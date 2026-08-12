#!/usr/bin/env node
/**
 * skill-drill-agent.mjs — the fifth piece of every skill
 * scripts/skill-agent.mjs publishes: "an algorithm that you can run on
 * your machine to constantly improve it... if it was a math skill, it
 * would constantly spam it with math problems if you ran npm serve."
 *
 * A skill published by skill-agent.mjs is, by itself, a snapshot frozen
 * at the moment its one wiki page converged. This agent is what keeps
 * drilling it after that -- a separate, `npm run server`-launched loop
 * (own process, same as the other three agents) that:
 *
 *   1. picks a published skill (rotates through whichever this
 *      machine's skill-agent-registry.json says are actually live,
 *      least-recently-drilled first -- same rotation shape as
 *      skill-agent.mjs's own pickTopic());
 *   2. classifies it into a drill category (classifyDrillCategory()) --
 *      right now exactly one concrete generator exists,
 *      drill-generators/arithmetic.mjs, matching the user's own math
 *      example. Anything that doesn't match a known category falls
 *      back to "generic": a regression drill that just re-checks the
 *      skill still reproduces its own trained content, since there's no
 *      way to generate genuinely novel held-out material for an
 *      arbitrary research topic without calling out to an external
 *      LLM -- which this project deliberately never does (see
 *      "NO EXTERNAL APIS" throughout wiki/Self-Improvement.md);
 *   3. measures REAL held-out accuracy before drilling (pytorch_trainer
 *      "op":"eval" -- a pure forward pass, no weight update, against a
 *      fresh batch the current weights were never trained on);
 *   4. continues training (pytorch_trainer "op":"train" with
 *      initW/initB = the current weights) on a second fresh batch;
 *   5. measures held-out accuracy again on a THIRD fresh batch (never
 *      touched by either step 3 or step 4);
 *   6. THE JUDGE: only if accuracy after is a strict improvement over
 *      accuracy before does this count as real progress -- same
 *      strict-improvement rule as self-improve.mjs's decideReward(). A
 *      cycle that doesn't improve discards its weight update (keeps the
 *      previous best) but still logs the attempt -- the graph shows
 *      failed drills too, not just wins.
 *   7. on genuine improvement, the updated weights are committed to
 *      extension-builder/drill-weights/<slug>.json and pushed straight
 *      to TARGET_BRANCH (same "not beta, but to git" destination every
 *      other autonomous agent in this repo uses) -- "when one model
 *      learns, they all learn": a `git pull` on any other install picks
 *      up the improved weights.
 *
 * Every attempt (improved or not) is appended to the LOCAL, gitignored
 * extension-builder/skill-quality-history.json -- the data
 * GET /api/self-improvement/history and the Self-Improvement dashboard
 * (src/routes/app/self-improvement.tsx) graph. This file is local
 * bookkeeping about how well drilling is going on THIS machine, not
 * something that gets published (same reasoning as
 * self-improvement-scoreboard.json).
 *
 * This agent does not need a sandbox git worktree to train in (unlike
 * self-improve.mjs/skill-agent.mjs) -- it never touches this repo's own
 * source or executable scripts, only a small per-skill weight-matrix
 * JSON file, so there is no runner regression it could possibly cause.
 * A sandbox worktree is still used for the actual git push (via
 * publishFilesToBranch), same discipline as everywhere else in this
 * repo: no autonomous agent pushes from the live server's own working
 * directory.
 *
 * Env vars:
 *   NEUROCLAW_SKILL_DRILLS=0              disable the loop entirely
 *   NEUROCLAW_SKILL_DRILLS_INTERVAL_MS    ms between cycles (default 10 min)
 *   NEUROCLAW_SELF_IMPROVE_BRANCH         branch a real improvement is pushed to (default 'main')
 *
 * Usage: node scripts/skill-drill-agent.mjs             (runs the loop forever)
 *        node scripts/skill-drill-agent.mjs --once       (one cycle, for testing)
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, publishFilesToBranch } from './git-worktree-utils.mjs'
import { generateArithmeticBatch } from './drill-generators/arithmetic.mjs'

const REGISTRY_PATH = path.join(ROOT, 'extension-builder', 'skill-agent-registry.json')
const WEIGHTS_DIR = path.join(ROOT, 'extension-builder', 'drill-weights')
export const HISTORY_PATH = path.join(ROOT, 'extension-builder', 'skill-quality-history.json')
const TARGET_BRANCH = process.env.NEUROCLAW_SELF_IMPROVE_BRANCH || 'main'
const DIMS = 16
const DRILL_SAMPLE_COUNT = 8
const DRILL_EPOCHS = 400

function log(...args) {
  console.log('[skill-drill-agent]', ...args)
}

/** Right now exactly one concrete drill category is implemented,
 *  matching the user's own worked example ("if it was a math skill").
 *  Everything else drills generically (a regression check, not a
 *  generalization test) rather than pretending to generate held-out
 *  material for topics this project has no honest way to quiz. Pure,
 *  directly testable. */
