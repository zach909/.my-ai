#!/usr/bin/env node
/**
 * Write the shared look (interface/ambient.ts) out as plain files for the pages
 * that cannot be served by the backend: the desktop app's own screens, the
 * browser extension popup, the launcher pages and the older pages in
 * interface/. Each loads its own copy, so there is still one definition.
 *
 *   npm run build:backend   (or tsc -p tsconfig.backend.json)   then
 *   node scripts/sync-ambient.mjs
 *
 * test/core/ambient-copies.test.ts fails when any copy drifts from the source.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { AMBIENT_CSS, AMBIENT_JS } = await import(pathToFileURL(join(root, 'dist', 'interface', 'ambient.js')).href);

export const AMBIENT_COPY_DIRS = [
  'desktop-app/src/renderer',
  'browser-extension',
  'interface/static',
];

for (const dir of AMBIENT_COPY_DIRS) {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, 'ambient.css'), AMBIENT_CSS);
  writeFileSync(join(root, dir, 'ambient.js'), AMBIENT_JS);
  console.log(`wrote ${dir}/ambient.css and ambient.js`);
}
