/**
 * The agent that watches for things getting worse.
 *
 * Its value is entirely in whether it actually fires. A monitor that reports
 * green because its check silently failed is worse than no monitor, because it
 * buys confidence it has not earned. So these tests plant each defect it is
 * meant to catch and assert it catches them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const EXT_DIR = path.join(ROOT, 'extension-builder', 'extensions')
const PROBE = 'good_bits_test_VITEST_PROBE.ext.json'

function runAgent(): string {
  return execFileSync('node', ['scripts/optimize-agent.mjs', '--once'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  })
}

beforeEach(() => {
  mkdirSync(EXT_DIR, { recursive: true })
})
afterEach(() => {
  rmSync(path.join(EXT_DIR, PROBE), { force: true })
})

describe('catching what it is meant to catch', () => {
  it('finds and removes a test leftover in the live extensions directory', () => {
    // 147 of these had accumulated over six days, each loaded as a real
    // extension for the rest of that machine's life.
    writeFileSync(path.join(EXT_DIR, PROBE), '{"neurons":[]}')
    const out = runAgent()
    expect(out).toMatch(/test-leftovers\s+removed \d+/)
    expect(existsSync(path.join(EXT_DIR, PROBE))).toBe(false)
  }, 200_000)

  it('checks that the memory store can still accept something new', () => {
    // The worst bug found so far: pinned knowledge exceeding capacity meant
    // every new memory was discarded on creation and the agent could not learn.
    expect(runAgent()).toMatch(/memory-accepts-new\s+yes/)
  }, 200_000)

  it('checks that state writes survive a power cut', () => {
    // A plain writeFileSync truncates before it writes; losing power in
    // between made a published store item vanish from the catalogue entirely.
    expect(runAgent()).toMatch(/non-atomic-state-writes\s+none in the watched files/)
  }, 200_000)

  it('checks the repository does not contain itself', () => {
    expect(runAgent()).toMatch(/unexplained-gitlinks\s+none/)
  }, 200_000)

  it('counts unreachable exports rather than failing to look', () => {
    // -1 is how each check reports "I could not run", and a monitor that
    // cannot run must not read as a pass.
    const out = runAgent()
    expect(out).toMatch(/tested-but-unreachable\s+\d+ exports/)
    expect(out).not.toMatch(/tested-but-unreachable\s+check failed/)
  }, 200_000)
})

describe('the baseline is a ratchet', () => {
  it('records a report each run', () => {
    runAgent()
    const report = JSON.parse(readFileSync(path.join(ROOT, 'config', 'optimization-report.json'), 'utf8'))
    expect(report.checks.map((c: { name: string }) => c.name).sort()).toEqual([
      'memory-accepts-new',
      'non-atomic-state-writes',
      'test-leftovers',
      'tested-but-unreachable',
      'unexplained-gitlinks',
    ])
    expect(typeof report.at).toBe('string')
  }, 200_000)

  it('only moves the baseline in the improving direction', () => {
    const file = path.join(ROOT, 'config', 'optimization-baseline.json')
    runAgent()
    const before = JSON.parse(readFileSync(file, 'utf8'))

    // Plant a regression: more leftovers than the best ever recorded.
    writeFileSync(path.join(EXT_DIR, PROBE), '{"neurons":[]}')
    runAgent()
    const after = JSON.parse(readFileSync(file, 'utf8'))

    // A regression must NOT become the new normal on the next cycle -- that is
    // how a ratchet turns into a slide.
    expect(after['test-leftovers'].value).toBeLessThanOrEqual(before['test-leftovers'].value)
  }, 300_000)
})

describe('what it will not do on its own', () => {
  it('has no code-editing or git-writing powers', () => {
    const source = readFileSync(path.join(ROOT, 'scripts/optimize-agent.mjs'), 'utf8')
    // It may READ git state; it must never write it, and must never rewrite
    // source files. An autonomous process editing the program unattended is a
    // far worse failure than one that files an accurate complaint.
    for (const forbidden of ['git(\'commit\'', 'git(\'push\'', 'git(\'reset\'', 'git(\'checkout\'']) {
      expect(source).not.toContain(forbidden)
    }
    // Exactly one deletion CALL SITE, and it is the documented test-leftover
    // sweep. Counting the identifier would also match the import, which is why
    // this looks for the call.
    expect(source.match(/unlinkSync\(/g) ?? []).toHaveLength(1)
    // Nothing else that destroys. mkdirSync({recursive:true}) is fine and is
    // why this checks the destructive calls by name rather than the option.
    expect(source).not.toMatch(/\brmSync\(|\brimraf\b|\brm\s+-rf/)
    expect(source).not.toMatch(/writeFileSync\([^)]*\.(ts|tsx|mjs|js)\b/)
  })
})
