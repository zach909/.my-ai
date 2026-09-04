/**
 * "add start RSI server button in experiments" -- the backend half:
 * SelfImprovementServerManager (interface/web-server.ts) is the manual
 * on/off switch for scripts/self-improve.mjs, needed because `npm run
 * server` is the only thing that starts that loop on its own (the desktop
 * app spawns the backend directly and never touches it).
 *
 * A real child process is spawned throughout -- a tiny fixture script
 * standing in for self-improve.mjs (which needs git remotes, torch, and
 * runs for 30 minutes by default, none of which belong in a unit test) --
 * exercised through Node's real process table, not mocked.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SelfImprovementServerManager } from '../../interface/web-server';

function writeFixture(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, body);
  return file;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise(r => setTimeout(r, 20));
  }
}

describe('SelfImprovementServerManager', () => {
  let dir: string;
  let manager: SelfImprovementServerManager | null;

  afterEach(() => {
    manager?.shutdown();
    manager = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('starts stopped, with no pid and no exit history', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rsi-server-'));
    const script = writeFixture(dir, 'long-lived.mjs', 'setInterval(() => {}, 1000);\n');
    manager = new SelfImprovementServerManager(script);
    expect(manager.status()).toEqual({ running: false, pid: null, startedAt: null, lastExit: null });
  });

  it('start() reports running with a real pid, and a second start() is refused', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rsi-server-'));
    const script = writeFixture(dir, 'long-lived.mjs', 'setInterval(() => {}, 1000);\n');
    manager = new SelfImprovementServerManager(script);

    const started = await manager.start();
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error('unreachable');
    expect(started.pid).toBeGreaterThan(0);

    const status = manager.status();
    expect(status.running).toBe(true);
    expect(status.pid).toBe(started.pid);
    expect(status.startedAt).not.toBeNull();

    // One process at a time -- self-improve.mjs owns a single scoreboard
    // file, not written to expect two writers.
    const second = await manager.start();
    expect(second).toEqual({ ok: false, error: 'already running' });
  });

  it('stop() kills the process and status() reflects it going down', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rsi-server-'));
    const script = writeFixture(dir, 'long-lived.mjs', 'setInterval(() => {}, 1000);\n');
    manager = new SelfImprovementServerManager(script);
    await manager.start();
    expect(manager.status().running).toBe(true);

    const stopped = manager.stop();
    expect(stopped).toEqual({ ok: true });

    await waitUntil(() => manager!.status().running === false);
    const status = manager.status();
    expect(status.pid).toBeNull();
    expect(status.lastExit).not.toBeNull();
    expect(status.lastExit!.signal).toBe('SIGTERM');
  });

  it('stop() on an already-stopped manager is refused, not a crash', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rsi-server-'));
    const script = writeFixture(dir, 'unused.mjs', '');
    manager = new SelfImprovementServerManager(script);
    expect(manager.stop()).toEqual({ ok: false, error: 'not running' });
  });

  it('records a natural exit (not killed by stop()) as lastExit too', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rsi-server-'));
    const script = writeFixture(dir, 'quick-exit.mjs', 'process.exit(0);\n');
    manager = new SelfImprovementServerManager(script);
    await manager.start();

    await waitUntil(() => manager!.status().running === false);
    const status = manager.status();
    expect(status.running).toBe(false);
    expect(status.lastExit).not.toBeNull();
    expect(status.lastExit!.code).toBe(0);
    expect(status.lastExit!.signal).toBeNull();
  });

  it('a nonexistent script path fails start() with an error, not a silent "running"', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rsi-server-'));
    const missing = path.join(dir, 'does-not-exist.mjs');
    manager = new SelfImprovementServerManager(missing);

    const result = await manager.start();
    // Node still spawns a process for a missing file (the failure surfaces
    // asynchronously as an 'exit' with a nonzero code), so this either
    // fails start() outright or comes back up already exited -- either way
    // status() must never claim a real, healthy run.
    if (result.ok) {
      await waitUntil(() => manager!.status().running === false);
    }
    expect(manager.status().running).toBe(false);
  });

  it('shutdown() kills a running process without requiring a prior stop()', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rsi-server-'));
    const script = writeFixture(dir, 'long-lived.mjs', 'setInterval(() => {}, 1000);\n');
    manager = new SelfImprovementServerManager(script);
    const started = await manager.start();
    expect(started.ok).toBe(true);

    manager.shutdown();
    // shutdown() clears the live process, not the "it was started at some
    // point" record -- there is no requirement that shutting down erases
    // history the way a fresh manager's empty status() does.
    const status = manager.status();
    expect(status.running).toBe(false);
    expect(status.pid).toBeNull();
  });
});
