/**
 * spawn-utils.mjs — a tiny promise wrapper around `child_process.spawn`,
 * extracted out of dev.mjs/server.mjs so both can run independent
 * startup steps (the update check, the backend build) CONCURRENTLY
 * instead of serially with execFileSync.
 *
 * Startup-time optimization: `printUpdateCheck()` (scripts/update-check.mjs)
 * is a network call with up to a 15s git-fetch timeout (60s if it
 * auto-pulls) and has zero dependency on `build-backend.mjs` (a pure
 * CPU-bound tsc compile) -- the two were only ever run one after the
 * other because dev.mjs/server.mjs called them as sequential blocking
 * steps, not because either one needs the other's result. Running them
 * concurrently removes that dead time from every single startup, not
 * just the rare slow-network case.
 */

import { spawn } from 'node:child_process'

/** Spawns `cmd args` and resolves with its exit code once it exits --
 *  never rejects on a non-zero exit (the caller decides what a bad code
 *  means), only on the process itself failing to spawn at all. */
export function spawnAwait(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 0))
  })
}
