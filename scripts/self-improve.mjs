#!/usr/bin/env node
/**
 * self-improve.mjs — the autonomous self-improvement loop `npm run server`
 * launches alongside the web backend.
 *
 * "when you run npm run server it will do autonomous improvements, it will
 * improve its skills, push them to GitHub... it will run improvement
 * algorithms that you can use to improve, making it code stuff and learn...
 * this will be pushed to GitHub, then the third stage where it has a
 * sandbox and basically what it does is it improves its own code, if it
 * works then the model will be rewarded... if it fails it will be
 * punished, then if it is better than the original it'll be pushed."
 *
 * A concrete, honest realization of that spec, scoped to what this repo
 * can actually and safely do:
 *
 *   - "improves its own code": this app is a small rule-based/trained-
 *     mesh engine, not something that can freely rewrite arbitrary
 *     TypeScript by reasoning about it -- so "improving its code" means
 *     improving the hyperparameters of its own real training scripts
 *     (extension-builder/train-coding-skills.mjs,
 *     build-physics-chemistry-network.mjs), the same genuine
 *     torch.autograd training this repo already uses everywhere else.
 *     This is real self-improvement (the resulting model measurably
 *     converges better or worse), just scoped to a dimension this
 *     codebase can safely and honestly tune on its own.
 *   - "a sandbox": every training run happens inside a throwaway `git
 *     worktree` checked out fresh from HEAD -- never the live server's
 *     own working directory. Torn down whether the attempt succeeds or
 *     fails.
 *   - "improvement algorithms... making it code stuff and learn": the
 *     mutation strategy is evolution-strategy style (perturb the current
 *     best hyperparameters by a random step), the same family as
 *     trainDefinitionsRandomSearch() elsewhere in this repo -- a real,
 *     different algorithm from plain gradient descent, not just a
 *     restart of it.
 *   - "rewarded... punished... pushed if it's better than the original":
 *     a real, persisted scoreboard
 *     (extension-builder/self-improvement-scoreboard.json) tracks the
 *     best hyperparameters and score seen so far per target script. A
 *     candidate that scores higher is the reward -- it becomes the new
 *     best and gets pushed straight to the target branch (main by
 *     default -- see NEUROCLAW_SELF_IMPROVE_BRANCH below; NOT this
 *     session's own dev branch, which stays untouched either way) via a
 *     second isolated worktree. A candidate that scores the same or
 *     worse is the punishment -- discarded, logged to history, nothing
 *     pushed. Pushing straight to main with no human review step is a
 *     real, explicit choice this project's owner made (see
 *     wiki/Self-Improvement.md) -- it is not this script's default
 *     assumption about what's safe, it's what was asked for.
 *
 * Deliberately NOT built: literal unrestricted self-rewriting of
 * arbitrary source files, or any external "hacking" target -- per this
 * session's own scoping decision, "hack the box" means experimenting on
 * its own code in its own sandbox, nothing else.
 *
 * "when the agent [improves] itself, I wanted it to go through that test
 * to see if it's been improved -- if it passes it'll get saved to Beta
 * and if it fails, it will try again with negative feedback": every
 * candidate, for every target (not just the exam network's own row),
 * must ALSO clear a fresh, randomized, cross-domain capability exam
 * (scripts/capability-exam.mjs) before it's rewarded -- see
 * runCapabilityExamGate() below. A candidate that fails the exam is
 * punished exactly like any other failed candidate: discarded, logged,
 * retried next cycle with nothing but "not good enough yet" (the
 * scoreboard entry) carried forward -- the "negative feedback."
 * Accepted candidates still push straight to a real branch, just not
 * `main` directly anymore now that a gate stands in front of them --
 * see TARGET_BRANCH below.
 *
 * Env vars:
 *   NEUROCLAW_SELF_IMPROVE=0                 disable the loop entirely
 *   NEUROCLAW_SELF_IMPROVE_INTERVAL_MS       ms between cycles (default 30 min)
 *   NEUROCLAW_SELF_IMPROVE_TARGET_BRANCH     branch an exam-gated reward is pushed to (default 'beta')
 *   NEUROCLAW_EXAM_PASS_THRESHOLD            minimum capability-exam score required to be rewarded (default 0.15)
 *
 * Usage: node scripts/self-improve.mjs           (runs the loop forever)
 *        node scripts/self-improve.mjs --once     (runs exactly one cycle, for testing)
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { broadcastImprovement } from './peer-sync.mjs'
import { TARGETS } from './self-improve-targets.mjs'
import { withSandboxWorktree, runnerPassesSmoke, publishFilesToBranch } from './git-worktree-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')
const SCOREBOARD_PATH = path.join(ROOT, 'extension-builder', 'self-improvement-scoreboard.json')
// This pipeline's own dedicated branch var -- deliberately NOT the same
// NEUROCLAW_SELF_IMPROVE_BRANCH env var skill-agent.mjs/skill-drill-agent.mjs
// read (those two stay on 'main', unchanged): once a capability-exam gate
// stands in front of a reward, an exam-gated candidate lands on `beta`
// instead, and a `beta`-tracking sandbox checkout (`npm run server` on
// that branch) picks it up automatically via update-check.mjs's existing
// fast-forward auto-pull.
export const TARGET_BRANCH = process.env.NEUROCLAW_SELF_IMPROVE_TARGET_BRANCH || 'beta'
export const CAPABILITY_EXAM_TARGET = 'extension-builder/build-capability-exam-network.mjs'
export const EXAM_PASS_THRESHOLD = Number(process.env.NEUROCLAW_EXAM_PASS_THRESHOLD) || 0.15

function log(...args) {
  console.log('[self-improve]', ...args)
}

// Re-exported for backwards compatibility with callers/tests that import
// TARGETS from this module -- the real definition now lives in
// self-improve-targets.mjs (see that file's doc comment for why).
export { TARGETS }

export const DEFAULT_HYPERPARAMS = { epochs: 1500, learningRate: 0.05, tolerance: 1e-3 }

/**
 * Evolution-strategy style mutation -- perturbs the current best
 * hyperparameters by a random step rather than guessing blind or
 * restarting from scratch, the same family as this repo's
 * trainDefinitionsRandomSearch(). Exported and pure (no I/O, no
 * randomness source that can't be reasoned about) so it's directly unit
 * testable.
 */
