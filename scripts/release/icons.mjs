/**
 * Icon container formats written by hand: Windows .ico and macOS .icns, both
 * built from the PNGs that interface/platform/icon.ts renders. Both formats
 * accept PNG data directly, so no image conversion is involved.
 * Node built-ins only.
 */

/** @param {Array<{size: number, png: Buffer}>} images */
export function makeIco(images) {
  const sorted = [...images].sort((a, b) => a.size - b.size);
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sorted.length, 4);
  let offset = 6 + 16 * sorted.length;
  const dir = [];
  for (const { size, png } of sorted) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size; e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    dir.push(e);
    offset += png.length;
  }
  return Buffer.concat([head, ...dir, ...sorted.map((i) => i.png)]);
}

const ICNS_TYPES = { 16: 'icp4', 32: 'icp5', 64: 'icp6', 128: 'ic07', 256: 'ic08', 512: 'ic09' };

/** @param {Array<{size: number, png: Buffer}>} images sizes from 16 to 512 */
export function makeIcns(images) {
  const parts = [];
  for (const { size, png } of [...images].sort((a, b) => a.size - b.size)) {
    const type = ICNS_TYPES[size];
    if (!type) throw new Error(`no icns type for size ${size}`);
    const h = Buffer.alloc(8);
    h.write(type, 0, 'ascii'); h.writeUInt32BE(png.length + 8, 4);
    parts.push(h, png);
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii'); head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}
