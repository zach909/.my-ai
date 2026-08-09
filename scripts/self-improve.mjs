#!/usr/bin/env node
/**
 * self-improve.mjs — the autonomous self-improvement loop `npm run server`
 * launches alongside the web backend.
 *
 * "when you run npm run server it will do autonomous improvements, it will
 * improve its skills, push them to GitHub beta... it will run improvement
 * algorithms that you can use to improve, making it code stuff and learn...
 * this will be pushed to GitHub beta, then the third stage where it has a
 * sandbox and basically what it does is it improves its own code, if it
 * works then the model will be rewarded... if it fails it will be
 * punished, then if it is better than the original it'll be pushed to
 * beta."
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
 *   - "rewarded... punished... pushed to beta if better than the
 *     original": a real, persisted scoreboard
 *     (extension-builder/self-improvement-scoreboard.json) tracks the
 *     best hyperparameters and score seen so far per target script. A
 *     candidate that scores higher is the reward -- it becomes the new
 *     best and gets pushed straight to a dedicated `beta` branch (never
 *     main, never this session's own dev branch) via a second isolated
 *     worktree. A candidate that scores the same or worse is the
 *     punishment -- discarded, logged to history, nothing pushed.
 *
 * Deliberately NOT built: literal unrestricted self-rewriting of
 * arbitrary source files, or any external "hacking" target -- per this
 * session's own scoping decision, "hack the box" means experimenting on
 * its own code in its own sandbox, nothing else.
 *
 * Env vars:
 *   NEUROCLAW_SELF_IMPROVE=0             disable the loop entirely
 *   NEUROCLAW_SELF_IMPROVE_INTERVAL_MS   ms between cycles (default 30 min)
 *
 * Usage: node scripts/self-improve.mjs           (runs the loop forever)
 *        node scripts/self-improve.mjs --once     (runs exactly one cycle, for testing)
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { broadcastImprovement } from './peer-sync.mjs'
import { TARGETS } from './self-improve-targets.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')
const SCOREBOARD_PATH = path.join(ROOT, 'extension-builder', 'self-improvement-scoreboard.json')
const BETA_BRANCH = 'beta'

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

/**
 * The runner gate: "it's the skills and the model runner which is
 * basically the thing that runs the model, which is made up of skills."
 * A skill only matters if the runner that executes it still works, so a
 * candidate's trained-accuracy score is never sufficient on its own --
 * this runs the same smoke suite every other change in this repo is
 * verified against (test/smoke.mjs), inside the same sandbox worktree
 * that just trained the candidate, and treats any failure as an
 * automatic disqualification regardless of how good the accuracy score
 * looked. Parses the suite's own final "<N> passed, <M> failed" summary
 * line rather than just checking the exit code, so the reason is
 * recorded, not just a pass/fail bit.
 */
function runnerPassesSmoke(worktree) {
  const res = spawnSync('node', ['test/smoke.mjs'], { cwd: worktree, encoding: 'utf8', timeout: 5 * 60 * 1000 })
  const output = `${res.stdout || ''}\n${res.stderr || ''}`
  const match = output.match(/(\d+)\s+passed,\s+(\d+)\s+failed/)
  if (!match) return { ok: false, reason: 'could not read smoke test results (runner may be broken)' }
  const [, passed, failed] = match
  if (Number(failed) > 0) return { ok: false, reason: `${failed} smoke test(s) failed against the runner` }
  return { ok: true, passed: Number(passed) }
}

/** Sandbox: a throwaway git worktree checked out from the current commit.
 *  Every file write during a training run happens here; the live server's
 *  own working directory is never touched. Always torn down, win or lose. */
function withSandboxWorktree(fn) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'neuroclaw-self-improve-'))
  const worktree = path.join(tmp, 'wt')
  const created = spawnSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  if (created.status !== 0) {
    rmSync(tmp, { recursive: true, force: true })
    return { ok: false, error: `could not create sandbox worktree: ${(created.stderr || '').slice(-500)}` }
  }
  try {
    // A git worktree only ever contains tracked files -- node_modules/
    // and the .bin/ toolchain symlinks are gitignored, so a fresh
    // worktree has neither. Symlinking them in from the real checkout
    // (read-only reuse, same repo/same dependency versions) avoids
    // needing a full `npm install` -- and therefore network access --
    // just to build inside the sandbox.
    for (const dir of ['node_modules', '.bin']) {
      const target = path.join(ROOT, dir)
      const link = path.join(worktree, dir)
      if (existsSync(target) && !existsSync(link)) {
        symlinkSync(target, link, 'dir')
      }
    }
    // The sandbox needs its own real dist/ to run the target script
    // against -- build it inside the worktree rather than trusting
    // whatever happens to be on disk from an unrelated build.
    const built = spawnSync('node', ['scripts/build-backend.mjs'], { cwd: worktree, encoding: 'utf8' })
    if (built.status !== 0) {
      return { ok: false, error: `sandbox backend build failed: ${(built.stderr || '').slice(-2000)}` }
    }
    return fn(worktree)
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT, encoding: 'utf8' })
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Pushes the improved scoreboard straight to the dedicated `beta`
 *  branch, via its OWN isolated worktree -- never the live server's
 *  checked-out branch, and never this session's own dev branch. Degrades
 *  to a logged, non-fatal failure if git push isn't possible in this
 *  environment (no credentials, no network) -- the improvement stays
 *  recorded locally and the loop tries again next cycle. */
