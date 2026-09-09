#!/usr/bin/env node
/**
 * launcher.mjs -- "when the server's not running and you access the web
 * thing, I want it to automatically launch. Or if you can't do that, I
 * want a page saying run this command, and it automatically copies to
 * clipboard."
 *
 * The real backend (`npm run server`, scripts/server.mjs) isn't something
 * a web page can start on its own -- there is nothing listening at all
 * once it's down, and a browser hitting a dead port just shows its own
 * connection-refused error; no web content this app controls ever runs.
 * The only way anything can respond is if SOMETHING is already listening.
 * This is that something: a tiny, near-zero-overhead process meant to be
 * left running (see the wiki for making it start at login) on the same
 * port the real backend normally uses. It does nothing until the first
 * real request arrives, at which point it:
 *
 *   1. Answers immediately with a small self-reloading "Starting..." page.
 *   2. Stops listening on the port (so the real backend can bind it) and
 *      spawns `node scripts/server.mjs`, detached, so it keeps running
 *      even after this script exits.
 *   3. Polls the port until the real backend answers, then exits -- the
 *      "Starting..." page's own retry loop picks up the live backend the
 *      moment it's there, with no further action from this process.
 *   4. If the backend doesn't come up within a generous timeout (a build
 *      failure, a missing dependency, something genuinely wrong), it
 *      reopens the port itself and serves the fallback page: the exact
 *      command to run, a Copy button (plus a best-effort auto-copy on
 *      load), and an explicit note about why this can't just open a
 *      terminal for you -- browsers do not let a web page run commands on
 *      your machine, on purpose, for the same reason you wouldn't want
 *      every OTHER website able to do that either.
 *
 * This is a hand-off, not a supervisor: once the real backend is up, this
 * script's job is done and it exits. If the backend later crashes, nothing
 * is listening again until this is run again. That is a real, accepted
 * limitation for now, not an oversight -- see the wiki page this ships
 * with for the tradeoffs of the alternative (a permanent reverse-proxy
 * process in front of the backend) if that's ever wanted instead.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 7861;
const HOST = process.env.NEUROCLAW_WEB_HOST || '127.0.0.1';
/** How long to wait for the real backend before giving up and falling back. */
const LAUNCH_TIMEOUT_MS = 90_000;

let handled = false;

function startingPageHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Starting Neuroclaw…</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,sans-serif;background:#0b0b10;color:#e8e8ee}
  .card{max-width:420px;text-align:center;padding:24px}
  .spinner{width:32px;height:32px;margin:0 auto 18px;border-radius:50%;
    border:3px solid #2a2a35;border-top-color:#7c6cff;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  h1{font-size:18px;margin:0 0 8px}
  p{font-size:13px;color:#9a9aab;margin:0}
</style></head>
<body>
  <div class="card">
    <div class="spinner" role="status" aria-label="Starting"></div>
    <h1>Starting Neuroclaw…</h1>
    <p>This page reloads on its own the moment it's ready.</p>
  </div>
  <script>
  (function retry() {
    fetch(location.href, { cache: 'no-store', method: 'HEAD' })
      .then(function (r) { if (r.ok || r.status < 500) location.reload(); else setTimeout(retry, 700); })
      .catch(function () { setTimeout(retry, 700); });
  })();
  </script>
</body></html>`;
}

function fallbackPageHtml(command, reason) {
  const escaped = command.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Start Neuroclaw</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,sans-serif;background:#0b0b10;color:#e8e8ee;padding:24px}
  .card{max-width:520px}
  h1{font-size:20px;margin:0 0 8px}
  p{font-size:13px;color:#9a9aab;line-height:1.5}
  pre{background:#17171f;border:1px solid #2a2a35;border-radius:8px;padding:14px 16px;
    font-size:13px;overflow-x:auto;user-select:all}
  button{margin-top:10px;padding:8px 16px;border-radius:6px;border:1px solid #3a3a4a;
    background:#7c6cff;color:#fff;font-size:13px;cursor:pointer}
  button:active{transform:scale(.97)}
  .note{margin-top:18px;padding-top:14px;border-top:1px solid #22222c}
  .ok{color:#6cff9c}
</style></head>
<body>
  <div class="card">
    <h1>Couldn't start it automatically</h1>
    <p>${reason}</p>
    <p>Run this in a terminal, from this folder:</p>
    <pre id="cmd">${escaped}</pre>
    <button id="copy" type="button">Copy command</button>
    <span id="copied" class="ok" style="margin-left:8px;font-size:13px"></span>
    <p class="note">This page can't open a terminal for you — a web page running a command on
    your machine on its own is exactly the thing browsers refuse to allow, for anyone's site,
    on purpose. Open a terminal yourself (Terminal / PowerShell / your shell), paste, and press
    Enter.</p>
  </div>
  <script>
  var cmd = ${JSON.stringify(command)};
  function copy() {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(cmd).then(function () {
      var m = document.getElementById('copied');
      if (m) { m.textContent = 'Copied'; setTimeout(function () { m.textContent = ''; }, 2000); }
    }).catch(function () {});
  }
  document.getElementById('copy').addEventListener('click', copy);
  // Best-effort auto-copy on load. Several browsers refuse clipboard writes
  // without a user gesture (a click) -- this silently does nothing there,
  // which is why the button above exists as the real, always-working path.
  copy();
  </script>
</body></html>`;
}

/** Resolves once something accepts a TCP connection on `host:port`. */
function waitForPort(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    (function attempt() {
      const socket = createConnection(port, host);
      socket.once('connect', () => { socket.end(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error('timed out'));
        else setTimeout(attempt, 400);
      });
    })();
  });
}

