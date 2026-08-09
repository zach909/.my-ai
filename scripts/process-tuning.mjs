#!/usr/bin/env node
/**
 * process-tuning.mjs — "optimize it for everything... so it creates new
 * skills fast." Per this session's own scoping decision, this tunes only
 * the server's own Node processes (never the host machine): libuv's
 * threadpool size (this app spawns a lot of child processes and does a
 * lot of file I/O -- training scripts, git worktrees, pytorch_trainer.py
 * -- all of which queue on that threadpool) and Node's heap ceiling,
 * sized to the actual machine's CPU count and memory rather than left at
 * Node's conservative defaults. Applied by setting env vars on the child
 * processes scripts/server.mjs spawns (UV_THREADPOOL_SIZE and
 * --max-old-space-size only take effect if set before a process starts,
 * so this can't retune an already-running process -- it tunes the
 * backend and self-improvement loop children server.mjs launches).
 */

import os from 'node:os'

/** Pure function of the machine's real resources -- directly testable
 *  without needing to actually spawn anything. */
export function computeTunedEnv(totalMemBytes = os.totalmem(), cpuCount = os.cpus().length) {
  // libuv's threadpool defaults to 4 -- this app routinely runs several
  // concurrent child_process spawns (python3/pytorch, git worktree
  // operations, training scripts) that all queue on it. Scale with CPU
  // count, bounded so a huge machine doesn't spawn an unreasonable
  // number of OS threads for no benefit.
  const threadpoolSize = Math.max(4, Math.min(32, cpuCount * 2))
  // Give Node's heap room proportional to actual available memory
  // instead of V8's conservative default, but never claim more than a
  // quarter of total system memory for one process's heap -- this is a
  // ceiling that lets Node use more when it needs to, not a mandate to
  // pre-allocate anything.
  const maxOldSpaceMB = Math.max(512, Math.min(4096, Math.floor(totalMemBytes / 1024 / 1024 / 4)))
  return {
    UV_THREADPOOL_SIZE: String(threadpoolSize),
    NODE_OPTIONS: `--max-old-space-size=${maxOldSpaceMB}`,
  }
}

/** Merges the tuned env on top of the given base env (defaults to the
 *  current process's env) without ever discarding a value the caller
 *  already set explicitly -- an explicit UV_THREADPOOL_SIZE or
 *  NODE_OPTIONS the deployment already configured always wins over this
 *  script's own guess. */
export function tunedEnv(baseEnv = process.env) {
  const tuned = computeTunedEnv()
  return {
    ...tuned,
    ...baseEnv,
    // NODE_OPTIONS is additive by nature (space-separated flags) -- if the
    // caller already set one, append ours rather than let object spread
    // silently drop the heap-sizing flag.
    NODE_OPTIONS: baseEnv.NODE_OPTIONS
      ? `${baseEnv.NODE_OPTIONS} ${tuned.NODE_OPTIONS}`
      : tuned.NODE_OPTIONS,
  }
}
