#!/usr/bin/env node
/**
 * check-no-third-party.mjs -- the lock behind the "no third-party code" rule
 * in AGENTS.md. Node built-ins only.
 *
 *   node scripts/check-no-third-party.mjs          scan every tracked or new file, exit 1 on any hit
 *   node scripts/check-no-third-party.mjs --json   same, as JSON
 *
 * It runs in four places so nothing slips past one of them: the git
 * pre-commit hook (.githooks/), CI (.github/workflows/no-third-party.yml),
 * the vitest suite (test/core/no-third-party.test.ts), and the Claude Code
 * hooks (.claude/hooks/block-third-party.mjs) that stop the assistant before
 * it installs or pastes anything.
 *
 * What it can and cannot see. It blocks declared packages, lockfiles,
 * vendored folders and binaries, imports of anything outside Node/Python/
 * platform built-ins, bundled or minified output, licence/copyright banners
 * of other people's code, and commands that fetch packages. It cannot tell
 * that a plain, banner-free function was pasted from a website; that part
 * is still on whoever writes the code.
 *
 * The only exceptions live in .third-party-allowlist.json (owner edits only).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOW = JSON.parse(readFileSync(path.join(ROOT, '.third-party-allowlist.json'), 'utf8'));

/** The guard's own files hold the very patterns they look for, so they are not scanned for content. */
export const GUARD_FILES = [
  'scripts/check-no-third-party.mjs',
  '.third-party-allowlist.json',
  '.claude/hooks/block-third-party.mjs',
  '.claude/settings.json',
  '.githooks/pre-commit',
  '.githooks/pre-push',
  '.github/workflows/no-third-party.yml',
  '.github/CODEOWNERS',
  'test/core/no-third-party.test.ts',
  'scripts/install-hooks.mjs',
];

const CODE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const TEXT_EXT = new Set([...CODE_EXT, '.py', '.kt', '.java', '.swift', '.sh', '.css', '.html', '.kts', '.gradle', '.yml', '.yaml', '.svg', '.xml']);
const BINARY_EXT = new Set([
  '.jar', '.aar', '.whl', '.so', '.dll', '.dylib', '.exe', '.a', '.lib', '.node', '.wasm',
  '.onnx', '.gguf', '.safetensors', '.pt', '.pth', '.ckpt', '.tflite', '.mlmodel', '.pb',
  '.zip', '.tar', '.tgz', '.gz', '.7z', '.rar', '.xz', '.bz2', '.apk', '.ipa', '.dmg', '.deb', '.rpm', '.iso',
]);
const VENDOR_DIR = /(^|\/)(node_modules|vendor|third[_-]?party|bower_components|Pods|Carthage|site-packages)\//i;
const OTHER_LOCKFILES = new Set([
  'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'Cargo.lock', 'poetry.lock', 'Pipfile.lock',
  'Gemfile.lock', 'go.sum', 'Podfile.lock', 'Package.resolved', 'composer.lock', 'uv.lock',
]);
const OTHER_MANIFESTS = new Set([
  'pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile', 'Cargo.toml', 'go.mod', 'Gemfile', 'Podfile',
  'Package.swift', 'composer.json', 'pom.xml', 'deno.json', 'bunfig.toml',
]);
const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => m.replace(/^node:/, ''))]);
const PY_STDLIB = new Set(`__future__ _thread abc argparse array ast asyncio atexit base64 bdb binascii bisect builtins bz2 calendar
cgi cmath cmd code codecs collections colorsys compileall concurrent configparser contextlib contextvars copy copyreg cProfile csv
ctypes curses dataclasses datetime dbm decimal difflib dis doctest email encodings enum errno faulthandler fcntl filecmp fileinput
fnmatch fractions ftplib functools gc getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http imaplib imghdr
importlib inspect io ipaddress itertools json keyword linecache locale logging lzma mailbox marshal math mimetypes mmap
multiprocessing netrc numbers operator optparse os pathlib pdb pickle pkgutil platform plistlib poplib posixpath pprint profile
pstats pty pwd py_compile queue quopri random re readline reprlib resource runpy sched secrets select selectors shelve shlex
shutil signal site smtplib socket socketserver sqlite3 ssl stat statistics string struct subprocess sys sysconfig syslog tarfile
tempfile termios textwrap threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle types typing
unicodedata unittest urllib uuid venv warnings wave weakref webbrowser xml xmlrpc zipapp zipfile zipimport zlib zoneinfo`.split(/\s+/));

/** @typedef {{rule: string, file: string, line: number, message: string}} Violation */

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const base = (p) => p.split('/').pop();
const ext = (p) => path.extname(p).toLowerCase();

function pkgName(spec) {
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
}

