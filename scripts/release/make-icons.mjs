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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { renderIconPng } = await import(pathToFileURL(path.join(ROOT, 'dist', 'interface', 'platform', 'icon.js')).href);

export const EXTENSION_ICONS = [16, 32, 48, 128].map((s) => ({ file: `browser-extension/icons/icon-${s}.png`, size: s }));

const check = process.argv.includes('--check');
let bad = 0;
for (const { file, size } of EXTENSION_ICONS) {
  const want = renderIconPng(size);
  const abs = path.join(ROOT, file);
  if (check) {
    if (!existsSync(abs) || !readFileSync(abs).equals(want)) { console.error(`stale icon: ${file}`); bad++; }
  } else {
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, want);
    console.log(`wrote ${file}`);
  }
}
if (bad) process.exit(1);
