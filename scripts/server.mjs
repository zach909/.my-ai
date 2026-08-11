#!/usr/bin/env node
/**
 * server.mjs — `npm run server`: builds and starts the production
 * backend, prints a read-only startup resource diagnostic and an
 * automatic update check, and launches the autonomous self-improvement
 * loop (scripts/self-improve.mjs) and the peer-sync listener
 * (scripts/peer-sync.mjs) alongside it. All three child processes get
 * the CPU/memory-aware tuning from process-tuning.mjs so the
 * self-improvement cycles run as fast as this machine's real resources
 * allow.
 *
 * Mirrors scripts/dev.mjs's structure (build once, spawn, tear down
 * together on exit) but for the production entry point instead of the
 * Vite dev server, plus the autonomous pieces dev.mjs doesn't need.
 */

import { execFileSync, spawn } from 'node:child_process'
import { printDiagnostics } from './system-diagnostics.mjs'
import { printUpdateCheck } from './update-check.mjs'
import { tunedEnv } from './process-tuning.mjs'
import { DEFAULT_PEER_PORT } from './peer-sync.mjs'

const ROOT = process.cwd()
const PORT = Number(process.env.PORT) || 7861

console.log('[server] read-only startup diagnostics...')
printDiagnostics()

// Real motivation: this session watched a bad merge from another
// automated agent break `npm run server` on `main`, and the user's own
// checkout stayed broken until they pulled the fix -- knowing "you're
// behind origin" the moment the server starts beats finding out from a
// crash. Read-only (git fetch only updates tracking refs), never blocks
// startup on failure (offline/no-upstream degrades to a one-line notice).
console.log('[server] checking for updates...')
printUpdateCheck(ROOT)

console.log('[server] building backend...')
execFileSync('node', ['scripts/build-backend.mjs'], { cwd: ROOT, stdio: 'inherit' })

const childEnv = tunedEnv()

console.log(`[server] starting backend on port ${PORT}...`)
const backend = spawn('node', ['dist/interface/main.js', 'web', String(PORT)], {
  cwd: ROOT,
  stdio: 'inherit',
  env: childEnv,
})

const children = [backend]

if (process.env.NEUROCLAW_SELF_IMPROVE !== '0') {
  console.log('[server] starting autonomous self-improvement loop...')
  const improver = spawn('node', ['scripts/self-improve.mjs'], { cwd: ROOT, stdio: 'inherit', env: childEnv })
  children.push(improver)
} else {
  console.log('[server] self-improvement loop disabled (NEUROCLAW_SELF_IMPROVE=0)')
}

if (process.env.NEUROCLAW_PEER_SYNC !== '0') {
  const peerPort = Number(process.env.NEUROCLAW_PEER_PORT) || DEFAULT_PEER_PORT
  console.log(`[server] starting peer-sync listener on port ${peerPort}...`)
  const peers = spawn('node', ['scripts/peer-sync-server.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...childEnv, NEUROCLAW_PEER_PORT: String(peerPort) },
  })
  children.push(peers)
} else {
  console.log('[server] peer-sync listener disabled (NEUROCLAW_PEER_SYNC=0)')
}

function shutdown() {
  console.log('[server] shutting down...')
  for (const child of children) child.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
backend.on('exit', (code) => {
  console.error(`[server] backend exited with code ${code}`)
  for (const child of children) if (child !== backend) child.kill()
  process.exit(code ?? 0)
})
