#!/usr/bin/env node
/**
 * Package the Chrome extension: browser-extension/ -> neuroclaw-chrome-extension-<version>.zip
 *
 *   node scripts/release/build-extension.mjs [outDir]     (default: release-artifacts/)
 *
 * The zip is what you upload to the Chrome Web Store, or unzip and "Load
 * unpacked" in developer mode. Only the listed files go in (never a stray file
 * from the folder), the version must match package.json, and the zip is
 * byte-for-byte reproducible for the same sources. Prints the artifact path.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './zip.mjs';
import { drift, authority } from './version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'browser-extension');

export const EXTENSION_FILES = [
  'manifest.json', 'background.js', 'connection.js', 'app.html', 'app.js', 'options.html', 'options.js',
  'popup.html', 'popup.js', 'ideas.json', 'ambient.css', 'ambient.js',
  'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png',
];

export function buildExtension(outDir = path.join(ROOT, 'release-artifacts')) {
  const bad = drift();
  if (bad.length) throw new Error(`version drift, run scripts/release/version.mjs sync: ${bad.map((b) => b.name).join(', ')}`);
  const manifest = JSON.parse(readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  // Everything the manifest points at must be in the package, or Chrome refuses to load it.
  const referenced = [manifest.background?.service_worker, manifest.options_ui?.page, ...Object.values(manifest.icons ?? {}), ...Object.values(manifest.action?.default_icon ?? {})].filter(Boolean);
  for (const f of referenced) if (!EXTENSION_FILES.includes(f)) throw new Error(`manifest references ${f}, which is not packaged`);
  const entries = EXTENSION_FILES.map((name) => {
    const file = path.join(SRC, name);
    if (!existsSync(file)) throw new Error(`missing extension file: browser-extension/${name}${name.startsWith('icons/') ? ' (run scripts/release/make-icons.mjs)' : ''}`);
    return { name, data: readFileSync(file) };
  });
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `neuroclaw-chrome-extension-${authority()}.zip`);
  writeFileSync(out, createZip(entries));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(buildExtension(process.argv[2] ? path.resolve(process.argv[2]) : undefined)); }
  catch (e) { console.error(`extension build failed: ${e.message}`); process.exit(1); }
}
