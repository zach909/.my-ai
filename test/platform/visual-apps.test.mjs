/**
 * Visual apps (models && skills/core/visual-apps.ts): a visual kept as an app and put on the computer only
 * after the owner has seen exactly what would be written and approved it.
 *
 * The store is checked directly (against a throwaway home folder, never the real one). The routes run on the
 * real compiled server, and the consent card is driven in a real browser on the real chat page. Needs Chrome
 * or Chromium for the browser half (see browserSkip).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Browser } from './browser.mjs';
import { api, browserSkip, dist, ensureBuilt, removeDir, startServer, tempDir } from './helpers.mjs';

ensureBuilt();
const A = await import(dist('models && skills/core/visual-apps.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mkHome = () => mkdtempSync(path.join(tmpdir(), 'nc-home-'));
const sys = (platform, home) => ({ platform, home, env: {} });

test('each system gets one launcher file in its own place, carrying a marker and nothing from the name that could run', () => {
  const home = '/home/zed';
  const app = { id: 'dice', name: 'Dice' };
  const linux = A.planLauncher(app, 'http://127.0.0.1:7861/', sys('linux', home));
  assert.equal(linux.path, '/home/zed/.local/share/applications/neuroclaw-dice.desktop');
  assert.match(linux.content, /^Exec=xdg-open http:\/\/127\.0\.0\.1:7861\/visual-apps\/dice$/m);
  const mac = A.planLauncher(app, 'http://127.0.0.1:7861', sys('darwin', home));
  assert.equal(mac.path, '/home/zed/Applications/Dice.webloc');
  const win = A.planLauncher(app, 'http://127.0.0.1:7861', { platform: 'win32', home: 'C:\\Users\\zed', env: { APPDATA: 'C:\\Users\\zed\\AppData\\Roaming' } });
  assert.match(win.path.replaceAll('\\', '/'), /Start Menu\/Programs\/Dice\.url$/);
  for (const p of [linux, mac, win]) assert.ok(p.content.includes('neuroclaw-visual-app:dice'), `${p.platform} has no marker`);
  assert.ok(A.isUnavailable(A.planLauncher(app, 'http://x', sys('android', home))));

  // A hostile name cannot add a line (an extra Exec=, say) to the entry.
  const evil = A.cleanName('Dice\nExec=rm -rf ~\r\n');
  assert.ok(!/[\n\r]/.test(evil));
  const plan = A.planLauncher({ id: 'dice', name: evil }, 'http://127.0.0.1:7861', sys('linux', home));
  assert.equal(plan.content.split('\n').filter((l) => l.startsWith('Exec=')).length, 1);
});

test('saving changes nothing outside the data folder; an install needs the approval a preview returned, once, in time', () => {
  const dir = tempDir('nc-apps-'); const home = mkHome();
  let now = 1_000;
  const store = new A.VisualAppStore(dir, () => now);
  try {
    assert.throws(() => store.save('', '<p>x</p>'), /name/i);
    assert.throws(() => store.save('Dice', '   '), /no visual/i);
    assert.throws(() => store.save('Dice', 'x'.repeat(A.APP_CODE_MAX + 1)), /KB/);
    const a = store.save('Dice', '<button>Roll</button>');
    const b = store.save('Dice', '<button>Roll 2</button>');
    assert.deepEqual([a.id, b.id], ['dice', 'dice-2']);

    const plan = A.planLauncher(a, 'http://127.0.0.1:7861', sys('linux', home));
    assert.ok(!existsSync(plan.path), 'saving wrote a launcher');
    assert.throws(() => store.install('dice', undefined, 'http://127.0.0.1:7861', sys('linux', home)), /Not approved/);
    assert.throws(() => store.install('dice', 'guess', 'http://127.0.0.1:7861', sys('linux', home)), /Not approved/);

    const shown = store.preview('dice', 'http://127.0.0.1:7861', sys('linux', home));
    assert.ok(!existsSync(plan.path), 'a preview wrote the launcher');
    assert.throws(() => store.install('dice', 'guess', 'http://127.0.0.1:7861', sys('linux', home)), /Not approved/, 'a wrong approval also spends the real one');
    assert.throws(() => store.install('dice', shown.approval, 'http://127.0.0.1:7861', sys('linux', home)), /Not approved/);

    const again = store.preview('dice', 'http://127.0.0.1:7861', sys('linux', home));
    now += A.APPROVAL_TTL_MS + 1;
    assert.throws(() => store.install('dice', again.approval, 'http://127.0.0.1:7861', sys('linux', home)), /Not approved/, 'an expired approval installed');

    const fresh = store.preview('dice', 'http://127.0.0.1:7861', sys('linux', home));
    const done = store.install('dice', fresh.approval, 'http://127.0.0.1:7861', sys('linux', home));
    assert.equal(readFileSync(plan.path, 'utf8'), fresh.plan.content, 'what was written is not what the preview showed');
    assert.equal(done.launcher.path, plan.path);
    assert.throws(() => store.install('dice', fresh.approval, 'http://127.0.0.1:7861', sys('linux', home)), /Not approved/, 'one approval, one install');
  } finally { removeDir(dir); removeDir(home); }
});

test('removing an app takes out the launcher it wrote, and leaves a file someone else put there alone', () => {
  const dir = tempDir('nc-apps-'); const home = mkHome();
  const store = new A.VisualAppStore(dir);
  try {
    for (const replaced of [false, true]) {
      const app = store.save(replaced ? 'Mine' : 'Yours', '<p>hi</p>');
      const { plan, approval } = store.preview(app.id, 'http://127.0.0.1:7861', sys('linux', home));
      store.install(app.id, approval, 'http://127.0.0.1:7861', sys('linux', home));
      if (replaced) writeFileSync(plan.path, '[Desktop Entry]\nName=Something else entirely\n');
      const r = store.remove(app.id);
      assert.equal(r.removed, true);
      assert.equal(r.launcherRemoved, !replaced);
      assert.equal(existsSync(plan.path), replaced, replaced ? 'a replaced file was deleted' : 'the launcher stayed behind');
    }
    assert.deepEqual(store.remove('nothing'), { removed: false, launcherRemoved: false });
    assert.deepEqual(store.list(), []);
  } finally { removeDir(dir); removeDir(home); }
});

test('an app can be allowed only the listed tools, only with an approval a preview returned, once; nothing is allowed by default', () => {
  const dir = tempDir('nc-apps-');
  const store = new A.VisualAppStore(dir);
  try {
    const app = store.save('Fixer', '<p>x</p>');
    assert.equal(store.osAllows(app.id, 'terminal'), false, 'a new app can already ask for a tool');
    // Never offered to an app, however it is asked: things that speak for you, look at you, or change the agent.
    for (const tool of ['computer-access', 'email', 'camera', 'plugin-maker', 'store', 'self-heal', 'nope', 7]) {
      assert.throws(() => store.previewOs(app.id, [tool]), /cannot be given/, String(tool));
    }
    assert.throws(() => store.previewOs(app.id, []), /at least one/);
    assert.throws(() => store.grantOs(app.id, ['terminal'], undefined), /Not approved/);

    const shown = store.previewOs(app.id, ['terminal', 'terminal', 'radios']);
    assert.deepEqual(shown.tools.map((t) => t.id), ['terminal', 'radios']);
    assert.equal(store.osAllows(app.id, 'terminal'), false, 'a preview granted');
    assert.throws(() => store.grantOs(app.id, ['terminal', 'radios', 'desktop'], shown.approval), /Not approved/, 'approval carried to a bigger list');
    const again = store.previewOs(app.id, ['terminal']);
    const granted = store.grantOs(app.id, ['terminal'], again.approval);
    assert.deepEqual(granted.os.tools, ['terminal']);
    assert.equal(store.osAllows(app.id, 'terminal'), true);
    assert.equal(store.osAllows(app.id, 'radios'), false, 'granted more than was approved');
    assert.throws(() => store.grantOs(app.id, ['terminal'], again.approval), /Not approved/, 'one approval, one grant');
    store.revokeOs(app.id);
    assert.equal(store.osAllows(app.id, 'terminal'), false);
  } finally { removeDir(dir); }
});

const skip = browserSkip();
let srv, home, apps, browser;
before(async () => {
  home = mkHome(); apps = tempDir('nc-apps-');
  srv = await startServer({ env: { HOME: home, XDG_DATA_HOME: '', CORONA_VISUAL_APPS_DIR: apps } });
  if (!skip) browser = await Browser.launch();
});
after(async () => { await browser?.close(); await srv?.stop(); removeDir(home); removeDir(apps); });

test('on the real server: save, preview, approve, open the page, remove', async () => {
  const launcher = path.join(home, '.local', 'share', 'applications', 'neuroclaw-dice.desktop');
  const made = await api(srv.url, '/api/visual-apps', { method: 'POST', body: { name: 'Dice', code: '<button id="r">Roll</button><script>/*</script>*/</script>' } });
  assert.equal(made.status, 201);
  assert.equal(made.json.app.id, 'dice');

  const blind = await api(srv.url, '/api/visual-apps/dice/install', { method: 'POST', body: { approval: 'x' } });
  assert.equal(blind.status, 400);
  assert.match(blind.json.error, /Not approved/);
  assert.ok(!existsSync(launcher), 'installed without a preview');

  const shown = await api(srv.url, '/api/visual-apps/dice/preview', { method: 'POST', body: {} });
  assert.equal(shown.status, 200);
  assert.equal(shown.json.plan.path, launcher);
  assert.ok(!existsSync(launcher), 'a preview wrote the launcher');

  const ok = await api(srv.url, '/api/visual-apps/dice/install', { method: 'POST', body: { approval: shown.json.approval } });
  assert.equal(ok.status, 200);
  assert.equal(readFileSync(launcher, 'utf8'), shown.json.plan.content);
  assert.match(readFileSync(launcher, 'utf8'), /visual-apps\/dice/);

  const page = await api(srv.url, '/visual-apps/dice');
  assert.equal(page.status, 200);
  assert.match(page.text, /<title>Dice<\/title>/);
  assert.ok(!page.text.includes('</script>*/'), 'the app\'s own text closed the page\'s script');
  assert.equal((await api(srv.url, '/visual-apps/nope')).status, 404);
  assert.equal((await api(srv.url, '/api/visual-apps')).json.apps.length, 1);

  const gone = await api(srv.url, '/api/visual-apps/dice', { method: 'DELETE' });
  assert.deepEqual(gone.json, { removed: true, launcherRemoved: true });
  assert.ok(!existsSync(launcher));
});


