/**
 * The delivery pipeline: which builds a change triggers, what the summary says, and that the workflow
 * is wired so a failed build can never be reported as a success or published.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, tempDir, removeDir } from './helpers.mjs';
import { affectedTargets } from '../../scripts/release/changed-targets.mjs';
import { renderSummary } from '../../scripts/release/summary.mjs';

const wf = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const on = (o) => Object.entries(o).filter(([, v]) => v === true).map(([k]) => k).filter((k) => ['extension', 'linux', 'windows', 'macos', 'android', 'ios'].includes(k)).sort();

test('a change rebuilds only what it affects', () => {
  assert.deepEqual(on(affectedTargets(['docs/PLATFORMS.md'])), [], 'documentation rebuilds nothing');
  assert.deepEqual(on(affectedTargets(['README.md', 'CONTRIBUTING.md'])), []);
  assert.deepEqual(on(affectedTargets(['wiki/home.md'])), ['linux', 'macos', 'windows'], 'wiki pages ship inside the desktop packages');
  assert.deepEqual(on(affectedTargets(['test/platform/x.test.mjs'])), [], 'tests alone rebuild nothing');
  assert.deepEqual(on(affectedTargets(['browser-extension/app.js'])), ['extension']);
  assert.deepEqual(on(affectedTargets(['mobile/android/app/src/main/java/ai/neuroclaw/app/WebActivity.kt'])), ['android']);
  assert.deepEqual(on(affectedTargets(['mobile/ios/NeuroClaw/ContentView.swift'])), ['ios']);
  assert.deepEqual(on(affectedTargets(['interface/web-server.ts'])), ['linux', 'macos', 'windows'], 'engine and shared UI flow into every desktop package');
  assert.deepEqual(on(affectedTargets(['models && skills/onebrain/model.json'])), ['android', 'ios', 'linux', 'macos', 'windows'], 'the model is embedded in the phone apps too');
  assert.deepEqual(on(affectedTargets(['interface/ambient.ts'])), ['extension', 'linux', 'macos', 'windows'], 'the shared look is copied into the extension');
  assert.deepEqual(on(affectedTargets(['scripts/release/package-macos.mjs'])), ['linux', 'macos', 'windows'].filter((x) => x !== 'x'));
  assert.deepEqual(on(affectedTargets(['package.json'])), ['android', 'extension', 'ios', 'linux', 'macos', 'windows'], 'a version bump rebuilds everything');
  assert.deepEqual(on(affectedTargets(['.github/workflows/ci.yml'])), ['android', 'extension', 'ios', 'linux', 'macos', 'windows'], 'a pipeline change is tested by building everything');
});

test('combined changes are the union, and unknown source files fall back to a safe rebuild', () => {
  assert.deepEqual(on(affectedTargets(['browser-extension/app.js', 'mobile/ios/project.yml'])), ['extension', 'ios']);
  const unknown = affectedTargets(['some-new-folder/code.js']);
  assert.deepEqual(on(unknown), ['linux', 'macos', 'windows'], 'never silently ship stale packages');
  assert.equal(affectedTargets(['docs/x.md']).any, false);
  assert.equal(affectedTargets(['test/a.test.mjs']).tests, true);
  assert.equal(affectedTargets(['docs/x.md']).tests, false);
});

test('the planner CLI: --all, --files, and a new branch (all-zero base) all behave, and write GITHUB_OUTPUT', () => {
  const dir = tempDir();
  try {
    const out = path.join(dir, 'out'); writeFileSync(out, '');
    const run = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/release/changed-targets.mjs'), ...a], { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: out } });
    assert.deepEqual(on(JSON.parse(run('--all').stdout)), ['android', 'extension', 'ios', 'linux', 'macos', 'windows']);
    assert.deepEqual(on(JSON.parse(run('--base', '0'.repeat(40), '--head', 'HEAD').stdout)), ['android', 'extension', 'ios', 'linux', 'macos', 'windows'], 'first push of a branch has nothing to diff against');
    writeFileSync(out, '');
    assert.deepEqual(on(JSON.parse(run('--files', 'browser-extension/popup.js').stdout)), ['extension']);
    const lines = readFileSync(out, 'utf8').trim().split('\n');
    assert.ok(lines.includes('extension=true') && lines.includes('linux=false') && lines.includes('desktop=false'), lines.join(','));
  } finally { removeDir(dir); }
});

test('the summary reports only what happened: success is built, failure is loud, skipped is explained, nothing is invented', () => {
  const needs = { verify: { result: 'success' }, extension: { result: 'success' }, linux: { result: 'failure' }, windows: { result: 'skipped' }, macos: { result: 'cancelled' }, android: { result: 'skipped' }, ios: { result: 'skipped' } };
  const plan = { extension: 'true', linux: 'true', windows: 'false', macos: 'true', android: 'false', ios: 'false', tests: 'true' };
  const { md, ok, failed } = renderSummary(needs, plan, { vitest: 'NOT RUN: vitest is not installed in this checkout' });
  assert.equal(ok, false);
  assert.equal(failed, 2);
  assert.match(md, /Linux[^\n]*\*\*FAILED\*\*/);
  assert.match(md, /macOS[^\n]*\*\*Cancelled\*\*/);
  assert.match(md, /Chrome extension[^\n]*\| Built \|/);
  assert.match(md, /Windows[^\n]*Not rebuilt \(this change does not affect it\)/);
  assert.match(md, /Not releasable/);
  assert.match(md, /NOT RUN: vitest/);
  assert.doesNotMatch(md.split('\n').find((l) => l.includes('Linux')), /Built/);
  const good = renderSummary({ verify: { result: 'success' }, extension: { result: 'success' }, linux: { result: 'skipped' }, windows: { result: 'skipped' }, macos: { result: 'skipped' }, android: { result: 'skipped' }, ios: { result: 'skipped' } }, { extension: 'true', tests: 'true' });
  assert.equal(good.ok, true);
  assert.match(good.md, /All 1 requested build\(s\) completed/);
  const skipped = renderSummary({ verify: { result: 'skipped' }, extension: { result: 'skipped' }, linux: { result: 'skipped' }, windows: { result: 'skipped' }, macos: { result: 'skipped' }, android: { result: 'skipped' }, ios: { result: 'skipped' } }, { extension: 'true', tests: 'false' });
  assert.match(skipped.md, /Chrome extension[^\n]*Skipped \(a job it depends on did not succeed\)/, 'a build that was wanted but never ran is never "passed"');
  const signed = renderSummary({ verify: { result: 'success' }, macos: { result: 'success' } }, { macos: 'true', tests: 'true' }, { macosSigning: 'ad-hoc' });
  assert.match(signed.md, /Ad-hoc signed only/);
  assert.match(renderSummary({ macos: { result: 'success' } }, { macos: 'true' }, { macosSigning: 'developer-id' }).md, /Developer ID signed/);
});

