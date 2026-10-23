/**
 * node:zlib's gzipSync/gunzipSync, without node:zlib and without a
 * third-party compression package (this project writes its own: AGENTS.md).
 *
 * gzipSync here writes a spec-valid GZIP stream (RFC 1952) whose DEFLATE
 * payload (RFC 1951) uses only "stored" (uncompressed) blocks -- so the bytes
 * are not shrunk, but they are byte-for-byte a real gzip file: any standard
 * gunzip, including Node's own zlib, can decode them. gunzipSync is a full
 * RFC 1951 inflate (stored, fixed-Huffman and dynamic-Huffman blocks), so it
 * can decode anything a real gzip encoder produces, not just this file's own
 * output.
 *
 * Used only for round-trips within one device (packZip/unpackZip in
 * models && skills/core/zip-halt.ts read back exactly what they wrote on the
 * same phone), so the lack of real compression costs nothing here.
 */
import { Buffer } from "./buffer-shim.js";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** RFC 1951 §3.2.4: one or more "stored" (BTYPE=00) blocks, each at most 65535 bytes. */
function deflateStore(data: Uint8Array): Uint8Array {
  const MAX_BLOCK = 0xffff;
  const blockCount = Math.max(1, Math.ceil(data.length / MAX_BLOCK));
  const out = new Uint8Array(blockCount * 5 + data.length);
  let pos = 0;
  let offset = 0;
  for (let i = 0; i < blockCount; i++) {
    const isLast = i === blockCount - 1;
    const chunk = data.subarray(offset, offset + MAX_BLOCK);
    out[pos++] = isLast ? 1 : 0; // BFINAL in bit 0, BTYPE=00 in bits 1-2 (already 0), byte-aligned after this
    const len = chunk.length;
    out[pos++] = len & 0xff;
    out[pos++] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    out[pos++] = nlen & 0xff;
    out[pos++] = (nlen >>> 8) & 0xff;
    out.set(chunk, pos);
    pos += chunk.length;
    offset += chunk.length;
  }
  return out.subarray(0, pos);
}

/** Canonical Huffman decoder built from a list of code lengths (RFC 1951 §3.2.2). */
class HuffmanTable {
  private readonly counts: Uint16Array;
  private readonly symbols: Uint16Array;

  constructor(lengths: number[]) {
    const maxBits = Math.max(0, ...lengths);
    this.counts = new Uint16Array(maxBits + 1);
    for (const len of lengths) if (len > 0) this.counts[len]++;
    const offsets = new Uint16Array(maxBits + 2);
    for (let i = 1; i <= maxBits; i++) offsets[i + 1] = offsets[i] + this.counts[i];
    this.symbols = new Uint16Array(lengths.length);
    for (let sym = 0; sym < lengths.length; sym++) {
      const len = lengths[sym];
      if (len > 0) this.symbols[offsets[len]++] = sym;
    }
  }

  /** Reads one symbol bit-by-bit (slow but simple and unmistakably correct). */
  decode(reader: BitReader): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < this.counts.length; len++) {
      code |= reader.bit();
      const count = this.counts[len];
      if (code - first < count) return this.symbols[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error("invalid deflate stream: no matching Huffman code");
  }
}

class BitReader {
  private pos = 0;
  private bitBuf = 0;
  private bitCount = 0;
  constructor(private readonly data: Uint8Array) {}

  bit(): number {
    if (this.bitCount === 0) {
      if (this.pos >= this.data.length) throw new Error("invalid deflate stream: unexpected end");
      this.bitBuf = this.data[this.pos++];
      this.bitCount = 8;
    }
    const b = this.bitBuf & 1;
    this.bitBuf >>>= 1;
    this.bitCount--;
    return b;
  }

