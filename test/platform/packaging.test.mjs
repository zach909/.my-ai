/**
 * Desktop packaging: the payload, the per-user app copy, the launcher, and the Linux, Windows and macOS packages.
 * Everything that can run here runs for real (a real .deb is built with dpkg-deb, the packaged engine is really
 * started). Steps that need Windows (IExpress) or macOS (swiftc, hdiutil, codesign) are checked as far as they can
 * be and reported as skipped, never as passed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { ROOT, dist, ensureBuilt, tempDir, removeDir, startServer, freePort } from './helpers.mjs';
import { stageApp, assertNoPackages, assertSelfContainedRuntime } from '../../scripts/release/stage-app.mjs';
import { syncAppHome, CODE_ENTRIES, STATE_DIRS } from '../../scripts/release/app-home.mjs';
import { appHomeDir, browserCandidates, findBrowser, windowCommand } from '../../scripts/desktop-launcher.mjs';
import { createZip, readZip } from '../../scripts/release/zip.mjs';
import { makeIco, makeIcns } from '../../scripts/release/icons.mjs';
import { packageLinux } from '../../scripts/release/package-linux.mjs';
import { packageWindows, INSTALL_PS1, UNINSTALL_PS1, LAUNCH_VBS, iexpressSed } from '../../scripts/release/package-windows.mjs';
import { packageMacos, infoPlist, BUNDLE_ID } from '../../scripts/release/package-macos.mjs';
import { authority } from '../../scripts/release/version.mjs';

ensureBuilt();
const COMMIT = 'a'.repeat(40);
const V = authority();
const text = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const hasDpkg = spawnSync('dpkg-deb', ['--version']).status === 0;

/** One staged payload shared by the tests that need it; the runtime is a stub so packaging tests stay fast. */
let staged;
function stage() {
  if (staged) return staged;
  const out = tempDir('nc-stage-');
  stageApp({ out, channel: 'beta', commit: COMMIT, runtime: false });
  mkdirSync(path.join(out, 'runtime'), { recursive: true });
  writeFileSync(path.join(out, 'runtime', 'node'), '#!/bin/sh\necho stub\n'); chmodSync(path.join(out, 'runtime', 'node'), 0o755);
  writeFileSync(path.join(out, 'runtime', 'node.exe'), 'MZ stub');
  staged = out;
  return out;
}

test('the compiled backend imports only Node built-ins, so the payload needs no node_modules; a stray package import is caught', () => {
  assertNoPackages(path.join(ROOT, 'dist'));
  const dir = tempDir();
  try {
    mkdirSync(path.join(dir, 'x'));
    // The statements are assembled from pieces so this file itself never reads as an import of a package.
    const kw = ['im', 'port'].join('');
    const q = "'";
    const pkgA = ['re', 'act'].join('');
    const pkgB = ['left', 'pad'].join('-');
    const lineA = [kw, 'z', 'from', q + pkgA + q].join(' ') + ';';
    const lineB = `const m = await ${kw}(${q}${pkgB}${q});`;
    writeFileSync(path.join(dir, 'x', 'a.js'), [[kw, 'fs', 'from', q + 'node:fs' + q].join(' ') + ';', lineA, ''].join('\n'));
    assert.throws(() => assertNoPackages(dir), new RegExp(pkgA));
    writeFileSync(path.join(dir, 'x', 'a.js'), lineB + '\n');
    assert.throws(() => assertNoPackages(dir), new RegExp(pkgB));
  } finally { removeDir(dir); }
});