function pushScoreboardToBeta(board) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'neuroclaw-beta-push-'))
  const worktree = path.join(tmp, 'wt')
  try {
    spawnSync('git', ['fetch', 'origin', BETA_BRANCH], { cwd: ROOT, encoding: 'utf8' })
    const hasRemoteBeta =
      spawnSync('git', ['rev-parse', '--verify', `origin/${BETA_BRANCH}`], { cwd: ROOT, encoding: 'utf8' }).status === 0
    const base = hasRemoteBeta ? `origin/${BETA_BRANCH}` : 'HEAD'
    const added = spawnSync('git', ['worktree', 'add', '--detach', worktree, base], { cwd: ROOT, encoding: 'utf8' })
    if (added.status !== 0) return { ok: false, error: `could not create beta worktree: ${(added.stderr || '').slice(-500)}` }

    mkdirSync(path.join(worktree, 'extension-builder'), { recursive: true })
    writeFileSync(
      path.join(worktree, 'extension-builder', 'self-improvement-scoreboard.json'),
      JSON.stringify(board, null, 2) + '\n',
      'utf8',
    )
    spawnSync('git', ['add', 'extension-builder/self-improvement-scoreboard.json'], { cwd: worktree, encoding: 'utf8' })
    const committed = spawnSync(
      'git',
      ['commit', '-m', 'Self-improvement: new best hyperparameters (automated)'],
      { cwd: worktree, encoding: 'utf8' },
    )
    if (committed.status !== 0) {
      // "nothing to commit" (identical scoreboard already on beta) isn't a
      // real failure -- anything else is.
      const nothingToCommit = /nothing to commit/i.test(committed.stdout || '')
      return nothingToCommit ? { ok: true, noop: true } : { ok: false, error: (committed.stdout || '').slice(-500) }
    }
    // Fully-qualified destination ref (refs/heads/beta, not just "beta")
    // -- pushing a detached-HEAD worktree's HEAD to a bare branch name
    // that doesn't exist on the remote yet is genuinely ambiguous to git
    // and fails with "failed to push some refs" otherwise (found by
    // actually running this end-to-end rather than trusting it from
    // reading the command).
    const pushed = spawnSync('git', ['push', 'origin', `HEAD:refs/heads/${BETA_BRANCH}`], { cwd: worktree, encoding: 'utf8' })
    if (pushed.status !== 0) {
      log(`push to ${BETA_BRANCH} failed (no credentials/network in this environment?) -- keeping the improvement locally, will retry next cycle: ${(pushed.stderr || '').slice(-500)}`)
      return { ok: false, error: pushed.stderr }
    }
    return { ok: true }
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT, encoding: 'utf8' })
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** One full cycle: pick a target, mutate its best-known hyperparameters,
 *  train the candidate in a sandbox, and reward (push to beta) or punish
 *  (discard) based on whether it's a real improvement. */
export async function runOneCycle({ scoreboardPath = SCOREBOARD_PATH, rand = Math.random, push = true } = {}) {
  const board = loadScoreboard(scoreboardPath)
  const target = TARGETS[Math.floor(rand() * TARGETS.length)]
  const key = target.script
  const entry = board.targets[key] ?? { bestHyperparams: DEFAULT_HYPERPARAMS, bestScore: 0, history: [] }
  const candidate = mutateHyperparams(entry.bestHyperparams, rand)

  log(`cycle: target=${key} baseline_score=${entry.bestScore.toFixed(4)} candidate=${JSON.stringify(candidate)}`)

  // Train AND run the runner gate inside the SAME sandbox worktree, before
  // it gets torn down -- the smoke suite needs the worktree's own dist/
  // and test/ files still in place.
  const result = withSandboxWorktree((worktree) => {
    const trained = runTargetInSandbox(worktree, key, candidate)
    if (!trained.ok) return trained
    const gate = runnerPassesSmoke(worktree)
    return { ...trained, gate }
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

  // The judge: a candidate only earns a reward if BOTH hold -- its
  // trained accuracy is a real, strict improvement over the current best
  // (decideReward), AND the runner that actually executes skills still
  // passes its own test suite against it (runnerPassesSmoke). Either one
  // failing is a punishment, no matter how good the other looks.
  const score = target.metric(result.summary)
  attempt.score = score
  attempt.runnerOk = result.gate.ok
  if (!result.gate.ok) attempt.runnerFailureReason = result.gate.reason
  const improved = decideReward(score, entry.bestScore)
  const rewarded = improved && result.gate.ok

  if (!rewarded) {
    const reason = !result.gate.ok ? `runner regression: ${result.gate.reason}` : 'not an improvement'
    log(`candidate scored ${score.toFixed(4)} (baseline ${entry.bestScore.toFixed(4)}) -- punished (discarded): ${reason}`)
    entry.history = [...entry.history.slice(-19), attempt]
    board.targets[key] = entry
    saveScoreboard(board, scoreboardPath)
    return { target: key, rewarded: false, reason, ...attempt }
  }

  log(`candidate scored ${score.toFixed(4)} -- beats current best ${entry.bestScore.toFixed(4)} and the runner still passes (${result.gate.passed} smoke tests), rewarded`)
  entry.bestHyperparams = candidate
  entry.bestScore = score
  entry.history = [...entry.history.slice(-19), attempt]
  board.targets[key] = entry
  saveScoreboard(board, scoreboardPath)

  const pushResult = push ? pushScoreboardToBeta(board) : { ok: false, skipped: true }
  if (pushResult.ok) log(`pushed new best hyperparameters for ${key} to ${BETA_BRANCH}`)

  // Alongside (never instead of) the GitHub beta push -- "GitHub is the
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
