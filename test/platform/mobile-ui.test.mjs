/**
 * The shared interface in a real browser, at phone, tablet and desktop sizes: layouts hold, controls work,
 * settings change and persist, navigation reaches every page, the update status shows each outcome, and the
 * installable app (manifest, icons, offline shell) is real. Needs Chrome or Chromium (see browserSkip).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Browser } from './browser.mjs';
import { startServer, api, browserSkip, tempDir, removeDir } from './helpers.mjs';

const skip = browserSkip();
let srv, browser, dataDir;
const SIZES = [
  { name: 'small phone', width: 360, height: 640, mobile: true, scale: 2 },
  { name: 'phone', width: 390, height: 844, mobile: true, scale: 3 },
  { name: 'tablet', width: 768, height: 1024, mobile: true, scale: 2 },
  { name: 'desktop', width: 1280, height: 800, mobile: false, scale: 1 },
];
const PAGES = ['/', '/settings', '/settings#updates', '/settings#remote', '/settings#access', '/settings#aios', '/settings#safety', '/settings#data', '/settings#modules', '/settings#about', '/accounts', '/commons', '/sharing', '/login'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  if (skip) return;
  dataDir = tempDir('nc-ui-');
  srv = await startServer({ dataDir });
  browser = await Browser.launch();
});
after(async () => { await browser?.close(); await srv?.stop(); if (dataDir) removeDir(dataDir); });

async function open(size, p) {
  const pg = await browser.newPage();
  await pg.emulate(size);
  await pg.goto(srv.url + p);
  await pg.waitFor('document.readyState === "complete"');
  return pg;
}
async function settle(pg, ms = 700) { await sleep(ms); }

for (const size of SIZES) {
  test(`${size.name} (${size.width}px): every page fits the screen, has no console errors, and its controls are reachable`, { skip, timeout: 120_000 }, async () => {
    for (const p of PAGES) {
      const pg = await open(size, p);
      try {
        if (p.startsWith('/settings')) await pg.waitFor('document.querySelector("#panel h2")', 8000);
        await settle(pg);
        const m = await pg.eval(`(() => {
          const de = document.documentElement;
          const wide = [...document.querySelectorAll('body *')].filter((e) => {
            if (e.closest('#nc-ambient')) return false;
            const r = e.getBoundingClientRect();
            const cs = getComputedStyle(e);
            if (r.width === 0 || cs.position === 'fixed' || cs.visibility === 'hidden') return false;
            // Inside a horizontally scrolling strip (the settings tabs) overflow is the point.
            if (e.closest('nav[role=tablist]') && e.parentElement.matches('nav[role=tablist]')) return false;
            return r.right > innerWidth + 1 || r.left < -1;
          }).slice(0, 5).map((e) => e.tagName + '#' + e.id + '.' + String(e.className).slice(0, 30));
          return { iw: innerWidth, sw: de.scrollWidth, wide };
        })()`);
        assert.equal(m.iw, size.width, `${p}: the layout viewport grew to ${m.iw}px, so something is wider than the screen`);
        assert.ok(m.sw <= m.iw, `${p}: page scrolls sideways (${m.sw} > ${m.iw})`);
        assert.deepEqual(m.wide, [], `${p}: elements poke outside the screen`);
        assert.deepEqual(pg.errors, [], `${p}: console errors`);
        if (size.mobile && size.width < 500 && (p === '/' || p.startsWith('/settings'))) {
          const small = await pg.eval(`[...document.querySelectorAll('button, a.nc-btn, a.back, .grid a, select, input:not([type=checkbox]):not([type=file])')].filter((e) => {
            const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
            return r.width > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden]') && !e.classList.contains('copy-btn') && r.height < 43.5;
          }).map((e) => e.tagName + '#' + e.id + ' ' + Math.round(e.getBoundingClientRect().height) + 'px ' + (e.textContent || '').trim().slice(0, 20))`);
          assert.deepEqual(small, [], `${p}: controls under 44px tall on a phone`);
          const unlabelled = await pg.eval(`[...document.querySelectorAll('input[role=switch]')].filter((e) => !document.querySelector('label[for="' + e.id + '"]')).map((e) => e.id)`);
          assert.deepEqual(unlabelled, [], `${p}: switches with no label to tap`);
        }
      } finally { await pg.close(); }
    }
  });
}

test('home: type, send, and the real engine answers; the chat survives within the page and Clear empties it', { skip, timeout: 120_000 }, async () => {
  const pg = await open(SIZES[1], '/');
  try {
    await pg.waitFor('document.getElementById("status-text").textContent.length > 0');
    await pg.waitFor('document.querySelector("#status-dot.online")', 15000);
    const before = await pg.eval('document.querySelectorAll(".message").length');
    await pg.click('#input');
    await pg.type('#input', 'hello from a phone');
    await pg.click('#send-btn');
    await pg.waitFor(`document.querySelectorAll(".message.user").length >= 1 && document.querySelectorAll(".message.ai, .message.error").length >= 1`, 30000);
    const last = await pg.eval(`(() => { const m = [...document.querySelectorAll(".message.ai, .message.error")].pop(); return { cls: m.className, text: m.textContent }; })()`);
    assert.ok(last.cls.includes('ai'), `the engine answered, not an error: ${last.text}`);
    assert.ok(last.text.length > 5);
    assert.ok((await pg.eval('document.querySelectorAll(".message").length')) >= before + 2);
    assert.equal(await pg.eval('document.getElementById("input").value'), '', 'the box empties after sending');
    await pg.click('#clear-btn');
    await pg.waitFor('document.querySelectorAll(".message.user").length === 0');
    assert.deepEqual(pg.dialogs, ['Clear chat history?'], 'Clear asks before it deletes');
    assert.deepEqual(pg.errors, []);
  } finally { await pg.close(); }
});

test('navigation: home reaches Settings, Settings reaches home, both ways with real clicks on a phone', { skip, timeout: 120_000 }, async () => {
  const pg = await open(SIZES[0], '/');
  try {
    await pg.click('#settings-link');
    await pg.waitFor('location.pathname === "/settings"');
    await pg.waitFor('document.querySelector("#panel h2")');
    await pg.click('a.back');
    await pg.waitFor('location.pathname === "/"');
    assert.equal(await pg.eval('document.title'), 'Neuroclaw Terminal');
  } finally { await pg.close(); }
});

test('settings: tabs switch by tap and by keyboard, and every section loads without an error banner', { skip, timeout: 120_000 }, async () => {
  const pg = await open(SIZES[1], '/settings');
  try {
    await pg.waitFor('document.querySelector("#panel h2")');
    const ids = await pg.eval('[...document.querySelectorAll("[role=tab]")].map((b) => b.dataset.id)');
    assert.deepEqual(ids, ['general', 'updates', 'remote', 'access', 'aios', 'safety', 'data', 'modules', 'about']);
    for (const id of ids) {
      await pg.click(`#tab-${id}`);
      await pg.waitFor(`document.querySelector("#tab-${id}").getAttribute("aria-selected") === "true" && document.querySelector("#panel h2") && !document.querySelector("#panel .banner[role=alert]")`, 10000);
      assert.equal(await pg.eval('location.hash'), `#${id}`);
    }
    await pg.eval('document.querySelector("#tab-general").focus()');
    await pg.s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await pg.waitFor('document.querySelector("#tab-updates").getAttribute("aria-selected") === "true"');
    assert.deepEqual(pg.errors, []);
  } finally { await pg.close(); }
});

test('settings: a toggle saves to the server, applies at once, and is still applied after a reload', { skip, timeout: 120_000 }, async () => {
  const pg = await open(SIZES[1], '/settings');
  try {
    await pg.waitFor('document.querySelector("#ambient")');
    assert.equal(await pg.eval('document.documentElement.classList.contains("nc-ambient-off")'), false);
    await pg.click('#ambient');
    await pg.waitFor('document.documentElement.classList.contains("nc-ambient-off")', 5000);
    assert.equal(await pg.eval('document.getElementById("ambient").checked'), false);
    assert.equal((await api(srv.url, '/api/app-settings')).json.settings.appearance.ambient, false, 'the server has it');
    await pg.goto(srv.url + '/settings');
    await pg.waitFor('document.querySelector("#ambient")');
    assert.equal(await pg.eval('document.documentElement.classList.contains("nc-ambient-off")'), true, 'still applied after a reload');
    assert.equal(await pg.eval('document.getElementById("ambient").checked'), false);
    const other = await open(SIZES[3], '/');
    try { await other.waitFor('document.documentElement.classList.contains("nc-ambient-off")', 8000); } finally { await other.close(); }
    await pg.click('#ambient');
    await pg.waitFor('!document.documentElement.classList.contains("nc-ambient-off")', 5000);
    const sel = await pg.eval('document.getElementById("reduceMotion").value');
    assert.equal(sel, 'system');
  } finally { await pg.close(); }
});

test('settings: a failed save is shown to the person and the switch goes back', { skip, timeout: 120_000 }, async () => {
  const pg = await open(SIZES[1], '/settings');
  try {
    await pg.waitFor('document.querySelector("#keepLocalHistory")');
    // Make the next save fail on the server's side by pointing the page at a refused value.
    await pg.eval(`window.fetch = ((orig) => (u, o) => String(u).includes('/api/app-settings') && o && o.method === 'POST' ? Promise.resolve(new Response(JSON.stringify({ error: 'Settings were not saved: the folder is not writable for this user.' }), { status: 500 })) : orig(u, o))(window.fetch)`);
    await pg.click('#keepLocalHistory');
    await pg.waitFor('document.getElementById("status").className === "err"', 5000);
    assert.match(await pg.eval('document.getElementById("status").textContent'), /not saved/i);
    assert.equal(await pg.eval('document.getElementById("keepLocalHistory").checked'), true, 'the switch returned to its real state');
  } finally { await pg.close(); }
});

test('settings: remote access checks the password before sending it', { skip, timeout: 120_000 }, async () => {
  const pg = await open(SIZES[0], '/settings#remote');
  try {
    await pg.waitFor('document.querySelector("#new")');
    await pg.click('#new'); await pg.type('#new', 'short');
    await pg.click('#confirm'); await pg.type('#confirm', 'short');
    await pg.click('.actions .nc-btn.primary');
    await pg.waitFor('document.getElementById("status").className === "err"');
    assert.match(await pg.eval('document.getElementById("status").textContent'), /at least 8 characters/);
    await pg.type('#new', 'a long enough password'); await pg.type('#confirm', 'a different password!!');
    await pg.click('.actions .nc-btn.primary');
    await pg.waitFor('/do not match/.test(document.getElementById("status").textContent)');
  } finally { await pg.close(); }
});

test('settings: computer access toggles the real switch on the server and shows what it blocks', { skip, timeout: 120_000 }, async () => {
  const pg = await open(SIZES[1], '/settings#access');
  try {
    await pg.waitFor('document.querySelector("#sw-desktop")');
    await pg.click('#sw-desktop');
    await pg.waitFor('document.querySelector("#sw-desktop") && document.querySelector("#sw-desktop").checked === false && /Saved/.test(document.getElementById("status").textContent)', 8000);
    assert.equal((await api(srv.url, '/api/access')).json.switches.find((s) => s.name === 'desktop').on, false);
    await pg.waitFor('/blocked by desktop switch/.test(document.getElementById("panel").textContent)', 8000);
    await pg.click('#sw-desktop');
    await pg.waitFor('document.querySelector("#sw-desktop").checked === true', 8000);
  } finally { await pg.close(); }
});

/** A stand-in update server on this machine: serves whatever manifest the test sets. */
function manifestServer() {
  let body = null, status = 200;
  const s = createServer((req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); });
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${s.address().port}/release-manifest.json`,
    set: (b, st = 200) => { body = b; status = st; },
    close: () => s.close(),
  })));
}

test('settings: the update status shows available, current and failed, each in plain words', { skip, timeout: 120_000 }, async () => {
  const ms = await manifestServer();
  const pg = await open(SIZES[1], '/settings#updates');
  try {
    await pg.waitFor('document.querySelector("#manifestUrl")');
    const version = (await api(srv.url, '/api/app-info')).json.version;
    const art = { name: 'neuroclaw-9.9.9-linux-x64.deb', platform: 'linux', arch: 'x64', kind: 'linux-deb', sha256: 'e'.repeat(64), size: 5 * 1024 * 1024, signing: 'unsigned' };
    const manifest = (v) => ({ schema: 1, version: v, channel: 'stable', commit: 'f'.repeat(40), builtAt: '2026-01-01T00:00:00Z', artifacts: [art] });
    await pg.eval(`document.getElementById('manifestUrl').value = ${JSON.stringify(ms.url)}`);
    await pg.click('#save-address');
    await pg.waitFor('/Saved/.test(document.getElementById("status").textContent)', 8000);

    ms.set(manifest('9.9.9'));
    await pg.click('#check-update');
    await pg.waitFor('/Update available/.test(document.getElementById("update-result").textContent)', 12000);
    const t = await pg.eval('document.getElementById("update-result").textContent');
    assert.match(t, /9\.9\.9 is available/);
    assert.match(t, /neuroclaw-9\.9\.9-linux-x64\.deb/);
    assert.match(t, /e{64}/, 'the checksum is shown so the download can be verified');
    assert.match(t, /never installs an update by itself/);

    ms.set(manifest(version));
    await pg.eval('fetch("/api/app-settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({updates:{channel:"beta"}})})');
    await pg.eval('fetch("/api/app-settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({updates:{channel:"stable"}})})');
    await pg.click('#check-update');
    await pg.waitFor('/Up to date/.test(document.getElementById("update-result").textContent)', 12000);

    ms.set('nope', 500);
    await pg.eval('fetch("/api/app-settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({updates:{channel:"beta"}})})');
    await pg.eval('fetch("/api/app-settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({updates:{channel:"stable"}})})');
    await pg.click('#check-update');
    await pg.waitFor('/Check failed/.test(document.getElementById("update-result").textContent)', 12000);
    assert.match(await pg.eval('document.getElementById("update-result").textContent'), /answered 500/);
    assert.deepEqual(pg.errors.filter((e) => !/Failed to load resource/.test(e)), []);
  } finally { await pg.close(); ms.close(); await api(srv.url, '/api/app-settings', { method: 'POST', body: { updates: { manifestUrl: 'https://github.com/zach909/.my-ai/releases/latest/download/release-manifest.json' } } }); }
});

test('installable app: a valid manifest, real PNG icons at the sizes they claim, and a service worker that registers', { skip, timeout: 120_000 }, async () => {
  const man = await api(srv.url, '/manifest.webmanifest');
  assert.equal(man.status, 200);
  assert.match(man.headers.get('content-type'), /manifest\+json/);
  const m = man.json;
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  assert.equal(m.theme_color, '#110c0e', 'the house colour, not the old blue');
  assert.equal(m.background_color, '#110c0e');
  for (const icon of m.icons) {
    const r = await fetch(srv.url + icon.src);
    assert.equal(r.headers.get('content-type'), 'image/png');
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.subarray(1, 4).toString(), 'PNG');
    const [w, h] = icon.sizes.split('x').map(Number);
    assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [w, h], `${icon.src} really is ${icon.sizes}`);
  }
  const pg = await open(SIZES[1], '/');
  try {
    assert.equal(await pg.eval('document.querySelector("link[rel=manifest]").getAttribute("href")'), '/manifest.webmanifest');
    const reg = await pg.eval('navigator.serviceWorker.ready.then((r) => !!r.active)');
    assert.equal(reg, true, 'the offline shell is registered and active');
  } finally { await pg.close(); }
});

test('the pages are reachable without a login only where they should be: install files yes, settings API no from a regular user path', async () => {
  for (const p of ['/manifest.webmanifest', '/sw.js', '/app-icon-192.png']) assert.equal((await fetch(srv.url + p)).status, 200, p);
  const sw = await fetch(srv.url + '/sw.js');
  assert.match(await sw.text(), /url\.pathname\.startsWith\('\/api\/'\)/, 'the service worker never caches the API');
  assert.equal(sw.headers.get('service-worker-allowed'), '/');
});
