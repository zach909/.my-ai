#!/usr/bin/env node
/**
 * update-check.mjs — automatic update check printed at server startup.
 *
 * Read-only: `git fetch` (no merge, no pull, no working-tree change)
 * against the checked-out branch's own upstream, then reports how far
 * local HEAD has drifted from it. Directly motivated by this session's
 * own repeated experience: multiple other automated agents push to this
 * repo's `main` concurrently, and a checkout that's fallen behind is
 * exactly what caused real, reported breakage earlier (a bad merge
 * landed upstream and the user's local `npm run server` kept failing
 * until they pulled the fix). Knowing "you're behind" the moment the
 * server starts is strictly better than finding out from a crash.
 *
 * Never modifies anything -- `git fetch` updates only the local
 * tracking refs (origin/<branch>), never the checked-out branch itself.
 * Degrades to a silent no-op (never blocks startup) if git isn't
 * available, there's no upstream configured, or there's no network --
 * same optional-dependency pattern as every other network-touching
 * piece of this project.
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

export function printUpdateCheck(cwd = process.cwd()) {
  const result = checkForUpdates(cwd)
  if (result.status === 'unavailable') {
    log(result.message) // informational only -- never treated as an error
  } else if (result.status === 'up-to-date') {
    log(`${result.branch}: ${result.message}`)
  } else {
    log(`${result.branch}: ${result.message}`)
  }
  return result
}

function isEntryPoint() {
  return process.argv[1] && process.argv[1].endsWith('update-check.mjs')
}

if (isEntryPoint()) {
  printUpdateCheck()
}
