/**
 * The writable copy of the app that a packaged build runs from.
 *
 * The backend resolves several folders (wiki, store, config, extension-builder,
 * generated) against its working directory and writes into them. An installed
 * app lives somewhere read-only or shared (/opt, a signed .app bundle, Program
 * Files), so running from there fails the first time it saves anything. Instead
 * the launcher keeps a per-user copy with the same layout as the source tree
 * and runs from that.
 *
 *   code      (dist/, scripts/, package.json, build-info.json, models && skills/onebrain)
 *             replaced whenever the installed build differs from the copy, so an
 *             update takes effect, and nothing stale is left behind.
 *   state     (wiki, store, config, generated, extension-builder)
 *             seeded from the build only for files that do not exist yet, and
 *             never overwritten or deleted: what the person made or changed is theirs.
 *
 * Node built-ins only. Pure file operations, so test/platform/packaging.test.mjs
 * exercises it directly.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

export const CODE_ENTRIES = ['dist', 'scripts', 'package.json', 'build-info.json', 'models && skills'];
export const STATE_DIRS = ['wiki', 'store', 'config', 'generated', 'extension-builder'];
const STAMP = '.app-home.json';

function readStamp(home) {
  try { return JSON.parse(readFileSync(path.join(home, STAMP), 'utf8')); } catch { return null; }
}

/** Copy files from `from` into `to` only where `to` has none; returns how many were added. */
function seed(from, to) {
  let added = 0;
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (statSync(src).isDirectory()) added += seed(src, dst);
    else if (!existsSync(dst)) { cpSync(src, dst); added++; }
  }
  return added;
}

/**
 * @param {{payloadDir: string, homeDir: string}} o  payloadDir has the same layout as the repo
 * @returns {{action: 'installed'|'updated'|'current', version: string, seeded: number}}
 */
export function syncAppHome({ payloadDir, homeDir }) {
  const want = JSON.parse(readFileSync(path.join(payloadDir, 'build-info.json'), 'utf8'));
  const id = `${want.version}+${want.commit}`;
  const have = readStamp(homeDir);
  const complete = existsSync(path.join(homeDir, 'dist', 'interface', 'main.js'));
  let action = have && have.id === id && complete ? 'current' : have ? 'updated' : 'installed';
  mkdirSync(homeDir, { recursive: true });
  if (action !== 'current') {
    for (const entry of CODE_ENTRIES) {
      const src = path.join(payloadDir, entry);
      if (!existsSync(src)) continue;
      // Copy next to the old one, then swap, so a crash mid-update leaves the previous build runnable.
      const dst = path.join(homeDir, entry);
      const tmp = `${dst}.new`;
      rmSync(tmp, { recursive: true, force: true });
      cpSync(src, tmp, { recursive: true });
      rmSync(dst, { recursive: true, force: true });
      renameSync(tmp, dst);
    }
  }
  let seeded = 0;
  for (const dir of STATE_DIRS) seeded += seed(path.join(payloadDir, dir), path.join(homeDir, dir));
  if (action !== 'current') writeFileSync(path.join(homeDir, STAMP), JSON.stringify({ id, version: want.version, commit: want.commit, at: new Date().toISOString() }, null, 2));
  return { action, version: want.version, seeded };
}
