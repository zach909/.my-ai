#!/usr/bin/env node
/**
 * Runs every test file in this directory and exits non-zero if any of them
 * did, without a later file being skipped just because an earlier one
 * failed -- `a && b` in the "test" script would do exactly that, silently
 * hiding whatever "test b" would have reported the moment "test a" broke.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = ['ipc-handlers.test.js', 'doctor.test.mjs'];

let anyFailed = false;
for (const file of FILES) {
  console.log(`\n--- ${file} ---`);
  const result = spawnSync(process.execPath, [path.join(HERE, file)], { stdio: 'inherit' });
  if (result.status !== 0) anyFailed = true;
}
process.exit(anyFailed ? 1 : 0);
