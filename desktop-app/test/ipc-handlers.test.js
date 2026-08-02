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

  // --- show-in-folder ---
  await handlers.get('show-in-folder')(FAKE_EVENT, '/some/real/path');
  check(shellCalls.showItemInFolder[shellCalls.showItemInFolder.length - 1] === '/some/real/path',
    'show-in-folder is passed the real path argument, not the event object');

  // --- spawn-process ---
  const spawnResult = await handlers.get('spawn-process')(FAKE_EVENT, 'echo', ['hello-from-spawn']);
  check(spawnResult.success === true && spawnResult.stdout.trim() === 'hello-from-spawn',
    'spawn-process runs the real command/args arguments, not the event object');

  console.log(`\n${_passed} passed, ${_failed} failed`);
  process.exit(_failed === 0 ? 0 : 1);
}

main();
