/** The release manifest: strict schema, real checksums, and it only ever lists files that exist. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, dist, ensureBuilt, tempDir, removeDir } from './helpers.mjs';
import { authority } from '../../scripts/release/version.mjs';
import { buildManifest, classify } from '../../scripts/release/manifest.mjs';

ensureBuilt();
const { validateManifest, sha256File, verifyArtifact } = await import(dist('interface/platform/release-manifest.js'));
const V = authority();
const COMMIT = 'c'.repeat(40);

const good = () => ({ schema: 1, version: V, channel: 'stable', commit: COMMIT, builtAt: '2026-01-01T00:00:00Z', artifacts: [{ name: `neuroclaw-${V}-linux-x64.deb`, platform: 'linux', arch: 'x64', kind: 'linux-deb', sha256: 'd'.repeat(64), size: 5, signing: 'unsigned' }] });

test('a well-formed manifest validates; each kind of damage is rejected by name', () => {
  assert.equal(validateManifest(good()).version, V);
  const breakers = [
    ['schema', (m) => { m.schema = 2; }, /schema/],
    ['version', (m) => { m.version = '1'; }, /version/],
    ['channel', (m) => { m.channel = 'nightly'; }, /channel/],
    ['commit', (m) => { m.commit = 'abc'; }, /commit/],
    ['builtAt', (m) => { m.builtAt = 'yesterday'; }, /builtAt/],
    ['artifacts not a list', (m) => { m.artifacts = {}; }, /artifacts/],
    ['platform', (m) => { m.artifacts[0].platform = 'beos'; }, /platform/],
    ['sha', (m) => { m.artifacts[0].sha256 = 'XYZ'; }, /sha256/],
    ['size', (m) => { m.artifacts[0].size = 0; }, /size/],
    ['signing', (m) => { m.artifacts[0].signing = 'maybe'; }, /signing/],
    ['path in name', (m) => { m.artifacts[0].name = 'sub/dir.deb'; }, /file name/],
    ['duplicate', (m) => { m.artifacts.push({ ...m.artifacts[0] }); }, /twice/],
  ];
  for (const [name, mutate, re] of breakers) {
    const m = good(); mutate(m);
    assert.throws(() => validateManifest(m), re, name);
  }
  assert.throws(() => validateManifest(null));
  assert.throws(() => validateManifest('x'));
});

test('sha256File and verifyArtifact detect a changed file', async () => {
  const dir = tempDir();
  try {
    const f = path.join(dir, 'a.bin'); writeFileSync(f, 'hello');
    const want = createHash('sha256').update('hello').digest('hex');
    assert.equal(await sha256File(f), want);
    assert.equal(await verifyArtifact(f, { sha256: want }), true);
    writeFileSync(f, 'hellp');
    assert.equal(await verifyArtifact(f, { sha256: want }), false, 'one changed byte must fail verification');
  } finally { removeDir(dir); }
});

test('artifact names map to platform, architecture and kind, and nothing else is accepted', () => {
  assert.deepEqual(classify(`neuroclaw-${V}-linux-arm64.tar.gz`, V), { platform: 'linux', arch: 'arm64', kind: 'linux-tarball' });
  assert.deepEqual(classify(`neuroclaw-${V}-windows-x64.exe`, V), { platform: 'windows', arch: 'x64', kind: 'windows-installer-exe' });
  assert.deepEqual(classify(`neuroclaw-${V}-macos-arm64.dmg`, V), { platform: 'macos', arch: 'arm64', kind: 'macos-dmg' });
  assert.deepEqual(classify(`neuroclaw-chrome-extension-${V}.zip`, V), { platform: 'chromeos', arch: 'any', kind: 'chrome-extension-zip' });
  assert.deepEqual(classify(`neuroclaw-${V}-android-any.apk`, V), { platform: 'android', arch: 'any', kind: 'android-apk' });
  for (const n of ['neuroclaw-0.0.1-linux-x64.deb', 'README.md', 'SHA256SUMS', 'neuroclaw-ios-simulator.zip', `neuroclaw-${V}-linux-riscv.deb`]) assert.equal(classify(n, V), null, n);
});

test('the manifest lists exactly the artifacts that exist, with real hashes, and records signing only when told', async () => {
  const dir = tempDir();
  try {
    const files = { [`neuroclaw-${V}-linux-x64.deb`]: 'deb bytes', [`neuroclaw-chrome-extension-${V}.zip`]: 'zip bytes', [`neuroclaw-${V}-macos-arm64.dmg`]: 'dmg bytes', 'notes.txt': 'ignored' };
    for (const [n, c] of Object.entries(files)) writeFileSync(path.join(dir, n), c);
    const m = await buildManifest({ dir, commit: COMMIT, channel: 'beta', signed: ['macos-dmg'] });
    assert.deepEqual(m.artifacts.map((a) => a.name).sort(), [`neuroclaw-${V}-linux-x64.deb`, `neuroclaw-${V}-macos-arm64.dmg`, `neuroclaw-chrome-extension-${V}.zip`].sort());
    const deb = m.artifacts.find((a) => a.kind === 'linux-deb');
    assert.equal(deb.sha256, createHash('sha256').update('deb bytes').digest('hex'));
    assert.equal(deb.size, 'deb bytes'.length);
    assert.equal(deb.signing, 'unsigned');
    assert.equal(m.artifacts.find((a) => a.kind === 'macos-dmg').signing, 'signed');
    assert.equal(m.commit, COMMIT); assert.equal(m.version, V); assert.equal(m.channel, 'beta');
    assert.ok(!m.artifacts.some((a) => a.platform === 'windows'), 'a platform that was not built has no entry, not a placeholder');
  } finally { removeDir(dir); }
});

test('an empty directory is an error, not an empty "release"', async () => {
  const dir = tempDir();
  try { await assert.rejects(buildManifest({ dir, commit: COMMIT }), /no release artifacts/); } finally { removeDir(dir); }
});

test('the CLI writes release-manifest.json and a SHA256SUMS that matches the files', () => {
  const dir = tempDir();
  try {
    writeFileSync(path.join(dir, `neuroclaw-${V}-linux-x64.deb`), 'one');
    writeFileSync(path.join(dir, `neuroclaw-${V}-windows-x64.zip`), 'two');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/release/manifest.mjs'), dir, '--commit', COMMIT, '--channel', 'stable'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const m = JSON.parse(readFileSync(path.join(dir, 'release-manifest.json'), 'utf8'));
    validateManifest(m);
    const sums = readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8').trim().split('\n');
    assert.equal(sums.length, 2);
    for (const line of sums) {
      const [hash, name] = line.split('  ');
      assert.equal(createHash('sha256').update(readFileSync(path.join(dir, name))).digest('hex'), hash);
    }
    const bad = spawnSync(process.execPath, [path.join(ROOT, 'scripts/release/manifest.mjs'), dir, '--commit', 'nothex'], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0, 'a bad commit is refused');
  } finally { removeDir(dir); }
});