export function classifyDrillCategory(topic) {
  return /\b(arithmetic|math(?:s|ematics)?|algebra|calculus|number\s*theory|numerical)\b/i.test(topic)
    ? 'arithmetic'
    : 'generic'
}

/** Picks the published skill drilled least recently -- never-drilled
 *  skills first, then oldest-drilled-first. Pure function of the
 *  registry + history, directly testable. */
export function pickSkillToDrill(registry, history) {
  const published = Object.entries(registry.topics ?? {}).filter(([, t]) => t.publishedAt)
  if (published.length === 0) return null
  const lastDrilledAt = (slug) => {
    const h = history.skills?.[slug]?.history
    return h && h.length > 0 ? h[h.length - 1].at : ''
  }
  const sorted = [...published].sort((a, b) => lastDrilledAt(a[0]).localeCompare(lastDrilledAt(b[0])))
  const [slug, entry] = sorted[0]
  return { slug, topic: entry.topic ?? slug }
}

export function loadRegistry(registryPath = REGISTRY_PATH) {
  if (!existsSync(registryPath)) return { topics: {} }
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8'))
    return parsed && typeof parsed === 'object' && parsed.topics ? parsed : { topics: {} }
  } catch {
    return { topics: {} }
  }
}

export function loadHistory(historyPath = HISTORY_PATH) {
  if (!existsSync(historyPath)) return { skills: {} }
  try {
    const parsed = JSON.parse(readFileSync(historyPath, 'utf8'))
    return parsed && typeof parsed === 'object' && parsed.skills ? parsed : { skills: {} }
  } catch {
    return { skills: {} }
  }
}

export function saveHistory(history, historyPath = HISTORY_PATH) {
  mkdirSync(path.dirname(historyPath), { recursive: true })
  writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n', 'utf8')
}

function loadWeights(slug) {
  const p = path.join(WEIGHTS_DIR, `${slug}.json`)
  if (!existsSync(p)) return { dims: DIMS, numReadouts: 1, W: [new Array(DIMS).fill(0)], b: [new Array(DIMS).fill(0)] }
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    if (parsed?.W && parsed?.b) return parsed
  } catch {
    // fall through to a fresh start
  }
  return { dims: DIMS, numReadouts: 1, W: [new Array(DIMS).fill(0)], b: [new Array(DIMS).fill(0)] }
}

/** Talks to the same persistent pytorch_trainer.py worker contract
 *  every other trainer in this repo uses -- "op":"train" for a real
 *  gradient-descent pass, "op":"eval" for a pure forward pass with NO
 *  weight update (see that script's own doc comment). */
function runPytorch(spec) {
  return new Promise((resolve) => {
    const scriptPath = path.join(ROOT, 'extension-builder', 'pytorch_trainer.py')
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
    child.stdin.write(JSON.stringify(spec) + '\n')
    child.stdin.end()
  })
}

/** Builds one fresh batch of (input, target) embedding pairs for the
 *  given category -- "arithmetic" generates real, never-fabricated
 *  arithmetic facts; "generic" replays the skill's own wiki content as
 *  a single-sample regression check (see this file's doc comment for
 *  why generic drilling can't honestly claim to be a generalization
 *  test). */
async function buildBatch(category, wikiContent, embedText, rand, count = DRILL_SAMPLE_COUNT) {
  // Every sample needs a `readout` index -- pytorch_trainer.py's
  // (readoutIdx, input, target) contract (see that file's own doc
  // comment). This agent only ever trains one readout per skill
  // (numReadouts: 1 throughout), so every sample is readout 0.
  if (category === 'arithmetic') {
    return generateArithmeticBatch(count, rand).map(({ problem, answer }) => ({
      readout: 0,
      input: embedText(problem, DIMS),
      target: embedText(answer, DIMS),
    }))
  }
  const trigger = new Array(DIMS).fill(0.7)
  return [{ readout: 0, input: trigger, target: embedText(wikiContent ?? '', DIMS) }]
}

/** One full drill cycle for one skill. Exported and given every real
 *  dependency (embedText, wikiContent, rand) explicitly so it's testable
 *  without spawning a real python3 subprocess or touching disk. */
