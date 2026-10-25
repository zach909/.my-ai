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
    await pg.click('.nc-visual-bar button[title^="Keep this"]');
    await pg.type('#nc-app-card input', 'Clicker');
    assert.ok(await clickText('Review'));
    await pg.waitFor(`document.querySelector('#nc-app-card .nc-card-path')`);
    assert.equal(await pg.eval(`document.querySelector('#nc-app-card .nc-card-path').textContent`), launcher);
    assert.match(await pg.eval(`document.querySelector('#nc-app-card .nc-card-pre').textContent`), /\[Desktop Entry\]/);
    assert.ok(!existsSync(launcher), 'the card wrote the launcher before approval');
    assert.ok(await clickText('Cancel'));
    await sleep(400);
    assert.equal((await api(srv.url, '/api/visual-apps')).json.apps.length, 0, 'Cancel left a saved app behind');

    // Approve: now it is written, with what was shown.
    await pg.click('.nc-visual-bar button[title^="Keep this"]');
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
