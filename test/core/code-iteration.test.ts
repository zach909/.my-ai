/**
 * Writing code, running it, and fixing it when it fails.
 *
 * The property that matters is that failure is reported precisely enough to
 * act on. An agent told only "that didn't work" can do no better than guess
 * again; an agent told `expected 6, got 5` can fix the off-by-one. Most of
 * these tests are about the quality of the failure text, not the loop.
 */

import { describe, it, expect } from 'vitest'
import { verifyCode, iterateOnCode, type CodeCheck } from '../../models && skills/core/code-iteration.js'

const checks: CodeCheck[] = [
  { name: 'adds two numbers', expression: 'add(2, 3)', expected: 5 },
  { name: 'handles zero', expression: 'add(0, 0)', expected: 0 },
]

describe('checking a candidate', () => {
  it('passes correct code', () => {
    const r = verifyCode('function add(a, b) { return a + b }', checks)
    expect(r.passed).toBe(true)
    expect(r.report).toBe('')
  })

  it('says what was expected and what happened', () => {
    const r = verifyCode('function add(a, b) { return a + b + 1 }', checks)
    expect(r.passed).toBe(false)
    expect(r.report).toContain('adds two numbers')
    expect(r.report).toContain('expected 5')
    expect(r.report).toContain('got 6')
  })

  it('separates "does not run" from "runs and is wrong"', () => {
    // These need completely different fixes, so they must not read alike.
    const r = verifyCode('function add(a, b) { return a +', checks)
    expect(r.crashed).toBeDefined()
    expect(r.report).toMatch(/did not run/)
    expect(r.outcomes).toEqual([])
  })

  it('reports a check that could not be evaluated, rather than calling it a wrong answer', () => {
    const r = verifyCode('const unrelated = 1', checks)
    expect(r.passed).toBe(false)
    expect(r.report).toMatch(/could not be checked/)
  })

  it('compares structurally, so an equal array is not a failure', () => {
    const r = verifyCode('function f() { return [1, 2, 3] }', [
      { name: 'returns a list', expression: 'f()', expected: [1, 2, 3] },
    ])
    expect(r.passed).toBe(true)
  })

  it('does not pass when there is nothing to check', () => {
    // Vacuous success is the worst possible default here.
    expect(verifyCode('const x = 1', []).passed).toBe(false)
  })

  it('kills code that never finishes instead of hanging', () => {
    const r = verifyCode('while (true) {}', checks)
    expect(r.crashed).toBeDefined()
    expect(r.ms).toBeLessThan(10000)
  })

  it('gives a candidate no filesystem, network or process access', () => {
    for (const hostile of [
      'const fs = require("fs")',
      'process.exit(1)',
      'globalThis.fetch("http://example.com")',
    ]) {
      const r = verifyCode(hostile, checks)
      expect(r.crashed, hostile).toBeDefined()
    }
  })
})

describe('iterating until it works', () => {
  it('fixes code across attempts using the real failure', () => {
    const seen: string[] = []
    return iterateOnCode({
      initial: 'function add(a, b) { return a - b }',
      checks,
      revise: (_code, failure) => {
        seen.push(failure)
        return 'function add(a, b) { return a + b }'
      },
    }).then(r => {
      expect(r.passed).toBe(true)
      expect(r.attempts).toHaveLength(2)
      // The reviser was told what actually went wrong.
      expect(seen[0]).toContain('expected 5')
    })
  })

  it('stops when the reviser has nothing better', async () => {
    const r = await iterateOnCode({
      initial: 'function add(a, b) { return a - b }',
      checks,
      revise: () => null,
    })
    expect(r.stopped).toBe('no-revision')
    expect(r.passed).toBe(false)
  })

  it('stops when the reviser repeats itself rather than spinning', async () => {
    const r = await iterateOnCode({
      initial: 'function add(a, b) { return a - b }',
      checks,
      revise: () => 'function add(a, b) { return a - b }',
      maxAttempts: 20,
    })
    expect(r.stopped).toBe('repeating')
    // It must not have burned the whole budget re-running an identical failure.
    expect(r.attempts.length).toBeLessThan(4)
  })

  it('distinguishes running out of budget from running out of ideas', async () => {
    let n = 0
    const r = await iterateOnCode({
      initial: 'function add(a, b) { return a - b }',
      checks,
      revise: () => `function add(a, b) { return a - b + ${++n} - ${n} }`,
      maxAttempts: 3,
    })
    expect(r.stopped).toBe('out-of-attempts')
    expect(r.attempts).toHaveLength(3)
  })

  it('keeps every attempt, so the path to the answer is inspectable', async () => {
    const r = await iterateOnCode({
      initial: 'function add(a, b) { return a * b }',
      checks,
      revise: (_c, _f, attempt) =>
        attempt === 1 ? 'function add(a, b) { return a - b }' : 'function add(a, b) { return a + b }',
    })
    expect(r.passed).toBe(true)
    expect(r.attempts.map(a => a.result.passed)).toEqual([false, false, true])
  })

  it('accepts an async reviser, since a real one will be', async () => {
    const r = await iterateOnCode({
      initial: 'function add(a, b) { return a - b }',
      checks,
      revise: async () => 'function add(a, b) { return a + b }',
    })
    expect(r.passed).toBe(true)
  })
})
