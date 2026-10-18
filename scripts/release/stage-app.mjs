#!/usr/bin/env node
/**
 * Assemble the app payload that every desktop package wraps:
 *
 *   <out>/app/       package.json, build-info.json, dist/, scripts/, config/, wiki/, generated/,
 *                    extension-builder/, models && skills/onebrain/   (same layout as the repo)
 *   <out>/runtime/   the Node runtime the engine runs on (copied from the build machine's own node)
 *
 *   node scripts/release/stage-app.mjs <outDir> [--channel stable|beta|dev] [--commit <sha>] [--no-runtime]
 *
 * Needs `node scripts/build-backend.mjs` first. The payload holds no node_modules:
 * the backend uses only Node built-ins, which this checks by scanning the compiled
 * output. build-info.json records the source commit, version, channel, platform
 * and architecture, so every package, and the running app, can say what it is.
 *
 * The Node runtime is NOT committed to the repository or downloaded: it is the
 * `node` that runs this script on the CI runner for the target platform, copied
 * into the package so the app starts without Node being installed.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { authority, drift } from './version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const COPY = [
  { from: 'dist', to: 'dist', skip: (rel) => rel.startsWith('plugin_manager/registry-data') && false },
  { from: 'config', to: 'config', skip: (rel) => rel === 'access.json' || rel === 'Icon.obj' }, // access.json is one person's saved switches, not a default
  { from: 'wiki', to: 'wiki' },
  { from: 'generated', to: 'generated' },
  { from: 'extension-builder', to: 'extension-builder', skip: (rel) => /(^|\/)(node_modules|__pycache__|test|tests)(\/|$)/.test(rel) },
  { from: 'models && skills/onebrain', to: 'models && skills/onebrain' },
];

function copyDir(from, to, skip = () => false, base = from) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = path.join(from, name);
    const rel = path.relative(base, src).split(path.sep).join('/');
    if (skip(rel)) continue;
    if (statSync(src).isDirectory()) copyDir(src, path.join(to, name), skip, base);
    else copyFileSync(src, path.join(to, name));
  }
}

/** Fail the build if the compiled backend imports anything that is not a Node built-in or a relative file. */
export function assertNoPackages(distDir) {
  const builtins = new Set([...builtinModules, ...builtinModules.map((m) => m.replace(/^node:/, ''))]);
  const bad = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) { if (!['app', 'assets', 'builder', 'desktop'].includes(name) || dir !== distDir) walk(p); continue; }
      if (!/\.(m?js|cjs)$/.test(name)) continue;
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(/^\s*(?:import|export)\b[^'"\n]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
        const spec = m[1] || m[2] || m[3];
        if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
        if (!builtins.has(spec) && !builtins.has(spec.split('/')[0])) bad.add(`${path.relative(distDir, p)} -> ${spec}`);
      }
    }
  };
  walk(distDir);
  if (bad.size) throw new Error(`the compiled backend imports packages that the payload does not carry:\n  ${[...bad].join('\n  ')}`);
}

/**
 * A package that bundles Node must bundle all of it. Debian's and Ubuntu's own `node` is a small launcher that loads the
 * system's libnode, so copying it gives a package that only runs where Node happens to be installed. Refuse that, and say how
 * to get a self-contained runtime (the official nodejs.org build, which is a single executable of 80 MB or more).
 */
export function assertSelfContainedRuntime(file) {
  const size = statSync(file).size;
  let dynamic = false;
  if (process.platform === 'linux') {
    const r = spawnSync('ldd', [file], { encoding: 'utf8' });
    dynamic = /libnode/.test(r.stdout || '');
  }
  if (dynamic || size < 40 * 1024 * 1024) {
    throw new Error(`${file} is not a self-contained Node (${Math.round(size / 1048576)} MB${dynamic ? ', links the system libnode' : ''}). `
      + 'Build with the official nodejs.org Node 22 binary on PATH, or pass --no-runtime to stage without one. '
      + 'A package built from this runtime would only work on machines that already have Node installed.');
  }
}

export function stageApp({ out, channel = 'dev', commit = null, runtime = true }) {
  const bad = drift();
  if (bad.length) throw new Error(`version drift, run scripts/release/version.mjs sync: ${bad.map((b) => b.name).join(', ')}`);
  if (!existsSync(path.join(ROOT, 'dist', 'interface', 'main.js'))) throw new Error('dist/ is not built: run node scripts/build-backend.mjs first');
  assertNoPackages(path.join(ROOT, 'dist'));
  const version = authority();
  const sha = commit || process.env.GITHUB_SHA || (() => { const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; })();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('cannot determine the source commit (pass --commit <40-hex> or run inside the git checkout)');

  rmSync(out, { recursive: true, force: true });
  const app = path.join(out, 'app');
  mkdirSync(app, { recursive: true });
  for (const c of COPY) {
    const src = path.join(ROOT, c.from);
    if (!existsSync(src)) throw new Error(`missing ${c.from}`);
    copyDir(src, path.join(app, c.to), c.skip);
  }
  // Runtime scripts: the launcher, the agents the engine can start, and their helpers (not the release tooling).
  mkdirSync(path.join(app, 'scripts', 'release'), { recursive: true });
  for (const f of readdirSync(path.join(ROOT, 'scripts'))) {
    const src = path.join(ROOT, 'scripts', f);
    if (statSync(src).isFile() && /\.mjs$/.test(f) && !/^(check-no-third-party|install-hooks|stage-desktop-dist|sync-ambient|build-backend|dev|finalize-static-build|find-unreachable|launcher)\.mjs$/.test(f)) copyFileSync(src, path.join(app, 'scripts', f));
    else if (statSync(src).isDirectory() && ['drill-generators', 'exam-generators'].includes(f)) copyDir(src, path.join(app, 'scripts', f));
  }
  copyFileSync(path.join(ROOT, 'scripts', 'release', 'app-home.mjs'), path.join(app, 'scripts', 'release', 'app-home.mjs'));

  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: pkg.name, version, type: 'module', private: true }, null, 2) + '\n');
  const info = { version, commit: sha, channel, platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux', arch: process.arch, builtAt: new Date(process.env.SOURCE_DATE_EPOCH ? Number(process.env.SOURCE_DATE_EPOCH) * 1000 : Date.now()).toISOString() };
  writeFileSync(path.join(app, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');

  if (runtime) {
    const rt = path.join(out, 'runtime');
    mkdirSync(rt, { recursive: true });
    const dest = path.join(rt, process.platform === 'win32' ? 'node.exe' : 'node');
    assertSelfContainedRuntime(process.execPath);
    copyFileSync(process.execPath, dest);
    if (process.platform !== 'win32') chmodSync(dest, 0o755);
  }
  return { out, app, info };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const out = a.find((x) => !x.startsWith('--') && a[a.indexOf(x) - 1] !== '--channel' && a[a.indexOf(x) - 1] !== '--commit');
  if (!out) { console.error('usage: stage-app.mjs <outDir> [--channel stable|beta|dev] [--commit sha] [--no-runtime]'); process.exit(2); }
  try {
    const r = stageApp({ out: path.resolve(out), channel: opt('--channel') || 'dev', commit: opt('--commit'), runtime: !a.includes('--no-runtime') });
    console.log(`staged ${r.info.version} (${r.info.commit.slice(0, 8)}, ${r.info.platform}/${r.info.arch}) in ${r.out}`);
  } catch (e) { console.error(`stage failed: ${e.message}`); process.exit(1); }
}
