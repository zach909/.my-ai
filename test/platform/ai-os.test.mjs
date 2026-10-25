/**
 * AI OS mode: the engine becomes part of the computer's sign-in.
 *
 * Nothing here touches the real operating system's startup items. The plan for each platform is checked as
 * data (and, where this machine has the real parser, by the real parser: systemd-analyze, xmllint); the
 * enable / disable flow runs against a fake file system and fake commands; the HTTP route is tested only
 * where it refuses or reports, never where it would change this machine.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Browser } from './browser.mjs';
import { ROOT, dist, ensureBuilt, startServer, api, browserSkip, tempDir, removeDir } from './helpers.mjs';

ensureBuilt();
const AI = await import(dist('interface/platform/ai-os.js'));
const text = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const hasTool = (cmd, args = ['--version']) => { const r = spawnSync(cmd, args, { stdio: 'ignore' }); return !r.error; };

/** A source checkout that has been built, in a fake file system. */
const CHECKOUT = ['/srv/nc/dist/interface/main.js'];
/** An installed build: the launcher and build-info.json exist. */
const INSTALLED = ['/srv/nc/dist/interface/main.js', '/srv/nc/build-info.json', '/srv/nc/scripts/desktop-launcher.mjs'];

const baseEnv = { home: '/home/me', dataDir: '/home/me/.neuroclaw', root: '/srv/nc', node: '/usr/bin/node', uid: 1000, systemdUser: true, env: {} };
const plan = (over, present = CHECKOUT) => AI.planAiOs({ ...baseEnv, platform: 'linux', ...over }, (p) => present.includes(p));

/** Fake file system and command runner. `fail` maps "file arg0 arg1" prefixes to a non-zero exit. */
function fakeIo({ present = CHECKOUT, fail = [], writeFails = [] } = {}) {
  const fs = new Set(present);
  const io = {
    fs, calls: [], written: new Map(), removed: [],
    writeFile(f, c) { if (writeFails.includes(f)) throw new Error('read-only file system'); io.written.set(f, c); fs.add(f); },
    removeFile(f) { io.removed.push(f); fs.delete(f); },
    exists: (f) => fs.has(f),
    run(file, args) {
      const line = [file, ...args].join(' ');
      io.calls.push(line);
      const bad = fail.find((p) => line.startsWith(p));
      return bad ? { status: 1, stdout: '', stderr: `${bad} failed on purpose` } : { status: 0, stdout: '', stderr: '' };
    },
  };
  return io;
}

/* ---------- which command the computer starts ---------- */

test('a source checkout starts dist/interface/main.js directly, with the startup git pull off', () => {
  const p = plan({});
  assert.equal(p.engine.kind, 'direct');
  assert.deepEqual(p.engine.args, ['/srv/nc/dist/interface/main.js', 'web', '7861']);
  assert.equal(p.engine.env.NEUROCLAW_AUTO_UPDATE, '0', 'a background service must never rewrite the checkout it runs from');
  assert.equal(p.engine.cwd, '/srv/nc');
});

test('an installed build starts the packaged launcher without a window', () => {
  const p = plan({}, INSTALLED);
  assert.equal(p.engine.kind, 'launcher');
  assert.deepEqual(p.engine.args, ['/srv/nc/scripts/desktop-launcher.mjs', '--no-window']);
  assert.equal(p.engine.cwd, '/home/me/.neuroclaw');
});

test('nothing is planned for a build that does not exist, or for a platform that cannot do it', () => {
  const unbuilt = plan({}, []);
  assert.equal(unbuilt.supported, false);
  assert.match(unbuilt.reason, /build-backend/);
  for (const platform of ['android', 'ios', 'freebsd']) {
    const p = AI.planAiOs({ ...baseEnv, platform }, () => true);
    assert.equal(p.supported, false, platform);
    assert.ok(p.reason.length > 30, `${platform} gets a reason in words`);
  }
});

/* ---------- Linux ---------- */

