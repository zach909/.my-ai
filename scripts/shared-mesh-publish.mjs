#!/usr/bin/env node
/**
 * shared-mesh-publish.mjs — pushes this install's queued mesh weight delta
 * (written by models && skills/core/shared-mesh-sync.ts) to GitHub.
 *
 * Only ever started by SharedMeshSync, and only when shared learning is
 * opted into (NEUROCLAW_SHARED_LEARNING=1). Runs as its own detached process
 * because publishFilesToBranch() is synchronous git (fetch/commit/push) and
 * would otherwise freeze the backend server while the network is slow.
 *
 * What gets pushed is weight numbers only -- int8-quantised changes to the
 * shared block of the mesh -- never conversation text. A failed push is
 * logged and left in the outbox; the next sync pass queues it again.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { ROOT, publishFilesToBranch } from './git-worktree-utils.mjs'

const LOCAL_DIR = path.join(ROOT, 'extension-builder', 'shared-mesh-local')
const OUTBOX = path.join(LOCAL_DIR, 'outbox.json')
const STATE = path.join(LOCAL_DIR, 'state.json')
// A finished project's merged hive delta has its own outbox (written by
// models && skills/core/hive-learning.ts) so it can never overwrite this
// install's regular one. Only a file of exactly that name, in this folder.
const HIVE_OUTBOX = /^outbox-hive-[a-f0-9]{16}\.json$/

/** Which outbox to push, and whether it is this install's own (whose success is recorded in state.json). */
function pickOutbox() {
  const arg = process.argv[2]
  if (!arg) return { file: OUTBOX, own: true }
  const resolved = path.resolve(arg)
  if (path.dirname(resolved) !== LOCAL_DIR || !HIVE_OUTBOX.test(path.basename(resolved))) return null
  return { file: resolved, own: false }
}

function log(...args) {
  console.log('[shared-mesh-publish]', ...args)
}

function main() {
  if (process.env.NEUROCLAW_SHARED_LEARNING !== '1') {
    log('shared learning not opted into (NEUROCLAW_SHARED_LEARNING=1) -- nothing pushed')
    return
  }
  const outbox = pickOutbox()
  if (!outbox) {
    log('not one of this install\'s outbox files -- skipping')
    return
  }
  if (!existsSync(outbox.file)) return
  let job
  try {
    job = JSON.parse(readFileSync(outbox.file, 'utf8'))
  } catch {
    return
  }
  if (!job || typeof job.content !== 'string' || !/^extension-builder\/shared-mesh\/deltas\/[a-f0-9]{16}\.json$/.test(job.relPath)) {
    log('outbox malformed -- skipping')
    return
  }
  const result = publishFilesToBranch(
    [{ relPath: job.relPath, content: job.content }],
    'Shared learning: updated mesh weight delta from one install\n\nAutomated push by scripts/shared-mesh-publish.mjs (opt-in: NEUROCLAW_SHARED_LEARNING=1).',
    process.env.NEUROCLAW_SHARED_LEARNING_BRANCH || 'main',
  )
  if (!result.ok) {
    log('push failed (non-fatal, retried next sync):', String(result.error || '').slice(-300))
    return
  }
  if (!outbox.own) {
    // A project's hive delta: done, so it is not pushed again. Nothing about this install's own state changes.
    rmSync(outbox.file, { force: true })
    log(result.noop ? 'already up to date' : `pushed ${job.relPath}`)
    return
  }
  let state = {}
  try {
    state = JSON.parse(readFileSync(STATE, 'utf8'))
  } catch {
    state = {}
  }
  mkdirSync(LOCAL_DIR, { recursive: true })
  writeFileSync(STATE, JSON.stringify({ ...state, lastPublishedHash: job.hash, lastPublishAt: Date.now() }, null, 2) + '\n')
  log(result.noop ? 'already up to date' : `pushed ${job.relPath}`)
}

main()