/** Is a JS/TS import specifier something this repo is allowed to import? */
function jsSpecOk(spec) {
  if (spec.startsWith('.') || spec.startsWith('/')) return true;
  if (spec.startsWith('node:')) return true;
  if (NODE_BUILTINS.has(spec) || NODE_BUILTINS.has(spec.split('/')[0])) return true;
  return ALLOW.npmPackages.includes(pkgName(spec));
}

function scanImports(file, text, out) {
  const e = ext(file);
  if (CODE_EXT.has(e)) {
    const NAMES = String.raw`(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?)`;
    const res = [
      new RegExp(String.raw`^[ \t]*import\s+${NAMES}\s+from\s*(['"])([^'"\n]+)\1`, 'gm'),
      new RegExp(String.raw`^[ \t]*export\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s*(['"])([^'"\n]+)\1`, 'gm'),
      /^[ \t]*import\s*(['"])([^'"\n]+)\1/gm,
      /(?<![\w$.])import\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
      /(?<![\w$.])require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
    ];
    for (const re of res) {
      for (const m of text.matchAll(re)) {
        if (!jsSpecOk(m[2])) out.push({ rule: 'import', file, line: lineOf(text, m.index), message: `imports "${m[2]}", which is not Node built-in, relative, or on the allow-list` });
      }
    }
  } else if (e === '.py') {
    const localExists = (name) => {
      const dir = path.dirname(path.join(ROOT, file));
      return [dir, ROOT].some((d) => existsSync(path.join(d, name + '.py')) || existsSync(path.join(d, name)));
    };
    const re = /^[ \t]*(?:from[ \t]+([A-Za-z_]\w*)[\w.]*[ \t]+import\b|import[ \t]+([A-Za-z_][\w.]*(?:[ \t]*,[ \t]*[A-Za-z_][\w.]*)*))/gm;
    for (const m of text.matchAll(re)) {
      const names = m[1] ? [m[1]] : m[2].split(',').map((s) => s.trim().split('.')[0]);
      for (const name of names) {
        if (!PY_STDLIB.has(name) && !localExists(name)) out.push({ rule: 'import', file, line: lineOf(text, m.index), message: `imports Python module "${name}", which is not standard library or in this repo` });
      }
    }
  } else if (e === '.kt' || e === '.java') {
    for (const m of text.matchAll(/^import\s+([\w.]+)/gm)) {
      if (!ALLOW.kotlinImportPrefixes.some((p) => m[1].startsWith(p))) out.push({ rule: 'import', file, line: lineOf(text, m.index), message: `imports ${m[1]}, which is not platform or this app` });
    }
  } else if (e === '.swift') {
    for (const m of text.matchAll(/^\s*import\s+(?:struct\s+|class\s+|enum\s+|protocol\s+|func\s+)?(\w+)/gm)) {
      if (!ALLOW.swiftImports.includes(m[1])) out.push({ rule: 'import', file, line: lineOf(text, m.index), message: `imports Swift module ${m[1]}, which is not an allowed Apple framework` });
    }
  }
}

function scanBanners(file, text, out) {
  const holders = ALLOW.ownCopyrightHolders.map((h) => h.toLowerCase());
  const checks = [
    [/SPDX-License-Identifier/i, 'carries an SPDX licence tag, so it is someone else\'s code'],
    [/@license\b/, 'carries an @license banner, so it is someone else\'s code'],
    [/Licensed under the/i, 'carries a "Licensed under" notice, so it is someone else\'s code'],
    [/Permission is hereby granted/i, 'carries a licence grant, so it is someone else\'s code'],
    [/\/\/# sourceMappingURL=/, 'points at a source map, so it is bundler output'],
    [/__vite__mapDeps|webpackChunk|__webpack_require__|rolldown-runtime/, 'contains bundler runtime markers'],
  ];
  for (const [re, msg] of checks) {
    const m = re.exec(text);
    if (m) out.push({ rule: 'banner', file, line: lineOf(text, m.index), message: msg });
  }
  for (const m of text.matchAll(/^.*(?:Copyright\s*(?:\(c\)|©)|©\s*\d{4}|Copyright\s+\d{4}).*$/gim)) {
    if (!holders.some((h) => m[0].toLowerCase().includes(h))) out.push({ rule: 'banner', file, line: lineOf(text, m.index), message: 'has a copyright line naming someone else' });
  }
  if (CODE_EXT.has(ext(file)) || ext(file) === '.css') {
    const lines = text.split('\n');
    const i = lines.findIndex((l) => l.length > 3000);
    if (i >= 0) out.push({ rule: 'minified', file, line: i + 1, message: `has a ${lines[i].length}-character line, which means minified or bundled code` });
  }
}

/** Dependency names declared by a package.json, anywhere in the usual places. */
function packageJsonViolations(file, text, out) {
  let json;
  try { json = JSON.parse(text); } catch { out.push({ rule: 'manifest', file, line: 1, message: 'package.json is not valid JSON' }); return; }
  const isRoot = file === 'package.json';
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides', 'resolutions']) {
    for (const name of Object.keys(json[key] || {})) {
      if (!isRoot || !ALLOW.npmPackages.includes(name)) out.push({ rule: 'manifest', file, line: 1, message: `${key} declares "${name}"${isRoot ? '' : ' (only the root package.json may declare anything)'}` });
    }
  }
  if (json.bundledDependencies || json.bundleDependencies) out.push({ rule: 'manifest', file, line: 1, message: 'bundles dependencies' });
  for (const [name, cmd] of Object.entries(json.scripts || {})) scanCommands(file, `${name}: ${cmd}`, out, 1);
}

function lockfileViolations(file, text, out) {
  let json;
  try { json = JSON.parse(text); } catch { return; }
  const root = (json.packages && json.packages['']) || {};
  const direct = { ...(root.dependencies || {}), ...(root.devDependencies || {}), ...(root.optionalDependencies || {}) };
  for (const name of Object.keys(direct)) {
    if (!ALLOW.npmPackages.includes(name)) out.push({ rule: 'manifest', file, line: 1, message: `lockfile root depends on "${name}"` });
  }
}

function gradleViolations(file, text, out) {
  for (const m of text.matchAll(/\b(?:implementation|api|compileOnly|runtimeOnly|kapt|ksp|testImplementation|androidTestImplementation|classpath)\s*\(?\s*["']([^"']+)["']/g)) {
    const coord = m[1].split(':').slice(0, 2).join(':');
    if (!ALLOW.gradleDependencies.includes(coord)) out.push({ rule: 'manifest', file, line: lineOf(text, m.index), message: `Gradle dependency ${coord} is not on the allow-list` });
  }
  for (const m of text.matchAll(/\bid\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    if (!ALLOW.gradlePlugins.includes(m[1])) out.push({ rule: 'manifest', file, line: lineOf(text, m.index), message: `Gradle plugin ${m[1]} is not on the allow-list` });
  }
}

/** True when `index` sits inside a quoted string on its line, so message text such as "npm install failed" is not mistaken for a command. */
function inString(text, index) {
  const prefix = text.slice(text.lastIndexOf('\n', index - 1) + 1, index);
  return ['"', "'", '`'].some((q) => prefix.split(q).length % 2 === 0);
}

/** Commands that fetch other people's code. Used on scripts, workflows, package.json scripts and by the Claude hook. */
export function scanCommands(file, text, out, startLine = 1) {
  const add = (index, message) => {
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    if (/^\s*(?:#|\/\/|\/\*|\*)/.test(text.slice(lineStart, index + 1))) return; // a comment, not a command
    if (inString(text, index)) return;
    out.push({ rule: 'command', file, line: startLine + lineOf(text, index) - 1, message });
  };
  for (const m of text.matchAll(/\b(?:npm|pnpm|yarn|bun)[ \t]+(?:i|install|add)\b((?:[ \t]+-[-\w=]+)*)[ \t]+([@\w][^\s;&|'"`)]*)/g)) {
    if (!ALLOW.npmPackages.includes(pkgName(m[2].replace(/@[^/]*$/, '') || m[2]))) add(m.index, `installs the package "${m[2]}"`);
  }
  for (const m of text.matchAll(/\b(?:pip3?|python3?\s+-m\s+pip|uv\s+pip|pipx|poetry|conda)\s+(?:install|add)\b([^\n;&|]*)/g)) {
    if (!/^\s*(?:-[-\w]+\s+)*(?:-r|--requirement)\s+\S+\s*(?:-[-\w]+\s*)*$/.test(m[1])) add(m.index, 'installs a Python package');
  }
  for (const m of text.matchAll(/\bnpx[ \t]+(?:-[-\w]+[ \t]+)*([@\w][^\s;&|'"`)]*)/g)) {
    if (!['tsc', 'vitest', 'typescript'].includes(m[1]) && !ALLOW.npmPackages.includes(pkgName(m[1]))) add(m.index, `runs "npx ${m[1]}", which downloads and runs a package`);
  }
  for (const m of text.matchAll(/(?:^|[\s;&|])(?:cargo\s+(?:add|install)|go\s+(?:get|install)|gem\s+install|composer\s+require|dotnet\s+add\s+package|flutter\s+pub\s+add)\b/g)) add(m.index, 'installs a package');
  for (const m of text.matchAll(/\bgit\s+(?:submodule\s+add|subtree\b)/g)) add(m.index, 'pulls another repository in');
  for (const m of text.matchAll(/\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/g)) add(m.index, 'pipes a download into a shell');
  for (const m of text.matchAll(/(?:^|[ \t;&|])bun[ \t]+(?!lock)[\w./-]+/g)) add(m.index, 'uses the Bun runtime');
}

function workflowViolations(file, text, out) {
  for (const m of text.matchAll(/^\s*-?\s*uses:\s*([^\s@#]+)/gm)) {
    if (m[1].startsWith('./')) continue;
    if (!ALLOW.githubActions.includes(m[1])) out.push({ rule: 'workflow', file, line: lineOf(text, m.index), message: `uses the action ${m[1]}, which is third-party code` });
  }
}

/** Scan one file's text. `file` is repo-relative with forward slashes. */
export function scanFile(file, text) {
  /** @type {Violation[]} */
  const out = [];
  if (GUARD_FILES.includes(file)) return out;
  const name = base(file);
  if (VENDOR_DIR.test(file)) out.push({ rule: 'vendored', file, line: 1, message: 'lives in a vendored / dependency folder' });
  if (BINARY_EXT.has(ext(file)) || /\.tar\.\w+$/.test(file)) out.push({ rule: 'vendored', file, line: 1, message: `is a ${ext(file) || 'compressed'} binary or archive, which can hide third-party code` });
  if (name === '.gitmodules') out.push({ rule: 'vendored', file, line: 1, message: 'git submodules pull in other repositories' });
  if (OTHER_LOCKFILES.has(name)) out.push({ rule: 'manifest', file, line: 1, message: 'is a lockfile for a package manager this repo does not use' });
  if (OTHER_MANIFESTS.has(name)) out.push({ rule: 'manifest', file, line: 1, message: 'is a manifest for a package manager this repo does not use' });
  if (name === 'package-lock.json') {
    if (file !== 'package-lock.json') out.push({ rule: 'manifest', file, line: 1, message: 'only the root package-lock.json may exist' });
    else lockfileViolations(file, text, out);
  }
  if (name === 'package.json') packageJsonViolations(file, text, out);
  if (/^requirements.*\.txt$/.test(name)) {
    text.split('\n').forEach((l, i) => { if (l.trim() && !l.trim().startsWith('#')) out.push({ rule: 'manifest', file, line: i + 1, message: `requires "${l.trim()}"` }); });
  }
  if (/\.gradle(\.kts)?$/.test(name)) gradleViolations(file, text, out);
  if (name === 'project.yml' && /^\s*packages:\s*$/m.test(text)) out.push({ rule: 'manifest', file, line: 1, message: 'declares Swift packages' });
  if (name === 'gradlew' || name === 'gradlew.bat') out.push({ rule: 'vendored', file, line: 1, message: 'is the Gradle wrapper script, which is Gradle\'s own code' });
  if (/^\.github\/workflows\/.+\.ya?ml$/.test(file)) workflowViolations(file, text, out);
  if (TEXT_EXT.has(ext(file)) || name === 'Dockerfile' || ['.sh', '.yml', '.yaml'].includes(ext(file))) {
    scanImports(file, text, out);
    scanBanners(file, text, out);
    if (['.sh', '.mjs', '.js', '.yml', '.yaml'].includes(ext(file)) || name.startsWith('Dockerfile')) scanCommands(file, text, out);
  }
  return out;
}

export function trackedFiles() {
  const raw = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, maxBuffer: 1 << 28 });
  return raw.toString('utf8').split('\0').filter(Boolean).filter((f) => existsSync(path.join(ROOT, f)));
}

export function scanRepo() {
  /** @type {Violation[]} */
  const all = [];
  for (const file of trackedFiles()) {
    const abs = path.join(ROOT, file);
    let text = '';
    if (!BINARY_EXT.has(ext(file))) {
      try { text = readFileSync(abs, 'utf8'); } catch { /* unreadable: treat as empty */ }
    }
    all.push(...scanFile(file, text));
  }
  return all;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = scanRepo();
  if (process.argv.includes('--json')) console.log(JSON.stringify(violations, null, 2));
  else if (violations.length === 0) console.log('No third-party code found.');
  else {
    const byFile = new Map();
    for (const v of violations) byFile.set(v.file, [...(byFile.get(v.file) || []), v]);
    for (const [file, vs] of byFile) {
      console.error(file);
      for (const v of vs) console.error(`  ${v.line}  [${v.rule}] ${v.message}`);
    }
    console.error(`\n${violations.length} problem(s) in ${byFile.size} file(s). This repo takes no third-party code (AGENTS.md). Remove it, or ask the owner to add it to .third-party-allowlist.json.`);
  }
  process.exit(violations.length ? 1 : 0);
}
