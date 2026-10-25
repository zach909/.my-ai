#!/usr/bin/env node
/**
 * build-native.mjs -- compile and test the Rust kernels in native/.
 * Node built-ins only; the compiler is `rustc` (the language's own toolchain).
 * There is deliberately no Cargo.toml: this repo takes no crates, and the
 * no-third-party check rejects Cargo manifests.
 *
 *   node scripts/build-native.mjs          run the unit tests
 *   node scripts/build-native.mjs --lib    also build native/target/libneuroclaw_native.rlib
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'native', 'target');
const SRC = path.join(ROOT, 'native', 'lib.rs');
mkdirSync(OUT, { recursive: true });

function rustc(args) {
  const r = spawnSync('rustc', ['--edition', '2021', '--crate-name', 'neuroclaw_native', SRC, ...args], { stdio: 'inherit' });
  if (r.error) {
    console.error(`could not run rustc: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

rustc(['--test', '-o', path.join(OUT, 'tests')]);
const t = spawnSync(path.join(OUT, 'tests'), { stdio: 'inherit' });
if (t.status !== 0) process.exit(t.status ?? 1);

if (process.argv.includes('--lib')) rustc(['--crate-type', 'rlib', '-O', '--out-dir', OUT]);
