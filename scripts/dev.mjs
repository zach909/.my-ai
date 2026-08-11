// Development entry point: `npm run dev`.
//
// vite.config.ts proxies /api/* to http://127.0.0.1:7861 (see its `server.proxy`
// comment), but nothing started that backend -- `dev` used to be a bare `vite`
// invocation, so every API call in the dev server (chat, chat-groups, status,
// extension builder, ...) failed with ECONNREFUSED. This builds the backend
// once, runs it in the background on port 7861, then runs Vite in the
// foreground, and tears the backend down when Vite exits (Ctrl+C or crash).

import { execFileSync, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { printUpdateCheck } from './update-check.mjs';

const ROOT = process.cwd();
const BACKEND_PORT = 7861;

// Same motivation as the "always rebuild" comment below: a stale
// checkout behind origin is exactly what caused real, reported breakage
// this session (another automated agent's bad merge broke `main`, and
// the user's local checkout stayed broken until they pulled). Read-only,
// never blocks startup on failure.
console.log('[dev] checking for updates...');
printUpdateCheck(ROOT);

// Always rebuild, not just when dist/interface/main.js is missing. It used
// to only build once "if missing" -- fine the very first time, but on every
// later `npm run dev` it silently ran whatever was already in dist/, even
// if that was a stale build from before the latest backend source changes
// (a merge, a pull, a fix). Since the backend fails ENTIRELY closed on a
// stale/broken build (nothing to fall back to but ECONNREFUSED forever),
// and a full rebuild only takes a few seconds, always rebuilding is the
// only way to guarantee dev never silently runs old backend code.
console.log('[dev] building backend...');
execFileSync('node', ['scripts/build-backend.mjs'], { cwd: ROOT, stdio: 'inherit' });

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
 * as the backend process itself exits. Vite starts proxying /api/* the
 * moment it comes up; spawning it in parallel with the backend (as before)
 * raced Node's module-load time against Vite's own startup, so cold starts
 * intermittently opened the browser onto a stream of ECONNREFUSED proxy
 * errors until the backend happened to catch up. Waiting here instead means
 * Vite never starts until the backend is actually reachable.
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
  console.error(`[dev] ${err.message} — starting Vite anyway; /api/* calls will fail until the backend is up.`);
}

const vite = spawn('npx', ['vite'], { cwd: ROOT, stdio: 'inherit' });

function shutdown() {
  vite.kill();
  backend.kill();
}
vite.on('exit', (code) => {
  backend.kill();
  process.exit(code ?? 0);
});
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