export function mutateHyperparams(base, rand = Math.random) {
  const jitter = (v, pct) => Math.max(1e-6, v * (1 + (rand() * 2 - 1) * pct))
  return {
    epochs: Math.max(50, Math.round(jitter(base.epochs, 0.3))),
    learningRate: jitter(base.learningRate, 0.4),
    tolerance: jitter(base.tolerance, 0.4),
  }
}

/** Pure reward/punish decision -- a candidate is only rewarded if it's a
 *  real, strict improvement over the current best. Ties are punished
 *  (discarded), not rewarded: "better than the original" means strictly
 *  better, not "at least as good." */
export function decideReward(candidateScore, bestScore) {
  return candidateScore > bestScore
}

export function loadScoreboard(scoreboardPath = SCOREBOARD_PATH) {
  if (!existsSync(scoreboardPath)) return { targets: {} }
  try {
    const parsed = JSON.parse(readFileSync(scoreboardPath, 'utf8'))
    return parsed && typeof parsed === 'object' && parsed.targets ? parsed : { targets: {} }
  } catch {
    return { targets: {} } // corrupt/partial scoreboard -- start clean rather than crash the loop
  }
}

export function saveScoreboard(board, scoreboardPath = SCOREBOARD_PATH) {
  mkdirSync(path.dirname(scoreboardPath), { recursive: true })
  writeFileSync(scoreboardPath, JSON.stringify(board, null, 2) + '\n', 'utf8')
}

/** Runs one target training script inside `cwd` (a sandbox worktree, never
 *  the live server's own working tree) with hyperparameter overrides
 *  passed via env vars, and returns its parsed JSON summary. Never
 *  throws -- a failed run is a punished attempt, not a crashed loop. */
function runTargetInSandbox(cwd, targetScript, hyperparams) {
  const res = spawnSync('node', [targetScript], {
    cwd,
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    env: {
      ...process.env,
      SELF_IMPROVE_EPOCHS: String(hyperparams.epochs),
      SELF_IMPROVE_LR: String(hyperparams.learningRate),
      SELF_IMPROVE_TOLERANCE: String(hyperparams.tolerance),
    },
  })
  if (res.error || res.status !== 0) {
    const stderrTail = (res.stderr || '').slice(-2000)
    return { ok: false, error: res.error?.message ?? (stderrTail || `exit code ${res.status}`) }
  }
  // Every target script's final statement is
  // `console.log(JSON.stringify(summary, null, 2))` -- pretty-printed
  // and therefore multi-line, unlike the log lines before it (each
  // prefixed with e.g. "[train-coding-skills] ..."). Taking just the
  // last line of stdout (as an earlier version of this function did)
  // only grabs the closing "}" and fails to parse. The final summary
  // object always starts with a bare "{" on its own line -- find the
  // LAST such line and take everything from there to the end of output.
  const stdout = res.stdout || ''
  const lines = stdout.split('\n')
  const jsonStart = lines.lastIndexOf('{')
  if (jsonStart === -1) {
    return { ok: false, error: 'could not find a JSON summary in training script output' }
  }
  const jsonText = lines.slice(jsonStart).join('\n')
  try {
    return { ok: true, summary: JSON.parse(jsonText) }
  } catch {
    return { ok: false, error: 'could not parse training script output as JSON' }
  }
}

