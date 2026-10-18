#!/usr/bin/env node
/**
 * Write release-manifest.json and SHA256SUMS for the files in a directory.
 *
 *   node scripts/release/manifest.mjs <artifactsDir> --commit <40-hex> [--channel stable|beta|dev]
 *                                     [--signed kind,kind] [--out <dir>]
 *
 * Only files that really exist are listed, each with its SHA-256 and size; a platform
 * whose build failed simply has no entry. Which platform, architecture and kind a file is
 * comes from its name (the same names the packagers write), and anything in the directory
 * that is not a recognised release artifact is ignored. --signed names the kinds that were
 * genuinely code-signed with a real credential in this run; everything else is recorded as
 * "unsigned", so the manifest can never claim more than happened.
 *
 * The result is checked against the schema the app's update check enforces
 * (interface/platform/release-manifest.ts) before it is written.
 * Needs `node scripts/build-backend.mjs` first. Node built-ins only.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authority } from './version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Recognise a release artifact by file name; null for anything else. */
export function classify(name, version) {
  const v = version.replace(/[.+]/g, '\\$&');
  const rules = [
    [new RegExp(`^neuroclaw-${v}-linux-(x64|arm64)\\.deb$`), 'linux', 'linux-deb'],
    [new RegExp(`^neuroclaw-${v}-linux-(x64|arm64)\\.tar\\.gz$`), 'linux', 'linux-tarball'],
    [new RegExp(`^neuroclaw-${v}-windows-(x64|arm64)\\.exe$`), 'windows', 'windows-installer-exe'],
    [new RegExp(`^neuroclaw-${v}-windows-(x64|arm64)\\.zip$`), 'windows', 'windows-zip'],
    [new RegExp(`^neuroclaw-${v}-macos-(x64|arm64)\\.dmg$`), 'macos', 'macos-dmg'],
    [new RegExp(`^neuroclaw-${v}-macos-(x64|arm64)\\.zip$`), 'macos', 'macos-app-zip'],
  ];
  for (const [re, platform, kind] of rules) { const m = re.exec(name); if (m) return { platform, arch: m[1], kind }; }
  if (name === `neuroclaw-chrome-extension-${version}.zip`) return { platform: 'chromeos', arch: 'any', kind: 'chrome-extension-zip' };
  if (name === `neuroclaw-${version}-android-any.apk`) return { platform: 'android', arch: 'any', kind: 'android-apk' };
  return null;
}

export async function buildManifest({ dir, commit, channel = 'dev', signed = [], now = new Date() }) {
  const version = authority();
  const artifacts = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (!statSync(full).isFile()) continue;
    const c = classify(name, version);
    if (!c) continue;
    const data = readFileSync(full);
    artifacts.push({ name, platform: c.platform, arch: c.arch, kind: c.kind, sha256: createHash('sha256').update(data).digest('hex'), size: data.length, signing: signed.includes(c.kind) ? 'signed' : 'unsigned' });
  }
  if (!artifacts.length) throw new Error(`no release artifacts for version ${version} in ${dir}`);
  const manifest = { schema: 1, version, channel, commit, builtAt: now.toISOString(), artifacts };
  const { validateManifest } = await import(pathToFileURL(path.join(ROOT, 'dist', 'interface', 'platform', 'release-manifest.js')).href);
  return validateManifest(manifest);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const dir = a.find((x, i) => !x.startsWith('--') && !['--commit', '--channel', '--signed', '--out'].includes(a[i - 1]));
  if (!dir || !opt('--commit')) { console.error('usage: manifest.mjs <artifactsDir> --commit <sha> [--channel c] [--signed kinds] [--out dir]'); process.exit(2); }
  try {
    const out = path.resolve(opt('--out') || dir);
    const m = await buildManifest({ dir: path.resolve(dir), commit: opt('--commit'), channel: opt('--channel') || 'dev', signed: (opt('--signed') || '').split(',').filter(Boolean) });
    writeFileSync(path.join(out, 'release-manifest.json'), JSON.stringify(m, null, 2) + '\n');
    writeFileSync(path.join(out, 'SHA256SUMS'), m.artifacts.map((x) => `${x.sha256}  ${x.name}`).join('\n') + '\n');
    console.log(`release-manifest.json: ${m.artifacts.length} artifact(s) for ${m.version} (${m.commit.slice(0, 8)}, ${m.channel})`);
  } catch (e) { console.error(`manifest failed: ${e.message}`); process.exit(1); }
}
