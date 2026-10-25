#!/usr/bin/env node
/**
 * The desktop launcher: what runs when someone opens NeuroClaw from the Start
 * menu, the application menu or the Dock. No terminal involved.
 *
 *   1. Make the per-user writable copy of the app current (scripts/release/app-home.mjs).
 *   2. If a NeuroClaw server already answers on the port, use it. Otherwise start
 *      the bundled engine (the Node runtime shipped next to this file) and wait
 *      until it answers.
 *   3. Open the interface in its own app window (Edge/Chrome/Chromium "app mode"
 *      on Windows and Linux; the macOS app shows it in its own WKWebView window
 *      and runs this with --no-window).
 *   4. When that window is closed, stop the server this launcher started (unless
 *      NEUROCLAW_KEEP_RUNNING=1). A server that was already running is left alone.
 *
 * It asks for no privileges, installs no service and touches nothing outside the
 * app's own folders (~/.neuroclaw and the per-user app copy). Starting the engine at
 * every sign-in is a separate opt-in, AI OS mode (scripts/ai-os.mjs), which runs this
 * with --no-window.
 *
 * Flags: --no-window (start/attach and print "READY <url>", for the macOS host),
 *        --stop (stop a server this launcher started), --port <n>, --help.
 * Node built-ins only.
 */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = 7861;

/** Where the per-user app copy lives. */
export function appHomeDir(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'NeuroClaw', 'app');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'NeuroClaw', 'app');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'neuroclaw', 'app');
}

/** Browsers that can show a page as an app window (no tabs, no address bar), in order of preference. */
export function browserCandidates(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const pf = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean);
    return pf.flatMap((root) => [
      path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ]);
  }
  if (platform === 'darwin') {
    return ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium'].map((n) => `/Applications/${n}.app/Contents/MacOS/${n}`);
  }
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser'];
}

