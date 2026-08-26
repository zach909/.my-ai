// Build the Neuroclaw Node/TypeScript backend into `dist/`.
//
// The backend is a mix of TypeScript sources (compiled by tsc via
// tsconfig.backend.json) and a handful of modules that ship only as compiled
// `.js` (no `.ts` source). tsc naturally skips the latter, so after the type
// compile we copy every `.js` that has no corresponding `.ts` sibling into the
// matching `dist/` location. The end result is a fully wired `dist/` tree that
// the smoke suite (test/smoke.mjs) loads via file URLs.

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = process.cwd();
// Resolve tsc from the standard node_modules/.bin location rather than the
// fragile committed .bin/tsc symlink, which dangles until `npm install` runs.
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc');

// Directories that make up the backend runtime.
const DIRS = [
  'models && skills',
  'models && skills/core',
  'interface',
  'plugins',
  'plugins/extensions',
  'plugin_manager',
  'extension-builder',
];

// 1. Type-check + emit the TypeScript half.
if (!existsSync(TSC)) {
  console.error('✗ tsc not found at', TSC);
  console.error('  Run `npm install` (or `bun install` / `pnpm install`) first to install dependencies.');
  process.exit(1);
}
console.log('› tsc -p tsconfig.backend.json');
execFileSync(TSC, ['-p', 'tsconfig.backend.json'], { stdio: 'inherit', cwd: ROOT });

// 2. Copy JS-only modules (no .ts sibling) that tsc could not have emitted.
let copied = 0;
for (const dir of DIRS) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) continue;
  for (const entry of readdirSync(abs)) {
    if (!entry.endsWith('.js')) continue;
    const base = entry.slice(0, -3);
    const tsSibling = join(abs, `${base}.ts`);
    if (existsSync(tsSibling)) continue; // tsc already emitted this one
    const dest = join(ROOT, 'dist', dir, entry);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(abs, entry), dest);
    copied++;
  }
}
console.log(`› copied ${copied} JS-only module(s) into dist/`);
console.log('✓ backend build complete');
