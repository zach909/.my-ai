#!/usr/bin/env node
/**
 * Regression test for main.js's ipcMain.handle() listeners.
 *
 * Electron always invokes an ipcMain.handle() listener as (event, ...args) --
 * the IpcMainInvokeEvent is always the injected first argument, real caller
 * arguments start at position two. Every handler here that takes at least
 * one argument omitted that leading `event` parameter, so each declared
 * parameter was actually bound one position early: the first named
 * parameter received the event object instead of the real argument, and the
 * true last argument the renderer passed was silently dropped.
 *
 * No real Electron runtime is installed in this environment (desktop-app/
 * has no node_modules -- `electron` is a devDependency, not vendored), so
 * this mocks Electron's module surface just enough to exercise the real
 * handler functions exactly as Electron would call them: require('electron')
 * is redirected (via Module._resolveFilename, the standard technique
 * proxyquire/rewire use) to a fake app/BrowserWindow/ipcMain/dialog/shell,
 * ipcMain.handle() is captured into a map instead of actually registering
 * with a real IPC bus, and each handler is then invoked directly with a
 * fake event object followed by real arguments -- proving the fix against
 * the actual production code, not a reimplementation of it.
 *
 * Run with: node test/ipc-handlers.test.js
 */
'use strict';

const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');

let _passed = 0;
let _failed = 0;

function check(cond, msg) {
  if (cond) {
    _passed++;
    console.log(`  ok   ${msg}`);
  } else {
    _failed++;
    console.log(`  FAIL ${msg}`);
  }
}

const FAKE_ELECTRON_ID = '\0fake-electron-for-test';
const handlers = new Map();
const shellCalls = { openExternal: [], showItemInFolder: [] };
const dialogCalls = { showOpenDialog: [] };

const fakeElectron = {
  app: {
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: Object.assign(
    function FakeBrowserWindow() {
      return {
        loadFile: () => {},
        webContents: { send: () => {}, openDevTools: () => {} },
        on: () => {},
      };
    },
    { getAllWindows: () => [] },
  ),
  ipcMain: {
    handle: (channel, listener) => { handlers.set(channel, listener); },
  },
  dialog: {
    showOpenDialog: async (win, options) => {
      dialogCalls.showOpenDialog.push(options);
      return { canceled: true, filePaths: [] };
    },
  },
  shell: {
    openExternal: async (url) => { shellCalls.openExternal.push(url); },
    showItemInFolder: (filePath) => { shellCalls.showItemInFolder.push(filePath); },
  },
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'electron') return FAKE_ELECTRON_ID;
  return originalResolveFilename.call(this, request, ...rest);
};
require.cache[FAKE_ELECTRON_ID] = {
  id: FAKE_ELECTRON_ID,
  filename: FAKE_ELECTRON_ID,
  loaded: true,
  exports: fakeElectron,
};

// This suite only exercises the IPC handlers below via the fake Electron
// shell above -- it must not spawn a real backend process or block on
// main.js's ensureBuilt()/waitForBackend() startup sequence.
process.env.DESKTOP_APP_SKIP_BACKEND = '1';

const mainPath = path.join(__dirname, '..', 'src', 'main', 'main.js');
delete require.cache[require.resolve(mainPath)];
require(mainPath);

const { resolveStaticFile, startAppServer, DESKTOP_TOKEN_HEADER } = require(path.join(__dirname, '..', 'src', 'main', 'app-server.js'));

const FAKE_EVENT = { sender: {} }; // stands in for Electron's IpcMainInvokeEvent

