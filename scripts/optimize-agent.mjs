#!/usr/bin/env node
/**
 * The optimization agent: keeps the machine honest, on a cycle, forever.
 *
 * Every other autonomous agent here makes the system do MORE -- research new
 * skills, drill them, learn from conversation. This one exists because more is
 * not the only direction things move. Left alone, this codebase reliably
 * produces four specific kinds of rot, each of which was found by hand, days
 * or weeks late, and each of which is cheap to detect mechanically:
 *
 *   1. Code with no reachable call path. A plugin absent from the routing
 *      table. An API with no UI. A loadRoutingMemory() nothing calls. This is
 *      the single most common defect in this repo, and it always looks
 *      finished: it compiles, it has tests, the tests pass -- because they call
 *      it directly, which is the one caller that proves nothing.
 *
 *   2. Files accumulating where the running system reads them. 147
 *      good_bits_test_*.ext.json had built up over six days in the live
 *      extensions directory, each loaded as a real extension forever after.
 *
 *   3. The repository containing itself. A 608MB clone committed as a gitlink
 *      with no .gitmodules, so every fresh clone got a submodule git could not
 *      populate.
 *
 *   4. Memory that cannot grow. Pinned installed knowledge exceeded capacity,
 *      and the eviction check compared the total rather than the evictable
 *      population, so every new memory was discarded the instant it was made.
 *      The agent was unable to learn anything, and nothing said so.
 *
 * So this measures those, on a cycle, against a stored baseline, and says when
 * a number moves the wrong way. It runs as part of `npm run server`, which
 * means the checking happens wherever Corona runs rather than depending on
 * anyone remembering to look.
 *
 * What it will and will not do on its own is a deliberate line. It DELETES
 * known test leftovers -- a file matching a pattern a test is documented to
 * write is unambiguous rubbish, and leaving it costs boot time and memory. It
 * does NOT edit code, revert commits, or install anything. An autonomous
 * process that rewrites the program while nobody is watching is a much worse
 * failure than one that files an accurate complaint.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = process.cwd()
const BASELINE = path.join(ROOT, 'config', 'optimization-baseline.json')
const REPORT = path.join(ROOT, 'config', 'optimization-report.json')
const CYCLE_MS = Number(process.env.CORONA_OPTIMIZE_CYCLE_MS) || 6 * 60 * 60 * 1000

/** Files a test is documented to write into a live directory. Safe to delete. */
const TEST_LEFTOVERS = [
  { dir: 'extension-builder/extensions', prefixes: ['good_bits_test_', 'autoload_probe_', 'source_autoload_probe_'] },
]

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/** Test leftovers sitting where the running system will load them. */
function checkTestLeftovers({ remove }) {
  let found = 0
  const removed = []
  for (const { dir, prefixes } of TEST_LEFTOVERS) {
    const full = path.join(ROOT, dir)
    if (!existsSync(full)) continue
    for (const entry of readdirSync(full)) {
      if (!prefixes.some(p => entry.startsWith(p))) continue
      found++
      if (remove) {
        try {
          unlinkSync(path.join(full, entry))
          removed.push(`${dir}/${entry}`)
        } catch { /* another process may have taken it; not our problem */ }
      }
    }
  }
  return {
    name: 'test-leftovers',
    value: found,
    lowerIsBetter: true,
    detail: removed.length ? `removed ${removed.length}` : found ? `${found} present` : 'none',
    removed,
  }
}

/** The repository must not contain a copy of itself. */
function checkRepoIntegrity() {
  let gitlinks = []
  try {
    gitlinks = git('ls-files', '-s').split('\n').filter(l => l.startsWith('160000')).map(l => l.split('\t')[1])
  } catch { /* not a git checkout; nothing to check */ }
  const explained = existsSync(path.join(ROOT, '.gitmodules'))
  const unexplained = explained ? [] : gitlinks
  return {
    name: 'unexplained-gitlinks',
    value: unexplained.length,
    lowerIsBetter: true,
    detail: unexplained.length ? unexplained.join(', ') : 'none',
  }
}

