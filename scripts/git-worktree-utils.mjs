#!/usr/bin/env node
/**
 * git-worktree-utils.mjs — shared sandbox/publish primitives used by
 * every autonomous agent this project runs (scripts/self-improve.mjs,
 * scripts/skill-agent.mjs). Extracted out of self-improve.mjs so a
 * second agent doesn't duplicate (and risk drifting from) the same
 * git-worktree plumbing, sandbox-symlink workaround, and
 * fully-qualified-ref push fix that were each found and fixed by
 * actually running this code end-to-end earlier this session.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')

/**
 * Sandbox: a throwaway git worktree checked out from the current commit.
 * Every file write an agent makes while researching/training happens
 * here; the live server's own working directory is never touched.
 * Always torn down, win or lose.
 */
export async function withSandboxWorktree(fn, { prefix = 'neuroclaw-sandbox-', buildBackend = true } = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), prefix))
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
    if (buildBackend) {
      const built = spawnSync('node', ['scripts/build-backend.mjs'], { cwd: worktree, encoding: 'utf8' })
      if (built.status !== 0) {
        return { ok: false, error: `sandbox backend build failed: ${(built.stderr || '').slice(-2000)}` }
      }
    }
    // Awaited (not just returned) so the `finally` cleanup below can't
    // remove the worktree out from under an async fn -- a real bug found
    // before this ever shipped: `return fn(worktree)` on an async
    // callback returns its Promise immediately, and `finally` in a
    // non-async function runs synchronously right after that `return`
    // statement, not after the Promise settles, deleting the worktree
    // while the callback was still using it.
    return await fn(worktree)
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT, encoding: 'utf8' })
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** The runner gate every autonomous agent's output goes through before
 *  anything gets published: does the actual test suite still pass
 *  against it? Reused as-is by every agent so "did this break the
 *  runner" always means the exact same check. */
export function runnerPassesSmoke(worktree) {
  const res = spawnSync('node', ['test/smoke.mjs'], { cwd: worktree, encoding: 'utf8', timeout: 5 * 60 * 1000 })
  const output = `${res.stdout || ''}\n${res.stderr || ''}`
  const match = output.match(/(\d+)\s+passed,\s+(\d+)\s+failed/)
  if (!match) return { ok: false, reason: 'could not read smoke test results (runner may be broken)' }
  const [, passed, failed] = match
  if (Number(failed) > 0) return { ok: false, reason: `${failed} smoke test(s) failed against the runner` }
  return { ok: true, passed: Number(passed) }
}

/**
 * Publishes a set of files straight to TARGET_BRANCH (main by default),
 * via its OWN isolated worktree -- never the live server's checked-out
 * branch, and never this session's own dev branch. `files` is an array
 * of `{ relPath, content }`. Degrades to a logged, non-fatal failure if
 * git push isn't possible in this environment (no credentials, no
 * network, or the branch moved since the fetch and the push is no
 * longer a fast-forward) -- the caller decides what to do with a
 * failed push (self-improve.mjs keeps the improvement locally and
 * retries next cycle; skill-agent.mjs does the same for a new skill).
 */
export function publishFilesToBranch(files, commitMessage, targetBranch = process.env.NEUROCLAW_SELF_IMPROVE_BRANCH || 'main') {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'neuroclaw-branch-push-'))
  const worktree = path.join(tmp, 'wt')
  try {
    spawnSync('git', ['fetch', 'origin', targetBranch], { cwd: ROOT, encoding: 'utf8' })
    const hasRemoteBranch =
      spawnSync('git', ['rev-parse', '--verify', `origin/${targetBranch}`], { cwd: ROOT, encoding: 'utf8' }).status === 0
    const base = hasRemoteBranch ? `origin/${targetBranch}` : 'HEAD'
    const added = spawnSync('git', ['worktree', 'add', '--detach', worktree, base], { cwd: ROOT, encoding: 'utf8' })
    if (added.status !== 0) return { ok: false, error: `could not create push worktree: ${(added.stderr || '').slice(-500)}` }

    for (const { relPath, content } of files) {
      const full = path.join(worktree, relPath)
      mkdirSync(path.dirname(full), { recursive: true })
      writeFileSync(full, content, 'utf8')
      spawnSync('git', ['add', relPath], { cwd: worktree, encoding: 'utf8' })
    }
    const committed = spawnSync('git', ['commit', '-m', commitMessage], { cwd: worktree, encoding: 'utf8' })
    if (committed.status !== 0) {
      // "nothing to commit" (identical content already on the target
      // branch) isn't a real failure -- anything else is.
      const nothingToCommit = /nothing to commit/i.test(committed.stdout || '')
      return nothingToCommit ? { ok: true, noop: true } : { ok: false, error: (committed.stdout || '').slice(-500) }
    }
    // Fully-qualified destination ref -- see self-improve.mjs's own
    // history for why a bare branch name that doesn't exist locally is
    // genuinely ambiguous to git and fails otherwise.
    const pushed = spawnSync('git', ['push', 'origin', `HEAD:refs/heads/${targetBranch}`], { cwd: worktree, encoding: 'utf8' })
    if (pushed.status !== 0) {
      return { ok: false, error: pushed.stderr }
    }
    return { ok: true }
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT, encoding: 'utf8' })
    rmSync(tmp, { recursive: true, force: true })
  }
}
