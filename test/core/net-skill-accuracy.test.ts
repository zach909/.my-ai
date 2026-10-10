/**
 * Switching net skills on and off from how well they have predicted.
 *
 * What these protect: a skill is never switched on a handful of early results,
 * a switched-off skill can still earn its way back, the owner's override beats
 * the score, and a turn that says nothing about the outcome says nothing about
 * the skill.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SkillAccuracyLedger } from '../../models && skills/core/net-skill-accuracy.js'
import { NetSkillRouter } from '../../models && skills/core/net-skill-router.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'corona-accuracy-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function misses(ledger: SkillAccuracyLedger, id: string, n: number): Array<'on' | 'off' | null> {
  return Array.from({ length: n }, () => ledger.record(id, false))
}

describe('the ledger', () => {
  it('waits for enough results before a score can switch anything', () => {
    const ledger = new SkillAccuracyLedger()
    const flips = misses(ledger, 'a', 19)

    expect(flips.every(f => f === null)).toBe(true)
    expect(ledger.isEnabled('a')).toBe(true)
    expect(ledger.status('a').reason).toMatch(/Still learning: 19 of 20/)
  })

  it('switches a region off once it has been wrong enough, and says why', () => {
    const ledger = new SkillAccuracyLedger()
    const flips = misses(ledger, 'a', 20)

    expect(flips[19]).toBe('off')
    expect(ledger.isEnabled('a')).toBe(false)
    expect(ledger.status('a').reason).toMatch(/Switched off/)
  })

  it('does not switch off a region that is usually right', () => {
    const ledger = new SkillAccuracyLedger()
    for (let i = 0; i < 60; i++) ledger.record('good', i % 3 !== 0)
    expect(ledger.isEnabled('good')).toBe(true)
  })

  it('brings a region back only after it clears the higher bar', () => {
    const ledger = new SkillAccuracyLedger()
    misses(ledger, 'a', 20)
    expect(ledger.isEnabled('a')).toBe(false)

    // One hit in three keeps accuracy around a third, above the 0.15 that
    // switched it off but the test of 0.3 is the one that matters: staying
    // between the two thresholds must not flip it.
    let flippedOn = false
    let sawInBetween = false
    for (let i = 0; i < 80 && !flippedOn; i++) {
      const flipped = ledger.record('a', true)
      const accuracy = ledger.get('a')!.accuracy
      if (accuracy > 0.15 && accuracy < 0.3) {
        sawInBetween = true
        expect(ledger.isEnabled('a')).toBe(false)
      }
      flippedOn = flipped === 'on'
    }
    expect(sawInBetween).toBe(true)
    expect(flippedOn).toBe(true)
    expect(ledger.isEnabled('a')).toBe(true)
  })

  it('lets the owner override the score either way', () => {
    const ledger = new SkillAccuracyLedger()
    misses(ledger, 'bad', 20)
    ledger.setSwitch('bad', 'on')
    expect(ledger.isEnabled('bad')).toBe(true)
    expect(ledger.status('bad').reason).toMatch(/Kept on by you/)

    for (let i = 0; i < 30; i++) ledger.record('good', true)
    ledger.setSwitch('good', 'off')
    expect(ledger.isEnabled('good')).toBe(false)

    ledger.setSwitch('bad', 'auto')
    expect(ledger.isEnabled('bad')).toBe(false)
  })

  it('keeps what it learned across a restart', () => {
    const file = path.join(dir, 'ledger.json')
    const first = new SkillAccuracyLedger()
    first.persistTo(file)
    misses(first, 'a', 20)
    first.setSwitch('b', 'off')

    const second = new SkillAccuracyLedger()
    second.persistTo(file)

    expect(second.isEnabled('a')).toBe(false)
    expect(second.get('a')?.trials).toBe(20)
    expect(second.isEnabled('b')).toBe(false)
  })

  it('starts over, rather than failing, on a damaged file', () => {
    const file = path.join(dir, 'ledger.json')
    const ledger = new SkillAccuracyLedger()
    ledger.persistTo(file)
    ledger.record('a', true)
    writeFileSync(file, '{ not json')

    const again = new SkillAccuracyLedger()
    expect(() => again.persistTo(file)).not.toThrow()
    expect(again.isEnabled('a')).toBe(true)
  })
})

describe('the router', () => {
  function build(ledger = new SkillAccuracyLedger()) {
    const router = new NetSkillRouter(2, 64, ledger)
    router.register({ id: 'terminal', name: 'Terminal', meaning: 'run shell command terminal' })
    router.register({ id: 'files', name: 'Files', meaning: 'run shell command script file' })
    router.register({ id: 'calendar', name: 'Calendar', meaning: 'meeting schedule event' })
    return router
  }
  const INPUT = 'run a shell command'

  it('skips a switched-off region and lets the next best take its place', () => {
    const router = build()
    expect(router.select(INPUT).ids).toEqual(expect.arrayContaining(['terminal']))

    router.getLedger().setSwitch('terminal', 'off')
    const ids = router.select(INPUT).ids

    expect(ids).not.toContain('terminal')
    expect(ids).toContain('files')
  })

  it('records hits and misses against what actually handled the input', () => {
    const router = build()

    const result = router.judge(INPUT, ['terminal'])

    expect(result.find(r => r.id === 'terminal')?.hit).toBe(true)
    expect(result.find(r => r.id === 'files')?.hit).toBe(false)
    expect(router.getLedger().get('terminal')?.hits).toBe(1)
    expect(router.getLedger().get('files')?.hits).toBe(0)
  })

  it('records nothing when the outcome is unknown', () => {
    const router = build()
    expect(router.judge(INPUT, [])).toEqual([])
    expect(router.getLedger().all()).toEqual([])
  })

  it('records nothing when the outcome is in a vocabulary it does not know', () => {
    const router = build()
    expect(router.judge(INPUT, ['some-other-system'])).toEqual([])
    expect(router.getLedger().all()).toEqual([])
  })

  it('does not judge regions that have no outcome signal', () => {
    const router = build()
    const result = router.judge(INPUT, ['terminal'], id => id === 'terminal')
    expect(result.map(r => r.id)).toEqual(['terminal'])
    expect(router.getLedger().get('files')).toBeUndefined()
  })

  it('keeps judging a switched-off region, so it can recover', () => {
    const router = build()
    for (let i = 0; i < 20; i++) router.judge(INPUT, ['files'])
    expect(router.getLedger().isEnabled('terminal')).toBe(false)
    expect(router.select(INPUT).ids).not.toContain('terminal')

    let comeBack = false
    for (let i = 0; i < 80 && !comeBack; i++) {
      comeBack = router.judge(INPUT, ['terminal']).some(r => r.flipped === 'on')
    }

    expect(comeBack).toBe(true)
    expect(router.select(INPUT).ids).toContain('terminal')
  })

  it('agrees across routers that share a ledger', () => {
    const ledger = new SkillAccuracyLedger()
    const a = build(ledger)
    const b = build(ledger)

    ledger.setSwitch('terminal', 'off')

    expect(a.select(INPUT).ids).not.toContain('terminal')
    expect(b.select(INPUT).ids).not.toContain('terminal')
  })

  it('lists each region with its record and whether it is running', () => {
    const router = build()
    router.getLedger().setSwitch('calendar', 'off')

    const calendar = router.getAccuracy().find(s => s.id === 'calendar')

    expect(calendar).toMatchObject({ name: 'Calendar', enabled: false, mode: 'off' })
  })
})
