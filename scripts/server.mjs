#!/usr/bin/env node
/**
 * server.mjs — `npm run server`: builds and starts the production
 * backend, prints a read-only startup resource diagnostic and an
 * automatic update check, and launches five autonomous agents alongside
 * it: the self-improvement loop (scripts/self-improve.mjs, tunes
 * existing skills' hyperparameters), the skill-creation agent
 * (scripts/skill-agent.mjs -- "a separate AI... working on skills":
 * researches new topics, writes them up, and trains genuinely new
 * skills from scratch, publishing five things per skill -- see that
 * file's own doc comment), the skill-drill agent
 * (scripts/skill-drill-agent.mjs -- the fifth of those five things:
 * constantly re-drills each published skill with fresh problems,
 * judges whether it genuinely got better, and pushes real
 * improvements), the conversation-learning agent
 * (scripts/conversation-learning-agent.mjs -- "it learns by talking to
 * you": trains on real local usage, strictly local, never published),
 * and the peer-sync listener (scripts/peer-sync.mjs). All child
 * processes get the CPU/memory-aware tuning from process-tuning.mjs so
 * these cycles run as fast as this machine's real resources allow.
 *
 * Mirrors scripts/dev.mjs's structure (build once, spawn, tear down
 * together on exit) but for the production entry point instead of the
 * Vite dev server, plus the autonomous pieces dev.mjs doesn't need.
 */

import { spawn } from 'node:child_process'
import { printDiagnostics } from './system-diagnostics.mjs'
import { tunedEnv } from './process-tuning.mjs'
import { DEFAULT_PEER_PORT } from './peer-sync.mjs'
import { spawnAwait } from './spawn-utils.mjs'

const ROOT = process.cwd()
const PORT = Number(process.env.PORT) || 7861

console.log('[server] read-only startup diagnostics...')
printDiagnostics()

// Startup-time optimization: the update check (a network call, up to a
// 15s git-fetch timeout -- real motivation: this session watched a bad
// merge from another automated agent break `npm run server` on `main`,
// and the user's own checkout stayed broken until they pulled the fix,
// so knowing "you're behind origin" the moment the server starts beats
// finding out from a crash) and the backend build (a pure CPU-bound tsc
// compile) don't depend on each other at all -- running them
// concurrently removes that dead time from every single `npm run
// server`, not just a slow-network edge case. The update check itself
// stays read-only-by-default and never blocks startup on failure
// (offline/no-upstream degrades to a one-line notice) -- see its own
// doc comment in update-check.mjs.
console.log('[server] checking for updates and building backend...')
const [, buildCode] = await Promise.all([
  spawnAwait('node', ['scripts/update-check.mjs'], { cwd: ROOT }),
  spawnAwait('node', ['scripts/build-backend.mjs'], { cwd: ROOT }),
])
if (buildCode !== 0) {
  console.error(`[server] backend build failed (exit ${buildCode})`)
  process.exit(buildCode)
}

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

if (process.env.NEUROCLAW_SKILL_AGENT !== '0') {
  console.log('[server] starting autonomous skill-creation agent (research -> wiki -> skill)...')
  const skillAgent = spawn('node', ['scripts/skill-agent.mjs'], { cwd: ROOT, stdio: 'inherit', env: childEnv })
  children.push(skillAgent)
} else {
  console.log('[server] skill-creation agent disabled (NEUROCLAW_SKILL_AGENT=0)')
}

if (process.env.NEUROCLAW_CONVERSATION_LEARNING !== '0') {
  console.log('[server] starting conversation-learning agent (local only, never published)...')
  const conversationLearner = spawn('node', ['scripts/conversation-learning-agent.mjs'], { cwd: ROOT, stdio: 'inherit', env: childEnv })
  children.push(conversationLearner)
} else {
  console.log('[server] conversation-learning agent disabled (NEUROCLAW_CONVERSATION_LEARNING=0)')
}

if (process.env.NEUROCLAW_SKILL_DRILLS !== '0') {
  console.log('[server] starting skill-drill agent (constantly re-drills published skills, judges + graphs the result)...')
  const drillAgent = spawn('node', ['scripts/skill-drill-agent.mjs'], { cwd: ROOT, stdio: 'inherit', env: childEnv })
  children.push(drillAgent)
} else {
  console.log('[server] skill-drill agent disabled (NEUROCLAW_SKILL_DRILLS=0)')
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
