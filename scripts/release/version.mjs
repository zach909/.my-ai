#!/usr/bin/env node
/**
 * One application version.
 *
 *   node scripts/release/version.mjs            show the version and every place it is carried
 *   node scripts/release/version.mjs check      exit 1 if any place disagrees with package.json
 *   node scripts/release/version.mjs sync       write package.json's version into every place
 *   node scripts/release/version.mjs set 1.2.3  change package.json, then sync
 *
 * package.json "version" is the authority. The places that must carry a copy
 * because their tools read the version from their own file are listed in
 * TARGETS. test/platform/version.test.mjs runs `check`, so a build with a
 * drifted version fails before it can produce an artifact that disagrees with
 * the one it came from. Node built-ins only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parse(v) {
  const m = SEMVER.exec(v);
  if (!m) throw new Error(`"${v}" is not a version like 1.2.3 or 1.2.3-beta.1`);
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '' };
}

/** Android versionCode: 1.2.3 -> 10203. */
export function versionCode(v) {
  const { major, minor, patch } = parse(v);
  if (minor > 99 || patch > 99) throw new Error('minor and patch must stay below 100');
  return major * 10000 + minor * 100 + patch;
}

/** iOS CFBundleVersion / Chrome numeric version: the three numbers, build counter appended (iOS wants a rising integer). */
export const iosBuild = (v) => String(versionCode(v));
/** Chrome's manifest "version" accepts 1 to 4 dot-separated integers and no prerelease text. */
export const chromeVersion = (v) => { const p = parse(v); return `${p.major}.${p.minor}.${p.patch}`; };

const file = (rel) => path.join(ROOT, rel);
const readJson = (rel) => JSON.parse(readFileSync(file(rel), 'utf8'));
const readText = (rel) => readFileSync(file(rel), 'utf8');
const writeJson = (rel, obj) => writeFileSync(file(rel), JSON.stringify(obj, null, 2) + '\n');

/** Each target knows how to read the version it carries and how to write a new one. */
export const TARGETS = [
  { name: 'browser-extension/manifest.json', get: () => { const j = readJson('browser-extension/manifest.json'); return `${j.version}|${j.version_name ?? ''}`; },
    want: (v) => `${chromeVersion(v)}|${parse(v).pre ? v : ''}`,
    set: (v) => { const j = readJson('browser-extension/manifest.json'); j.version = chromeVersion(v); if (parse(v).pre) j.version_name = v; else delete j.version_name; writeJson('browser-extension/manifest.json', j); } },
  { name: 'mobile/android build.gradle.kts', get: () => { const t = readText('mobile/android/app/build.gradle.kts'); return `${/versionName = "([^"]+)"/.exec(t)?.[1]}|${/versionCode = (\d+)/.exec(t)?.[1]}`; },
    want: (v) => `${v}|${versionCode(v)}`,
    set: (v) => { const rel = 'mobile/android/app/build.gradle.kts'; writeFileSync(file(rel), readText(rel).replace(/versionName = "[^"]+"/, `versionName = "${v}"`).replace(/versionCode = \d+/, `versionCode = ${versionCode(v)}`)); } },
  { name: 'mobile/ios project.yml', get: () => { const t = readText('mobile/ios/project.yml'); return `${/MARKETING_VERSION: "([^"]+)"/.exec(t)?.[1]}|${/CURRENT_PROJECT_VERSION: "([^"]+)"/.exec(t)?.[1]}`; },
    want: (v) => `${v}|${iosBuild(v)}`,
    set: (v) => { const rel = 'mobile/ios/project.yml'; writeFileSync(file(rel), readText(rel).replace(/MARKETING_VERSION: "[^"]+"/, `MARKETING_VERSION: "${v}"`).replace(/CURRENT_PROJECT_VERSION: "[^"]+"/, `CURRENT_PROJECT_VERSION: "${iosBuild(v)}"`)); } },
];

export function authority() {
  const v = readJson('package.json').version;
  parse(v);
  return v;
}

/** Every target whose copy differs from what package.json implies. */
export function drift() {
  const v = authority();
  return TARGETS.map((t) => ({ name: t.name, have: String(t.get()), want: t.want(v) })).filter((r) => r.have !== r.want);
}

function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'set') {
    const j = readJson('package.json');
    parse(arg ?? '');
    j.version = arg;
    writeJson('package.json', j);
  }
  if (cmd === 'sync' || cmd === 'set') {
    const v = authority();
    for (const t of TARGETS) t.set(v);
    console.log(`version ${v} written to ${TARGETS.length} places`);
    return;
  }
  const v = authority();
  const bad = drift();
  if (cmd === 'check') {
    if (bad.length) {
      console.error(`version drift: package.json says ${v}`);
      for (const r of bad) console.error(`  ${r.name}: has ${r.have}, expected ${r.want}`);
      console.error('Run: node scripts/release/version.mjs sync');
      process.exit(1);
    }
    console.log(`version ${v}: all ${TARGETS.length} places agree`);
    return;
  }
  console.log(`version ${v} (package.json)`);
  for (const t of TARGETS) console.log(`  ${t.name}: ${t.get()}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
