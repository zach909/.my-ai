#!/usr/bin/env node
/**
 * Write the app icon (the coral cord around the glowing sphere, drawn by
 * interface/platform/icon.ts) as PNG files for the places that need real files:
 * the Chrome extension, and the packaging of every desktop platform.
 *
 *   node scripts/release/make-icons.mjs [--check]
 *
 * Needs `npm run build:backend` first (it imports the compiled icon renderer).
 * --check fails when a committed icon differs from what the renderer produces,
 * so the icon cannot drift from the look.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { renderIconPng } = await import(pathToFileURL(path.join(ROOT, 'dist', 'interface', 'platform', 'icon.js')).href);

export const EXTENSION_ICONS = [16, 32, 48, 128].map((s) => ({ file: `browser-extension/icons/icon-${s}.png`, size: s }));

/** Header and decompressed pixel rows of a PNG. Two Node versions can compress the same image to different bytes, so --check compares this, not the file. */
const pixels = (png) => {
  const idat = [];
  let header = null;
  for (let at = 8; at + 8 <= png.length;) {
    const len = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') header = body;
    else if (type === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  return Buffer.concat([header ?? Buffer.alloc(0), inflateSync(Buffer.concat(idat))]);
};
const same = (a, b) => { try { return pixels(a).equals(pixels(b)); } catch { return false; } };

const check = process.argv.includes('--check');
let bad = 0;
for (const { file, size } of EXTENSION_ICONS) {
  const want = renderIconPng(size);
  const abs = path.join(ROOT, file);
  if (check) {
    if (!existsSync(abs) || !same(readFileSync(abs), want)) { console.error(`stale icon: ${file}`); bad++; }
  } else {
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, want);
    console.log(`wrote ${file}`);
  }
}
if (bad) process.exit(1);