test('Linux with a systemd user manager: a unit that restarts on failure, logs to the data folder, and is wanted by default.target', () => {
  const p = plan({});
  assert.equal(p.mechanism, 'systemd-user');
  const [unit] = p.files;
  assert.equal(unit.path, '/home/me/.config/systemd/user/neuroclaw.service');
  assert.match(unit.content, /^ExecStart="\/usr\/bin\/node" "\/srv\/nc\/dist\/interface\/main\.js" "web" "7861"$/m);
  assert.match(unit.content, /^Restart=on-failure$/m);
  assert.match(unit.content, /^StartLimitBurst=5$/m, 'a crash loop gives up instead of burning the CPU');
  assert.match(unit.content, /^WantedBy=default\.target$/m);
  assert.match(unit.content, /^Environment="NEUROCLAW_AUTO_UPDATE=0"$/m);
  assert.match(unit.content, /^StandardOutput=append:\/home\/me\/\.neuroclaw\/logs\/ai-os\.log$/m);
});

test('enabling registers for the next sign-in and does not start a second engine; "start now" is a separate, optional step', () => {
  const p = plan({});
  const enable = p.enable.map((c) => c.args.join(' '));
  assert.deepEqual(enable, ['--user daemon-reload', '--user enable neuroclaw.service']);
  assert.ok(!enable.some((a) => a.includes('--now') || a.includes('start')), 'the engine serving this very request is already on the port');
  assert.deepEqual(p.startNow.map((c) => c.args.join(' ')), ['--user start neuroclaw.service']);
});

test('XDG_CONFIG_HOME is honoured when absolute, ignored when relative', () => {
  assert.equal(plan({ env: { XDG_CONFIG_HOME: '/cfg' } }).files[0].path, '/cfg/systemd/user/neuroclaw.service');
  assert.equal(plan({ env: { XDG_CONFIG_HOME: 'relative' } }).files[0].path, '/home/me/.config/systemd/user/neuroclaw.service');
});

test('Linux without a user manager (a container, WSL): an autostart entry, and the systemd leftovers are cleared so nothing starts twice', () => {
  const p = plan({ systemdUser: false });
  assert.equal(p.mechanism, 'xdg-autostart');
  assert.equal(p.files[0].path, '/home/me/.config/autostart/neuroclaw-ai-os.desktop');
  assert.deepEqual(p.enable, []);
  assert.ok(p.removeOnEnable.includes('/home/me/.config/systemd/user/neuroclaw.service'));
  assert.match(p.summary, /not restarted/i, 'it says plainly that this way has no restart');
});

/** The Desktop Entry spec's Exec parsing: file-level string unescape, then quoted-argument parsing. */
function parseDesktopExec(value) {
  const s = value.replace(/\\(.)/g, (_, c) => ({ s: ' ', n: '\n', t: '\t', r: '\r' }[c] ?? c));
  const out = [];
  let cur = null, quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '\\') { cur += s[++i]; continue; }
      if (c === '"') { quoted = false; continue; }
      cur += c;
    } else if (c === '"') { quoted = true; cur ??= ''; }
    else if (c === ' ') { if (cur !== null) { out.push(cur); cur = null; } }
    else cur = (cur ?? '') + c;
  }
  if (cur !== null) out.push(cur);
  return out.map((a) => a.replace(/%%/g, '%'));
}

test('the autostart Exec line round-trips through the Desktop Entry rules, including spaces, quotes, $, backticks, backslashes and %', () => {
  const nasty = '/opt/we ird/"q" $HOME `x` \\ 100%/node';
  const p = plan({ systemdUser: false, node: nasty });
  const exec = /^Exec=(.*)$/m.exec(p.files[0].content)[1];
  assert.deepEqual(parseDesktopExec(exec), ['env', 'NEUROCLAW_AUTO_UPDATE=0', nasty, '/srv/nc/dist/interface/main.js', 'web', '7861']);
});