test('the summary CLI exits non-zero when a build failed, and zero when all requested builds passed', () => {
  const run = (needs, plan) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/release/summary.mjs')], { encoding: 'utf8', env: { ...process.env, NEEDS_JSON: JSON.stringify(needs), PLAN_JSON: JSON.stringify(plan), GITHUB_STEP_SUMMARY: '' } });
  assert.equal(run({ linux: { result: 'failure' } }, { linux: 'true' }).status, 1);
  assert.equal(run({ verify: { result: 'success' }, linux: { result: 'success' } }, { linux: 'true', tests: 'true' }).status, 0);
});

test('use-node picks a suitable Node from the runner tool cache and writes it to GITHUB_PATH', () => {
  const dir = tempDir();
  try {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    mkdirSync(path.join(dir, 'node', '99.1.0', arch, 'bin'), { recursive: true });
    mkdirSync(path.join(dir, 'node', '99.3.0', arch, 'bin'), { recursive: true });
    mkdirSync(path.join(dir, 'node', '18.0.0', arch, 'bin'), { recursive: true });
    const ghPath = path.join(dir, 'path'); writeFileSync(ghPath, '');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/release/use-node.mjs'), '99'], { encoding: 'utf8', env: { ...process.env, RUNNER_TOOL_CACHE: dir, GITHUB_PATH: ghPath } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(ghPath, 'utf8').trim(), path.join(dir, 'node', '99.1.0', arch, 'bin'));
    const none = spawnSync(process.execPath, [path.join(ROOT, 'scripts/release/use-node.mjs'), '120'], { encoding: 'utf8', env: { ...process.env, RUNNER_TOOL_CACHE: dir, GITHUB_PATH: ghPath } });
    assert.notEqual(none.status, 0, 'fails loudly when no suitable Node is installed');
  } finally { removeDir(dir); }
});