function onPath(name, env = process.env) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try { if (statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
}

export function findBrowser(platform = process.platform, env = process.env, exists = existsSync, which = (n) => onPath(n, env)) {
  // NEUROCLAW_BROWSER names a Chromium-based browser to use instead of searching.
  if (env.NEUROCLAW_BROWSER && exists(env.NEUROCLAW_BROWSER)) return env.NEUROCLAW_BROWSER;
  for (const c of browserCandidates(platform, env)) {
    if (path.isAbsolute(c)) { if (exists(c)) return c; }
    else { const p = which(c); if (p) return p; }
  }
  return null;
}

/** The command line that opens `url` as an app window with its own profile, so closing it ends the process. */
export function windowCommand(browser, url, profileDir) {
  return { cmd: browser, args: [`--app=${url}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--window-size=1100,800'] };
}

async function probe(port, timeoutMs = 1500) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return 'other';
    const j = await r.json().catch(() => null);
    return j && j.running === true && j.subsystems ? 'neuroclaw' : 'other';
  } catch { return 'none'; }
}

async function freePort(start) {
  const { createServer } = await import('node:net');
  for (let p = start; p < start + 50; p++) {
    const ok = await new Promise((res) => { const s = createServer(); s.once('error', () => res(false)); s.listen(p, '127.0.0.1', () => s.close(() => res(true))); });
    if (ok) return p;
  }
  throw new Error(`no free port from ${start}`);
}

function log(...a) { console.log('[neuroclaw]', ...a); }

function failurePage(reason, logFile) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NeuroClaw could not start</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#110c0e;color:#f8ede9;font-family:ui-rounded,system-ui,sans-serif;padding:16px;box-sizing:border-box}main{max-width:34rem;padding:28px;border:1px solid rgba(255,228,218,.2);border-radius:32px;background:rgba(255,240,232,.08)}code{overflow-wrap:anywhere;color:#ffc4b4}</style><main><h1 style="font-size:1.3rem">NeuroClaw could not start</h1><p>${esc(reason)}</p><p>The details are in <code>${esc(logFile)}</code>. Close this window and open NeuroClaw again; if it keeps happening, send that file with your report.</p></main>`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('neuroclaw [--no-window] [--stop] [--port <n>]'); return; }
  const dataDir = process.env.CORONA_DATA_DIR || path.join(homedir(), '.neuroclaw');
  mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
  const pidFile = path.join(dataDir, 'launcher.json');
  if (args.includes('--stop')) {
    try { const j = JSON.parse(readFileSync(pidFile, 'utf8')); process.kill(j.serverPid); log('stopped server', j.serverPid); } catch { log('no server started by the launcher is running'); }
    rmSync(pidFile, { force: true });
    return;
  }
  const noWindow = args.includes('--no-window');
  const portArg = args.indexOf('--port');
  let port = Number(portArg >= 0 ? args[portArg + 1] : process.env.PORT) || DEFAULT_PORT;

  // 1. The app copy.
  const payload = path.resolve(HERE, '..');
  const home = process.env.NEUROCLAW_APP_HOME || appHomeDir();
  const { syncAppHome } = await import(pathToFileURL(path.join(HERE, 'release', 'app-home.mjs')).href);
  const logFile = path.join(dataDir, 'logs', 'server.log');
  let sync;
  try { sync = syncAppHome({ payloadDir: payload, homeDir: home }); }
  catch (e) { return fatal(`Could not prepare the app's folder (${home}): ${e.message}`, logFile, noWindow); }
  log(`app ${sync.version} ${sync.action} in ${home}`);

  // 2. Attach to a running server, or start one.
  let child = null;
  const state = await probe(port);
  if (state === 'other') port = await freePort(port + 1);
  if (state !== 'neuroclaw') {
    try { if (existsSync(logFile) && statSync(logFile).size > 5 * 1024 * 1024) rmSync(logFile); } catch { /* keep appending */ }
    const out = openSync(logFile, 'a');
    child = spawn(process.execPath, ['dist/interface/main.js', 'web', String(port)], {
      cwd: home, stdio: ['ignore', out, out], windowsHide: true,
      env: { ...process.env, NEUROCLAW_AUTO_UPDATE: '0', PORT: String(port) },
    });
    closeSync(out);
    let exited = null;
    child.on('exit', (code) => { exited = code; });
    writeFileSync(pidFile, JSON.stringify({ serverPid: child.pid, port, at: new Date().toISOString() }));
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && exited === null && (await probe(port)) !== 'neuroclaw') await new Promise((r) => setTimeout(r, 400));
    if ((await probe(port)) !== 'neuroclaw') {
      return fatal(exited !== null ? `The engine stopped right after starting (exit code ${exited}).` : 'The engine did not answer within 90 seconds.', logFile, noWindow);
    }
    log(`engine started on port ${port} (pid ${child.pid})`);
  } else {
    log(`using the NeuroClaw already running on port ${port}`);
  }
  const url = `http://127.0.0.1:${port}/`;
  const stopServer = () => { if (child && !process.env.NEUROCLAW_KEEP_RUNNING) { try { child.kill(); } catch { /* gone */ } rmSync(pidFile, { force: true }); } };
  process.on('SIGTERM', () => { stopServer(); process.exit(0); });
  process.on('SIGINT', () => { stopServer(); process.exit(0); });
  process.on('exit', stopServer);

  // 3. The window.
  if (noWindow) { console.log(`READY ${url}`); await new Promise(() => {}); return; }
  const browser = findBrowser();
  if (!browser) {
    openDefault(url);
    log('no Chromium-based browser found for an app window; opened your default browser. The engine keeps running; run "neuroclaw --stop" to stop it.');
    if (child) child.unref();
    process.removeAllListeners('exit');
    return;
  }
  const profile = path.join(dataDir, 'browser-profile');
  mkdirSync(profile, { recursive: true });
  const { cmd, args: cargs } = windowCommand(browser, url, profile);
  const win = spawn(cmd, cargs, { stdio: 'ignore' });
  win.on('error', (e) => log('could not open a window:', e.message));
  // 4. The window closing ends the session.
  await new Promise((r) => win.on('exit', r));
  stopServer();
}

function openDefault(url) {
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
}

function fatal(reason, logFile, noWindow) {
  console.error(`[neuroclaw] ${reason}`);
  if (noWindow) { console.log(`FAILED ${reason}`); process.exitCode = 1; return; }
  try {
    const page = path.join(path.dirname(logFile), 'start-failed.html');
    writeFileSync(page, failurePage(reason, logFile));
    openDefault(pathToFileURL(page).href);
  } catch { /* the console message above is all there is */ }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('[neuroclaw] failed:', e); process.exit(1); });
}
