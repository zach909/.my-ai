/**
 * The Chrome extension: what it declares, how it talks to a server, how it is packaged, and (in a real Chromium
 * with the extension loaded) that a click opens the app, the launcher connects, and failures are explained.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, startServer, browserSkip, tempDir, removeDir, ensureBuilt, dist, freePort } from './helpers.mjs';
import { Browser } from './browser.mjs';
import { buildExtension, EXTENSION_FILES } from '../../scripts/release/build-extension.mjs';
import { readZip } from '../../scripts/release/zip.mjs';
import { authority } from '../../scripts/release/version.mjs';
import { DEFAULT_SERVER, normalizeServerUrl, isLocalServer, permissionPattern, probeServer, describeProbe } from '../../browser-extension/connection.js';

ensureBuilt();
const EXT = path.join(ROOT, 'browser-extension');
const manifest = JSON.parse(readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('manifest: MV3, one clear icon set, one-click action, and the smallest permission set that works', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'NeuroClaw');
  assert.equal(manifest.version, authority().replace(/-.*/, ''));
  assert.ok(manifest.action.default_title.includes('Open NeuroClaw'));
  assert.equal(manifest.action.default_popup, undefined, 'no popup in the way: one click goes straight to the app');
  assert.deepEqual([...manifest.permissions].sort(), ['clipboardWrite', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['http://localhost/*', 'http://127.0.0.1/*'], 'only this computer by default');
  assert.deepEqual([...manifest.optional_host_permissions].sort(), ['http://*/*', 'https://*/*'], 'other servers only after the person agrees, per address');
  assert.equal(manifest.content_security_policy, undefined, 'the strict MV3 default stays: no remote code, no eval');
  assert.equal(manifest.content_scripts, undefined, 'it never injects itself into pages you browse');
  assert.ok(!manifest.permissions.includes('tabs') && !manifest.permissions.includes('<all_urls>'));
  assert.ok(manifest.options_ui.page && existsSync(path.join(EXT, manifest.options_ui.page)));
  assert.match(manifest.description, /does not|not inside/i, 'it says plainly that the engine is not in the extension');
});

test('a keyboard shortcut opens NeuroClaw through the same click handler, and costs no permission', () => {
  const cmd = manifest.commands?._execute_action;
  assert.ok(cmd, '_execute_action is the built-in command that behaves exactly like clicking the toolbar icon');
  assert.match(cmd.suggested_key.default, /^(Ctrl|Alt)\+/, 'Chrome only accepts a shortcut with Ctrl or Alt');
  assert.match(cmd.description, /NeuroClaw/);
  assert.match(readFileSync(path.join(EXT, 'background.js'), 'utf8'), /chrome\.action\.onClicked\.addListener\(openLauncher\)/, 'and that click handler is the one that opens the launcher');
  assert.deepEqual([...manifest.permissions].sort(), ['clipboardWrite', 'storage'], 'a shortcut adds no permission');
});

test('every file the manifest and pages reference exists and is packaged; icons are real PNGs at their sizes and match the renderer', async () => {
  const refs = [manifest.background.service_worker, manifest.options_ui.page, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)];
  for (const r of refs) { assert.ok(existsSync(path.join(EXT, r)), r); assert.ok(EXTENSION_FILES.includes(r), `${r} is packaged`); }
  for (const page of ['app.html', 'options.html', 'popup.html']) {
    const html = readFileSync(path.join(EXT, page), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) if (!/^https?:/.test(m[1])) assert.ok(EXTENSION_FILES.includes(m[1]), `${page} loads ${m[1]}, which is not packaged`);
    assert.doesNotMatch(html, /<script[^>]*>[^<]+<\/script>/, `${page} has an inline script, which MV3 forbids`);
    assert.doesNotMatch(html, /(?:src|href|action)="https?:\/\//, `${page} does not load anything from the internet`);
  }
  const { renderIconPng } = await import(dist('interface/platform/icon.js'));
  for (const [size, file] of Object.entries(manifest.icons)) {
    const buf = readFileSync(path.join(EXT, file));
    assert.equal(buf.subarray(1, 4).toString(), 'PNG');
    assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [Number(size), Number(size)]);
    assert.ok(buf.equals(renderIconPng(Number(size))), `${file} is stale: run node scripts/release/make-icons.mjs`);
  }
  assert.equal(spawnSync(process.execPath, [path.join(ROOT, 'scripts/release/make-icons.mjs'), '--check']).status, 0);
});

test('connection: addresses are normalised, unsafe ones are refused with a reason, local ones are recognised', () => {
  assert.equal(normalizeServerUrl('localhost:7861'), 'http://localhost:7861');
  assert.equal(normalizeServerUrl(' http://192.168.1.20:7861/ '), 'http://192.168.1.20:7861');
  assert.equal(normalizeServerUrl('https://nc.example.org/some/path?x=1'), 'https://nc.example.org', 'path and query are dropped: the app is at the root');
  assert.equal(normalizeServerUrl(DEFAULT_SERVER), 'http://localhost:7861');
  for (const bad of ['', '   ', 'ftp://x.test', 'javascript:alert(1)', 'http://user:pass@host.test', 'http://', 'chrome://settings']) assert.throws(() => normalizeServerUrl(bad), Error, JSON.stringify(bad));
  assert.throws(() => normalizeServerUrl('http://user:pass@host.test'), /password/i);
  assert.equal(isLocalServer('http://localhost:7861'), true);
  assert.equal(isLocalServer('http://127.0.0.1:9'), true);
  assert.equal(isLocalServer('http://192.168.1.20:7861'), false);
  assert.equal(permissionPattern('http://192.168.1.20:7861'), 'http://192.168.1.20:7861/*');
});