/** Press "make app" on the first panel. The bubble springs in, so a pointer click can land on a moving target: try again until the card is there. */
async function openCard(pg) {
  for (let i = 0; i < 6; i++) {
    await sleep(500);
    try { await pg.click('.nc-visual-bar button[title^="Keep this"]'); } catch { /* still moving */ }
    try { await pg.waitFor(`document.querySelector('#nc-app-card input')`, 1500); return; } catch { /* not open yet */ }
  }
  throw new Error('the make-app card did not open');
}

test('in the chat page: "make app" shows the exact file first, writes nothing until approved, and Cancel leaves nothing behind', { skip }, async () => {
  const launcher = path.join(home, '.local', 'share', 'applications', 'neuroclaw-clicker.desktop');
  const pg = await browser.newPage();
  const clickText = (text) => pg.eval(`(() => { const b = [...document.querySelectorAll('#nc-app-card button')].find((x) => x.textContent === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
  try {
    await pg.emulate({ width: 1000, height: 900 });
    await pg.goto(srv.url + '/');
    await pg.eval(`addMessage('ai', 'Try this\\n' + String.fromCharCode(96,96,96) + 'visual\\n<button>Hit</button>\\n' + String.fromCharCode(96,96,96), '12:00')`);
    await pg.waitFor(`document.querySelector('.nc-visual-bar button[title^="Keep this"]')`);

    // Cancel after the review: the saved draft is deleted and no launcher was written.
    await openCard(pg);
    await pg.type('#nc-app-card input', 'Clicker');
    assert.ok(await clickText('Review'));
    await pg.waitFor(`document.querySelector('#nc-app-card .nc-card-path')`);
    assert.equal(await pg.eval(`document.querySelector('#nc-app-card .nc-card-path').textContent`), launcher);
    assert.match(await pg.eval(`document.querySelector('#nc-app-card .nc-card-pre').textContent`), /\[Desktop Entry\]/);
    assert.ok(!existsSync(launcher), 'the card wrote the launcher before approval');
    assert.ok(await clickText('Cancel'));
    let left = -1;
    for (let i = 0; i < 50 && left !== 0; i++) { await sleep(100); left = (await api(srv.url, '/api/visual-apps')).json.apps.length; }
    assert.equal(left, 0, 'Cancel left a saved app behind');

    // Approve: now it is written, with what was shown.
    await openCard(pg);
    await pg.type('#nc-app-card input', 'Clicker');
    assert.ok(await clickText('Review'));
    await pg.waitFor(`document.querySelector('#nc-app-card .nc-card-pre')`);
    const shown = await pg.eval(`document.querySelector('#nc-app-card .nc-card-pre').textContent`);
    assert.ok(await clickText('Approve and install'));
    await pg.waitFor(`document.querySelector('#nc-app-card strong') && document.querySelector('#nc-app-card strong').textContent.includes('installed')`);
    assert.equal(readFileSync(launcher, 'utf8'), shown);
    assert.deepEqual(pg.errors, []);
    await api(srv.url, '/api/visual-apps/clicker', { method: 'DELETE' });
    assert.ok(!existsSync(launcher));
  } finally { await pg.close(); }
});

test('on the real server: an app asks the computer for something only if allowed, and a risky tool still waits for the owner', async () => {
  // Inside the folder the server runs in: the file tool has its own sandbox and would refuse anywhere else.
  const work = srv.cwd;
  writeFileSync(path.join(work, 'marker-file.txt'), 'hi');
  const call = (id, tool, request) => api(srv.url, `/api/visual-apps/${id}/os`, { method: 'POST', body: { tool, request } });
  try {
    assert.ok(!(await api(srv.url, '/api/visual-apps/os-tools')).json.tools.some((t) => t.id === 'email'));
    await api(srv.url, '/api/visual-apps', { method: 'POST', body: { name: 'Tidy', code: '<p>x</p>' } });

    const none = await call('tidy', 'file-system', `list ${work}`);
    assert.equal(none.status, 403, 'an app with no grant asked the computer');

    const bad = await api(srv.url, '/api/visual-apps/tidy/os-preview', { method: 'POST', body: { tools: ['email'] } });
    assert.equal(bad.status, 400);
    const blind = await api(srv.url, '/api/visual-apps/tidy/os-grant', { method: 'POST', body: { tools: ['file-system'], approval: 'x' } });
    assert.equal(blind.status, 400);
    assert.equal((await call('tidy', 'file-system', `list ${work}`)).status, 403);

    const shown = await api(srv.url, '/api/visual-apps/tidy/os-preview', { method: 'POST', body: { tools: ['file-system'] } });
    assert.equal(shown.status, 200);
    const ok = await api(srv.url, '/api/visual-apps/tidy/os-grant', { method: 'POST', body: { tools: ['file-system'], approval: shown.json.approval } });
    assert.deepEqual(ok.json.app.os.tools, ['file-system']);

    // Allowed for files only: another tool is still refused, and so is a request that is too long.
    assert.equal((await call('tidy', 'terminal', 'run ls')).status, 403);
    assert.equal((await call('tidy', 'file-system', 'x'.repeat(601))).status, 400);

    // Files is a risky tool, so even an allowed app's request is held for the owner and nothing has run.
    const held = await call('tidy', 'file-system', `list ${work}`);
    assert.equal(held.status, 200);
    assert.equal(held.json.status, 'held', JSON.stringify(held.json));
    assert.match(held.json.text, /Waiting for your permission/);
    assert.ok(!held.json.text.includes('marker-file.txt'), 'the tool ran before anyone approved it');

    // The owner approves it in Settings, once; only then does it run.
    const id = held.json.text.match(/request ([a-f0-9]{10})/)[1];
    const done = await api(srv.url, `/api/safety/approvals/${id}/approve`, { method: 'POST', body: {} });
    assert.equal(done.json.approval.status, 'approved');
    assert.match(done.json.approval.result, /marker-file\.txt/);
    const twice = await api(srv.url, `/api/safety/approvals/${id}/approve`, { method: 'POST', body: {} });
    assert.equal(twice.status, 409, 'an approval ran twice');

    // Taking the grant away ends it.
    await api(srv.url, '/api/visual-apps/tidy/os-revoke', { method: 'POST', body: {} });
    assert.equal((await call('tidy', 'file-system', `list ${work}`)).status, 403);
  } finally { await api(srv.url, '/api/visual-apps/tidy', { method: 'DELETE' }); }
});

test('in the browser: the grant card lists what an app may be given, and an installed app\'s page shows every request it makes and what became of it', { skip }, async () => {
  const pg = await browser.newPage();
  const clickText = (text) => pg.eval(`(() => { const b = [...document.querySelectorAll('#nc-app-card button')].find((x) => x.textContent === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
  try {
    await pg.emulate({ width: 1000, height: 900 });
    await pg.goto(srv.url + '/');
    await pg.eval(`addMessage('ai', String.fromCharCode(96,96,96) + 'visual\\n<p>hi</p>\\n' + String.fromCharCode(96,96,96), '12:00')`);
    await pg.waitFor(`document.querySelector('.nc-visual-bar button[title^="Keep this"]')`);
    await openCard(pg);
    await pg.type('#nc-app-card input', 'Looker');
    await clickText('Review');
    await pg.waitFor(`document.querySelector('#nc-app-card .nc-card-pre')`);
    await clickText('Approve and install');
    await pg.waitFor(`[...document.querySelectorAll('#nc-app-card button')].some((b) => b.textContent.startsWith('Let it change'))`);
    await clickText('Let it change this computer...');
    await pg.waitFor(`document.querySelectorAll('#nc-app-card input[type=checkbox]').length > 0`);
    const labels = await pg.eval(`[...document.querySelectorAll('#nc-app-card label')].map((l) => l.textContent)`);
    assert.ok(labels.some((l) => l.startsWith('Terminal')) && !labels.some((l) => /mail|camera|Store/i.test(l)), labels.join(' | '));
    // Nothing is allowed until Allow is pressed.
    await pg.eval(`document.querySelectorAll('#nc-app-card input[type=checkbox]')[1].click()`); // Files
    await clickText('Review');
    await pg.waitFor(`[...document.querySelectorAll('#nc-app-card button')].some((b) => b.textContent === 'Allow')`);
    assert.equal(await pg.eval(`fetch('/api/visual-apps').then((r) => r.json()).then((j) => j.apps[0].os || null)`), null, 'allowed before Allow was pressed');
    await clickText('Allow');
    await pg.waitFor(`document.querySelector('#nc-app-card strong') && document.querySelector('#nc-app-card strong').textContent.includes('may now ask')`);

    // The app's own page: it asks for a file listing; the page shows the request and that it is waiting for the owner.
    const code = `<script>ai.os("file-system", "list ${srv.cwd.replaceAll('\\', '/')}").then(function () {}, function () {});<\/script>`;
    await api(srv.url, '/api/visual-apps/looker', { method: 'DELETE' });
    await api(srv.url, '/api/visual-apps', { method: 'POST', body: { name: 'Looker', code } });
    const shown = await api(srv.url, '/api/visual-apps/looker/os-preview', { method: 'POST', body: { tools: ['file-system'] } });
    await api(srv.url, '/api/visual-apps/looker/os-grant', { method: 'POST', body: { tools: ['file-system'], approval: shown.json.approval } });
    await pg.goto(srv.url + '/visual-apps/looker');
    await pg.waitFor(`document.querySelectorAll('#oslog li').length >= 2`, 15000);
    const lines = await pg.eval(`[...document.querySelectorAll('#oslog li')].map((l) => l.textContent)`);
    assert.match(lines[0], /^Asked file-system: list /);
    assert.match(lines[1], /^\s+held: .*Waiting for your permission/);
  } finally { await api(srv.url, '/api/visual-apps/looker', { method: 'DELETE' }); await pg.close(); }
});
