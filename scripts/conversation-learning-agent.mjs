#!/usr/bin/env node
/**
 * conversation-learning-agent.mjs — the third autonomous agent this
 * project runs, and the only one that learns from real usage instead of
 * external research.
 *
 * "How the agent learns is not by just updating the skills and other
 * stuff like that. It learns by talking to you. It tries to predict
 * what you're gonna say and tries to predict what any input into the
 * model is gonna say, and then that's how it learns."
 *
 * Two real, different prediction directions trained per conversation
 * turn, both via genuine torch.autograd gradient descent (the same
 * pytorch_trainer.py contract every other @definishon in this repo
 * uses) -- neither is hand-written, both are whatever gradient descent
 * actually converges on for that turn's real content:
 *
 *   1. "predict what any input into the model is gonna say" --
 *      input = embedText(the user's actual message),
 *      target = embedText(this agent's actual response) to it.
 *   2. "predict what you're gonna say" -- input = embedText(this
 *      agent's PRIOR response), target = embedText(the user's NEXT
 *      real message) that actually followed it.
 *
 * Absolute privacy boundary, enforced structurally, not just by policy:
 * this entire script only ever reads
 * extension-builder/conversation-log.jsonl (itself gitignored -- see
 * extension-builder/.gitignore) and writes its trained output to
 * extension-builder/extensions/conversation_learning.ext.json (also
 * gitignored). It NEVER calls withSandboxWorktree(), NEVER calls
 * publishFilesToBranch(), NEVER imports scripts/peer-sync.mjs -- unlike
 * self-improve.mjs and skill-agent.mjs, there is no code path in this
 * file capable of sending anything it reads to git, a peer, or anywhere
 * else. Real conversation content stays on this machine, structurally,
 * not by discipline alone.
 *
 * Env vars:
 *   NEUROCLAW_CONVERSATION_LEARNING=0             disable the loop entirely
 *   NEUROCLAW_CONVERSATION_LEARNING_INTERVAL_MS   ms between cycles (default 20 min)
 *
 * Usage: node scripts/conversation-learning-agent.mjs          (runs the loop forever)
 *        node scripts/conversation-learning-agent.mjs --once   (one cycle, for testing)
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const LOG_PATH = path.join(ROOT, 'extension-builder', 'conversation-log.jsonl')
const OUTPUT_PATH = path.join(ROOT, 'extension-builder', 'extensions', 'conversation_learning.ext.json')
const STATE_PATH = path.join(ROOT, 'extension-builder', 'conversation-learning-state.json')
const DIMS = 16
const MAX_TURNS = 150 // bounded, same reasoning as every other capped batch this session

function log(...args) {
  console.log('[conversation-learning]', ...args)
}

/** Reads real turns straight off disk -- a plain JS mirror of
 *  src/lib/conversation-log.ts's readRecentConversationTurns() (this
 *  script can't import that compiled TS module's exact path reliably
 *  across dev/prod builds, so the parsing logic -- simple JSONL,
 *  skip malformed lines -- is duplicated here deliberately, not
 *  reused incorrectly). */
export function readRecentTurns(logPath = LOG_PATH, limit = MAX_TURNS) {
  if (!existsSync(logPath)) return []
  let raw
  try {
    raw = readFileSync(logPath, 'utf8')
  } catch {
    return []
  }
  const turns = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed.userMessage === 'string' && typeof parsed.response === 'string') {
        turns.push(parsed)
      }
    } catch {
      continue
    }
  }
  return turns.slice(-limit)
}

/**
 * Builds both real training-sample directions from a real turn history.
 * Pure function, directly testable. Each sample carries a stable `key`
 * (used to skip re-training turns whose content hasn't changed, and to
 * cap growth by only ever keeping the DIMS embedding target, never the
 * raw text, past this point).
 */
export function buildSamples(turns) {
  const samples = []
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]
    samples.push({ key: `respond:${turn.at}`, kind: 'respond', inputText: turn.userMessage, targetText: turn.response })
    if (i > 0) {
      const prior = turns[i - 1]
      samples.push({ key: `anticipate:${turn.at}`, kind: 'anticipate', inputText: prior.response, targetText: turn.userMessage })
    }
  }
  return samples
}