test('the systemd unit is accepted by the real systemd parser, with an awkward install path, and a broken one is rejected (control)', { skip: hasTool('systemd-analyze') ? false : 'systemd-analyze is not installed' }, () => {
  const dir = tempDir('nc-aios-');
  try {
    // Everything systemd accepts in a program path that still needs care in the unit file: space, %, backtick, &, ;.
    const weird = path.join(dir, 'we ird %h `x` & y;z');
    mkdirSync(path.join(weird, 'dist', 'interface'), { recursive: true });
    writeFileSync(path.join(weird, 'dist', 'interface', 'main.js'), '');
    const node = path.join(weird, 'node');
    symlinkSync(process.execPath, node);
    const p = AI.planAiOs({ ...baseEnv, platform: 'linux', root: weird, node, dataDir: path.join(dir, 'data') }, existsSync);
    const good = path.join(dir, 'good.service');
    writeFileSync(good, p.files[0].content);
    const r = spawnSync('systemd-analyze', ['verify', '--man=no', good], { encoding: 'utf8' });
    assert.equal(r.status, 0, `systemd rejected the unit:\n${r.stdout}${r.stderr}`);
    assert.equal((r.stdout + r.stderr).trim(), '', 'and had no warnings about it');
    const bad = path.join(dir, 'bad.service');
    writeFileSync(bad, '[Service]\nExecStart=relative/path\n');
    assert.notEqual(spawnSync('systemd-analyze', ['verify', '--man=no', bad], { encoding: 'utf8' }).status, 0, 'the check can fail, so passing means something');
  } finally { removeDir(dir); }
});

test('a path systemd cannot take unambiguously ($ quote backslash tab) gets the autostart entry instead of a guess', () => {
  for (const node of ['/opt/a$HOME/node', "/opt/it's/node", '/opt/q"q/node', '/opt/back\\slash/node', '/opt/tab\tx/node']) {
    const p = plan({ node });
    assert.equal(p.mechanism, 'xdg-autostart', JSON.stringify(node));
    assert.match(p.summary, /character systemd cannot take/);
  }
  assert.equal(plan({ node: '/opt/we ird 100%/node' }).mechanism, 'systemd-user', 'a space or % is fine: it is escaped, and the real parser agrees (above)');
});

/* ---------- macOS ---------- */

