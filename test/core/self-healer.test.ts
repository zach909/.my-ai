/**
 * Section 24 self-healing: detect, repair, fall back to a known-good
 * snapshot, and report anything still broken -- never silently.
 */
import { describe, it, expect } from 'vitest'
import { SelfHealer } from '../../models && skills/core/self-healer.js'

describe('healthReport', () => {
  it('reports each registered component without attempting a repair', async () => {
    const healer = new SelfHealer()
    let checks = 0
    healer.register({ name: 'always-healthy', check: () => { checks++; return true } })
    healer.register({ name: 'always-broken', check: () => false })
    const report = await healer.healthReport()
    expect(report).toEqual({ 'always-healthy': true, 'always-broken': false })
    expect(checks).toBe(1)
  })
})

describe('heal', () => {
  it('leaves a healthy component untouched', async () => {
    const healer = new SelfHealer()
    let repaired = false
    healer.register({ name: 'fine', check: () => true, repair: () => { repaired = true } })
    const report = await healer.heal()
    expect(report.checked).toBe(1)
    expect(report.healthy).toBe(1)
    expect(report.repaired).toBe(0)
    expect(repaired).toBe(false)
    expect(report.results[0]).toMatchObject({ component: 'fine', wasHealthy: true, recovered: true, unrecoverable: false })
  })

  it('repairs an unhealthy component whose repair actually fixes it', async () => {
    const healer = new SelfHealer()
    let fixed = false
    healer.register({
      name: 'fixable',
      check: () => fixed,
      repair: () => { fixed = true },
    })
    const report = await healer.heal()
    expect(report.healthy).toBe(0)
    expect(report.repaired).toBe(1)
    expect(report.unrecoverable).toEqual([])
    expect(report.results[0].recovered).toBe(true)
    expect(report.results[0].actions).toContain('repaired')
  })

  it('tries repair up to maxAttempts before giving up on it', async () => {
    const healer = new SelfHealer()
    let attempts = 0
    healer.register({
      name: 'stubborn',
      check: () => attempts >= 3,
      repair: () => { attempts++ },
      maxAttempts: 3,
    })
    const report = await healer.heal()
    expect(attempts).toBe(3)
    expect(report.repaired).toBe(1)
  })

  it('falls back to a known-good snapshot when repair does not hold', async () => {
    const healer = new SelfHealer()
    let value = 'good'
    healer.register({
      name: 'driftable',
      check: () => value === 'good',
      repair: () => { /* does nothing -- repair alone cannot fix this one */ },
      snapshot: () => value,
      restore: (snap) => { value = snap as string },
    })
    healer.snapshotAll()
    value = 'corrupted'
    const report = await healer.heal()
    expect(report.restored).toBe(1)
    expect(report.repaired).toBe(0)
    expect(value).toBe('good')
    expect(report.results[0].actions).toContain('restored-known-good')
  })

  it('reports a component as unrecoverable when neither repair nor restore fixes it, rather than hiding the failure', async () => {
    const healer = new SelfHealer()
    healer.register({ name: 'hopeless', check: () => false, repair: () => { /* never works */ } })
    const report = await healer.heal()
    expect(report.unrecoverable).toEqual(['hopeless'])
    expect(report.results[0].recovered).toBe(false)
    expect(report.results[0].unrecoverable).toBe(true)
  })

  it('does not throw when a component has no repair or restore at all', async () => {
    const healer = new SelfHealer()
    healer.register({ name: 'bare', check: () => false })
    const report = await healer.heal()
    expect(report.unrecoverable).toEqual(['bare'])
  })

  it('does not crash the whole cycle when a repair function throws', async () => {
    const healer = new SelfHealer()
    healer.register({ name: 'throws', check: () => false, repair: () => { throw new Error('boom') } })
    healer.register({ name: 'fine-after', check: () => true })
    const report = await healer.heal()
    expect(report.checked).toBe(2)
    expect(report.unrecoverable).toEqual(['throws'])
    expect(report.results.find((r) => r.component === 'fine-after')?.wasHealthy).toBe(true)
  })
})

describe('the log', () => {
  it('records every step, never staying silent about a repair', async () => {
    const healer = new SelfHealer()
    healer.register({ name: 'x', check: () => false, repair: () => { /* no-op */ } })
    await healer.heal()
    const log = healer.getLog()
    expect(log.length).toBeGreaterThan(0)
    expect(log.some((l) => l.includes('unhealthy'))).toBe(true)
  })

  it('is readable after the fact, not only at the moment of a heal', async () => {
    const healer = new SelfHealer()
    healer.register({ name: 'x', check: () => true })
    await healer.heal()
    const immediately = healer.getLog()
    const later = healer.getLog()
    expect(later).toEqual(immediately)
  })

  it('can be cleared', () => {
    const healer = new SelfHealer()
    healer.register({ name: 'x', check: () => true, snapshot: () => 1 })
    healer.snapshotAll()
    expect(healer.getLog().length).toBeGreaterThan(0)
    healer.clearLog()
    expect(healer.getLog()).toEqual([])
  })
})

describe('registry management', () => {
  it('lists registered components and lets one be unregistered', () => {
    const healer = new SelfHealer()
    healer.register({ name: 'a', check: () => true })
    healer.register({ name: 'b', check: () => true })
    expect(healer.list().sort()).toEqual(['a', 'b'])
    expect(healer.unregister('a')).toBe(true)
    expect(healer.list()).toEqual(['b'])
    expect(healer.unregister('a')).toBe(false)
  })
})
