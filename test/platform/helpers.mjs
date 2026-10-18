/**
 * Shared helpers for the platform tests (node:test, Node built-ins only).
 *
 * `startServer` runs the real compiled backend (dist/interface/main.js) on a free port with its own data
 * folder and an empty working directory, which is how a desktop entry or an installed app starts it. Nothing
 * here mocks the engine: the tests talk to the same server people use.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from './browser.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const dist = (rel) => pathToFileURL(path.join(ROOT, 'dist', rel)).href;

/** Build the backend once per test process if dist/ is missing or does not have the platform layer yet. */
export function ensureBuilt() {
  if (existsSync(path.join(ROOT, 'dist', 'interface', 'platform', 'routes.js'))) return;
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-backend.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`backend build failed:\n${(r.stdout + r.stderr).slice(-1500)}`);
}

export function freePort() {
  return new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

export function tempDir(prefix = 'nc-test-') { return mkdtempSync(path.join(tmpdir(), prefix)); }
export function removeDir(dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }

/**
 * @param {{dataDir?: string, cwd?: string, env?: Record<string,string>}} opts
 * @returns {Promise<{url: string, port: number, dataDir: string, stop: () => Promise<void>, log: () => string}>}
 */
export async function startServer(opts = {}) {
  ensureBuilt();
  const dataDir = opts.dataDir ?? tempDir('nc-data-');
  const cwd = opts.cwd ?? tempDir('nc-cwd-');
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'dist', 'interface', 'main.js'), 'web', String(port)], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CORONA_DATA_DIR: dataDir, NEUROCLAW_AUTO_UPDATE: '0', ...opts.env },
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited) throw new Error(`server exited early:\n${out.slice(-1500)}`);
    try { const r = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(1500) }); if (r.ok) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) { child.kill(); throw new Error(`server did not start in 60s:\n${out.slice(-1500)}`); }
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    url, port, dataDir, cwd,
    log: () => out,
    stop: () => new Promise((resolve) => { if (exited) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000); }),
  };
}

export async function api(base, p, { method = 'GET', body } = {}) {
  const r = await fetch(base + p, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, ok: r.ok, json, text, headers: r.headers };
}

/**
 * Browser tests need Chrome or Chromium. Without one they are skipped with the reason, unless
 * NEUROCLAW_REQUIRE_BROWSER=1 (set in CI), in which case a missing browser is a failure, not a quiet skip.
 */
export function browserSkip() {
  if (findChrome()) return false;
  if (process.env.NEUROCLAW_REQUIRE_BROWSER === '1') throw new Error('NEUROCLAW_REQUIRE_BROWSER=1 but no Chrome/Chromium was found');
  return 'no Chrome or Chromium installed (set CHROME_BIN to run the browser tests)';
}
