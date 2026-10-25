/**
 * Visuals: the AI is the back end, the panel in its reply is the front end (interface/visuals.ts).
 *
 * The parsing and the event contract are checked directly. The panel itself is checked in a real browser:
 * doing anything to a panel prompts the AI with no code from its author, the sandbox really holds against
 * hostile code, and a busy page drops events instead of queueing them. Needs Chrome or Chromium for the
 * browser half (see browserSkip).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Browser } from './browser.mjs';
import { dist, ensureBuilt, browserSkip } from './helpers.mjs';

ensureBuilt();
const V = await import(dist('interface/visuals.js'));
const FENCE = '```';
const block = (code) => `${FENCE}visual\n${code}\n${FENCE}`;

test('a message is cut into prose and visuals, in order', () => {
  const parts = V.splitVisuals(`Here you go\n${block('<b>one</b>')}\nand then\n${block('<i>two</i>')}\nbye`);
  assert.deepEqual(parts.map((p) => p.kind), ['text', 'visual', 'text', 'visual', 'text']);
  assert.equal(parts[1].text, '<b>one</b>');
  assert.equal(parts[3].text, '<i>two</i>');
});

test('too many, too big or empty blocks stay plain text, and a message without one is returned untouched', () => {
  const four = [1, 2, 3, 4].map((n) => block(`<p>${n}</p>`)).join('\n');
  assert.equal(V.splitVisuals(four).filter((p) => p.kind === 'visual').length, V.VISUAL_MAX_PER_MESSAGE);
  assert.equal(V.splitVisuals(block('x'.repeat(V.VISUAL_MAX_BYTES + 1))).filter((p) => p.kind === 'visual').length, 0);
  assert.equal(V.splitVisuals(`${FENCE}visual\n\n${FENCE}`).filter((p) => p.kind === 'visual').length, 0);
  assert.equal(V.splitVisuals(`${FENCE}js\nlet a = 1;\n${FENCE}`).filter((p) => p.kind === 'visual').length, 0);
  const plain = '  hello\n\n  world  ';
  assert.equal(V.plainText(plain), plain);
  assert.equal(V.plainText(`before\n${block('<b>secret code</b>')}`), 'before\n[visual]');
});

test('an event must have a safe name and a small JSON body; the turn the AI gets is built from it', () => {
  assert.deepEqual(V.parseVisualEvent({ name: 'click', data: { id: 'go' } }), { name: 'click', data: { id: 'go' } });
  assert.deepEqual(V.parseVisualEvent({ name: 'tap' }), { name: 'tap', data: null });
  for (const bad of [null, 'click', {}, { name: '' }, { name: 'a b' }, { name: 'x'.repeat(65) }, { name: 'ok', data: 'y'.repeat(V.VISUAL_EVENT_DATA_MAX) }]) {
    assert.equal(V.parseVisualEvent(bad), null, JSON.stringify(bad)?.slice(0, 40));
  }
  assert.equal(V.visualEventMessage({ name: 'pick', data: { choice: 'a' } }), '[visual event] pick {"choice":"a"}');
});

test('the back-end framing fits the 160 characters the doorway keeps, and is sent only when the page asked', () => {
  const s = V.VISUAL_BACKEND_SKILL;
  assert.ok(`${s.title}: ${s.description}`.length <= 160, 'would be cut off at the doorway');
  assert.deepEqual(V.visualSkillsFor({ visuals: true }), [s]);
  for (const body of [null, {}, { visuals: false }, { visuals: 'yes' }]) assert.deepEqual(V.visualSkillsFor(body), []);
});

test('the page scripts hold no </head>, </body> or </html>: the server inserts its tags at the first one it finds', () => {
  for (const [name, js] of [['VISUAL_CLIENT_JS', V.VISUAL_CLIENT_JS], ['VISUAL_CSS', V.VISUAL_CSS]]) {
    assert.ok(!/<\/(head|body|html)>/i.test(js), `${name} contains a closing page tag`);
  }
});

const skip = browserSkip();
let server, base, browser;

before(async () => {
  if (skip) return;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>:root{--border:rgba(255,228,218,.2);--text:#f8ede9;--primary-light:#ffc4b4}
body{background:#110c0e;color:#f8ede9;margin:0}${V.VISUAL_CSS}</style></head><body>
<div id="chat"></div><div id="input-area"><input id="input"><button id="send">Send</button></div>
<script>${V.VISUAL_CLIENT_JS}</script>
<script>
window.events = [];
ncVisuals.install({ input: document.getElementById('input'), sendBtn: document.getElementById('send'), send: function () {},
  onEvent: function (n, d) { window.events.push([n, d]); } });
window.show = function (code) {
  var b = document.createElement('div'); b.className = 'message ai'; document.getElementById('chat').appendChild(b);
  ncVisuals.attach(b, ${JSON.stringify(FENCE)} + 'visual' + String.fromCharCode(10) + code + String.fromCharCode(10) + ${JSON.stringify(FENCE)});
  return b.querySelector('iframe');
};
</script></body></html>`;
  // The same security headers the real server sends (WebServer.setSecurityHeaders): a panel's document inherits
  // the page's CSP, so the sandbox has to be proven under it, not under a bare test server.
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';");
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await Browser.launch();
});
after(async () => { await browser?.close(); await new Promise((r) => (server ? server.close(r) : r())); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open() { const pg = await browser.newPage(); await pg.emulate({ width: 900, height: 900 }); await pg.goto(base); return pg; }
/** A real pointer click inside the (sandboxed, so unreachable) frame, at an offset from its top-left corner. */
async function clickIn(pg, index, dx, dy) {
  const box = await pg.eval(`(() => { const r = document.querySelectorAll('.nc-visual iframe')[${index}].getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await pg.s.send('Input.dispatchMouseEvent', { type, x: box.x + dx, y: box.y + dy, button: 'left', clickCount: 1 });
  }
}

test('doing anything to a panel prompts the AI, with no code from the panel and one built-in prompt per element', { skip }, async () => {
  const pg = await open();
  try {
    // No script at all: a button that fills the panel, carrying its own built-in prompt.
    await pg.eval(`show('<button id="go" data-ai="Roll a die and show it" style="display:block;width:100%;height:70px">Roll</button>')`);
    await pg.waitFor(`document.querySelector('.nc-visual iframe') && document.querySelector('.nc-visual iframe').contentWindow`);
    await sleep(400);
    await clickIn(pg, 0, 120, 50);
    await pg.waitFor('window.events.length === 1');
    const [name, data] = await pg.eval('window.events[0]');
    assert.equal(name, 'click');
    assert.deepEqual(data, { tag: 'button', id: 'go', text: 'Roll', ask: 'Roll a die and show it' });
  } finally { await pg.close(); }
});

test('a panel that reports for itself is not reported twice, and a changed field reports its value', { skip }, async () => {
  const pg = await open();
  try {
    await pg.eval(`show('<button id="b" style="display:block;width:100%;height:50px" onclick="ai.send(&quot;mine&quot;, {n: 1})">Mine</button><label style="display:block;height:60px"><input type="checkbox" id="c" style="width:50px;height:50px;margin:5px"></label>')`);
    await sleep(500);
    await clickIn(pg, 0, 150, 30);
    await pg.waitFor('window.events.length >= 1');
    await sleep(300);
    assert.deepEqual(await pg.eval('window.events'), [['mine', { n: 1 }]], 'one event for one click, the panel\'s own');
    await clickIn(pg, 0, 40, 14 + 50 + 35);
    await pg.waitFor('window.events.length === 2');
    const [name, data] = await pg.eval('window.events[1]');
    assert.equal(name, 'change');
    assert.equal(data.value, true);
    assert.equal(data.id, 'c');
  } finally { await pg.close(); }
});

test('the sandbox holds: no page, no storage, no network; only data: and the one message channel', { skip }, async () => {
  const pg = await open();
  try {
    const sandbox = await pg.eval(`show('<p>x</p>').getAttribute('sandbox')`);
    assert.equal(sandbox, 'allow-scripts', 'any extra permission here would break the isolation');
    await pg.eval(`show('<script>var r = {};'
      + 'try { parent.document.title; r.page = "reachable"; } catch (e) { r.page = "blocked"; }'
      + 'try { localStorage.getItem("x"); r.storage = "reachable"; } catch (e) { r.storage = "blocked"; }'
      + 'try { r.popup = window.open("about:blank") ? "opened" : "blocked"; } catch (e) { r.popup = "blocked"; }'
      + 'function done() { ai.send("probe", r); }'
      + 'fetch(location.href).then(function () { r.net = "open"; done(); }, function () { r.net = "blocked"; done(); });'
      + '<\\/script>')`);
    await pg.waitFor('window.events.some(function (e) { return e[0] === "probe"; })', 8000);
    const probe = await pg.eval('window.events.find(function (e) { return e[0] === "probe"; })[1]');
    assert.deepEqual(probe, { page: 'blocked', storage: 'blocked', popup: 'blocked', net: 'blocked' });
  } finally { await pg.close(); }
});

test('a busy page drops a panel\'s events and tells the panel; a panel that lies about its size is clamped', { skip }, async () => {
  const pg = await open();
  try {
    await pg.eval(`show('<button style="display:block;width:100%;height:80px">Go</button><div style="height:5000px"></div>')`);
    await sleep(600);
    const h = await pg.eval(`parseInt(document.querySelector('.nc-visual iframe').style.height, 10)`);
    assert.ok(h >= 60 && h <= 640, `height ${h} is outside 60..640`);
    await pg.eval('ncVisuals.setBusy(true)');
    await clickIn(pg, 0, 100, 40);
    await sleep(500);
    assert.equal(await pg.eval('window.events.length'), 0, 'an event arrived while a turn was in flight');
    await pg.eval('ncVisuals.setBusy(false)');
    await sleep(200);
    await clickIn(pg, 0, 100, 40);
    await pg.waitFor('window.events.length === 1');
  } finally { await pg.close(); }
});

test('ai.os: a panel in the chat cannot ask the computer for anything; an installed app\'s request goes through its handler, one at a time', { skip }, async () => {
  const pg = await open();
  try {
    // In the chat there is no handler, so the request is refused where it is made.
    await pg.eval(`show('<script>ai.os("terminal", "run ls").then(function (v) { ai.send("os", { ok: true }); }, function (e) { ai.send("os", { ok: false, why: e.message }); });<\\/script>')`);
    await pg.waitFor('window.events.some(function (e) { return e[0] === "os"; })', 8000);
    const [, refused] = await pg.eval('window.events.find(function (e) { return e[0] === "os"; })');
    assert.equal(refused.ok, false);
    assert.match(refused.why, /Only an installed app/);

    // With a handler (what an installed app's page supplies): valid requests arrive, invalid ones do not, and a second waits.
    await pg.eval(`window.osCalls = [];
      window.mountApp = function (code) {
        var host = document.createElement('div'); document.body.appendChild(host);
        host.appendChild(ncVisuals.mount(code, undefined, function (tool, request) { window.osCalls.push([tool, request]); return new Promise(function (r) { window.finish = function () { r({ status: 'ran', text: 'done' }); }; }); }));
      };
      mountApp('<script>var out = [];'
        + 'ai.os("file-system", "list /tmp").then(function (v) { out.push(v.text); });'
        + 'ai.os("terminal", "second").catch(function (e) { out.push(e.message); });'
        + 'ai.os("Bad Tool!", "x").catch(function (e) { out.push(e.message); });'
        + 'setTimeout(function () { ai.send("out", out); }, 700);<\\/script>')`);
    await sleep(300);
    assert.deepEqual(await pg.eval('window.osCalls'), [['file-system', 'list /tmp']], 'more than the first valid request got through at once');
    await pg.eval('window.finish()');
    await pg.waitFor('window.events.some(function (e) { return e[0] === "out"; })', 8000);
    const [, out] = await pg.eval('window.events.find(function (e) { return e[0] === "out"; })');
    assert.deepEqual(out.sort(), ['One request at a time.', 'That request is not valid.', 'done'].sort());
  } finally { await pg.close(); }
});
