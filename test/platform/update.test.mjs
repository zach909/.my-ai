/** In-app update status: current, available, failed, unconfigured, and what each says. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dist, ensureBuilt } from './helpers.mjs';

ensureBuilt();
const { checkAppUpdate, evaluateManifest, pickArtifact, isAcceptableManifestUrl } = await import(dist('interface/platform/update.js'));

const SHA = 'a'.repeat(64);
const art = (o) => ({ name: 'neuroclaw-1.0.0-linux-x64.deb', platform: 'linux', arch: 'x64', kind: 'linux-deb', sha256: SHA, size: 1000, signing: 'unsigned', ...o });
const manifest = (o = {}) => ({ schema: 1, version: '1.0.0', channel: 'stable', commit: 'b'.repeat(40), builtAt: '2026-01-01T00:00:00Z', artifacts: [art({})], ...o });
const q = (o = {}) => ({ current: '0.1.0', channel: 'stable', platform: 'linux', arch: 'x64', manifestUrl: 'https://example.test/release-manifest.json', ...o });
const serve = (status, body, delayMs = 0) => async () => { if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }); };

test('a newer release is "available", with the right file, its checksum and an unsigned warning', async () => {
  const s = await checkAppUpdate(q({ fetchImpl: serve(200, manifest()) }));
  assert.equal(s.state, 'available');
  assert.equal(s.latest, '1.0.0');
  assert.equal(s.artifact.name, 'neuroclaw-1.0.0-linux-x64.deb');
  assert.equal(s.artifact.sha256, SHA);
  assert.match(s.message, /not code-signed/);
  assert.equal(s.commit, 'b'.repeat(40));
});

test('the same or an older release is "current"', async () => {
  assert.equal((await checkAppUpdate(q({ current: '1.0.0', fetchImpl: serve(200, manifest()) }))).state, 'current');
  const ahead = await checkAppUpdate(q({ current: '2.0.0', fetchImpl: serve(200, manifest()) }));
  assert.equal(ahead.state, 'current', 'a build ahead of the newest release is not told to "update" backwards');
});

test('a prerelease is not offered to the stable channel, but is to the beta channel', async () => {
  const beta = manifest({ version: '1.1.0-beta.1', channel: 'beta' });
  assert.equal((await checkAppUpdate(q({ fetchImpl: serve(200, beta) }))).state, 'current');
  assert.equal((await checkAppUpdate(q({ channel: 'beta', fetchImpl: serve(200, beta) }))).state, 'available');
});

test('a release without a build for this machine says so instead of offering a wrong file', async () => {
  const s = await checkAppUpdate(q({ platform: 'macos', arch: 'arm64', fetchImpl: serve(200, manifest()) }));
  assert.equal(s.state, 'failed');
  assert.match(s.message, /no macos\/arm64 build/);
  assert.equal(s.artifact, null);
});

test('an "any" architecture build matches every architecture of its platform, and platforms never cross', () => {
  const m = manifest({ artifacts: [art({ platform: 'chromeos', arch: 'any', name: 'neuroclaw-chrome-extension-1.0.0.zip', kind: 'chrome-extension-zip' })] });
  assert.equal(pickArtifact(m, 'chromeos', 'arm64').arch, 'any');
  assert.equal(pickArtifact(m, 'linux', 'x64'), null);
});

test('every way the check can fail is "failed" with a message a person can act on', async () => {
  const cases = [
    ['server error', serve(500, 'boom'), /answered 500/],
    ['no release yet', serve(404, 'nope'), /No release has been published/],
    ['not json', serve(200, 'hello'), /not valid/],
    ['wrong schema', serve(200, { schema: 7 }), /unsupported manifest schema/],
    ['bad commit', serve(200, manifest({ commit: 'nothex' })), /40-character/],
    ['hostile file name', serve(200, manifest({ artifacts: [art({ name: '../../etc/passwd' })] })), /plain file name/],
    ['oversized', serve(200, ' '.repeat(300 * 1024)), /unreasonably large/],
    ['network down', async () => { throw new TypeError('fetch failed'); }, /Could not reach the update server/],
    ['timeout', async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }, /did not answer in time/],
  ];
  for (const [name, fetchImpl, re] of cases) {
    const s = await checkAppUpdate(q({ fetchImpl }));
    assert.equal(s.state, 'failed', name);
    assert.match(s.message, re, name);
    assert.equal(s.artifact, null, name);
  }
});

test('no address means "unconfigured" and nothing is fetched; unsafe addresses are refused before any request', async () => {
  let called = false;
  const spy = async () => { called = true; return new Response('{}'); };
  assert.equal((await checkAppUpdate(q({ manifestUrl: '', fetchImpl: spy }))).state, 'unconfigured');
  for (const bad of ['http://example.com/m.json', 'ftp://example.com/m.json', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
    const s = await checkAppUpdate(q({ manifestUrl: bad, fetchImpl: spy }));
    assert.equal(s.state, 'failed', bad);
  }
  assert.equal(called, false);
  assert.equal(isAcceptableManifestUrl('http://127.0.0.1:8080/m.json'), true);
  assert.equal(isAcceptableManifestUrl('https://github.com/x/y/releases/latest/download/release-manifest.json'), true);
});

test('an unparseable current version cannot be compared and says so', () => {
  const s = evaluateManifest(manifest(), q({ current: 'dev-build' }), new Date().toISOString());
  assert.equal(s.state, 'failed');
  assert.match(s.message, /not a valid version/);
});