// ---- the workflow itself ----
const jobs = (() => {
  const out = {};
  const body = wf.slice(wf.indexOf('\njobs:\n') + 7);
  let current = null;
  for (const line of body.split('\n')) {
    const m = /^  ([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (m) { current = m[1]; out[current] = []; } else if (current) out[current].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n')]));
})();

test('the workflow has a job for every platform and every "needs" refers to a real job', () => {
  for (const j of ['plan', 'verify', 'extension', 'linux', 'windows', 'macos', 'android', 'ios', 'summary', 'release']) assert.ok(jobs[j], `job ${j}`);
  for (const [name, body] of Object.entries(jobs)) {
    const m = /needs:\s*\[([^\]]*)\]/.exec(body) ?? /needs:\s*([a-z-]+)\s*$/m.exec(body);
    if (!m) continue;
    for (const dep of m[1].split(',').map((s) => s.trim()).filter(Boolean)) assert.ok(jobs[dep], `${name} needs missing job ${dep}`);
  }
});

test('runners fit the platform: Windows packages on Windows, macOS and iOS on macOS, Android on Linux', () => {
  assert.match(jobs.windows, /runs-on: windows-latest/);
  assert.match(jobs.macos, /runs-on: macos-latest/);
  assert.match(jobs.ios, /runs-on: macos-latest/);
  assert.match(jobs.linux, /runs-on: ubuntu-latest/);
  assert.match(jobs.android, /runs-on: ubuntu-latest/);
});

test('every build job is gated on the plan, and none runs after verify failed', () => {
  for (const j of ['extension', 'linux', 'windows', 'macos', 'android', 'ios']) {
    assert.match(jobs[j], new RegExp(`needs\\.plan\\.outputs\\.${j} == 'true'`), `${j} is gated on the plan`);
    assert.match(jobs[j], /needs\.verify\.result != 'failure'/, `${j} does not run after a failed verify`);
  }
});

test('the summary job always runs and sees every result; releasing needs the summary to have succeeded', () => {
  assert.match(jobs.summary, /if: always\(\)/);
  assert.match(jobs.summary, /toJSON\(needs\)/);
  assert.match(jobs.release, /needs\.summary\.result == 'success'/);
  assert.match(jobs.release, /--draft/, 'releases are created as drafts for the owner to publish');
  assert.match(jobs.release, /does not match package\.json version/, 'a tag must equal the application version');
});

test('every package is smoke-tested by really starting it, on the platform it is for', () => {
  for (const j of ['linux', 'windows', 'macos']) assert.match(jobs[j], /smoke-package\.mjs/, `${j} starts the packaged app`);
  assert.match(jobs.windows, /uninstall\.ps1/, 'the Windows installer is installed and uninstalled for real');
  assert.match(jobs.extension, /unzip -tq/);
  assert.match(jobs.ios, /CFBundleShortVersionString/, 'the iOS app is checked for the shared version');
});

test('only first-party actions are used, secrets are never echoed, and signing is conditional on its secrets', () => {
  const uses = [...wf.matchAll(/^\s*-?\s*uses:\s*([^\s@#]+)/gm)].map((m) => m[1]);
  assert.ok(uses.length > 0);
  for (const u of uses) assert.ok(['actions/checkout', 'actions/upload-artifact'].includes(u), `third-party action ${u}`);
  assert.doesNotMatch(wf, /echo[^\n]*\$\{\{\s*secrets\./, 'a secret is never echoed');
  assert.match(jobs.macos, /if: \$\{\{ env\.MACOS_CERTIFICATE_P12 != '' \}\}/);
  assert.match(jobs.macos, /if: \$\{\{ env\.APPLE_ID != '' && env\.MACOS_SIGN_IDENTITY != '' \}\}/);
  assert.match(wf, /MACOS_SIGNING|signing=/);
  assert.match(wf, /^permissions:\n  contents: read/m, 'default permissions are read-only');
});

test('no key, token or credential is committed anywhere in the files this work added', () => {
  const roots = ['interface/platform', 'browser-extension', 'scripts/release', 'scripts/desktop-launcher.mjs', '.github/workflows', 'test/platform', 'docs/PLATFORMS.md'];
  const secretish = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bxox[bap]-[0-9A-Za-z-]{20,}/, /AIza[0-9A-Za-z_-]{35}/];
  const files = [];
  const walk = (p) => { const s = statSync(p); if (s.isDirectory()) readdirSync(p).forEach((n) => walk(path.join(p, n))); else if (/\.(m?js|ts|json|ya?ml|md|html|swift|plist|kts?)$/.test(p)) files.push(p); };
  for (const r of roots) walk(path.join(ROOT, r));
  assert.ok(files.length > 20);
  for (const f of files) { const t = readFileSync(f, 'utf8'); for (const re of secretish) if (f.endsWith('ci.test.mjs') === false) assert.doesNotMatch(t, re, `${path.relative(ROOT, f)} looks like it contains a credential`); }
});
