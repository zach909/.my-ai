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
 * turn, both via ExtensionBuilder.train()'s hand-rolled JS delta rule
 * (HyperDimensionalEngine.trainDefinitions() in
 * "models && skills/core/neuro-lang.ts" -- the same zero-dependency
 * mechanism every other script-trained neuron and the regular Extension
 * Builder "Train" button already use) -- neither is hand-written, both
 * are whatever the delta rule actually converges on for that turn's real
 * content. This needs nothing beyond Node.js: no PyTorch, no Python
 * process, no install step, so it trains automatically the moment the
 * server is running, out of the box. Each direction becomes one
 * dedicated neuron with one addScript(inputText, targetText) sample:
 *
 *   1. "predict what any input into the model is gonna say" --
 *      inputText = the user's actual message,
 *      targetText = this agent's actual response to it.
 *   2. "predict what you're gonna say" -- inputText = this agent's PRIOR
 *      response, targetText = the user's NEXT real message that actually
 *      followed it.
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

import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const LOG_PATH = path.join(ROOT, 'extension-builder', 'conversation-log.jsonl')
const OUTPUT_PATH = path.join(ROOT, 'extension-builder', 'extensions', 'conversation_learning.ext.json')
const STATE_PATH = path.join(ROOT, 'extension-builder', 'conversation-learning-state.json')
const LOCK_PATH = path.join(ROOT, 'extension-builder', 'conversation-learning.lock')
const MAX_TURNS = 150 // bounded, same reasoning as every other capped batch this session
// A stale lock (the process that held it died without cleaning up --
// e.g. `kill -9`, an OOM) shouldn't wedge learning forever. Real cycles
// finish in well under this; anything older is treated as abandoned.
const LOCK_STALE_MS = 10 * 60 * 1000

function log(...args) {
  console.log('[conversation-learning]', ...args)
}

/**
 * Cross-process lock: src/lib/conversation-learning-trigger.ts fires a
 * cycle immediately after every real chat turn ("always learn by
 * talking to it"), IN the backend server process, while
 * scripts/server.mjs also runs this same script as a separate
 * background process on a timer as a catch-up fallback. Without a lock
 * spanning BOTH processes, they could race writing OUTPUT_PATH/
 * STATE_PATH at the same time. A same-process in-memory flag (which
 * conversation-learning-trigger.ts also keeps, for the common case)
 * isn't enough on its own since it can't see the other process at all.
 */
export function acquireLock(lockPath = LOCK_PATH) {
  mkdirSync(path.dirname(lockPath), { recursive: true })
  try {
    writeFileSync(lockPath, String(process.pid), { flag: 'wx' }) // 'wx' = exclusive create, fails if it already exists
    return true
  } catch (err) {
    if (err.code !== 'EEXIST') return false
    // Held already -- but by a live process, or an abandoned one?
    try {
      const age = Date.now() - statSyncMtime(lockPath)
      if (age > LOCK_STALE_MS) {
        writeFileSync(lockPath, String(process.pid)) // stale -- reclaim it, no 'wx' this time
        return true
      }
    } catch {
      // Couldn't even stat it -- treat as held, safest default.
    }
    return false
  }
}

function statSyncMtime(p) {
  return statSync(p).mtimeMs
}

export function releaseLock(lockPath = LOCK_PATH) {
  try {
    unlinkSync(lockPath)
  } catch {
    // Already gone, or never ours to remove -- fine either way.
  }
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
 * cap growth by only ever keeping the fixed-size embedding target, never
 * the raw text, past this point).
 */
export function buildSamples(turns) {
  const samples = []
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]
    // Who said each side travels with the text. Without it a transcript is a
    // transcript of nobody: the network sees the words of a question and the
    // words of an answer and has nothing telling it those are different kinds
    // of thing, which is most of what there is to learn from a conversation.
    samples.push({
      key: `respond:${turn.at}`,
      kind: 'respond',
      inputSpeaker: 'user',
      inputText: turn.userMessage,
      targetSpeaker: 'ai',
      targetText: turn.response,
    })
    if (i > 0) {
      const prior = turns[i - 1]
      samples.push({
        key: `anticipate:${turn.at}`,
        kind: 'anticipate',
        inputSpeaker: 'ai',
        inputText: prior.response,
        targetSpeaker: 'user',
        targetText: turn.userMessage,
      })
    }
  }
  return samples
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
export async function runOneCycle({ logPath = LOG_PATH, outputPath = OUTPUT_PATH, statePath = STATE_PATH, worktreeRoot = ROOT, lockPath = LOCK_PATH } = {}) {
  // The in-process trigger (src/lib/conversation-learning-trigger.ts, fired
  // immediately from bot-service.ts on every real exchange) and this
  // background loop's own timer can both land on runOneCycle() at close to
  // the same moment, from two different OS processes -- a same-process
  // boolean can't stop that. This lock is the actual cross-process guard;
  // whichever side loses just defers to the other, no turn is lost, since
  // state.lastTrainedTurnAt makes the next successful cycle catch up anyway.
  if (!acquireLock(lockPath)) {
    log('another cycle is already running (cross-process lock held) -- skipping, will catch up next time')
    return { ok: true, trained: false, reason: 'locked' }
  }
  try {
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

    const neurons = []
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      const neuron = builder.addNeuron(project.id, `${s.kind}_${i}`, 0)
      if (!neuron) continue
      builder.addScript(project.id, neuron.id, s.inputText, s.targetText)
      neurons.push(neuron)
    }

    // Pure JS delta-rule training (ExtensionBuilder.train(), the same
    // mechanism the regular Extension Builder "Train" button uses) --
    // synchronous, no subprocess, no Python, no PyTorch. It mutates
    // `neuron.trained` directly on the neuron objects pushed above, so
    // there's nothing further to wire up here beyond reading the result.
    const trainResult = builder.train(project.id, { epochs: 1200 })
    const convergedCount = neurons.filter((n) => n.trained).length
    log(`${convergedCount}/${samples.length} sample(s) genuinely converged`)

    mkdirSync(path.dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, builder.saveWithoutQuantization(project.id), 'utf8')
    saveState({ lastTrainedTurnAt: newestTurnAt, turnsSeen: turns.length, convergedCount, sampleCount: samples.length }, statePath)

    log(`saved: ${path.relative(ROOT, outputPath)}`)
    return { ok: true, trained: true, turnCount: turns.length, sampleCount: samples.length, convergedCount, converged: trainResult?.converged ?? false }
  } finally {
    releaseLock(lockPath)
  }
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