  bits(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) value |= this.bit() << i;
    return value;
  }

  alignToByte(): void {
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  readByte(): number {
    if (this.pos >= this.data.length) throw new Error("invalid deflate stream: unexpected end");
    return this.data[this.pos++];
  }
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function fixedLiteralTable(): HuffmanTable {
  const lengths = new Array<number>(288);
  for (let i = 0; i <= 143; i++) lengths[i] = 8;
  for (let i = 144; i <= 255; i++) lengths[i] = 9;
  for (let i = 256; i <= 279; i++) lengths[i] = 7;
  for (let i = 280; i <= 287; i++) lengths[i] = 8;
  return new HuffmanTable(lengths);
}

function fixedDistanceTable(): HuffmanTable {
  return new HuffmanTable(new Array<number>(30).fill(5));
}

/** RFC 1951 full raw inflate: stored, fixed-Huffman, and dynamic-Huffman blocks. */
function inflateRaw(data: Uint8Array): Uint8Array {
  const reader = new BitReader(data);
  const chunks: number[] = [];

  function copyBlock(literals: HuffmanTable, distances: HuffmanTable): void {
    for (;;) {
      const sym = literals.decode(reader);
      if (sym < 256) {
        chunks.push(sym);
      } else if (sym === 256) {
        return;
      } else {
        const li = sym - 257;
        if (li >= LENGTH_BASE.length) throw new Error("invalid deflate stream: bad length symbol");
        const length = LENGTH_BASE[li] + reader.bits(LENGTH_EXTRA[li]);
        const distSym = distances.decode(reader);
        if (distSym >= DIST_BASE.length) throw new Error("invalid deflate stream: bad distance symbol");
        const distance = DIST_BASE[distSym] + reader.bits(DIST_EXTRA[distSym]);
        const start = chunks.length - distance;
        if (start < 0) throw new Error("invalid deflate stream: back-reference before start of output");
        for (let i = 0; i < length; i++) chunks.push(chunks[start + i]);
      }
    }
  }

  for (;;) {
    const final = reader.bit();
    const type = reader.bits(2);
    if (type === 0) {
      reader.alignToByte();
      const len = reader.readByte() | (reader.readByte() << 8);
      reader.readByte(); // NLEN low byte
      reader.readByte(); // NLEN high byte
      for (let i = 0; i < len; i++) chunks.push(reader.readByte());
    } else if (type === 1) {
      copyBlock(fixedLiteralTable(), fixedDistanceTable());
    } else if (type === 2) {
      const hlit = reader.bits(5) + 257;
      const hdist = reader.bits(5) + 1;
      const hclen = reader.bits(4) + 4;
      const codeLengthLengths = new Array<number>(19).fill(0);
      for (let i = 0; i < hclen; i++) codeLengthLengths[CODE_LENGTH_ORDER[i]] = reader.bits(3);
      const codeLengthTable = new HuffmanTable(codeLengthLengths);
      const allLengths: number[] = [];
      while (allLengths.length < hlit + hdist) {
        const sym = codeLengthTable.decode(reader);
        if (sym < 16) {
          allLengths.push(sym);
        } else if (sym === 16) {
          const prev = allLengths[allLengths.length - 1] ?? 0;
          const repeat = reader.bits(2) + 3;
          for (let i = 0; i < repeat; i++) allLengths.push(prev);
        } else if (sym === 17) {
          const repeat = reader.bits(3) + 3;
          for (let i = 0; i < repeat; i++) allLengths.push(0);
        } else {
          const repeat = reader.bits(7) + 11;
          for (let i = 0; i < repeat; i++) allLengths.push(0);
        }
      }
      const literalTable = new HuffmanTable(allLengths.slice(0, hlit));
      const distanceTable = new HuffmanTable(allLengths.slice(hlit, hlit + hdist));
      copyBlock(literalTable, distanceTable);
    } else {
      throw new Error("invalid deflate stream: reserved block type");
    }
    if (final) break;
  }
  return Uint8Array.from(chunks);
}

const GZIP_MAGIC = [0x1f, 0x8b];

export function gzipSync(data: Uint8Array): Buffer {
  const deflated = deflateStore(data);
  const header = new Uint8Array([
    GZIP_MAGIC[0], GZIP_MAGIC[1],
    8, // CM = deflate
    0, // FLG = none
    0, 0, 0, 0, // MTIME = unset
    0, // XFL
    255, // OS = unknown
  ]);
  const crc = crc32(data);
  const size = data.length >>> 0;
  const footer = new Uint8Array([
    crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, (crc >>> 24) & 0xff,
    size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, (size >>> 24) & 0xff,
  ]);
  return Buffer.concat([Buffer.from(header), Buffer.from(deflated), Buffer.from(footer)]);
}

export function gunzipSync(data: Uint8Array): Buffer {
  if (data.length < 18 || data[0] !== GZIP_MAGIC[0] || data[1] !== GZIP_MAGIC[1]) {
    throw new Error("not a gzip stream");
  }
  if (data[2] !== 8) throw new Error("unsupported gzip compression method");
  const flg = data[3];
  let offset = 10;
  if (flg & 0x04) { // FEXTRA
    const xlen = data[offset] | (data[offset + 1] << 8);
    offset += 2 + xlen;
  }
  if (flg & 0x08) { // FNAME
    while (data[offset] !== 0) offset++;
    offset++;
  }
  if (flg & 0x10) { // FCOMMENT
    while (data[offset] !== 0) offset++;
    offset++;
  }
  if (flg & 0x02) offset += 2; // FHCRC
  const payload = data.subarray(offset, data.length - 8);
  const inflated = inflateRaw(payload);
  const expectedSize = data[data.length - 4] | (data[data.length - 3] << 8) | (data[data.length - 2] << 16) | (data[data.length - 1] << 24);
  if ((inflated.length >>> 0) !== (expectedSize >>> 0)) throw new Error("gzip size mismatch");
  return Buffer.from(inflated);
}
