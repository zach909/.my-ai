#!/usr/bin/env node
/**
 * backroom.mjs -- NeuroClaw and an Ollama-hosted model (Gemma by default)
 * talking to each other until you stop it. A mod; see docs/BACKROOM.md.
 *
 *   node scripts/backroom.mjs
 *
 * Builds the backend first if the mod's files have not been compiled yet.
 *
 * Env vars:
 *   NEUROCLAW_BACKROOM_MODEL            Ollama model to talk to (default gemma3)
 *   OLLAMA_HOST                         where Ollama listens (default 127.0.0.1:11434)
 *   NEUROCLAW_BACKROOM_SEED             NeuroClaw's opening line
 *   NEUROCLAW_BACKROOM_MAX_TURNS        stop after this many turns (default: never)
 *   NEUROCLAW_BACKROOM_PUBLISH_EVERY    publish a digest every N new lines (default 50, 0 = never)
 *
 * Ctrl-C stops it cleanly and prints what it did.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const compiled = path.join(ROOT, 'dist', 'plugins', 'backroom', 'index.js')

if (!existsSync(compiled)) {
  console.log('backroom: compiling the backend (the mod has not been built yet)...')
  const build = spawnSync('node', [path.join(ROOT, 'scripts', 'build-backend.mjs')], { cwd: ROOT, stdio: 'inherit' })
  if (build.status !== 0 || !existsSync(compiled)) {
    console.error('backroom: the backend build failed, so there is nothing to run.')
    process.exit(1)
  }
}

const { getNeuroclawSystem } = await import(path.join(ROOT, 'dist', 'src', 'index.js'))
const { createBackroom } = await import(compiled)

const system = await getNeuroclawSystem()
const backroom = createBackroom(system, process.env.NEUROCLAW_BACKROOM_SEED ? { seed: process.env.NEUROCLAW_BACKROOM_SEED } : {})

const controller = new AbortController()
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => controller.abort())

console.log(`backroom ${backroom.config.runId}: NeuroClaw <-> ${backroom.config.modelLabel}. Ctrl-C to stop.`)
const timer = setInterval(() => {
  const s = backroom.status()
  console.log(`  ${s.turns} turns, ${s.learned} kept, ${s.trained} trained, ${s.silentTurns} silent, ${s.published} published${s.lastError ? `, last error: ${s.lastError}` : ''}`)
}, 30_000)

const final = await backroom.run(controller.signal)
clearInterval(timer)
console.log(`stopped: ${final.stopReason}`)
console.log(JSON.stringify(final, null, 2))
process.exit(final.stopReason && /failed \d+ times/.test(final.stopReason) ? 1 : 0)