test('the staged payload has the app, the one version, the source commit and no dependencies or saved personal state', () => {
  const out = stage();
  const info = JSON.parse(readFileSync(path.join(out, 'app', 'build-info.json'), 'utf8'));
  assert.deepEqual([info.version, info.commit, info.channel], [V, COMMIT, 'beta']);
  assert.ok(['linux', 'windows', 'macos'].includes(info.platform));
  assert.ok(['x64', 'arm64'].includes(info.arch));
  assert.ok(!Number.isNaN(Date.parse(info.builtAt)));
  const pkg = JSON.parse(readFileSync(path.join(out, 'app', 'package.json'), 'utf8'));
  assert.deepEqual([pkg.name, pkg.version, pkg.type, pkg.dependencies], ['neuroclaw', V, 'module', undefined]);
  assert.ok(existsSync(path.join(out, 'app', 'dist', 'interface', 'main.js')));
  assert.ok(existsSync(path.join(out, 'app', 'scripts', 'desktop-launcher.mjs')));
  assert.ok(existsSync(path.join(out, 'app', 'models && skills', 'onebrain', 'model.json')));
  assert.ok(!existsSync(path.join(out, 'app', 'node_modules')));
  assert.ok(!existsSync(path.join(out, 'app', 'config', 'access.json')), "one person's saved switches are not shipped as defaults");
  for (const dev of ['check-no-third-party.mjs', 'install-hooks.mjs', 'build-backend.mjs', 'dev.mjs']) assert.ok(!existsSync(path.join(out, 'app', 'scripts', dev)), `${dev} is build tooling`);
  assert.throws(() => stageApp({ out: tempDir(), commit: 'nothex', runtime: false }), /commit/);
});

test('the per-user app copy: installs, is left alone when current, updates code, and never touches what the person made', () => {
  const payload = tempDir('nc-pay-'); const home = path.join(tempDir('nc-home-'), 'app');
  const put = (root, rel, body) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), body); };
  try {
    put(payload, 'build-info.json', JSON.stringify({ version: '1.0.0', commit: 'a'.repeat(40) }));
    put(payload, 'package.json', '{}'); put(payload, 'dist/interface/main.js', 'v1'); put(payload, 'dist/old-only.js', 'old'); put(payload, 'scripts/a.mjs', 'a');
    put(payload, 'wiki/home.md', 'default home'); put(payload, 'config/routing.json', '{"default":1}');
    assert.deepEqual(syncAppHome({ payloadDir: payload, homeDir: home }), { action: 'installed', version: '1.0.0', seeded: 2 });
    assert.equal(readFileSync(path.join(home, 'dist/interface/main.js'), 'utf8'), 'v1');
    // The person edits a page, adds one of their own, and changes a config file.
    writeFileSync(path.join(home, 'wiki/home.md'), 'MY EDIT'); put(home, 'wiki/mine.md', 'mine'); put(home, 'store/x/item.json', '{}'); writeFileSync(path.join(home, 'config/routing.json'), '{"mine":1}');
    assert.equal(syncAppHome({ payloadDir: payload, homeDir: home }).action, 'current');
    assert.equal(readFileSync(path.join(home, 'wiki/home.md'), 'utf8'), 'MY EDIT');
    // A new build: code changes (and a deleted file goes away), new default pages appear, theirs stay.
    put(payload, 'build-info.json', JSON.stringify({ version: '1.1.0', commit: 'b'.repeat(40) }));
    put(payload, 'dist/interface/main.js', 'v2'); rmSync(path.join(payload, 'dist/old-only.js')); put(payload, 'wiki/new-page.md', 'new default');
    const r = syncAppHome({ payloadDir: payload, homeDir: home });
    assert.deepEqual([r.action, r.version, r.seeded], ['updated', '1.1.0', 1]);
    assert.equal(readFileSync(path.join(home, 'dist/interface/main.js'), 'utf8'), 'v2');
    assert.ok(!existsSync(path.join(home, 'dist/old-only.js')), 'no stale code left behind');
    assert.equal(readFileSync(path.join(home, 'wiki/home.md'), 'utf8'), 'MY EDIT', 'their edit survives the update');
    assert.equal(readFileSync(path.join(home, 'wiki/mine.md'), 'utf8'), 'mine');
    assert.equal(readFileSync(path.join(home, 'config/routing.json'), 'utf8'), '{"mine":1}');
    assert.ok(existsSync(path.join(home, 'store/x/item.json')));
    assert.equal(readFileSync(path.join(home, 'wiki/new-page.md'), 'utf8'), 'new default');
    assert.ok(!readdirSync(home).some((n) => n.endsWith('.new')), 'no half-copied folders left');
    assert.deepEqual(CODE_ENTRIES.filter((e) => STATE_DIRS.includes(e)), [], 'code and state never overlap');
  } finally { removeDir(payload); removeDir(path.dirname(home)); }
});