test('connection: probing reports connected, needs-login, not-neuroclaw and unreachable correctly', async () => {
  const resp = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  const ok = { running: true, subsystems: { llm: true } };
  assert.equal((await probeServer('http://x.test', resp(200, ok))).state, 'connected');
  assert.equal((await probeServer('http://x.test', resp(401, {}))).state, 'needs-login');
  assert.equal((await probeServer('http://x.test', resp(200, { hello: 1 }))).state, 'not-neuroclaw');
  assert.equal((await probeServer('http://x.test', resp(200, 'html'))).state, 'not-neuroclaw');
  assert.equal((await probeServer('http://x.test', resp(502, ''))).state, 'not-neuroclaw');
  assert.equal((await probeServer('http://x.test', async () => { throw new TypeError('fetch failed'); })).state, 'unreachable');
  const timed = await probeServer('http://x.test', async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; });
  assert.equal(timed.state, 'unreachable');
  assert.match(describeProbe(timed).body, /does not contain one/, 'it never pretends to hold an engine');
  assert.equal(describeProbe({ state: 'connected', origin: 'http://x.test' }).ok, true);
  assert.equal(describeProbe({ state: 'needs-login', origin: 'http://x.test' }).ok, true);
  assert.equal(describeProbe({ state: 'unreachable', origin: 'http://x.test' }).ok, false);
});

test('packaging: the zip holds exactly the listed files, the same bytes every time, at the one version', () => {
  const dir = tempDir();
  try {
    const a = buildExtension(path.join(dir, 'a'));
    const b = buildExtension(path.join(dir, 'b'));
    assert.match(path.basename(a), new RegExp(`^neuroclaw-chrome-extension-${authority().replace(/\./g, '\\.')}\\.zip$`));
    const bytesA = readFileSync(a);
    assert.ok(bytesA.equals(readFileSync(b)), 'reproducible: same sources, same bytes');
    const entries = readZip(bytesA);
    assert.deepEqual(entries.map((e) => e.name).sort(), [...EXTENSION_FILES].sort());
    for (const e of entries) assert.ok(e.data.equals(readFileSync(path.join(EXT, e.name))), `${e.name} is the file in the tree`);
    assert.equal(JSON.parse(entries.find((e) => e.name === 'manifest.json').data.toString()).version, manifest.version);
    assert.ok(!entries.some((e) => /README|\.test\.|node_modules/.test(e.name)), 'nothing stray is shipped');
    assert.ok(bytesA.length < 200 * 1024, 'small enough to review');
  } finally { removeDir(dir); }
});

// ---- real Chromium with the extension loaded ----
const skip = browserSkip();
let browser, srv, extDir, extId, swTarget;
before(async () => {
  if (skip) return;
  extDir = tempDir('nc-ext-');
  for (const e of readZip(readFileSync(buildExtension(path.join(extDir, 'zip'))))) {
    const dest = path.join(extDir, 'unpacked', e.name);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, e.data);
  }
  browser = await Browser.launch({ extensions: [path.join(extDir, 'unpacked')] });
  for (let i = 0; i < 40 && !swTarget; i++) {
    // Chromium also runs its own built-in extensions, each with a service worker; ours is the one whose manifest says so.
    for (const t of (await browser.targets()).filter((x) => x.type === 'service_worker' && x.url.startsWith('chrome-extension://'))) {
      const sw = await browser.attach(t);
      try { if (await sw.eval('chrome.runtime.getManifest().name') === manifest.name) { swTarget = t; break; } } catch { /* not ours */ } finally { sw.s.close(); }
    }
    if (!swTarget) await sleep(250);
  }
  if (swTarget) extId = new URL(swTarget.url).host;
  srv = await startServer();
});
after(async () => { await browser?.close(); await srv?.stop(); if (extDir) removeDir(extDir); });

async function setServer(pg, origin) {
  await pg.eval(origin ? `chrome.storage.local.set({ server: ${JSON.stringify(origin)} })` : 'chrome.storage.local.remove("server")');
}

test('loads in Chromium as shipped: a service worker starts and the manifest is what we wrote', { skip, timeout: 120_000 }, async () => {
  assert.ok(swTarget, 'the extension did not load (Chromium ignored --load-extension, or the package is invalid)');
  const pg = await browser.newPage();
  try {
    await pg.goto(`chrome-extension://${extId}/app.html?stay=1`);
    assert.equal(await pg.eval('chrome.runtime.getManifest().name'), 'NeuroClaw');
    assert.equal(await pg.eval('chrome.runtime.getManifest().version'), manifest.version);
    assert.deepEqual(pg.errors, []);
  } finally { await pg.close(); }
});

