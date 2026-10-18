/**
 * Where the app's code lives and where its settings live, independent of the
 * directory it happened to be started from.
 *
 * Several stores used to resolve their file against `process.cwd()`. That is
 * the repo root when someone runs `npm run dev` in a checkout, and nothing
 * useful in any other launch: a desktop entry starts with the home folder as
 * the working directory, an installed app lives somewhere read-only, and a
 * service starts at `/`. Saving a setting then threw (`mkdir config` failed)
 * or wrote into a random folder, so the setting did not stick. Settings now go
 * to the user's own data folder, which is always writable and is the same on
 * every launch.
 */
import { existsSync, mkdirSync, readFileSync, accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folder that holds package.json for this app: dist/ lives directly inside it. */
export function codeRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, 'utf8')).name === 'neuroclaw') return dir;
      } catch { /* keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Per-user data folder. Same rule as user-context.baseDir(), kept here so settings code has no dependency on accounts. */
export function dataRoot(): string {
  return process.env.CORONA_DATA_DIR ? path.resolve(process.env.CORONA_DATA_DIR) : path.join(homedir(), '.neuroclaw');
}

/** Small JSON config files (switches, safety, settings) live here. */
export function configRoot(): string {
  return path.join(dataRoot(), 'config');
}

/**
 * Resolve a config file for reading and writing.
 *
 * `write` is always inside the user's data folder. `read` is the same file, or,
 * when that does not exist yet, the older cwd-relative copy (`config/<name>`
 * in the checkout) so a person who already had switches set keeps them. The
 * next save writes to the new place and the old file is never touched.
 */
export function configFile(name: string, override?: string | undefined): { write: string; read: string } {
  if (override) {
    const abs = path.resolve(override);
    return { write: abs, read: abs };
  }
  const write = path.join(configRoot(), name);
  if (existsSync(write)) return { write, read: write };
  const legacy = path.join(codeRoot(), 'config', name);
  return { write, read: existsSync(legacy) ? legacy : write };
}

/** True when files can be created in `dir` (creating `dir` first if it does not exist). */
export function canWriteDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
