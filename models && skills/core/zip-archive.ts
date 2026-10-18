/**
 * A small ZIP writer and reader, written here on Node's own zlib so no package
 * is needed. It handles exactly what an export of text files needs: stored or
 * deflated entries, UTF-8 names, no encryption, no ZIP64, no multi-disk.
 *
 * The reader assumes the file is hostile (it is whatever someone chose to
 * import): every size is checked against a limit BEFORE anything is inflated,
 * inflating is capped at the size the entry declares, the checksum is checked
 * afterwards, and names are only ever returned, never used as paths.
 */

import { deflateRawSync, inflateRawSync } from "node:zlib";

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export interface ZipLimits {
  maxEntries: number;
  /** Largest any one entry may be once inflated. */
  maxEntryBytes: number;
  /** Largest all entries may be together once inflated. */
  maxTotalBytes: number;
}

export const DEFAULT_LIMITS: ZipLimits = { maxEntries: 20_000, maxEntryBytes: 16 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024 };

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Build a ZIP file holding `entries`. */
export function writeZip(entries: ZipEntry[], when = new Date()): Buffer {
  if (entries.length > 0xfffe) throw new ZipError("Too many files for one zip.");
  const { time, date } = dosTime(when);
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    if (name.length === 0 || name.length > 0xffff) throw new ZipError("Bad file name.");
    const crc = crc32(e.data);
    const deflated = deflateRawSync(e.data);
    const useDeflate = deflated.length < e.data.length;
    const body = useDeflate ? deflated : e.data;
    const method = useDeflate ? 8 : 0;
    if (body.length > 0xfffffffe || e.data.length > 0xfffffffe) throw new ZipError("A file is too big for a plain zip.");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(SIG_CENTRAL, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(UTF8_FLAG, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(e.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);

    offset += local.length + name.length + body.length;
    if (offset > 0xfffffffe) throw new ZipError("The zip would be too big.");
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBytes, end]);
}

/** Read every file in a ZIP, refusing anything malformed, encrypted, oversized or whose checksum is wrong. */
export function readZip(buf: Buffer, limits: ZipLimits = DEFAULT_LIMITS): ZipEntry[] {
  if (buf.length < 22) throw new ZipError("That is not a zip file.");
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_END) { end = i; break; }
  }
  if (end < 0) throw new ZipError("That is not a zip file.");
  const count = buf.readUInt16LE(end + 10);
  const centralSize = buf.readUInt32LE(end + 12);
  const centralOffset = buf.readUInt32LE(end + 16);
  if (count === 0xffff || centralOffset === 0xffffffff) throw new ZipError("Zip64 files are not supported.");
  if (count > limits.maxEntries) throw new ZipError(`That zip has more than ${limits.maxEntries} files.`);
  if (centralOffset + centralSize > end) throw new ZipError("The zip's index is damaged.");

  const out: ZipEntry[] = [];
  let total = 0;
  let p = centralOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw new ZipError("The zip's index is damaged.");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (next > end) throw new ZipError("The zip's index is damaged.");
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p = next;

    if (name.endsWith("/")) continue; // a folder entry carries nothing
    if (flags & ENCRYPTED_FLAG) throw new ZipError("Encrypted zips are not supported.");
    if (method !== 0 && method !== 8) throw new ZipError(`"${name}" uses a compression this reader does not support.`);
    if (usize === 0xffffffff || csize === 0xffffffff) throw new ZipError("Zip64 files are not supported.");
    if (usize > limits.maxEntryBytes) throw new ZipError(`"${name}" is larger than ${limits.maxEntryBytes} bytes.`);
    total += usize;
    if (total > limits.maxTotalBytes) throw new ZipError("That zip is too big once unpacked.");

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== SIG_LOCAL) throw new ZipError("The zip is damaged.");
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (start + csize > centralOffset) throw new ZipError("The zip is damaged.");
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(raw);
    } else {
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.max(1, usize) });
      } catch {
        throw new ZipError(`"${name}" would not unpack.`);
      }
    }
    if (data.length !== usize) throw new ZipError(`"${name}" is not the size it says.`);
    if (crc32(data) !== crc) throw new ZipError(`"${name}" is damaged (its checksum is wrong).`);
    out.push({ name, data });
  }
  return out;
}
