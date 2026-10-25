/**
 * Settings open, change, save, and persist, including the launch conditions that used to break them on Linux:
 * a working directory the app cannot write to, and a restart.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, dist, ensureBuilt, startServer, api, tempDir, removeDir } from './helpers.mjs';

ensureBuilt();
const { SETTINGS_FIELDS, applyPatch, normalize, DEFAULT_SETTINGS, SettingsStore } = await import(dist('interface/platform/settings-store.js'));
const text = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

test('defaults are sensible and every field in the schema has a consumer in the code', () => {
  assert.equal(DEFAULT_SETTINGS.appearance.ambient, true);
  assert.equal(DEFAULT_SETTINGS.updates.checkAutomatically, false, 'nothing contacts the network until the person opts in');
  const consumers = { 'appearance.ambient': ['interface/ambient.ts', 'ambient'], 'appearance.reduceMotion': ['interface/ambient.ts', 'reduceMotion'], 'chat.keepLocalHistory': ['interface/web-server.ts', 'keepLocalHistory'], 'updates.channel': ['interface/platform/routes.ts', 'updates.channel'], 'updates.checkAutomatically': ['interface/platform/settings-page.ts', 'checkAutomatically'], 'updates.manifestUrl': ['interface/platform/routes.ts', 'updates.manifestUrl'] };
  assert.deepEqual(SETTINGS_FIELDS.map((f) => f.path).sort(), Object.keys(consumers).sort(), 'a new setting must declare where it takes effect');
  for (const [field, [file, needle]] of Object.entries(consumers)) assert.ok(text(file).includes(needle), `${field}: ${file} never uses "${needle}"`);
});

test('validation: wrong types, unknown fields, unsafe addresses are refused with the field named', () => {
  const bad = [
    [{ appearance: { ambient: 'yes' } }, /on or off/, 'appearance.ambient'],
    [{ appearance: { reduceMotion: 'sometimes' } }, /one of/, 'appearance.reduceMotion'],
    [{ appearance: { nope: true } }, /Unknown setting/, 'appearance.nope'],
    [{ nope: { x: 1 } }, /Unknown settings group/, 'nope'],
    [{ updates: { manifestUrl: 'http://example.com/m.json' } }, /https/, 'updates.manifestUrl'],
    [{ updates: { manifestUrl: 'x'.repeat(600) } }, /500/, 'updates.manifestUrl'],
    [{ updates: { channel: 'nightly' } }, /one of/, 'updates.channel'],
  ];
  for (const [patch, re, field] of bad) {
    try { applyPatch(DEFAULT_SETTINGS, patch); assert.fail(`accepted ${JSON.stringify(patch)}`); }
    catch (e) { assert.match(e.message, re); assert.equal(e.field, field); assert.equal(e.status, 400); }
  }
  assert.throws(() => applyPatch(DEFAULT_SETTINGS, 'text'));
  assert.throws(() => applyPatch(DEFAULT_SETTINGS, [1]));
  assert.equal(applyPatch(DEFAULT_SETTINGS, { updates: { manifestUrl: '  ' } }).updates.manifestUrl, '', 'an empty address turns checks off');
  assert.equal(applyPatch(DEFAULT_SETTINGS, { updates: { manifestUrl: 'http://127.0.0.1:9/m.json' } }).updates.manifestUrl, 'http://127.0.0.1:9/m.json');
});

test('a damaged settings file falls back to defaults field by field, never throws', () => {
  const s = normalize({ appearance: { ambient: false, reduceMotion: 'bogus' }, chat: 'junk', updates: { channel: 'beta', surprise: 1 }, extra: {} });
  assert.equal(s.appearance.ambient, false, 'the good value is kept');
  assert.equal(s.appearance.reduceMotion, 'system', 'the bad one is replaced by its default');
  assert.equal(s.updates.channel, 'beta');
  assert.deepEqual(normalize(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalize('garbage'), DEFAULT_SETTINGS);
});

test('the store saves atomically, survives a new instance, and refuses to claim a save that failed', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'config', 'settings.json');
    const a = new SettingsStore(file);
    a.update({ appearance: { reduceMotion: 'on' } });
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).appearance.reduceMotion, 'on');
    assert.equal(new SettingsStore(file).load().appearance.reduceMotion, 'on', 'a restart sees it');
    // The folder becomes a file: nothing can be written there.
    const blocked = path.join(dir, 'blocked');
    writeFileSync(blocked, 'not a folder');
    const b = new SettingsStore(path.join(blocked, 'settings.json'));
    assert.throws(() => b.update({ appearance: { ambient: false } }), (e) => e.status === 500 && /not saved/i.test(e.message));
    assert.equal(b.load().appearance.ambient, true, 'the in-memory value did not change when the save failed');
    assert.equal(b.lastSave.ok, false);
  } finally { removeDir(dir); }
});

test('over HTTP: settings read, change, persist across a restart, and bad input is a clear 400', async () => {
  const dataDir = tempDir('nc-set-');
  let srv = await startServer({ dataDir });
  try {
    const first = await api(srv.url, '/api/app-settings');
    assert.equal(first.status, 200);
    assert.deepEqual(first.json.settings, DEFAULT_SETTINGS);
    assert.equal(first.json.fields.length, SETTINGS_FIELDS.length);
    const saved = await api(srv.url, '/api/app-settings', { method: 'POST', body: { appearance: { ambient: false, reduceMotion: 'on' }, chat: { keepLocalHistory: false }, updates: { channel: 'beta' } } });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.persistence.ok, true);
    assert.ok(existsSync(path.join(dataDir, 'config', 'settings.json')), 'saved in the data folder, not the working directory');
    const bad = await api(srv.url, '/api/app-settings', { method: 'POST', body: { updates: { manifestUrl: 'http://evil.example/m.json' } } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.field, 'updates.manifestUrl');
    const noJson = await fetch(srv.url + '/api/app-settings', { method: 'POST', body: '{"appearance":{"ambient":true}}' });
    assert.ok(noJson.status >= 400, 'a POST without a JSON content type is refused (the cross-site guard)');
    await srv.stop();
    srv = await startServer({ dataDir });
    const after = (await api(srv.url, '/api/app-settings')).json.settings;
    assert.equal(after.appearance.ambient, false);
    assert.equal(after.appearance.reduceMotion, 'on');
    assert.equal(after.chat.keepLocalHistory, false);
    assert.equal(after.updates.channel, 'beta');
  } finally { await srv.stop(); removeDir(dataDir); }
});

test('a save that cannot be written says so in plain words and does not pretend', async () => {
  const dataDir = tempDir('nc-ro-');
  writeFileSync(path.join(dataDir, 'config'), 'a file where the config folder should be');
  const srv = await startServer({ dataDir });
  try {
    const r = await api(srv.url, '/api/app-settings', { method: 'POST', body: { appearance: { ambient: false } } });
    assert.equal(r.status, 500);
    assert.match(r.json.error, /Settings were not saved/);
    const now = await api(srv.url, '/api/app-settings');
    assert.equal(now.json.settings.appearance.ambient, true, 'the unsaved change is not shown as saved');
    assert.equal(now.json.persistence.ok, false);
    assert.match(now.json.persistence.error, /not saved/i);
  } finally { await srv.stop(); removeDir(dataDir); }
});

test('Linux regression: computer-access switches save and persist when the working directory is not writable', async () => {
  const dataDir = tempDir('nc-lx-');
  const cwd = tempDir('nc-cwd-');
  writeFileSync(path.join(cwd, 'config'), 'the old code tried to mkdir config here and threw');
  let srv = await startServer({ dataDir, cwd });
  try {
    const on = await api(srv.url, '/api/access');
    assert.equal(on.status, 200);
    assert.equal(on.json.switches.find((s) => s.name === 'desktop').on, true);
    const r = await api(srv.url, '/api/access/switch', { method: 'POST', body: { name: 'desktop', on: false } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.persistence.ok, true, 'saved to the data folder');
    assert.ok(existsSync(path.join(dataDir, 'config', 'access.json')));
    const g = await api(srv.url, '/api/access/capability', { method: 'POST', body: { capability: 'screen.observe', level: null } });
    assert.equal(g.status, 200, g.text);
    await srv.stop();
    srv = await startServer({ dataDir, cwd });
    const again = await api(srv.url, '/api/access');
    assert.equal(again.json.switches.find((s) => s.name === 'desktop').on, false, 'still off after a restart');
    assert.equal(again.json.capabilities.find((c) => c.capability === 'screen.observe').level, null, 'a revoked grant stays revoked');
  } finally { await srv.stop(); removeDir(dataDir); removeDir(cwd); }
});

test('safety settings persist the same way', async () => {
  const dataDir = tempDir('nc-saf-');
  let srv = await startServer({ dataDir });
  try {
    const before = await api(srv.url, '/api/safety');
    assert.equal(before.status, 200);
    const t = before.json.tools.find((x) => x.ask === true);
    const r = await api(srv.url, '/api/safety/tools', { method: 'POST', body: { id: t.id, ask: false } });
    assert.equal(r.status, 200, r.text);
    assert.ok(existsSync(path.join(dataDir, 'config', 'tool-safety.json')));
    await srv.stop();
    srv = await startServer({ dataDir });
    assert.equal((await api(srv.url, '/api/safety')).json.tools.find((x) => x.id === t.id).ask, false);
  } finally { await srv.stop(); removeDir(dataDir); }
});

test('both settings URLs serve the one page, and the page offers every section the app supports', async () => {
  const srv = await startServer();
  try {
    const a = await api(srv.url, '/settings');
    const b = await api(srv.url, '/app/settings');
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.text, b.text, '/app/settings is the same page, not the old overflowing one');
    assert.match(a.text, /<meta name="viewport"/);
    for (const section of ['General', 'Updates', 'Remote access', 'Computer access', 'AI OS', 'Safety', 'Data', 'More', 'About']) assert.ok(a.text.includes(`'${section}'`), `section ${section}`);
    for (const level of ['observe', 'interact', 'modify', 'execute', 'system', 'privileged']) assert.ok(a.text.includes(`'${level}'`), `access level ${level}`);
    assert.ok(!/innerHTML/.test(a.text.replace(/replaceChildren/g, '')), 'no innerHTML: nothing from the server can run as markup');
  } finally { await srv.stop(); }
});

test('the access levels the page offers are exactly the engine\'s', async () => {
  const { ACCESS_LEVELS } = await import(dist('models && skills/core/access-manager.js'));
  const page = (await import(dist('interface/platform/settings-page.js'))).SETTINGS_PAGE;
  const m = /var LEVELS = \[([^\]]*)\]/.exec(page);
  assert.deepEqual(m[1].split(',').map((s) => s.trim().replace(/'/g, '')), [...ACCESS_LEVELS]);
});