export async function drillOneSkill({ slug, topic, wikiContent, embedText, rand = Math.random, weights }) {
  const category = classifyDrillCategory(topic)
  const before = await buildBatch(category, wikiContent, embedText, rand)
  const evalBefore = await runPytorch({ op: 'eval', dims: DIMS, numReadouts: 1, tolerance: 1e-3, samples: before, W: weights.W, b: weights.b })
  if (!evalBefore.ok) return { ok: false, error: evalBefore.error, category }

  const trainBatch = await buildBatch(category, wikiContent, embedText, rand)
  const trained = await runPytorch({
    op: 'train', dims: DIMS, numReadouts: 1, epochs: DRILL_EPOCHS, learningRate: 0.05, tolerance: 1e-3,
    samples: trainBatch, initW: weights.W, initB: weights.b,
  })
  if (!trained.ok) return { ok: false, error: trained.error, category }

  const after = await buildBatch(category, wikiContent, embedText, rand)
  const evalAfter = await runPytorch({ op: 'eval', dims: DIMS, numReadouts: 1, tolerance: 1e-3, samples: after, W: trained.W, b: trained.b })
  if (!evalAfter.ok) return { ok: false, error: evalAfter.error, category }

  const accuracyBefore = evalBefore.accuracy
  const accuracyAfter = evalAfter.accuracy
  const improved = accuracyAfter > accuracyBefore // strict, same rule as self-improve.mjs's decideReward()

  return {
    ok: true,
    category,
    accuracyBefore,
    accuracyAfter,
    improved,
    sampleCount: before.length,
    newWeights: improved ? { dims: DIMS, numReadouts: 1, W: trained.W, b: trained.b } : weights,
  }
}

/** One full cycle: pick a skill, drill it, judge the result, persist +
 *  push a genuine improvement, log everything (win or not) for the
 *  graph. */
export async function runOneCycle({ registryPath = REGISTRY_PATH, historyPath = HISTORY_PATH, rand = Math.random, push = true } = {}) {
  const registry = loadRegistry(registryPath)
  const history = loadHistory(historyPath)
  const pick = pickSkillToDrill(registry, history)
  if (!pick) {
    log('no published skills yet to drill -- nothing to do this cycle')
    return { ok: true, drilled: false, reason: 'no published skills' }
  }
  const { slug, topic } = pick

  let wikiContent = ''
  const wikiPath = path.join(ROOT, 'wiki', `${slug}.md`)
  if (existsSync(wikiPath)) wikiContent = readFileSync(wikiPath, 'utf8')

  const { embedText } = await import(path.join(ROOT, 'dist', 'models && skills', 'core', 'neuro-lang.js'))
  const weights = loadWeights(slug)

  log(`cycle: drilling "${topic}" (${slug})...`)
  const result = await drillOneSkill({ slug, topic, wikiContent, embedText, rand, weights })

  const attempt = { at: new Date().toISOString(), topic, category: result.category, ok: result.ok }
  if (!result.ok) {
    log(`drill failed (${result.error}) -- logged, discarded`)
    attempt.error = result.error
    history.skills[slug] = { history: [...(history.skills[slug]?.history ?? []).slice(-49), attempt] }
    saveHistory(history, historyPath)
    return { slug, topic, drilled: false, reason: result.error }
  }

  attempt.accuracyBefore = result.accuracyBefore
  attempt.accuracyAfter = result.accuracyAfter
  attempt.improved = result.improved
  attempt.sampleCount = result.sampleCount
  history.skills[slug] = { history: [...(history.skills[slug]?.history ?? []).slice(-49), attempt] }
  saveHistory(history, historyPath)

  if (!result.improved) {
    log(`"${topic}": accuracy ${result.accuracyBefore.toFixed(3)} -> ${result.accuracyAfter.toFixed(3)} -- not an improvement, weights unchanged`)
    return { slug, topic, drilled: true, improved: false, ...attempt }
  }

  log(`"${topic}": accuracy ${result.accuracyBefore.toFixed(3)} -> ${result.accuracyAfter.toFixed(3)} -- genuine improvement, publishing`)
  mkdirSync(WEIGHTS_DIR, { recursive: true })
  const weightsJson = JSON.stringify({ ...result.newWeights, slug, topic, category: result.category, updatedAt: attempt.at }, null, 2) + '\n'
  writeFileSync(path.join(WEIGHTS_DIR, `${slug}.json`), weightsJson, 'utf8')

  const publishResult = push
    ? publishFilesToBranch(
        [{ relPath: `extension-builder/drill-weights/${slug}.json`, content: weightsJson }],
        `skill-drill-agent: improved "${topic}" drill weights (${result.accuracyBefore.toFixed(3)} -> ${result.accuracyAfter.toFixed(3)}) (automated)`,
        TARGET_BRANCH,
      )
    : { ok: false, skipped: true }

  if (publishResult.ok) log(`pushed extension-builder/drill-weights/${slug}.json to ${TARGET_BRANCH}`)
  return { slug, topic, drilled: true, improved: true, published: publishResult.ok, ...attempt }
}

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000

async function loop() {
  if (process.env.NEUROCLAW_SKILL_DRILLS === '0') {
    log('disabled via NEUROCLAW_SKILL_DRILLS=0 -- exiting.')
    return
  }
  const intervalMs = Number(process.env.NEUROCLAW_SKILL_DRILLS_INTERVAL_MS) || DEFAULT_INTERVAL_MS
  log(`starting -- one drill cycle every ${Math.round(intervalMs / 60000)} minute(s)`)
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
        console.error('[skill-drill-agent] cycle failed:', err)
        process.exit(1)
      })
  } else {
    loop()
  }
}