/** Serves the fallback page on `port` until the process is killed. */
function serveFallback(port, host, reason) {
  const command = `cd ${JSON.stringify(ROOT).replace(/^"|"$/g, "'")} && npm run server`;
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fallbackPageHtml(command, reason));
  });
  server.listen(port, host, () => {
    console.log(`[launcher] could not auto-start Neuroclaw -- serving the manual-start page on http://${host}:${port}`);
    console.log(`[launcher] reason: ${reason}`);
  });
}

function launch(req, res) {
  handled = true;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(startingPageHtml());

  const serverScript = path.join(ROOT, 'scripts', 'server.mjs');
  if (!existsSync(serverScript)) {
    server.close(() => serveFallback(PORT, HOST, `scripts/server.mjs was not found under ${ROOT} -- this launcher needs to run from inside the Neuroclaw repository.`));
    return;
  }

  // Logged rather than swallowed -- a build/startup failure with nowhere to
  // look is exactly what turned "the server isn't running" from a one-line
  // fix into a mystery in the first place.
  const logDir = path.join(ROOT, '.neuroclaw');
  let logFd;
  try {
    mkdirSync(logDir, { recursive: true });
    logFd = openSync(path.join(logDir, 'launcher.log'), 'a');
  } catch {
    logFd = 'ignore';
  }

  server.close(() => {
    const child = spawn('node', [serverScript], {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: process.env,
    });
    child.unref();

    waitForPort(HOST, PORT, LAUNCH_TIMEOUT_MS)
      .then(() => {
        console.log('[launcher] Neuroclaw is up -- handing off.');
        process.exit(0);
      })
      .catch(() => {
        serveFallback(PORT, HOST, `Started scripts/server.mjs, but nothing answered on port ${PORT} within ${Math.round(LAUNCH_TIMEOUT_MS / 1000)}s. Check .neuroclaw/launcher.log for what went wrong.`);
      });
  });
}

const server = createServer((req, res) => {
  if (handled) return; // a burst of requests while we're already launching -- only the first one triggers it
  launch(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`[launcher] waiting on http://${HOST}:${PORT} -- will start Neuroclaw on the first request`);
});
server.on('error', (err) => {
  console.error(`[launcher] could not listen on ${HOST}:${PORT}: ${err.message}`);
  console.error('[launcher] something else is already using this port -- if that\'s Neuroclaw itself, there is nothing for this launcher to do.');
  process.exit(1);
});