test('macOS: a LaunchAgent that runs at load and restarts after a failure, with XML-escaped paths', () => {
  const p = plan({ platform: 'darwin', home: '/Users/me & <co>', dataDir: '/Users/me & <co>/Library/Application Support/NeuroClaw' });
  assert.equal(p.mechanism, 'launch-agent');
  assert.equal(p.files[0].path, '/Users/me & <co>/Library/LaunchAgents/ai.neuroclaw.os.plist');
  const c = p.files[0].content;
  assert.match(c, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(c, /<key>SuccessfulExit<\/key>\s*<false\/>/, 'restart only after a failure, so a clean stop stays stopped');
  assert.match(c, /Users\/me &amp; &lt;co&gt;\/Library\/Application Support\/NeuroClaw\/logs\/ai-os\.log/);
  assert.ok(!/me & </.test(c), 'no raw ampersand or angle bracket from a path survives into the XML');
  assert.deepEqual(p.enable, [], 'launchd loads ~/Library/LaunchAgents by itself at sign-in');
  assert.deepEqual(p.startNow.map((x) => x.args.join(' ')), ['bootout gui/1000/ai.neuroclaw.os', 'bootstrap gui/1000 /Users/me & <co>/Library/LaunchAgents/ai.neuroclaw.os.plist']);
});

test('the macOS plist is well-formed XML according to xmllint', { skip: hasTool('xmllint') ? false : 'xmllint is not installed' }, () => {
  const dir = tempDir('nc-aios-');
  try {
    const p = plan({ platform: 'darwin', home: '/Users/me & <co>', dataDir: '/Users/x/NeuroClaw' });
    const f = path.join(dir, 'a.plist');
    writeFileSync(f, p.files[0].content);
    const r = spawnSync('xmllint', ['--noout', '--nonet', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  } finally { removeDir(dir); }
});

/* ---------- Windows ---------- */

test('Windows: a hidden script started from the per-user Run key, with Windows paths even when planned on another OS', () => {
  const p = plan({ platform: 'win32', home: 'C:\\Users\\Me Too', dataDir: 'C:\\Users\\Me Too\\.neuroclaw', root: 'C:\\Program Files\\NeuroClaw', node: 'C:\\Program Files\\NeuroClaw\\node.exe' },
    ['C:\\Program Files\\NeuroClaw\\dist\\interface\\main.js']);
  assert.equal(p.mechanism, 'run-key');
  const script = 'C:\\Users\\Me Too\\.neuroclaw\\ai-os.vbs';
  assert.equal(p.files[0].path, script);
  const vbs = p.files[0].content;
  assert.match(vbs, /\r\n/, 'VBScript wants CRLF');
  assert.ok(vbs.includes('sh.Run """C:\\Program Files\\NeuroClaw\\node.exe"" ""C:\\Program Files\\NeuroClaw\\dist\\interface\\main.js"" ""web"" ""7861""", 0, False'),
    `hidden (window style 0), not waited on:\n${vbs}`);
  assert.ok(vbs.includes('sh.Environment("PROCESS")("NEUROCLAW_AUTO_UPDATE") = "0"'));
  assert.ok(vbs.includes('sh.CurrentDirectory = "C:\\Program Files\\NeuroClaw"'));
  const reg = p.enable[0];
  assert.equal(reg.file, 'reg');
  assert.deepEqual(reg.args.slice(0, 5), ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'NeuroClawAiOs', '/t']);
  assert.ok(reg.args.includes(`wscript.exe //B //Nologo "${script}"`));
  assert.ok(reg.args.includes('/f'));
  assert.ok(!JSON.stringify(p).includes('HKLM'), 'per-user only: no administrator rights');
});

/* ---------- enable and disable ---------- */

test('enable writes the file, registers it, and reports what it did', () => {
  const io = fakeIo();
  const r = AI.enableAiOs({ ...baseEnv, platform: 'linux' }, io);
  assert.equal(r.ok, true);
  assert.equal(r.enabled, true);
  assert.equal(r.mechanism, 'systemd-user');
  assert.ok(io.written.has('/home/me/.config/systemd/user/neuroclaw.service'));
  assert.deepEqual(io.calls, ['systemctl --user daemon-reload', 'systemctl --user enable neuroclaw.service']);
  assert.match(r.message, /next sign-in/);
  assert.ok(r.steps.every((s) => s.ok));
});

test('enable with startNow also starts the service (only for when nothing is running yet)', () => {
  const io = fakeIo();
  const r = AI.enableAiOs({ ...baseEnv, platform: 'linux' }, io, { startNow: true });
  assert.equal(r.ok, true);
  assert.equal(io.calls.at(-1), 'systemctl --user start neuroclaw.service');
  assert.match(r.message, /running now/);
});

test('enabling twice is the same as enabling once', () => {
  const io = fakeIo();
  AI.enableAiOs({ ...baseEnv, platform: 'linux' }, io);
  const first = io.written.get('/home/me/.config/systemd/user/neuroclaw.service');
  const r = AI.enableAiOs({ ...baseEnv, platform: 'linux' }, io);
  assert.equal(r.ok, true);
  assert.equal(io.written.get('/home/me/.config/systemd/user/neuroclaw.service'), first);
});

test('a failing command rolls back: the file is removed, the OS is told to disable, and the result says nothing was left on', () => {
  const io = fakeIo({ fail: ['systemctl --user enable'] });
  const r = AI.enableAiOs({ ...baseEnv, platform: 'linux' }, io);
  assert.equal(r.ok, false);
  assert.equal(r.enabled, false);
  assert.match(r.message, /Nothing was left turned on/);
  assert.ok(io.removed.includes('/home/me/.config/systemd/user/neuroclaw.service'), 'the unit file is gone again');
  assert.ok(io.calls.some((c) => c.startsWith('systemctl --user disable')), 'and systemd was told');
  assert.equal(AI.aiOsStatus({ ...baseEnv, platform: 'linux' }, io).enabled, false);
});

test('a file that cannot be written is reported by name and nothing is half-installed', () => {
  const target = '/home/me/.config/systemd/user/neuroclaw.service';
  const io = fakeIo({ writeFails: [target] });
  const r = AI.enableAiOs({ ...baseEnv, platform: 'linux' }, io);
  assert.equal(r.ok, false);
  assert.match(r.message, /Could not write .*neuroclaw\.service.*read-only/);
  assert.deepEqual(io.calls, [], 'no command ran after the failed write');
});

test('switching from autostart to systemd removes the autostart entry so the engine is not started twice', () => {
  const autostart = '/home/me/.config/autostart/neuroclaw-ai-os.desktop';
  const io = fakeIo({ present: [...CHECKOUT, autostart] });
  const r = AI.enableAiOs({ ...baseEnv, platform: 'linux', systemdUser: true }, io);
  assert.equal(r.ok, true);
  assert.ok(io.removed.includes(autostart));
  assert.ok(!io.fs.has(autostart));
});

test('disable removes every file either mechanism could have left, including a dangling systemd symlink', () => {
  const unit = '/home/me/.config/systemd/user/neuroclaw.service';
  const wants = '/home/me/.config/systemd/user/default.target.wants/neuroclaw.service';
  const autostart = '/home/me/.config/autostart/neuroclaw-ai-os.desktop';
  const io = fakeIo({ present: [...CHECKOUT, unit, wants, autostart] });
  // A symlink whose target is already gone reports exists() === false but must still be removed.
  const env = { ...baseEnv, platform: 'linux' };
  const r = AI.disableAiOs(env, io);
  assert.equal(r.ok, true);
  assert.equal(r.enabled, false);
  for (const f of [unit, wants, autostart]) assert.ok(io.removed.includes(f), f);
  assert.equal(io.calls[0], 'systemctl --user disable --now neuroclaw.service');
  assert.equal(io.calls.at(-1), 'systemctl --user daemon-reload');
  const dangling = fakeIo({ present: CHECKOUT });
  AI.disableAiOs(env, dangling);
  assert.ok(dangling.removed.includes(wants), 'removeFile is called even when exists() says no, so a dangling link cannot survive');
});

test('disable when it was never on is fine and does not fail on the stop command having nothing to stop', () => {
  const io = fakeIo({ fail: ['systemctl --user disable'] });
  const r = AI.disableAiOs({ ...baseEnv, platform: 'linux' }, io);
  assert.equal(r.ok, true, 'stopping a service that is not there is optional');
});

test('a disable that cannot remove a file does not claim it is off', () => {
  const unit = '/home/me/.config/systemd/user/neuroclaw.service';
  const wants = '/home/me/.config/systemd/user/default.target.wants/neuroclaw.service';
  const io = fakeIo({ present: [...CHECKOUT, unit, wants] });
  io.removeFile = (f) => { if (f === unit) throw new Error('permission denied'); io.fs.delete(f); };
  const r = AI.disableAiOs({ ...baseEnv, platform: 'linux' }, io);
  assert.equal(r.ok, false);
  assert.equal(r.enabled, false, 'the wants link is gone, so systemd will not start it: the state reported is the real one');
  assert.ok(r.steps.some((s) => !s.ok && /permission denied/.test(s.detail)));
});

test('status: on only when what the OS reads is there; the Windows registry value must exist too', () => {
  const unit = '/home/me/.config/systemd/user/neuroclaw.service';
  const wants = '/home/me/.config/systemd/user/default.target.wants/neuroclaw.service';
  const env = { ...baseEnv, platform: 'linux' };
  assert.equal(AI.aiOsStatus(env, fakeIo()).enabled, false);
  assert.equal(AI.aiOsStatus(env, fakeIo({ present: [...CHECKOUT, unit] })).enabled, false, 'a unit file that systemd never enabled is not "on"');
  assert.equal(AI.aiOsStatus(env, fakeIo({ present: [...CHECKOUT, unit, wants] })).enabled, true);
  assert.equal(AI.aiOsStatus(env, fakeIo({ present: [...CHECKOUT, '/home/me/.config/autostart/neuroclaw-ai-os.desktop'] })).enabled, true, 'found even when the other mechanism is the one planned now');
  const win = { ...baseEnv, platform: 'win32', home: 'C:\\U', dataDir: 'C:\\U\\.nc', root: 'C:\\nc', node: 'C:\\nc\\node.exe' };
  const present = ['C:\\nc\\dist\\interface\\main.js', 'C:\\U\\.nc\\ai-os.vbs'];
  assert.equal(AI.aiOsStatus(win, fakeIo({ present })).enabled, true);
  assert.equal(AI.aiOsStatus(win, fakeIo({ present, fail: ['reg query'] })).enabled, false, 'the script alone does not start anything');
});

test('the real file operations: atomic write, replace, and removing a dangling symlink', () => {
  const dir = tempDir('nc-aios-');
  try {
    const f = path.join(dir, 'a', 'b', 'x.service');
    AI.realIo.writeFile(f, 'one', 0o644);
    AI.realIo.writeFile(f, 'two', 0o644);
    assert.equal(readFileSync(f, 'utf8'), 'two');
    assert.deepEqual(readdirNames(path.dirname(f)), ['x.service'], 'no temp file left behind');
    const link = path.join(dir, 'link');
    symlinkSync(path.join(dir, 'gone'), link);
    assert.equal(AI.realIo.exists(link), false, 'existsSync follows the link and says no');
    AI.realIo.removeFile(link);
    assert.throws(() => lstatSync(link), 'but the dangling link itself is removed');
    AI.realIo.removeFile(path.join(dir, 'never-existed'));
    assert.equal(AI.realIo.run(process.execPath, ['-e', 'process.stdout.write("hi")']).stdout, 'hi');
    assert.equal(AI.realIo.run(process.execPath, ['-e', 'process.exit(3)']).status, 3);
    assert.notEqual(AI.realIo.run('definitely-not-a-program-xyz', []).status, 0);
  } finally { removeDir(dir); }
});
function readdirNames(d) { return spawnSync('ls', ['-A', d], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean); }

/* ---------- the route ---------- */

test('GET /api/ai-os reports the state; a bad POST body is refused before anything is touched', async () => {
  const s = await startServer();
  try {
    const g = await api(s.url, '/api/ai-os');
    assert.equal(g.status, 200);
    assert.equal(typeof g.json.supported, 'boolean');
    assert.equal(typeof g.json.enabled, 'boolean');
    assert.equal(typeof g.json.canChange, 'boolean');
    assert.equal(g.json.platform, process.platform);
    if (g.json.supported) assert.ok(g.json.summary.length > 20);
    for (const body of [{}, { enabled: 'yes' }, { enabled: 1 }, []]) {
      const p = await api(s.url, '/api/ai-os', { method: 'POST', body });
      assert.equal(p.status, 400, JSON.stringify(body));
      assert.match(p.json.error, /enabled/);
    }
    assert.equal((await api(s.url, '/api/ai-os', { method: 'DELETE' })).status, 405);
    assert.equal((await api(s.url, '/api/ai-os')).json.enabled, g.json.enabled, 'and the state did not change');
  } finally { await s.stop(); removeDir(s.dataDir); removeDir(s.cwd); }
});

test('a request a hostile web page could send (a CORS "simple" content type, so no preflight) is refused and changes nothing', { skip: process.platform !== 'linux' && 'drives the Linux autostart route only' }, async (t) => {
  // Hermetic, so that even if the defence regressed, the only thing this could write is a temp folder.
  const home = tempDir('nc-aios-home-');
  const run = tempDir('nc-aios-run-');
  const srv = await startServer({ env: { HOME: home, XDG_RUNTIME_DIR: run, XDG_CONFIG_HOME: '', DBUS_SESSION_BUS_ADDRESS: undefined } });
  try {
    const start = await api(srv.url, '/api/ai-os');
    if (start.json.mechanism !== 'xdg-autostart') return t.skip(`this machine's session would use ${start.json.mechanism}, which would reach the real service manager`);
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const r = await fetch(`${srv.url}/api/ai-os`, { method: 'POST', headers: { 'content-type': type }, body: '{"enabled":true}' });
      assert.ok(r.status >= 400 && r.status < 500, `${type} was answered ${r.status}`);
    }
    assert.equal(existsSync(path.join(home, '.config', 'autostart', 'neuroclaw-ai-os.desktop')), false, 'nothing was written');
    assert.equal((await api(srv.url, '/api/ai-os')).json.enabled, false);
  } finally { await srv.stop(); removeDir(home); removeDir(run); removeDir(srv.dataDir); removeDir(srv.cwd); }
});

test('the command-line tool reports status and refuses nonsense, without changing anything', () => {
  const run = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ai-os.mjs'), ...a], { encoding: 'utf8' });
  const st = run('status', '--json');
  assert.equal(st.status, 0, st.stderr);
  const j = JSON.parse(st.stdout);
  assert.equal(j.platform, process.platform);
  assert.equal(run('frobnicate').status, 2);
  assert.equal(run('--help').status, 0);
  assert.match(text('scripts/ai-os.mjs'), /startNow: !\(await engineRunning\(\)\)/, 'enable only starts the engine now when none is answering');
});

/* ---------- the Settings tab, clicked for real ---------- */

const browserReason = browserSkip();

test('Settings > AI OS: a failure shows its real cause and the switch goes back; then on, still on after a reload, and off again', { skip: browserReason || (process.platform !== 'linux' && 'drives the Linux autostart route only'), timeout: 180_000 }, async (t) => {
  // Hermetic: its own HOME, and an empty runtime dir so there is no systemd user bus to reach. The only thing it can write is a temp folder.
  const home = tempDir('nc-aios-home-');
  const run = tempDir('nc-aios-run-');
  const srv = await startServer({ env: { HOME: home, XDG_RUNTIME_DIR: run, XDG_CONFIG_HOME: '', DBUS_SESSION_BUS_ADDRESS: undefined } });
  const browser = await Browser.launch();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const start = await api(srv.url, '/api/ai-os');
    if (start.json.mechanism !== 'xdg-autostart') return t.skip(`this machine's session would use ${start.json.mechanism}, which would reach the real service manager`);
    assert.equal(start.json.enabled, false);
    assert.equal(start.json.canChange, true, 'the owner at this computer may change it');
    const desktop = path.join(home, '.config', 'autostart', 'neuroclaw-ai-os.desktop');

    const pg = await browser.newPage();
    await pg.emulate({ name: 'desktop', width: 1280, height: 800, mobile: false, scale: 1 });
    await pg.goto(`${srv.url}/settings#aios`);
    await pg.waitFor('document.querySelector("#aios")', 15000);
    assert.equal(await pg.eval('document.querySelector("#panel h2").textContent'), 'AI OS mode');
    assert.equal(await pg.eval('document.querySelector("#aios-state").textContent'), 'Off');
    assert.equal(await pg.eval('document.querySelector("#aios").disabled'), false);
    assert.equal(await pg.eval('document.querySelector("#aios").getAttribute("aria-label")'), 'Start NeuroClaw when I sign in');
    assert.match(await pg.eval('document.querySelector("#panel").textContent'), /no extra access/);

    // A config folder that cannot be created: ~/.config is a file.
    writeFileSync(path.join(home, '.config'), 'not a folder');
    await pg.click('#aios');
    await pg.waitFor('/Could not write/.test(document.getElementById("status").textContent)', 10000);
    assert.equal(await pg.eval('document.querySelector("#aios").checked'), false, 'the switch went back: nothing was turned on');
    assert.equal(await pg.eval('document.getElementById("status").className'), 'err');
    assert.equal((await api(srv.url, '/api/ai-os')).json.enabled, false);

    // Fixed: now it works.
    spawnSync('rm', ['-f', path.join(home, '.config')]);
    await pg.click('#aios');
    await pg.waitFor('document.querySelector("#aios-state").textContent === "On"', 10000);
    assert.ok(existsSync(desktop), 'the autostart file is really there');
    assert.match(readFileSync(desktop, 'utf8'), /^Exec=.*main\.js.*"web" "7861"$/m);
    assert.match(await pg.eval('document.querySelector("#aios-outcome").textContent'), /next sign-in/);
    assert.equal((await api(srv.url, '/api/ai-os')).json.enabled, true);

    await pg.goto(`${srv.url}/settings#aios`);
    await pg.waitFor('document.querySelector("#aios")', 15000);
    assert.equal(await pg.eval('document.querySelector("#aios").checked'), true, 'still on after a reload');
    assert.equal(await pg.eval('document.querySelector("#aios-state").textContent'), 'On');

    await pg.click('#aios');
    await pg.waitFor('document.querySelector("#aios-state").textContent === "Off"', 10000);
    assert.equal(existsSync(desktop), false, 'and turning it off removes it');
    assert.deepEqual(pg.errors, []);
    await sleep(50);
    await pg.close();
  } finally { await browser.close(); await srv.stop(); removeDir(home); removeDir(run); removeDir(srv.dataDir); removeDir(srv.cwd); }
});