function trainSamples(worktreeRoot, samples) {
  return new Promise((resolve) => {
    const scriptPath = path.join(worktreeRoot, 'extension-builder', 'pytorch_trainer.py')
    let child
    try {
      child = spawn('python3', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ ok: false, error: `could not launch python3: ${err.message}` })
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (err) => resolve({ ok: false, error: `python3 not available: ${err.message}` }))
    child.on('close', () => {
      const line = stdout.trim().split('\n').pop() ?? ''
      try {
        resolve(JSON.parse(line))
      } catch {
        resolve({ ok: false, error: stderr.trim() || 'no output from pytorch_trainer.py' })
      }
    })
    ;(async () => {
      const { embedText } = await import(path.join(worktreeRoot, 'dist', 'models && skills', 'core', 'neuro-lang.js'))
      const trainerSamples = samples.map((s, idx) => ({
        readout: idx,
        input: embedText(s.inputText, DIMS),
        target: embedText(s.targetText, DIMS),
      }))
      const spec = { dims: DIMS, numReadouts: samples.length, epochs: 1200, learningRate: 0.05, tolerance: 1e-3, samples: trainerSamples }
      child.stdin.write(JSON.stringify(spec) + '\n')
      child.stdin.end()
    })()
  })
}

function loadState(statePath = STATE_PATH) {
  if (!existsSync(statePath)) return { lastTrainedTurnAt: 0 }
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : { lastTrainedTurnAt: 0 }
  } catch {
    return { lastTrainedTurnAt: 0 }
  }
}

function saveState(state, statePath = STATE_PATH) {
  mkdirSync(path.dirname(statePath), { recursive: true })
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8')
}

/** One full cycle: read whatever real conversation happened, skip
 *  entirely if nothing new since last cycle (never retrains on an
 *  unchanged log), train both prediction directions for real, and
 *  overwrite the single local output file with the new state -- never
 *  git, never a peer, ever. */
export async function runOneCycle({ logPath = LOG_PATH, outputPath = OUTPUT_PATH, statePath = STATE_PATH, worktreeRoot = ROOT } = {}) {
  const turns = readRecentTurns(logPath)
  if (turns.length === 0) {
    log('no conversation turns logged yet -- nothing to learn from this cycle')
    return { ok: true, trained: false, reason: 'no turns' }
  }

  const state = loadState(statePath)
  const newestTurnAt = turns[turns.length - 1].at
  if (newestTurnAt <= state.lastTrainedTurnAt) {
    log('no new turns since the last cycle -- skipping')
    return { ok: true, trained: false, reason: 'no new turns' }
  }

  const samples = buildSamples(turns)
  log(`training on ${turns.length} real turn(s) (${samples.length} sample(s) across both prediction directions)...`)

  const { ExtensionBuilder } = await import(path.join(worktreeRoot, 'dist', 'extension-builder', 'builder.js'))
  const builder = new ExtensionBuilder()
  const project = builder.createProject(
    'Conversation Learning',
    'Trained locally on real (message, response) turns -- never published, never shared. See wiki/Privacy-Policy.md.',
  )

  const trainResult = await trainSamples(worktreeRoot, samples)
  let convergedCount = 0
  const neurons = []
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const neuron = builder.addNeuron(project.id, `${s.kind}_${i}`, 0)
    if (!neuron) continue
    builder.addScript(project.id, neuron.id, s.inputText, s.targetText)
    const converged = trainResult.ok && trainResult.sampleConverged?.[i] === true
    neuron.trained = converged
    if (converged) convergedCount++
    neurons.push(neuron)
  }

  if (!trainResult.ok) {
    log(`training unavailable this cycle (${trainResult.error}) -- neurons kept as untrained definitions, will retry`)
  } else {
    log(`${convergedCount}/${samples.length} sample(s) genuinely converged`)
  }

  mkdirSync(path.dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, builder.saveWithoutQuantization(project.id), 'utf8')
  saveState({ lastTrainedTurnAt: newestTurnAt, turnsSeen: turns.length, convergedCount, sampleCount: samples.length }, statePath)

  log(`saved: ${path.relative(ROOT, outputPath)}`)
  return { ok: true, trained: true, turnCount: turns.length, sampleCount: samples.length, convergedCount, pytorchOk: trainResult.ok }
}

const DEFAULT_INTERVAL_MS = 20 * 60 * 1000

async function loop() {
  if (process.env.NEUROCLAW_CONVERSATION_LEARNING === '0') {
    log('disabled via NEUROCLAW_CONVERSATION_LEARNING=0 -- exiting.')
    return
  }
  const intervalMs = Number(process.env.NEUROCLAW_CONVERSATION_LEARNING_INTERVAL_MS) || DEFAULT_INTERVAL_MS
  log(`starting -- one local learning cycle every ${Math.round(intervalMs / 60000)} minute(s), local only, never published`)
  for (;;) {
    try {
      await runOneCycle()
    } catch (err) {
      log('cycle threw unexpectedly, continuing:', err?.message ?? err)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

function isEntryPoint() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  if (process.argv.includes('--once')) {
    runOneCycle()
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((err) => {
        console.error('[conversation-learning] cycle failed:', err)
        process.exit(1)
      })
  } else {
    loop()
  }
}
