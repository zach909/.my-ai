#!/usr/bin/env node
/**
 * Start a packaged build the way a person's double-click would, and check it really works.
 *
 *   node scripts/release/smoke-package.mjs <appDir> [nodeBinary]
 *
 * <appDir> is the folder that holds the app payload (package.json, dist/, scripts/): inside an
 * extracted .deb that is opt/neuroclaw/app, in a macOS bundle Contents/Resources/app, in the Windows
 * zip NeuroClaw/app. [nodeBinary] is the runtime packaged next to it; default is the running node.
 *
 * It runs the launcher with a clean temporary home and data folder and the working directory set to
 * "/" (what a desktop entry gives), then checks: the engine starts, the interface and Settings pages
 * are served, a setting saves and is still there after the engine is stopped and started again, and
 * the engine stops when the launcher is told to. Exit 0 only if every check passed; prints each one.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [appDir, nodeBin = process.execPath] = process.argv.slice(2);
if (!appDir) { console.error('usage: smoke-package.mjs <appDir> [nodeBinary]'); process.exit(2); }

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const port = await new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const work = mkdtempSync(path.join(tmpdir(), 'nc-smoke-'));
const env = { ...process.env, CORONA_DATA_DIR: path.join(work, 'data'), NEUROCLAW_APP_HOME: path.join(work, 'apphome'), HOME: work, USERPROFILE: work, LOCALAPPDATA: path.join(work, 'local'), XDG_DATA_HOME: path.join(work, 'xdg') };
const url = `http://127.0.0.1:${port}`;

function launch() {
  const child = spawn(nodeBin, [path.join(appDir, 'scripts', 'desktop-launcher.mjs'), '--no-window', '--port', String(port)], { cwd: path.parse(work).root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const ready = new Promise((resolve) => {
    const t = setInterval(() => { if (/READY |FAILED /.test(out)) { clearInterval(t); resolve(out); } }, 200);
    child.on('exit', () => { clearInterval(t); resolve(out); });
    setTimeout(() => { clearInterval(t); resolve(out); }, 100_000);
  });
  return { child, ready };
}
const stop = (child) => new Promise((res) => { child.once('exit', res); child.kill('SIGTERM'); setTimeout(res, 8000); });
const get = async (p, init) => { const r = await fetch(url + p, { signal: AbortSignal.timeout(15000), ...init }); return { r, text: await r.text() }; };
const alive = async () => { try { await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; } };

try {
  let a = launch();
  const first = await a.ready;
  check('engine starts and reports READY', /READY /.test(first), /FAILED.*/.exec(first)?.[0] ?? '');
  if (/READY /.test(first)) {
    const status = await get('/api/status');
    check('/api/status answers as NeuroClaw', status.r.ok && JSON.parse(status.text).running === true);
    const home = await get('/');
    check('home page is served', home.r.ok && home.text.includes('Neuroclaw'));
    const settings = await get('/settings');
    check('Settings page is served', settings.r.ok && settings.text.includes('Settings'));
    const info = JSON.parse((await get('/api/app-info')).text);
    check('version and build are reported', /^\d+\.\d+\.\d+/.test(info.version) && info.build.packaged === true, `${info.version} ${info.build.platform}/${info.build.arch} ${String(info.build.commit).slice(0, 8)}`);
    const post = await get('/api/app-settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appearance: { reduceMotion: 'on' } }) });
    check('a setting saves', post.r.ok && JSON.parse(post.text).persistence.ok === true, post.text.slice(0, 120));
    const sw = await get('/api/access/switch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'workspace', on: false }) });
    check('a computer-access switch saves (the Linux settings crash)', sw.r.ok && JSON.parse(sw.text).persistence.ok === true, sw.text.slice(0, 120));
    await stop(a.child);
    await new Promise((r) => setTimeout(r, 500));
    check('engine stops when the launcher stops', !(await alive()));

    a = launch();
    const second = await a.ready;
    check('engine starts again', /READY /.test(second));
    const again = JSON.parse((await get('/api/app-settings')).text);
    check('the setting is still there after a restart', again.settings.appearance.reduceMotion === 'on');
    const access = JSON.parse((await get('/api/access')).text);
    check('the switch is still off after a restart', access.switches.find((s) => s.name === 'workspace').on === false);
    await stop(a.child);
  }
} catch (e) {
  check('smoke test ran to the end', false, e.message);
} finally {
  rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} check(s) failed` : `all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
