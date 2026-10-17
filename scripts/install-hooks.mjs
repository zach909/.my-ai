#!/usr/bin/env node
/**
 * Points git at .githooks/ so the no-third-party check runs before every
 * commit and push. Runs from the `prepare` script, so `npm install` sets it
 * up. Silent and harmless when there is no .git (a tarball, a CI cache).
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(ROOT, '.git'))) {
  try {
    for (const hook of ['pre-commit', 'pre-push']) {
      const file = path.join(ROOT, '.githooks', hook);
      if (existsSync(file)) chmodSync(file, 0o755);
    }
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    /* not fatal: CI still runs the same check */
  }
}