test('launcher helpers: per-OS app folders, app-window browsers, and a window command that owns its own profile', () => {
  assert.equal(appHomeDir('linux', { XDG_DATA_HOME: '/x/share' }, '/home/u'), path.join('/x/share', 'neuroclaw', 'app'));
  assert.equal(appHomeDir('linux', {}, '/home/u'), path.join('/home/u', '.local', 'share', 'neuroclaw', 'app'));
  assert.equal(appHomeDir('darwin', {}, '/Users/u'), path.join('/Users/u', 'Library', 'Application Support', 'NeuroClaw', 'app'));
  assert.equal(appHomeDir('win32', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u'), path.join('C:\\Users\\u\\AppData\\Local', 'NeuroClaw', 'app'));
  assert.ok(browserCandidates('win32', { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86' }).some((c) => /msedge\.exe$/.test(c)), 'Edge ships with Windows');
  assert.ok(browserCandidates('darwin').some((c) => /Google Chrome/.test(c)));
  assert.ok(browserCandidates('linux').includes('chromium'));
  assert.equal(findBrowser('linux', {}, () => false, (n) => (n === 'chromium' ? '/usr/bin/chromium' : null)), '/usr/bin/chromium');
  assert.equal(findBrowser('linux', {}, () => false, () => null), null, 'none found: the launcher falls back to the default browser');
  assert.equal(findBrowser('linux', { NEUROCLAW_BROWSER: '/opt/b' }, (p) => p === '/opt/b', () => '/usr/bin/chromium'), '/opt/b', 'an explicit choice wins');
  const w = windowCommand('/usr/bin/chromium', 'http://127.0.0.1:7861/', '/p');
  assert.ok(w.args.includes('--app=http://127.0.0.1:7861/') && w.args.includes('--user-data-dir=/p'));
});

function runLauncher({ payload, env, args = [] }) {
  const child = spawn(process.execPath, [path.join(payload, 'scripts', 'desktop-launcher.mjs'), '--no-window', ...args], { cwd: path.parse(payload).root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const done = new Promise((resolve) => {
    const t = setInterval(() => { if (/READY |FAILED /.test(out)) { clearInterval(t); resolve(out); } }, 150);
    child.on('exit', () => { clearInterval(t); resolve(out); });
    setTimeout(() => { clearInterval(t); resolve(out); }, 90_000);
  });
  return { child, done, stop: () => new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); setTimeout(r, 6000); }) };
}
const isolated = (dir) => ({ CORONA_DATA_DIR: path.join(dir, 'data'), NEUROCLAW_APP_HOME: path.join(dir, 'home'), HOME: dir, USERPROFILE: dir, LOCALAPPDATA: path.join(dir, 'local'), XDG_DATA_HOME: path.join(dir, 'xdg') });

test('end to end: the packaged engine starts from "/" like a desktop entry, serves the app, saves settings, survives a restart, and stops', () => {
  const out = stage();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/release/smoke-package.mjs'), path.join(out, 'app')], { encoding: 'utf8', timeout: 180_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /all 11 checks passed/);
  assert.match(r.stdout, /a computer-access switch saves \(the Linux settings crash\)/);
});

test('launcher: reuses a NeuroClaw that is already running and leaves it running when the launcher stops', async () => {
  const out = stage(); const dir = tempDir('nc-l1-');
  const srv = await startServer();
  const l = runLauncher({ payload: path.join(out, 'app'), env: isolated(dir), args: ['--port', String(srv.port)] });
  try {
    const log = await l.done;
    assert.match(log, new RegExp(`READY http://127\\.0\\.0\\.1:${srv.port}/`));
    assert.match(log, /already running/);
    await l.stop();
    assert.equal((await fetch(`${srv.url}/api/status`)).ok, true, 'the server it did not start is still up');
  } finally { await l.stop(); await srv.stop(); removeDir(dir); }
});

test('launcher: when something that is not NeuroClaw holds the port, it picks another instead of failing or hijacking it', async () => {
  const out = stage(); const dir = tempDir('nc-l2-');
  const port = await freePort();
  const squatter = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('not neuroclaw'); });
  await new Promise((r) => squatter.listen(port, '127.0.0.1', r));
  const l = runLauncher({ payload: path.join(out, 'app'), env: isolated(dir), args: ['--port', String(port)] });
  try {
    const log = await l.done;
    const m = /READY http:\/\/127\.0\.0\.1:(\d+)\//.exec(log);
    assert.ok(m, log);
    assert.notEqual(Number(m[1]), port, 'did not use the busy port');
    assert.equal((await (await fetch(`http://127.0.0.1:${m[1]}/api/status`)).json()).running, true);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'not neuroclaw', 'the other program was left alone');
  } finally { await l.stop(); squatter.close(); removeDir(dir); }
});

test('launcher: a broken install says so (FAILED with a reason) and exits non-zero instead of hanging', async () => {
  const out = stage(); const dir = tempDir('nc-l3-'); const broken = path.join(dir, 'payload');
  mkdirSync(path.join(broken, 'scripts', 'release'), { recursive: true });
  for (const f of ['desktop-launcher.mjs', 'release/app-home.mjs']) writeFileSync(path.join(broken, 'scripts', f), readFileSync(path.join(out, 'app', 'scripts', f)));
  writeFileSync(path.join(broken, 'build-info.json'), JSON.stringify({ version: '1.0.0', commit: COMMIT }));
  writeFileSync(path.join(broken, 'package.json'), '{}');
  mkdirSync(path.join(broken, 'dist', 'interface'), { recursive: true });
  writeFileSync(path.join(broken, 'dist', 'interface', 'main.js'), 'process.exit(3)');
  const l = runLauncher({ payload: broken, env: isolated(dir), args: ['--port', String(await freePort())] });
  try {
    const log = await l.done;
    assert.match(log, /FAILED The engine stopped right after starting \(exit code 3\)/);
    if (l.child.exitCode === null) await new Promise((r) => l.child.once('exit', r));
    assert.equal(l.child.exitCode, 1);
  } finally { await l.stop(); removeDir(dir); }
});

test('zip writer: round trip, deterministic, and refuses unsafe names', () => {
  const entries = [{ name: 'b/two.txt', data: Buffer.from('2'.repeat(500)) }, { name: 'a.txt', data: Buffer.from('one') }, { name: 'run.sh', data: Buffer.from('#!/bin/sh'), mode: 0o755 }];
  const z = createZip(entries);
  assert.ok(z.equals(createZip([...entries].reverse())), 'order of input does not change the bytes');
  assert.deepEqual(readZip(z).map((e) => [e.name, e.data.toString().length]), [['a.txt', 3], ['b/two.txt', 500], ['run.sh', 9]]);
  for (const bad of ['../x', '/abs', 'a\\b', 'a/../b']) assert.throws(() => createZip([{ name: bad, data: Buffer.from('x') }]), /unsafe/);
  assert.throws(() => createZip([{ name: 'a', data: Buffer.from('1') }, { name: 'a', data: Buffer.from('2') }]), /duplicate/);
  const t = tempDir();
  try { writeFileSync(path.join(t, 'z.zip'), z); if (spawnSync('unzip', ['-v']).status === 0) assert.equal(spawnSync('unzip', ['-tq', path.join(t, 'z.zip')]).status, 0, 'a standard unzip accepts it'); } finally { removeDir(t); }
});

test('icon containers: .ico and .icns parse back to the PNGs that went in', async () => {
  const { renderIconPng } = await import(dist('interface/platform/icon.js'));
  const sizes = [16, 32, 48, 64, 128, 256];
  const ico = makeIco(sizes.map((size) => ({ size, png: renderIconPng(size) })));
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, sizes.length]);
  for (let i = 0; i < sizes.length; i++) {
    const e = 6 + i * 16; const len = ico.readUInt32LE(e + 8); const off = ico.readUInt32LE(e + 12);
    assert.equal(ico[e], sizes[i] === 256 ? 0 : sizes[i]);
    assert.equal(ico.subarray(off + 1, off + 4).toString(), 'PNG');
    assert.ok(off + len <= ico.length);
  }
  const icns = makeIcns([16, 32, 64, 128, 256, 512].map((size) => ({ size, png: renderIconPng(size) })));
  assert.equal(icns.subarray(0, 4).toString(), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  let p = 8; const types = [];
  while (p < icns.length) { types.push(icns.subarray(p, p + 4).toString()); const len = icns.readUInt32BE(p + 4); assert.equal(icns.subarray(p + 9, p + 12).toString(), 'PNG'); p += len; }
  assert.deepEqual(types, ['icp4', 'icp5', 'icp6', 'ic07', 'ic08', 'ic09']);
  assert.throws(() => makeIcns([{ size: 99, png: Buffer.alloc(8) }]));
});