/** Exports nothing outside their own file and tests can reach. */
function checkUnreachable() {
  try {
    const out = execFileSync('node', ['scripts/find-unreachable.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120_000,
    })
    const m = out.match(/TESTED BUT NOT USED IN PRODUCTION CODE \((\d+)\)/)
    return {
      name: 'tested-but-unreachable',
      value: m ? Number(m[1]) : -1,
      lowerIsBetter: true,
      detail: m ? `${m[1]} exports` : 'could not parse the report',
    }
  } catch (err) {
    return { name: 'tested-but-unreachable', value: -1, lowerIsBetter: true, detail: `check failed: ${err.message}` }
  }
}

/**
 * Can the memory store still accept something new?
 *
 * This is the check that would have caught the worst bug found so far: pinned
 * installed knowledge exceeding capacity meant every new memory was evicted on
 * creation, and the agent could not learn. It is measured by actually storing
 * something and looking for it, because that is the only question that matters
 * and the only one a count of items cannot answer.
 */
async function checkMemoryAcceptsNew() {
  try {
    const { LongTermMemory } = await import(path.join(ROOT, 'dist/models && skills/core/long-term-memory.js'))
    const mem = new LongTermMemory({ capacity: 5 })
    for (let i = 0; i < 20; i++) mem.remember(`installed knowledge ${i}`, { pinned: true })
    const id = mem.remember('a newly learned thing', { importance: 0.9 }).id
    const survived = Boolean(mem.get(id))
    return {
      name: 'memory-accepts-new',
      value: survived ? 1 : 0,
      lowerIsBetter: false,
      detail: survived ? 'yes' : 'NO -- new memories are being discarded on creation',
    }
  } catch (err) {
    return { name: 'memory-accepts-new', value: -1, lowerIsBetter: false, detail: `check failed: ${err.message}` }
  }
}

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8'))
  } catch {
    return {}
  }
}

function save(file, data) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

/** A number that moved the wrong way since the baseline. */
function regressed(check, baseline) {
  const before = baseline[check.name]?.value
  if (typeof before !== 'number' || check.value < 0) return false
  return check.lowerIsBetter ? check.value > before : check.value < before
}

async function cycle() {
  const baseline = loadBaseline()
  const checks = [
    checkTestLeftovers({ remove: true }),
    checkRepoIntegrity(),
    checkUnreachable(),
    await checkMemoryAcceptsNew(),
  ]

  const regressions = checks.filter(c => regressed(c, baseline))
  for (const c of checks) {
    const mark = regressions.includes(c) ? 'REGRESSED' : 'ok'
    console.log(`[optimize] ${mark.padEnd(10)} ${c.name.padEnd(24)} ${c.detail}`)
  }

  // The baseline only ever moves in the improving direction, so a regression
  // stays visible until it is actually fixed rather than quietly becoming the
  // new normal on the next cycle -- which is how a ratchet turns into a slide.
  const next = { ...baseline }
  for (const c of checks) {
    if (c.value < 0) continue
    const before = next[c.name]?.value
    const better = typeof before !== 'number' || (c.lowerIsBetter ? c.value <= before : c.value >= before)
    if (better) next[c.name] = { value: c.value, at: new Date().toISOString() }
  }
  save(BASELINE, next)
  save(REPORT, { at: new Date().toISOString(), checks, regressions: regressions.map(r => r.name) })

  if (regressions.length > 0) {
    console.log(`[optimize] ${regressions.length} regression(s) since the best measurement. Details in config/optimization-report.json`)
  }
  return regressions.length
}

const once = process.argv.includes('--once')
await cycle()
if (!once) {
  setInterval(() => {
    cycle().catch(err => console.error('[optimize] cycle failed:', err?.message ?? err))
  }, CYCLE_MS)
  console.log(`[optimize] watching, next check in ${Math.round(CYCLE_MS / 60000)} minutes`)
}
