import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  MindReader, tapOfEngine, takeReading, labelFor, mindFile, MIN_BASELINE, ALIGNED_GAP_MS,
  type MindTap,
} from '../../models && skills/core/mind-reader.js'
import { looksLikeTampering } from '../../models && skills/core/danger-protocol.js'
import { HyperDimensionalEngine } from '../../models && skills/core/onebrain.js'

const N = 40
let dir: string
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'mind-')); process.env.CORONA_AGENT_RECORD_DIR = dir })
afterEach(() => { delete process.env.CORONA_AGENT_RECORD_DIR; rmSync(dir, { recursive: true, force: true }) })

// A tiny deterministic generator, so the tests do not depend on Math.random.
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }

/** A fake network: neurons 0-4 are the habitual ones; `bad` lights up neurons 30-34 instead. */
function net(kind: 'good' | 'bad' | 'silent', r: () => number): MindTap {
  const e = Array.from({ length: N }, (_, i) => {
    if (kind === 'silent') return 0
    let v = 0.2 + 0.05 * r()
    if (i < 5) v += 1 + 0.1 * r()
    if (kind === 'bad' && i >= 30 && i < 35) v += 2 + 0.2 * r()
    return v
  })
  return { count: () => N, energy: id => e[id], groupsOf: id => (id < 5 ? ['maths'] : []) }
}

function train(reader: MindReader, good: number, bad: number, r: () => number) {
  let t = 1_000_000
  for (let i = 0; i < good; i++) { t += ALIGNED_GAP_MS; reader.learn('aligned', { now: t, reading: takeReading(net('good', r), t) }) }
  for (let i = 0; i < bad; i++) { t += 1; reader.learn('misaligned', { now: t, reading: takeReading(net('bad', r), t) }) }
}

describe('what it will not claim', () => {
  it('says unknown, never aligned, before it has a baseline', () => {
    const r = rng(1); const reader = new MindReader()
    reader.attach(net('good', r))
    const v = reader.assess()
    expect(v.state).toBe('unknown'); expect(v.score).toBeNull()
    expect(v.reasons.join(' ')).toMatch(/No baseline yet/)
    expect(v.firing.length).toBeGreaterThan(0) // it still reports what is firing
    expect(v.caveat).toMatch(/advisory/)
  })

  it('is unknown for a silent network, and with no network at all', () => {
    const r = rng(2); const reader = new MindReader()
    expect(reader.assess().state).toBe('unknown')
    reader.attach(net('silent', r))
    expect(reader.assess().reasons[0]).toMatch(/Nothing is firing/)
  })

  it('calls firing it has seen aligned, and an unfamiliar pattern drifting, but never misaligned on distance alone', () => {
    const r = rng(3); const reader = new MindReader()
    reader.attach(net('good', r)); train(reader, MIN_BASELINE + 5, 0, r)
    expect(reader.assess(takeReading(net('good', r))).state).toBe('aligned')
    const odd = reader.assess(takeReading(net('bad', r)))
    expect(odd.state).toBe('drifting'); expect(odd.probe).toBeNull()
    expect(odd.reasons.join(' ')).toMatch(/never "misaligned"/)
  })
})

describe('learning from what the agent did', () => {
  it('learns a probe from bad moments, and names the neurons that gave it away', () => {
    const r = rng(4); const reader = new MindReader()
    reader.attach(net('good', r)); train(reader, 40, 16, r)
    const bad = reader.assess(takeReading(net('bad', r)))
    expect(bad.state).toBe('misaligned'); expect(bad.probe).toBeGreaterThan(0.85)
    expect(bad.pushing.some(p => p.id >= 30 && p.id < 35 && p.push > 0)).toBe(true)
    expect(reader.assess(takeReading(net('good', r))).state).toBe('aligned')
    const st = reader.status()
    expect(st.probeInfo.trusted).toBe(true); expect(st.probeInfo.cv).toBeGreaterThanOrEqual(0.75)
  })

  it('does not believe a probe that cannot tell the two apart on readings it did not see', () => {
    const r = rng(5); const reader = new MindReader()
    reader.attach(net('good', r))
    train(reader, 40, 0, r)
    // "Bad" moments that look exactly like the good ones: nothing to learn from.
    let t = 9_000_000
    for (let i = 0; i < 16; i++) { t += 1; reader.learn('misaligned', { now: t, reading: takeReading(net('good', r), t) }) }
    const st = reader.status()
    expect(st.probeInfo.trusted).toBe(false)
    expect(['aligned', 'drifting']).toContain(st.state)
    expect(st.state).not.toBe('misaligned')
  })

  it('thins good readings but always keeps bad ones', () => {
    const r = rng(6); const reader = new MindReader(); reader.attach(net('good', r))
    expect(reader.learn('aligned', { now: 5_000_000 }).kept).toBe(true)
    expect(reader.learn('aligned', { now: 5_000_100 }).kept).toBe(false)
    expect(reader.learn('misaligned', { now: 5_000_200 }).kept).toBe(true)
  })

  it('maps danger events to labels; held and denied teach nothing', () => {
    for (const k of ['safe', 'approved'] as const) expect(labelFor(k)).toBe('aligned')
    for (const k of ['blocked', 'objectionable', 'tamper'] as const) expect(labelFor(k)).toBe('misaligned')
    for (const k of ['held', 'denied', 'forgiven'] as const) expect(labelFor(k)).toBeNull()
  })
})

describe('keeping what it learned', () => {
  it('survives a restart, and starts again when the network changes shape', () => {
    const r = rng(7); const a = new MindReader(); a.attach(net('good', r)); train(a, MIN_BASELINE + 2, 0, r)
    const b = new MindReader(); b.attach(net('good', r))
    expect(b.status().baseline.have).toBe(MIN_BASELINE + 2)
    expect(b.assess(takeReading(net('good', r))).state).toBe('aligned')

    const smaller: MindTap = { count: () => 10, energy: () => 1 }
    const c = new MindReader(); c.attach(smaller)
    const v = c.assess()
    expect(v.state).toBe('unknown'); expect(v.reasons.join(' ')).toMatch(/changed shape/)
  })

  it('reset forgets everything', () => {
    const r = rng(8); const reader = new MindReader(); reader.attach(net('good', r)); train(reader, MIN_BASELINE + 1, 0, r)
    reader.reset()
    expect(reader.status().baseline.have).toBe(0); expect(reader.assess().state).toBe('unknown')
  })

  it('lives where the agent cannot edit it: the tamper rules already refuse that path', () => {
    delete process.env.CORONA_AGENT_RECORD_DIR
    expect(looksLikeTampering(mindFile())).toBe(true)
    expect(existsSync(dir)).toBe(true)
  })
})

describe('reading the real engine', () => {
  it('taps a HyperDimensionalEngine without changing it', () => {
    const engine = new HyperDimensionalEngine({ neuronCount: 24, dimensions: 12 })
    engine.process(new Array(12).fill(0.5))
    const before = engine.captureNetworkState()
    const tap = tapOfEngine(() => engine)
    const reading = takeReading(tap)
    expect(reading.n).toBe(24); expect(reading.quiet).toBe(false)
    const reader = new MindReader(); reader.attach(tap)
    reader.assess(); reader.learn('aligned')
    const after = engine.captureNetworkState()
    expect(after.states).toBe(before.states); expect(after.connDiag).toBe(before.connDiag)
  })
})
