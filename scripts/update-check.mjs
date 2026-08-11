#!/usr/bin/env node
/**
 * update-check.mjs — automatic update check printed at server startup,
 * and (by default -- "auto update everything") an automatic pull when
 * it's genuinely safe to do one.
 *
 * `git fetch` (no merge, no working-tree change) against the checked-out
 * branch's own upstream, then reports how far local HEAD has drifted
 * from it. Directly motivated by this session's own repeated experience:
 * multiple other automated agents push to this repo's `main`
 * concurrently, and a checkout that's fallen behind is exactly what
 * caused real, reported breakage earlier (a bad merge landed upstream
 * and the user's local `npm run server` kept failing until they pulled
 * the fix). Knowing "you're behind" the moment the server starts is
 * strictly better than finding out from a crash -- and applying it
 * automatically is better still, when it can be done safely.
 *
 * "Safely" is a real, checked condition, not an assumption: an update is
 * only ever auto-applied when it's a plain fast-forward (`git pull
 * --ff-only`, which refuses and does nothing on anything else) AND the
 * working tree has no local changes to lose (`git status --porcelain`
 * is empty). Anything else -- local edits in progress, a genuine
 * divergence, no upstream, offline -- degrades to the same read-only
 * notice this always printed; nothing destructive ever happens
 * automatically. Disable auto-apply entirely with
 * `NEUROCLAW_AUTO_UPDATE=0` (the check itself still runs and prints).
 */

import { spawnSync } from 'node:child_process'

function log(...args) {
  console.log('[update-check]', ...args)
}

/** Pure-ish core: given the already-fetched repo state, compute how far
 *  local HEAD and its upstream have diverged. Exported and separated
 *  from the git I/O below so the comparison logic itself is directly
 *  unit testable without needing a real git repo. */
export function summarizeDivergence(behind, ahead) {
  if (behind === 0 && ahead === 0) return { status: 'up-to-date', message: 'up to date with origin' }
  if (behind > 0 && ahead === 0) {
    return {
      status: 'behind',
      message: `${behind} commit${behind === 1 ? '' : 's'} behind origin -- run 'git pull' to update`,
    }
  }
  if (behind === 0 && ahead > 0) {
    return {
      status: 'ahead',
      message: `${ahead} commit${ahead === 1 ? '' : 's'} ahead of origin (local commits not yet pushed)`,
    }
  }
  return {
    status: 'diverged',
    message: `diverged from origin: ${ahead} local commit${ahead === 1 ? '' : 's'}, ${behind} remote commit${behind === 1 ? '' : 's'} not yet merged`,
  }
}

function run(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 15000 })
}

/** Runs the real check against the actual repo at `cwd`. Never throws --
 *  every failure mode (no git, no network, not a repo, detached HEAD, no
 *  upstream) degrades to a clearly-labeled `unavailable` result instead
 *  of blocking or crashing startup. */
export function checkForUpdates(cwd = process.cwd()) {
  const branchRes = run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  if (branchRes.status !== 0) return { status: 'unavailable', message: 'not a git repository' }
  const branch = branchRes.stdout.trim()
  if (branch === 'HEAD') return { status: 'unavailable', message: 'detached HEAD -- no branch to compare against origin' }

  const upstreamRes = run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd)
  if (upstreamRes.status !== 0) return { status: 'unavailable', message: `${branch} has no upstream configured` }
  const upstream = upstreamRes.stdout.trim()
  const remote = upstream.split('/')[0]

  const fetched = run(['fetch', remote, branch], cwd)
  if (fetched.status !== 0) {
    return { status: 'unavailable', message: `could not reach ${remote} (offline?) -- skipping update check` }
  }

  const countRes = run(['rev-list', '--left-right', '--count', `${upstream}...HEAD`], cwd)
  if (countRes.status !== 0) return { status: 'unavailable', message: 'could not compare against upstream' }
  const [behindStr, aheadStr] = countRes.stdout.trim().split(/\s+/)
  const behind = Number(behindStr) || 0
  const ahead = Number(aheadStr) || 0

  return { ...summarizeDivergence(behind, ahead), branch, upstream, behind, ahead }
}

/** True only when there is nothing local to lose -- the one precondition
 *  that has to hold before any automatic pull is even considered. */
export function workingTreeIsClean(cwd) {
  const res = run(['status', '--porcelain'], cwd)
  return res.status === 0 && res.stdout.trim().length === 0
}

/** Applies the update -- `--ff-only` so git itself refuses and changes
 *  nothing if this isn't a plain fast-forward (a merge conflict, a
 *  diverged history) even if the caller got the precondition check
 *  wrong somehow. Belt-and-suspenders: workingTreeIsClean() is checked
 *  by the caller too, but --ff-only is the actual hard guarantee. */
export function applyUpdate(cwd, remote, branch) {
  const res = spawnSync('git', ['pull', '--ff-only', remote, branch], { cwd, encoding: 'utf8', timeout: 60000 })
  if (res.status !== 0) {
    return { ok: false, error: (res.stderr || res.stdout || '').slice(-500) }
  }
  return { ok: true }
}

export function printUpdateCheck(cwd = process.cwd()) {
  const result = checkForUpdates(cwd)
  if (result.status === 'unavailable' || result.status === 'up-to-date') {
    log(result.status === 'unavailable' ? result.message : `${result.branch}: ${result.message}`)
    return result
  }

  log(`${result.branch}: ${result.message}`)

  if (result.status !== 'behind' || process.env.NEUROCLAW_AUTO_UPDATE === '0') {
    return result // "ahead" or "diverged" is never auto-resolved; opt-out respected
  }
  if (!workingTreeIsClean(cwd)) {
    log('not auto-pulling -- local changes present (this is expected on an active dev checkout)')
    return result
  }

  log('auto-pulling (fast-forward only, working tree clean)...')
  const remote = result.upstream.split('/')[0]
  const applied = applyUpdate(cwd, remote, result.branch)
  if (applied.ok) {
    log(`updated -- now up to date with ${result.upstream}. The build step that runs next will pick up the change.`)
  } else {
    log(`auto-pull failed, leaving the checkout as-is: ${applied.error}`)
  }
  return { ...result, autoUpdated: applied.ok }
}

function isEntryPoint() {
  return process.argv[1] && process.argv[1].endsWith('update-check.mjs')
}

if (isEntryPoint()) {
  printUpdateCheck()
}