async function main() {
  // Let app.whenReady().then(() => createWindow()) actually run (it's a
  // microtask queued by main.js's own top-level code, not yet flushed when
  // require() returns synchronously above).
  await Promise.resolve();
  await Promise.resolve();

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-app-ipc-test-'));

  // --- read-file ---
  const readPath = path.join(workdir, 'read-me.txt');
  fs.writeFileSync(readPath, 'hello from a real file', 'utf-8');
  const readResult = await handlers.get('read-file')(FAKE_EVENT, readPath);
  check(readResult.success === true && readResult.content === 'hello from a real file',
    'read-file reads the real file path argument, not the event object');

  // --- write-file ---
  const writePath = path.join(workdir, 'write-me.txt');
  const writeResult = await handlers.get('write-file')(FAKE_EVENT, writePath, 'written content');
  check(writeResult.success === true, 'write-file reports success');
  check(fs.existsSync(writePath) && fs.readFileSync(writePath, 'utf-8') === 'written content',
    'write-file actually writes the real content argument to the real path, not the event object');

  // --- exec-command ---
  const execResult = await handlers.get('exec-command')(FAKE_EVENT, 'echo hello-from-exec');
  check(execResult.success === true && execResult.stdout.trim() === 'hello-from-exec',
    'exec-command runs the real command argument, not the event object');

  // --- exec-command / spawn-process: destructive-command guard ---
  // exec-command always shells out via child_process.exec(); it's exposed to
  // the renderer via preload.js's contextBridge with no guard before this
  // fix, unlike plugins/plugin_terminal.py's equivalent full-shell-access
  // capability, which _is_blocked()-gates the same class of command.
  const blockedExecResult = await handlers.get('exec-command')(FAKE_EVENT, 'rm -rf /');
  check(blockedExecResult.success === false && /Blocked/.test(blockedExecResult.error),
    'exec-command blocks a destructive rm -rf / before it ever reaches the shell');

  const blockedSpawnResult = await handlers.get('spawn-process')(FAKE_EVENT, 'rm', ['-rf', '/']);
  check(blockedSpawnResult.success === false && /Blocked/.test(blockedSpawnResult.error),
    'spawn-process blocks a destructive rm -rf / split across command/args');

  // --- select-file (the "silent wrong output" variant: no throw, just
  //     silently discards the caller's real options and falls back to
  //     defaults) ---
  await handlers.get('select-file')(FAKE_EVENT, {
    filters: [{ name: 'Text', extensions: ['txt'] }],
    title: 'Pick a text file',
  });
  const lastDialogCall = dialogCalls.showOpenDialog[dialogCalls.showOpenDialog.length - 1];
  check(lastDialogCall.title === 'Pick a text file',
    'select-file forwards the caller\'s real title, not the "Select File" default');
  check(JSON.stringify(lastDialogCall.filters) === JSON.stringify([{ name: 'Text', extensions: ['txt'] }]),
    'select-file forwards the caller\'s real filters, not the [] default');

  // --- open-external ---
  await handlers.get('open-external')(FAKE_EVENT, 'https://example.com/real-url');
  check(shellCalls.openExternal[shellCalls.openExternal.length - 1] === 'https://example.com/real-url',
    'open-external opens the real url argument, not the event object');

  const blockedFileUrl = await handlers.get('open-external')(FAKE_EVENT, 'file:///etc/passwd');
  check(blockedFileUrl.success === false && /Blocked/.test(blockedFileUrl.error),
    'open-external blocks unsafe file:// protocol scheme');

  const blockedMailtoUrl = await handlers.get('open-external')(FAKE_EVENT, 'mailto:test@example.com');
  check(blockedMailtoUrl.success === false && /Blocked/.test(blockedMailtoUrl.error),
    'open-external blocks mailto: protocol scheme');

  const blockedJsUrl = await handlers.get('open-external')(FAKE_EVENT, 'javascript:alert(1)');
  check(blockedJsUrl.success === false && /Blocked/.test(blockedJsUrl.error),
    'open-external blocks javascript: protocol scheme');

  const invalidUrl = await handlers.get('open-external')(FAKE_EVENT, 'not-a-valid-url');
  check(invalidUrl.success === false && /Blocked/.test(invalidUrl.error),
    'open-external blocks invalid URL formats');

  const invalidTypeUrl = await handlers.get('open-external')(FAKE_EVENT, 12345);
  check(invalidTypeUrl.success === false && /Blocked/.test(invalidTypeUrl.error),
    'open-external blocks invalid URL types (non-strings)');

  // --- show-in-folder ---
  await handlers.get('show-in-folder')(FAKE_EVENT, '/some/real/path');
  check(shellCalls.showItemInFolder[shellCalls.showItemInFolder.length - 1] === '/some/real/path',
    'show-in-folder is passed the real path argument, not the event object');

  // --- spawn-process ---
  const spawnResult = await handlers.get('spawn-process')(FAKE_EVENT, 'echo', ['hello-from-spawn']);
  check(spawnResult.success === true && spawnResult.stdout.trim() === 'hello-from-spawn',
    'spawn-process runs the real command/args arguments, not the event object');

  // --- resolveStaticFile: sibling-directory path-traversal guard ---
  // A raw `resolved.startsWith(distDir)` containment check is a classic
  // bypass: distDir is a *string* prefix of any sibling directory whose
  // name also starts with it (e.g. "dist" prefixes "dist-evil"). An
  // "..%2f<sibling>/..." pathname isn't recognized as a ".." segment by the
  // URL parser's own dot-segment normalization (it only collapses a literal
  // ".." segment, not one hidden behind an encoded slash) and survives
  // untouched into resolveStaticFile()'s decodeURIComponent() call, which
  // reveals the real ".." only after that normalization already ran.
  const traversalDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-server-traversal-dist-'));
  fs.writeFileSync(path.join(traversalDistDir, 'index.html'), 'safe content');
  const siblingEvilDir = traversalDistDir + '-evil';
  fs.mkdirSync(siblingEvilDir, { recursive: true });
  fs.writeFileSync(path.join(siblingEvilDir, 'secret.txt'), 'TOP SECRET outside distDir');

  const traversalUrl = new URL('/..%2f' + path.basename(siblingEvilDir) + '/secret.txt', 'http://internal');
  const traversalResult = resolveStaticFile(traversalDistDir, traversalUrl.pathname);
  check(traversalResult === null,
    'resolveStaticFile refuses to serve a file from a sibling directory that merely shares a name prefix with distDir');

  // ── The app runs in its own window, not in a browser ────────────────────
  // Both servers bind 127.0.0.1, so nothing was ever reachable off the
  // machine -- but any browser ON the machine could open the app-server port
  // and drive the whole agent, backend API included, with no credential.
  const http = require('http');
  const tokenDist = fs.mkdtempSync(path.join(os.tmpdir(), 'app-server-token-dist-'));
  fs.writeFileSync(path.join(tokenDist, 'index.html'), '<html>app</html>');
  const TOKEN = 'test-token-abc123';
  const guarded = await startAppServer({ distDir: tokenDist, backendPort: 1, port: 0, authToken: TOKEN });
  const guardedPort = guarded.address().port;

  const get = (headers) => new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: guardedPort, path: '/', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
  });

  const noToken = await get({});
  check(noToken.status === 403,
    'a request with no desktop token is refused (a browser cannot open the app)');
  check(/NeuroClaw runs in its own window/.test(noToken.body),
    'the refusal tells the user where to actually open the app');

  const wrongToken = await get({ [DESKTOP_TOKEN_HEADER]: 'not-the-token' });
  check(wrongToken.status === 403, 'a request with the wrong token is refused');

  const rightToken = await get({ [DESKTOP_TOKEN_HEADER]: TOKEN });
  check(rightToken.status === 200 && rightToken.body.includes('<html>app</html>'),
    'the app window, which stamps the real token, is served normally');

  // The gate must cover the proxied backend API too, not just static files --
  // /api/* is the half that can actually drive the agent.
  const apiNoToken = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: guardedPort, path: '/api/status', headers: {} }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
  });
  check(apiNoToken === 403, 'the /api proxy is behind the same gate, not just the static files');

  guarded.close();

  // Opting out (no authToken) must still work: that is how the suite above
  // and any non-Electron embedding use this server.
  const openSrv = await startAppServer({ distDir: tokenDist, backendPort: 1, port: 0 });
  const openPort = openSrv.address().port;
  const openRes = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: openPort, path: '/' }, (res) => { res.resume(); resolve(res.statusCode); });
  });
  check(openRes === 200, 'omitting authToken leaves the server open, as documented');
  openSrv.close();

  // ── The window's connection is TLS, with a pinned certificate ───────────
  const https = require('https');
  const selfsigned = require('selfsigned');
  const { X509Certificate } = require('crypto');

  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: '127.0.0.1' }],
    {
      days: 1, keySize: 2048, algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
    }
  );
  const x509 = new X509Certificate(pems.cert);
  // Chromium matches on SAN and ignores commonName outright, so a cert without
  // an IP SAN for 127.0.0.1 would be rejected and the window would never load.
  check(/IP Address:127\.0\.0\.1/.test(x509.subjectAltName || ''),
    'the generated certificate carries an IP SAN for 127.0.0.1, which is what TLS clients actually match on');

  const tlsSrv = await startAppServer({
    distDir: tokenDist, backendPort: 1, port: 0,
    authToken: TOKEN, tls: { key: pems.private, cert: pems.cert },
  });
  const tlsPort = tlsSrv.address().port;

  const tlsGet = (opts) => new Promise((resolve) => {
    const req = https.get(
      { host: '127.0.0.1', port: tlsPort, path: '/', headers: { [DESKTOP_TOKEN_HEADER]: TOKEN }, ...opts },
      (res) => {
        // Grab the peer certificate while the socket is still attached: it is
        // detached by the time 'end' fires.
        const cert = res.socket && typeof res.socket.getPeerCertificate === 'function'
          ? res.socket.getPeerCertificate()
          : null;
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: b, cert }));
      }
    );
    req.on('error', (e) => resolve({ error: e }));
  });

  const overTls = await tlsGet({ rejectUnauthorized: false });
  check(overTls.status === 200 && overTls.body.includes('<html>app</html>'),
    'the app is served over a real TLS connection, not plaintext');

  // Pinning: the presented certificate must be exactly the one we generated.
  const presented = overTls.cert && overTls.cert.fingerprint256;
  const norm = (f) => String(f || '').replace(/:/g, '').toLowerCase();
  check(norm(presented) === norm(x509.fingerprint256),
    'the server presents exactly the certificate this launch generated (this is what main.js pins on)');

  // A plaintext request to a TLS port must fail rather than silently downgrade.
  const plaintext = await new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: tlsPort, path: '/' }, (res) => { res.resume(); resolve({ status: res.statusCode }); });
    req.on('error', () => resolve({ error: true }));
  });
  check(plaintext.error === true, 'a plaintext http request to the TLS port fails instead of downgrading');

  tlsSrv.close();

  console.log(`\n${_passed} passed, ${_failed} failed`);
  process.exit(_failed === 0 ? 0 : 1);
}

main();
