#!/usr/bin/env node
/**
 * Which builds does a change affect?
 *
 *   node scripts/release/changed-targets.mjs --base <sha> --head <sha>     (git diff between two commits)
 *   node scripts/release/changed-targets.mjs --files a.ts b.md             (explicit list)
 *   node scripts/release/changed-targets.mjs --all                         (everything: tags, releases, manual runs)
 *
 * Prints JSON, and when GITHUB_OUTPUT is set also writes `extension`, `linux`, `windows`, `macos`,
 * `android`, `ios`, `desktop`, `tests` and `any` as true/false for the workflow to gate jobs on.
 *
 * The rules are the dependency map of this repository, stated once: the engine and the shared interface
 * flow into every desktop package, the extension carries only its own files and the shared look, and the
 * phone apps load the shared interface from the server at run time, so only their own code, the OneBrain
 * model and the on-phone brain bundle (which they do embed) rebuild them. A change to the pipeline itself,
 * the version, or the lockfile rebuilds everything, so a broken pipeline is found by the change that broke it.
 * Documentation and tests alone rebuild nothing.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export const TARGETS = ['extension', 'linux', 'windows', 'macos', 'android', 'ios'];

const DESKTOP = ['linux', 'windows', 'macos'];
const RULES = [
  // [pattern, targets]
  [/^(\.github\/workflows\/|package\.json$|package-lock\.json$|scripts\/release\/(version|manifest|zip|packaging|changed-targets|summary)\.mjs$)/, TARGETS],
  [/^(interface|models && skills|plugins|plugin_manager|extension_system|extension-builder|tsconfig\.backend\.json)(\/|$)/, [...DESKTOP]],
  [/^(src\/(index\.ts|lib\/error-log\.ts|server\/)|config\/|wiki\/|generated\/)/, [...DESKTOP]],
  [/^scripts\/(desktop-launcher\.mjs|build-backend\.mjs|learning-loader\.mjs|release\/(stage-app|app-home|icons|package-(linux|windows|macos))\.mjs|release\/macos\/)/, [...DESKTOP]],
  [/^scripts\/[^/]+\.mjs$/, [...DESKTOP]],
  // The extension embeds the shared look and the icon renderer's output.
  [/^(browser-extension\/|interface\/ambient\.ts$|interface\/platform\/icon\.ts$|scripts\/release\/(build-extension|make-icons)\.mjs$)/, ['extension']],
  // Phone apps embed the OneBrain model and the on-phone brain bundle; the interface itself is fetched from the server.
  [/^mobile\/android\//, ['android']],
  [/^mobile\/ios\//, ['ios']],
  [/^(mobile\/brain\/|models && skills\/onebrain\/)/, ['android', 'ios']],
];
// Files that are only documentation or tests.
const INERT = /^(docs\/|wiki\/(?!.*\.(json|js|ts)$)|test\/|tests\/|[^/]+\.md$|\.githooks\/|\.claude\/|\.third-party-allowlist\.json$|AGENTS\.md$)/;

/** @param {string[]} files */
export function affectedTargets(files) {
  const hit = new Set();
  let unmatched = false;
  let tests = false;
  for (const f of files) {
    if (/^test\//.test(f) || /^tests\//.test(f)) tests = true;
    let matched = false;
    for (const [re, targets] of RULES) if (re.test(f)) { targets.forEach((t) => hit.add(t)); matched = true; }
    if (!matched && !INERT.test(f)) unmatched = true;
  }
  // Source files this map has no opinion about: be safe and rebuild the desktop packages rather than silently ship stale ones.
  if (unmatched) DESKTOP.forEach((t) => hit.add(t));
  const out = Object.fromEntries(TARGETS.map((t) => [t, hit.has(t)]));
  out.desktop = DESKTOP.some((t) => hit.has(t));
  out.tests = tests || files.some((f) => !INERT.test(f));
  out.any = TARGETS.some((t) => hit.has(t));
  return out;
}

function main() {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  let result;
  if (a.includes('--all')) {
    result = { ...Object.fromEntries(TARGETS.map((t) => [t, true])), desktop: true, tests: true, any: true };
  } else if (a.includes('--files')) {
    result = affectedTargets(a.slice(a.indexOf('--files') + 1).filter((x) => !x.startsWith('--')));
  } else {
    const base = opt('--base'), head = opt('--head') || 'HEAD';
    // A new branch's first push has an all-zero "before"; there is nothing to compare, so build everything.
    if (!base || /^0+$/.test(base)) result = { ...Object.fromEntries(TARGETS.map((t) => [t, true])), desktop: true, tests: true, any: true };
    else {
      let files;
      try { files = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' }).split('\n').filter(Boolean); }
      catch { files = execFileSync('git', ['diff', '--name-only', base, head], { encoding: 'utf8' }).split('\n').filter(Boolean); }
      result = affectedTargets(files);
    }
  }
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) main();