/** Runs a completely fresh, randomly-generated, cross-domain capability
 *  exam against the candidate's OWN sandbox worktree -- literally
 *  `node extension-builder/build-capability-exam-network.mjs`, the same
 *  script this loop trains as an ordinary target. Every call generates
 *  brand-new questions (never cached, never reused between cycles), so
 *  this really is "changing every time you take the test," applied at
 *  gate-time for every target, not just the exam network's own row.
 *  Never throws -- an exam that can't run at all is treated as a failed
 *  gate (punished), not a crashed cycle. */
function runCapabilityExamGate(worktree) {
  const res = spawnSync('node', ['extension-builder/build-capability-exam-network.mjs'], {
    cwd: worktree, encoding: 'utf8', timeout: 5 * 60 * 1000,
  })
  if (res.error || res.status !== 0) {
    return { ok: false, examScore: 0, error: res.error?.message ?? (res.stderr || '').slice(-2000) }
  }
  const lines = (res.stdout || '').split('\n')
  const jsonStart = lines.lastIndexOf('{')
  if (jsonStart === -1) return { ok: false, examScore: 0, error: 'no exam summary in output' }
  try {
    const summary = JSON.parse(lines.slice(jsonStart).join('\n'))
    return { ok: summary.trainingOk === true, examScore: summary.examScore ?? 0 }
  } catch {
    return { ok: false, examScore: 0, error: 'could not parse exam summary' }
  }
}

// Sandbox worktree + runner gate + branch-publish plumbing now lives in
// git-worktree-utils.mjs, shared with scripts/skill-agent.mjs -- both
// agents publish to the repo the exact same tested way instead of each
// maintaining their own (and risking drift) copy of the git-worktree
// symlink workaround and the fully-qualified-ref push fix.

/** Pushes the improved scoreboard straight to TARGET_BRANCH (beta by
 *  default) via publishFilesToBranch(). Degrades to a logged, non-fatal
 *  failure if git push isn't possible in this environment -- the
 *  improvement stays recorded locally and the loop tries again next
 *  cycle, so a transient failure here is never fatal to the loop. */
export function pushScoreboardToTargetBranch(board) {
  const result = publishFilesToBranch(
    [{ relPath: 'extension-builder/self-improvement-scoreboard.json', content: JSON.stringify(board, null, 2) + '\n' }],
    'Self-improvement: new best hyperparameters (automated)',
    TARGET_BRANCH,
  )
  if (!result.ok) {
    log(`push to ${TARGET_BRANCH} failed (no credentials/network in this environment, or the branch moved since the fetch) -- keeping the improvement locally, will retry next cycle: ${(result.error || '').slice(-500)}`)
  }
  return result
}

// Backwards-compatible alias -- earlier versions of this script and its
// callers (peer-sync-server.mjs) referenced this function as
// pushScoreboardToBeta(); kept so nothing importing that name breaks.
export const pushScoreboardToBeta = pushScoreboardToTargetBranch

/** One full cycle: pick a target, mutate its best-known hyperparameters,
 *  train the candidate in a sandbox, and reward (push to TARGET_BRANCH)
 *  or punish (discard) based on whether it's a real improvement. */
