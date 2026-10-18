/**
 * The one application version, and what is known about this particular build.
 *
 * `package.json` "version" is the single authority. Every other place that
 * carries a version (the extension manifest, the desktop and phone projects,
 * release artifacts) is derived from it by scripts/release/version.mjs, and
 * test/platform/version.test.mjs fails if any of them drifts.
 *
 * A release build also writes `build-info.json` next to package.json with the
 * source commit, channel, platform and architecture it was built for. A plain
 * checkout has no such file, so it reports itself as a development build and
 * says which commit it is on, instead of pretending to be a release.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { codeRoot } from './app-paths.js';

export type Channel = 'stable' | 'beta' | 'dev';

export interface BuildInfo {
  version: string;
  commit: string | null;
  channel: Channel;
  platform: string | null;
  arch: string | null;
  builtAt: string | null;
  /** True when this is a packaged release build rather than a source checkout. */
  packaged: boolean;
}

export const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export interface Semver { major: number; minor: number; patch: number; pre: string[] }

export function parseSemver(v: string): Semver | null {
  const m = SEMVER.exec(String(v).trim().replace(/^v/, ''));
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

/** Negative when a < b, 0 when equal, positive when a > b (semver precedence). Null when either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return null;
  for (const k of ['major', 'minor', 'patch'] as const) if (x[k] !== y[k]) return x[k] - y[k];
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1;   // 1.0.0 is newer than 1.0.0-beta
  if (!y.pre.length) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) { if (+p !== +q) return +p - +q; }
    else if (pn) return -1;
    else if (qn) return 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

function readJson(file: string): Record<string, unknown> | null {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; } catch { return null; }
}

/** The authoritative version string from package.json. */
export function appVersion(root = codeRoot()): string {
  const v = readJson(path.join(root, 'package.json'))?.version;
  return typeof v === 'string' && parseSemver(v) ? v : '0.0.0';
}

let gitCommit: string | null | undefined;

function sourceCommit(root: string): string | null {
  if (gitCommit !== undefined) return gitCommit;
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 3000 });
    gitCommit = r.status === 0 && /^[0-9a-f]{40}$/.test(r.stdout.trim()) ? r.stdout.trim() : null;
  } catch {
    gitCommit = null;
  }
  return gitCommit;
}

export function getBuildInfo(root = codeRoot()): BuildInfo {
  const version = appVersion(root);
  const info = readJson(path.join(root, 'build-info.json'));
  if (info && typeof info.commit === 'string') {
    const channel: Channel = info.channel === 'beta' || info.channel === 'dev' ? info.channel : 'stable';
    return {
      version,
      commit: info.commit,
      channel,
      platform: typeof info.platform === 'string' ? info.platform : null,
      arch: typeof info.arch === 'string' ? info.arch : null,
      builtAt: typeof info.builtAt === 'string' ? info.builtAt : null,
      packaged: true,
    };
  }
  return { version, commit: sourceCommit(root), channel: 'dev', platform: null, arch: null, builtAt: null, packaged: false };
}

/** Numeric build code for stores that need an integer (Android versionCode). 1.2.3 -> 10203. */
export function versionCode(v: string): number {
  const s = parseSemver(v);
  if (!s) throw new Error(`not a version: ${v}`);
  if (s.minor > 99 || s.patch > 99) throw new Error('minor and patch must stay below 100 to fit the build code');
  return s.major * 10000 + s.minor * 100 + s.patch;
}