test('Linux: a real .deb and .tar.gz are built with the right metadata, files and permissions', { skip: hasDpkg ? false : 'dpkg-deb is not installed here (the Linux CI job runs this)' }, async () => {
  const outDir = tempDir('nc-linux-');
  try {
    process.env.NEUROCLAW_DEB_COMPRESSION = 'gzip';
    const artifacts = await packageLinux({ stageDir: stage(), outDir });
    const deb = artifacts.find((a) => a.kind === 'linux-deb').file;
    const tar = artifacts.find((a) => a.kind === 'linux-tarball').file;
    assert.match(path.basename(deb), new RegExp(`^neuroclaw-${V.replace(/\./g, '\\.')}-linux-(x64|arm64)\\.deb$`));
    const field = (f) => spawnSync('dpkg-deb', ['-f', deb, f], { encoding: 'utf8' }).stdout.trim();
    assert.equal(field('Package'), 'neuroclaw'); assert.equal(field('Version'), V);
    assert.ok(['amd64', 'arm64'].includes(field('Architecture')));
    assert.match(field('Description'), /Local-first AI agent/);
    assert.ok(field('Description').includes(COMMIT), 'the package says which source commit it was built from');
    assert.equal(field('Depends'), '', 'bundles its runtime: nothing to install first');
    assert.match(field('Recommends'), /chromium/);
    const listing = spawnSync('dpkg-deb', ['-c', deb], { encoding: 'utf8' }).stdout.split('\n');
    const has = (re) => listing.some((l) => re.test(l));
    assert.ok(has(/-rwxr-xr-x root\/root .* \.\/usr\/bin\/neuroclaw$/), 'the command is executable');
    assert.ok(has(/-rw-r--r-- root\/root .* \.\/usr\/share\/applications\/neuroclaw\.desktop$/));
    for (const s of [48, 128, 256, 512]) assert.ok(has(new RegExp(`\\./usr/share/icons/hicolor/${s}x${s}/apps/neuroclaw\\.png$`)), `${s}px icon`);
    assert.ok(has(/-rwxr-xr-x root\/root .* \.\/opt\/neuroclaw\/runtime\/node$/));
    assert.ok(has(/\.\/opt\/neuroclaw\/app\/dist\/interface\/main\.js$/));
    assert.ok(!listing.some((l) => /^[-d]r.s|^[-d]r..s..s/.test(l) || /rws/.test(l.split(' ')[0])), 'no setuid files');
    assert.ok(!listing.some((l) => /\.\/(etc|lib|var|usr\/lib\/systemd)\//.test(l)), 'no service, no system config');
    const x = tempDir('nc-x-');
    try {
      spawnSync('dpkg-deb', ['-e', deb, path.join(x, 'ctl')]);
      const post = readFileSync(path.join(x, 'ctl', 'postinst'), 'utf8');
      assert.doesNotMatch(post, /sudo|systemctl|curl|wget|chmod \+s|useradd/, 'the install script only refreshes menu caches');
      spawnSync('dpkg-deb', ['-x', deb, path.join(x, 'root')]);
      const desktop = readFileSync(path.join(x, 'root', 'usr/share/applications/neuroclaw.desktop'), 'utf8');
      assert.match(desktop, /^Exec=neuroclaw$/m); assert.match(desktop, /^Terminal=false$/m); assert.match(desktop, /^Icon=neuroclaw$/m); assert.match(desktop, /^Type=Application$/m);
      assert.equal(readFileSync(path.join(x, 'root', 'usr/bin/neuroclaw'), 'utf8').trim().split('\n')[1], 'exec /opt/neuroclaw/runtime/node /opt/neuroclaw/app/scripts/desktop-launcher.mjs "$@"');
      // The installed layout (read-only /opt, working directory "/") really runs.
      const smoke = spawnSync(process.execPath, [path.join(ROOT, 'scripts/release/smoke-package.mjs'), path.join(x, 'root/opt/neuroclaw/app')], { encoding: 'utf8', timeout: 180_000 });
      assert.equal(smoke.status, 0, smoke.stdout + smoke.stderr);
    } finally { removeDir(x); }
    const names = spawnSync('tar', ['-tzf', tar], { encoding: 'utf8' }).stdout.split('\n');
    const top = `neuroclaw-${V}-linux-${artifacts[0].arch}`;
    for (const f of ['neuroclaw', 'README.txt', 'neuroclaw.desktop', 'neuroclaw.png', 'runtime/node', 'app/build-info.json']) assert.ok(names.includes(`${top}/${f}`), `${f} in the tarball`);
    const mode = spawnSync('tar', ['-tvzf', tar], { encoding: 'utf8' }).stdout.split('\n').find((l) => l.endsWith(`${top}/neuroclaw`));
    assert.match(mode, /^-rwxr-xr-x/);
  } finally { delete process.env.NEUROCLAW_DEB_COMPRESSION; removeDir(outDir); }
});

test('Windows: the portable zip is complete; the installer scripts are per-user, unprivileged and reversible; the .exe is only claimed where it can be built', async () => {
  const outDir = tempDir('nc-win-');
  try {
    const r = await packageWindows({ stageDir: stage(), outDir });
    const zip = r.artifacts.find((a) => a.kind === 'windows-zip');
    assert.ok(zip);
    const names = readZip(readFileSync(zip.file)).map((e) => e.name);
    for (const f of ['NeuroClaw.vbs', 'NeuroClaw.ico', 'uninstall.ps1', 'runtime/node.exe', 'app/build-info.json', 'app/scripts/desktop-launcher.mjs', 'app/dist/interface/main.js']) assert.ok(names.includes(`NeuroClaw/${f}`), f);
    const vbs = readZip(readFileSync(zip.file)).find((e) => e.name === 'NeuroClaw/NeuroClaw.vbs').data.toString();
    assert.ok(vbs.includes('\r\n'), 'Windows line endings');
    assert.match(vbs, /runtime\\node\.exe/); assert.match(vbs, /app\\scripts\\desktop-launcher\.mjs/); assert.match(vbs, /, 0, False/, 'hidden window: no console flash');
    if (process.platform === 'win32') assert.ok(r.artifacts.some((a) => a.kind === 'windows-installer-exe'), 'on Windows the installer must exist');
    else {
      assert.ok(!r.artifacts.some((a) => a.kind === 'windows-installer-exe'), 'not claimed where IExpress does not exist');
      assert.match(r.skipped.find((s) => s.kind === 'windows-installer-exe').reason, /iexpress/i);
    }
  } finally { removeDir(outDir); }
  // The scripts the installer runs (they execute on Windows in CI; here they are read for what they would do).
  assert.match(INSTALL_PS1, /\$env:LOCALAPPDATA 'Programs/, 'installs for the current user');
  assert.doesNotMatch(INSTALL_PS1 + UNINSTALL_PS1, /RunAs|-Verb|HKLM|Program Files|ProgramFiles|schtasks|New-Service|sc\.exe|Set-ExecutionPolicy|netsh|reg add/i, 'no elevation, no machine-wide changes, no service');
  assert.match(INSTALL_PS1, /GetFolderPath\('Programs'\)/, 'Start menu entry');
  assert.match(INSTALL_PS1, /GetFolderPath\('Desktop'\)/); assert.match(INSTALL_PS1, /MessageBox[^\n]*desktop/i, 'the desktop shortcut is optional and asked');
  assert.match(INSTALL_PS1, /HKCU:[^\n]*Uninstall/); assert.match(INSTALL_PS1, /UninstallString/);
  assert.match(INSTALL_PS1, /NEUROCLAW_INSTALL_SILENT/);
  assert.match(UNINSTALL_PS1, /Remove-Item[^\n]*Uninstall/); assert.match(UNINSTALL_PS1, /\.neuroclaw is kept/, 'your data is kept');
  assert.ok(LAUNCH_VBS.includes('desktop-launcher.mjs'));
  const sed = iexpressSed({ workDir: 'C:\\w', target: 'C:\\o\\neuroclaw-1.0.0-windows-x64.exe' });
  for (const f of ['payload.zip', 'install.ps1', 'install.cmd', 'version.txt']) assert.ok(sed.includes(`"${f}"`), f);
  assert.match(sed, /TargetName=C:\\o\\neuroclaw-1\.0\.0-windows-x64\.exe/);
  assert.doesNotMatch(path.basename('neuroclaw-1.0.0-windows-x64.exe'), /setup|install|update|patch/i, "a name Windows' installer detection would elevate");
});

test('macOS: the bundle is laid out as a standard .app with a valid Info.plist, an icon, the payload and a minimal-privilege host', async () => {
  const outDir = tempDir('nc-mac-');
  try {
    const r = await packageMacos({ stageDir: stage(), outDir, stageOnly: true });
    const app = r.bundle;
    for (const f of ['Contents/Info.plist', 'Contents/PkgInfo', 'Contents/Resources/AppIcon.icns', 'Contents/Resources/app/dist/interface/main.js', 'Contents/Resources/app/scripts/desktop-launcher.mjs', 'Contents/Resources/runtime/node']) assert.ok(existsSync(path.join(app, f)), f);
    assert.ok(statSync(path.join(app, 'Contents/Resources/runtime/node')).mode & 0o111, 'the runtime is executable');
    const plist = readFileSync(path.join(app, 'Contents/Info.plist'), 'utf8');
    assert.equal(plist, infoPlist({ version: V.replace(/-.*/, ''), build: String(Number(V.split('.')[0]) * 10000 + Number(V.split('.')[1]) * 100 + Number(V.split('.')[2].replace(/-.*/, ''))) }));
    for (const [k, v] of [['CFBundleIdentifier', BUNDLE_ID], ['CFBundleExecutable', 'NeuroClaw'], ['CFBundleIconFile', 'AppIcon'], ['CFBundlePackageType', 'APPL'], ['CFBundleShortVersionString', V.replace(/-.*/, '')]]) assert.match(plist, new RegExp(`<key>${k}</key>\\s*<string>${v.replace(/\./g, '\\.')}</string>`), k);
    assert.match(plist, /<key>NSHighResolutionCapable<\/key>\s*<true\/>/);
    assert.doesNotMatch(plist, /UsageDescription/, 'no permission prompts are declared: none are used');
    if (spawnSync('python3', ['--version']).status === 0) {
      assert.equal(spawnSync('python3', ['-c', 'import plistlib,sys; plistlib.load(open(sys.argv[1],"rb"))', path.join(app, 'Contents/Info.plist')]).status, 0, 'Info.plist parses as a property list');
    }
    assert.equal(readFileSync(path.join(app, 'Contents/Resources/AppIcon.icns')).subarray(0, 4).toString(), 'icns');
    if (process.platform !== 'darwin') {
      const full = await packageMacos({ stageDir: stage(), outDir });
      assert.deepEqual(full.artifacts, [], 'no .app or .dmg is claimed without macOS');
      assert.ok(full.skipped.some((s) => s.kind === 'macos-dmg'));
    }
  } finally { removeDir(outDir); }
  const swift = text('scripts/release/macos/NeuroClawHost.swift');
  const imports = [...swift.matchAll(/^import (\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['Foundation', 'SwiftUI', 'WebKit'], 'Apple frameworks only');
  assert.match(swift, /--no-window/); assert.match(swift, /READY /); assert.match(swift, /applicationWillTerminate/); assert.match(swift, /runOpenPanelWith/);
  assert.doesNotMatch(swift, /AVCaptureDevice|CNContactStore|CLLocationManager|AXIsProcessTrusted|CGWindowListCreateImage|NSAppleScript/, 'asks for no camera, contacts, location, accessibility or screen capture');
});

test('a Node that is only a launcher for a system library is refused, so a package never depends on the builder having Node', () => {
  const dir = tempDir();
  try {
    const small = path.join(dir, 'node'); writeFileSync(small, 'x'.repeat(1000));
    assert.throws(() => assertSelfContainedRuntime(small), /not a self-contained Node/);
    assert.doesNotThrow(() => assertSelfContainedRuntime(process.execPath), 'the Node running these tests is a real one (CI uses the official build)');
  } finally { removeDir(dir); }
});