test('one click (the action handler) opens the launcher, and clicking again returns to the same tab instead of opening more', { skip, timeout: 120_000 }, async () => {
  const sw = await browser.attach(swTarget);
  try {
    const first = await sw.eval('openLauncher()');
    const again = await sw.eval('openLauncher()');
    assert.equal(first, again, 'the same tab');
    await sleep(600);
    const tabs = (await browser.targets()).filter((t) => t.type === 'page' && t.url.startsWith(`chrome-extension://${extId}/app.html`));
    assert.equal(tabs.length, 1);
    for (const t of tabs) await fetch(`${browser.base}/json/close/${t.id}`);
  } finally { sw.s.close(); }
});

test('launcher with a running server: says Connected, links to the server, and (without ?stay) opens it', { skip, timeout: 120_000 }, async () => {
  const pg = await browser.newPage();
  try {
    await pg.goto(`chrome-extension://${extId}/app.html?stay=1`);
    await setServer(pg, srv.url);
    await pg.goto(`chrome-extension://${extId}/app.html?stay=1`);
    await pg.waitFor('document.getElementById("title").textContent === "Connected"', 10000);
    assert.equal(await pg.eval('document.getElementById("open").getAttribute("href")'), `${srv.url}/`);
    assert.equal(await pg.eval('document.getElementById("open-settings").getAttribute("href")'), `${srv.url}/settings`);
    assert.equal(await pg.eval('document.getElementById("dot").className'), 'dot ok');
    await pg.goto(`chrome-extension://${extId}/app.html`);
    await pg.waitFor(`location.href === ${JSON.stringify(srv.url + '/')}`, 10000);
    await pg.waitFor('document.title === "Neuroclaw Terminal"', 10000);
    assert.ok(await pg.eval('!!document.getElementById("input")'), 'the real NeuroClaw interface is what opened');
  } finally { await pg.close(); }
});

test('launcher with nothing at the address: explains plainly, shows how to get a server, offers retry', { skip, timeout: 120_000 }, async () => {
  const dead = `http://127.0.0.1:${await freePort()}`;
  const pg = await browser.newPage();
  try {
    await pg.goto(`chrome-extension://${extId}/app.html?stay=1`);
    await setServer(pg, dead);
    await pg.goto(`chrome-extension://${extId}/app.html`);
    await pg.waitFor('document.getElementById("title").textContent === "NeuroClaw is not reachable"', 10000);
    const body = await pg.eval('document.getElementById("body").textContent');
    assert.ok(body.includes(dead));
    assert.match(body, /does not contain one/);
    assert.equal(await pg.eval('document.getElementById("dot").className'), 'dot bad');
    assert.equal(await pg.eval('document.getElementById("help").open'), true, 'the setup help is open when it is needed');
    assert.match(await pg.eval('document.getElementById("help").textContent'), /Chromebook[\s\S]*Linux/);
    assert.equal(await pg.eval('document.getElementById("open").hidden'), true, 'no "Open" button to a server that is not there');
    // Start the server on that address, press Try again, and it connects.
  } finally { await pg.close(); }
});

test('launcher: a bad address is refused with a reason, a good one is saved and tested', { skip, timeout: 120_000 }, async () => {
  const pg = await browser.newPage();
  try {
    await pg.goto(`chrome-extension://${extId}/app.html?stay=1`);
    await setServer(pg, null);
    await pg.goto(`chrome-extension://${extId}/app.html?stay=1`);
    await pg.waitFor('document.getElementById("title").textContent.length > 0 && document.getElementById("title").textContent !== "Looking for your server..."', 10000);
    await pg.click('#server');
    await pg.type('#server', 'ftp://nope.example');
    await pg.click('#save');
    await pg.waitFor('/must start with http/.test(document.getElementById("err").textContent)');
    await pg.type('#server', srv.url);
    await pg.click('#save');
    await pg.waitFor('document.getElementById("title").textContent === "Connected"', 10000);
    assert.equal(await pg.eval('chrome.storage.local.get("server").then((s) => s.server)'), srv.url, 'the address is remembered');
  } finally { await pg.close(); }
});

test('options page saves the address, tests it, and resets to the default', { skip, timeout: 120_000 }, async () => {
  const pg = await browser.newPage();
  try {
    await pg.goto(`chrome-extension://${extId}/options.html`);
    await pg.waitFor('document.getElementById("server").value.length > 0');
    await pg.click('#server');
    await pg.type('#server', srv.url);
    await pg.click('#save');
    await pg.waitFor('/Saved\\. Connected/.test(document.getElementById("msg").textContent)', 10000);
    await pg.click('#reset');
    await pg.waitFor('document.getElementById("server").value === "http://localhost:7861"');
    assert.equal(await pg.eval('chrome.storage.local.get("server").then((s) => s.server === undefined)'), true);
    assert.deepEqual(pg.errors, []);
  } finally { await pg.close(); }
});
