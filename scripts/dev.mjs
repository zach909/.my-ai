// Development entry point: `npm run dev`.
//
// Builds the backend and runs it in the foreground. The backend serves
// everything itself, with Node built-ins only: the terminal page at `/`, the
// built dashboard at `/app`, and `/api/*`, all from one origin. There is no
// separate frontend dev server and no proxy: a proxy in front of the backend
// would make every remote client look like loopback to it and defeat its
// remote-access password gate.
//
// NEUROCLAW_WEB_PORT picks the port (default 7861) and NEUROCLAW_WEB_HOST the
// bind address (default 127.0.0.1; anything else needs a password, or the
// backend serves only its setup page until one is set -- see
// WebServer.start()). docker-compose.dev.yml sets the host to 0.0.0.0 and publishes the port as
// both :7861 and :3000.

import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { spawnAwait } from './spawn-utils.mjs';

const ROOT = process.cwd();
const BACKEND_PORT = Number(process.env.NEUROCLAW_WEB_PORT) || 7861;

// Startup-time optimization: the update check (a network call, up to a
// 15s git-fetch timeout -- see update-check.mjs) and the backend build
// (a pure CPU-bound tsc compile) don't depend on each other at all; they
// only ever ran one after the other because this script called them as
// sequential blocking steps. Running them concurrently removes that
// dead time from every single `npm run dev`, not just a slow-network
// edge case. (The update check itself is still read-only and never
// blocks startup on failure -- see its own doc comment.)
//
// Always rebuild, not just when dist/interface/main.js is missing. It used
// to only build once "if missing" -- fine the very first time, but on every
// later `npm run dev` it silently ran whatever was already in dist/, even
// if that was a stale build from before the latest backend source changes
// (a merge, a pull, a fix). Since the backend fails ENTIRELY closed on a
// stale/broken build (nothing to fall back to but ECONNREFUSED forever),
// and a full rebuild only takes a few seconds, always rebuilding is the
// only way to guarantee dev never silently runs old backend code.
console.log('[dev] checking for updates and building backend...');
const [, buildCode] = await Promise.all([
  spawnAwait('node', ['scripts/update-check.mjs'], { cwd: ROOT }),
  spawnAwait('node', ['scripts/build-backend.mjs'], { cwd: ROOT }),
]);
if (buildCode !== 0) {
  console.error(`[dev] backend build failed (exit ${buildCode})`);
  process.exit(buildCode);
}

console.log(`[dev] starting backend on port ${BACKEND_PORT}...`);
const backend = spawn('node', ['dist/interface/main.js', 'web', String(BACKEND_PORT)], {
  cwd: ROOT,
  stdio: 'inherit',
});
let backendExited = false;
backend.on('exit', (code) => {
  backendExited = true;
  if (code !== null && code !== 0) console.error(`[dev] backend exited with code ${code}`);
});

/**
 * Poll until something accepts a TCP connection on `port`, or bail as soon
 * as the backend process itself exits, so the ready message below is only
 * printed once the page can actually be opened.
 */
function waitForPort(port, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    (function attempt() {
      if (backendExited) {
        reject(new Error('backend exited before it started listening'));
        return;
      }
      const socket = createConnection(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`backend did not start listening on port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 150);
        }
      });
    })();
  });
}

try {
  await waitForPort(BACKEND_PORT);
  console.log(`[dev] backend is ready on port ${BACKEND_PORT}`);
} catch (err) {
  console.error(`[dev] ${err.message}`);
}

function shutdown() {
  backend.kill();
}
backend.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
