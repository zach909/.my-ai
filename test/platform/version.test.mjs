/** One application version, carried consistently, and drift is caught. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, dist, ensureBuilt, tempDir, removeDir, startServer, api } from './helpers.mjs';
import { authority, drift, TARGETS, versionCode as scriptVersionCode, chromeVersion } from '../../scripts/release/version.mjs';

ensureBuilt();
const { compareVersions, parseSemver, versionCode, appVersion, getBuildInfo } = await import(dist('interface/platform/version.js'));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

test('package.json is the authority and every place that carries a version agrees with it', () => {
  const v = authority();
  assert.match(v, /^\d+\.\d+\.\d+/);
  assert.deepEqual(drift(), [], 'run: node scripts/release/version.mjs sync');
  assert.equal(JSON.parse(read('browser-extension/manifest.json')).version, chromeVersion(v));
  assert.match(read('mobile/android/app/build.gradle.kts'), new RegExp(`versionName = "${v.replace(/\./g, '\\.')}"`));
  assert.match(read('mobile/ios/project.yml'), new RegExp(`MARKETING_VERSION: "${v.replace(/\./g, '\\.')}"`));
  assert.equal(appVersion(), v, 'the running engine reads the same version');
});

test('semver comparison handles releases, prereleases and garbage', () => {
  const lt = (a, b) => assert.ok(compareVersions(a, b) < 0, `${a} < ${b}`);
  lt('0.1.0', '0.1.1'); lt('0.9.9', '0.10.0'); lt('1.0.0-beta.1', '1.0.0'); lt('1.0.0-beta.2', '1.0.0-beta.10'); lt('1.0.0-alpha', '1.0.0-beta');
  assert.equal(compareVersions('1.2.3', 'v1.2.3'), 0);
  assert.equal(compareVersions('1.2.3+build5', '1.2.3'), 0);
  assert.equal(compareVersions('not-a-version', '1.0.0'), null);
  assert.equal(parseSemver('1.2'), null);
});

test('build codes rise with the version and the script and engine agree', () => {
  assert.equal(versionCode('0.1.0'), 100);
  assert.equal(versionCode('1.2.3'), 10203);
  assert.equal(scriptVersionCode('1.2.3'), versionCode('1.2.3'));
  assert.ok(versionCode('0.1.1') > versionCode('0.1.0'));
  assert.throws(() => versionCode('1.100.0'));
});

test('a drifted copy is reported by name, and sync repairs it (run in a scratch copy of the tree)', () => {
  const tmp = tempDir('nc-version-');
  try {
    mkdirSync(path.join(tmp, 'scripts', 'release'), { recursive: true });
    cpSync(path.join(ROOT, 'scripts', 'release', 'version.mjs'), path.join(tmp, 'scripts', 'release', 'version.mjs'));
    for (const f of ['package.json', 'browser-extension/manifest.json', 'mobile/android/app/build.gradle.kts', 'mobile/ios/project.yml']) {
      mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      cpSync(path.join(ROOT, f), path.join(tmp, f));
    }
    const run = (...a) => spawnSync(process.execPath, [path.join(tmp, 'scripts', 'release', 'version.mjs'), ...a], { encoding: 'utf8' });
    assert.equal(run('check').status, 0);
    const m = JSON.parse(readFileSync(path.join(tmp, 'browser-extension/manifest.json'), 'utf8')); m.version = '9.9.9';
    writeFileSync(path.join(tmp, 'browser-extension/manifest.json'), JSON.stringify(m));
    const bad = run('check');
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /browser-extension\/manifest\.json/);
    assert.equal(run('sync').status, 0);
    assert.equal(run('check').status, 0);
    assert.equal(run('set', '2.3.4').status, 0);
    assert.equal(JSON.parse(readFileSync(path.join(tmp, 'mobile/../browser-extension/manifest.json'), 'utf8')).version, '2.3.4');
    assert.match(readFileSync(path.join(tmp, 'mobile/android/app/build.gradle.kts'), 'utf8'), /versionCode = 20304/);
    assert.notEqual(run('set', 'banana').status, 0, 'a bad version is refused');
  } finally { removeDir(tmp); }
});

test('a source checkout says it is a development build; a build-info.json makes it a release', () => {
  const info = getBuildInfo();
  assert.equal(info.version, authority());
  assert.equal(info.packaged, false);
  assert.equal(info.channel, 'dev');
  const tmp = tempDir('nc-bi-');
  try {
    writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'neuroclaw', version: '3.2.1' }));
    writeFileSync(path.join(tmp, 'build-info.json'), JSON.stringify({ version: '3.2.1', commit: 'a'.repeat(40), channel: 'beta', platform: 'linux', arch: 'x64', builtAt: '2026-01-01T00:00:00Z' }));
    const rel = getBuildInfo(tmp);
    assert.deepEqual([rel.packaged, rel.channel, rel.platform, rel.arch, rel.commit], [true, 'beta', 'linux', 'x64', 'a'.repeat(40)]);
  } finally { removeDir(tmp); }
});

test('the running server reports the same version on the home page and in /api/app-info', async () => {
  const srv = await startServer();
  try {
    const info = await api(srv.url, '/api/app-info');
    assert.equal(info.json.version, authority());
    const home = await api(srv.url, '/');
    assert.ok(home.text.includes(`Neuroclaw v${authority()}`), 'the title bar shows the real version');
    assert.ok(!home.text.includes('__APP_VERSION__'));
  } finally { await srv.stop(); }
});
