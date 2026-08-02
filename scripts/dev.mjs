// Development entry point: `npm run dev`.
//
// vite.config.ts proxies /api/* to http://127.0.0.1:7861 (see its `server.proxy`
// comment), but nothing started that backend -- `dev` used to be a bare `vite`
// invocation, so every API call in the dev server (chat, chat-groups, status,
// extension builder, ...) failed with ECONNREFUSED. This builds the backend
// once, runs it in the background on port 7861, then runs Vite in the
// foreground, and tears the backend down when Vite exits (Ctrl+C or crash).

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BACKEND_PORT = 7861;

if (!existsSync(join(ROOT, 'dist', 'interface', 'main.js'))) {
  console.log('[dev] backend not built — running scripts/build-backend.mjs...');
  execFileSync('node', ['scripts/build-backend.mjs'], { cwd: ROOT, stdio: 'inherit' });
}

console.log(`[dev] starting backend on port ${BACKEND_PORT}...`);
const backend = spawn('node', ['dist/interface/main.js', 'web', String(BACKEND_PORT)], {
  cwd: ROOT,
  stdio: 'inherit',
});
backend.on('exit', (code) => {
  if (code !== null && code !== 0) console.error(`[dev] backend exited with code ${code}`);
});

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