export async function runOneCycle({ scoreboardPath = SCOREBOARD_PATH, rand = Math.random, push = true } = {}) {
  const board = loadScoreboard(scoreboardPath)
  const target = TARGETS[Math.floor(rand() * TARGETS.length)]
  const key = target.script
  const entry = board.targets[key] ?? { bestHyperparams: DEFAULT_HYPERPARAMS, bestScore: 0, history: [] }
  const candidate = mutateHyperparams(entry.bestHyperparams, rand)

  log(`cycle: target=${key} baseline_score=${entry.bestScore.toFixed(4)} candidate=${JSON.stringify(candidate)}`)

  // Train, run the runner gate, AND sit the candidate's own sandbox down
  // for a fresh capability exam -- all inside the SAME sandbox worktree,
  // before it gets torn down (the smoke suite and the exam script both
  // need the worktree's own dist/ and test/ files still in place). When
  // this cycle's target IS the exam network itself, its own train/eval
  // already produced a genuine held-out exam score -- reuse that instead
  // of paying for a second, redundant exam run.
  const result = await withSandboxWorktree((worktree) => {
    const trained = runTargetInSandbox(worktree, key, candidate)
    if (!trained.ok) return trained
    const gate = runnerPassesSmoke(worktree)
    const examResult = key === CAPABILITY_EXAM_TARGET
      ? { ok: true, examScore: trained.summary.examScore ?? 0 }
      : runCapabilityExamGate(worktree)
    return { ...trained, gate, examResult }
  })
  const attempt = { at: new Date().toISOString(), candidate, ok: result.ok }

  if (!result.ok) {
    log(`sandbox run failed, discarding (punished): ${result.error}`)
    attempt.error = result.error
    entry.history = [...entry.history.slice(-19), attempt]
    board.targets[key] = entry
    saveScoreboard(board, scoreboardPath)
    return { target: key, rewarded: false, reason: 'sandbox failure', ...attempt }
  }

  // The judge: a candidate only earns a reward if ALL THREE hold -- its
  // trained accuracy is a real, strict improvement over the current best
  // (decideReward); the runner that actually executes skills still
  // passes its own test suite against it (runnerPassesSmoke); AND the
  // candidate's own sandbox passes a completely fresh, randomly-generated
  // capability exam (runCapabilityExamGate) at or above
  // EXAM_PASS_THRESHOLD. Any one failing is a punishment -- "if it fails,
  // it will try again with negative feedback" -- no matter how good the
  // other two look.
  const score = target.metric(result.summary)
  attempt.score = score
  attempt.runnerOk = result.gate.ok
  if (!result.gate.ok) attempt.runnerFailureReason = result.gate.reason
  attempt.examScore = result.examResult.examScore
  attempt.examPassed = result.examResult.ok && result.examResult.examScore >= EXAM_PASS_THRESHOLD
  if (!attempt.examPassed && result.examResult.error) attempt.examFailureReason = result.examResult.error
  const improved = decideReward(score, entry.bestScore)
  const rewarded = improved && result.gate.ok && attempt.examPassed

  if (!rewarded) {
    const reason = !attempt.examPassed
      ? `capability exam failed: score ${attempt.examScore.toFixed(4)} below threshold ${EXAM_PASS_THRESHOLD}`
      : !result.gate.ok
        ? `runner regression: ${result.gate.reason}`
        : 'not an improvement'
    log(`candidate scored ${score.toFixed(4)} (baseline ${entry.bestScore.toFixed(4)}), exam ${attempt.examScore.toFixed(4)} -- punished (discarded): ${reason}`)
    entry.history = [...entry.history.slice(-19), attempt]
    board.targets[key] = entry
    saveScoreboard(board, scoreboardPath)
    return { target: key, rewarded: false, reason, ...attempt }
  }

  log(`candidate scored ${score.toFixed(4)} -- beats current best ${entry.bestScore.toFixed(4)}, the runner still passes (${result.gate.passed} smoke tests), and the exam passed (${attempt.examScore.toFixed(4)} >= ${EXAM_PASS_THRESHOLD}) -- rewarded`)
  entry.bestHyperparams = candidate
  entry.bestScore = score
  entry.history = [...entry.history.slice(-19), attempt]
  board.targets[key] = entry
  saveScoreboard(board, scoreboardPath)

  const pushResult = push ? pushScoreboardToTargetBranch(board) : { ok: false, skipped: true }
  if (pushResult.ok) log(`pushed new best hyperparameters for ${key} to ${TARGET_BRANCH}`)

  // Alongside (never instead of) the GitHub push -- "GitHub is the
  // weakness here, I want it to go directly between people": every
  // rewarded improvement also gets broadcast directly to any configured
  // peers, so it propagates even if GitHub is unreachable or simply not
  // how a given deployment shares improvements. A complete no-op with no
  // peers configured (the default).
  const peerResult = push ? await broadcastImprovement(key, candidate, score) : { sent: 0, peers: [] }

  return { target: key, rewarded: true, pushed: pushResult.ok, peersSent: peerResult.sent, score, ...attempt }
}

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000

async function loop() {
  if (process.env.NEUROCLAW_SELF_IMPROVE === '0') {
    log('disabled via NEUROCLAW_SELF_IMPROVE=0 -- exiting.')
    return
  }
  const intervalMs = Number(process.env.NEUROCLAW_SELF_IMPROVE_INTERVAL_MS) || DEFAULT_INTERVAL_MS
  log(`starting -- one cycle every ${Math.round(intervalMs / 60000)} minute(s)`)
  // Runs forever, one cycle at a time, until the parent process (server.mjs)
  // kills this process on shutdown. A single cycle throwing never takes the
  // loop down -- it's logged and treated the same as a punished attempt.
  for (;;) {
    try {
      await runOneCycle()
    } catch (err) {
      log('cycle threw unexpectedly, discarding and continuing:', err?.message ?? err)
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
        console.error('[self-improve] cycle failed:', err)
        process.exit(1)
      })
  } else {
    loop()
  }
}
