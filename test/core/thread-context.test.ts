/**
 * Short-term context: freezing the mesh's activity when a turn stops and
 * thawing it when the conversation returns.
 *
 * What these protect: a thaw puts the neurons back exactly; it never rolls
 * back what the mesh has learned in the meantime (the one mesh is shared by
 * every conversation); conversations do not leak into each other; a frozen
 * state fades; and a conversation resumed after a distraction behaves exactly
 * like one that was never interrupted.
 */

import { describe, it, expect } from 'vitest'
import { HyperDimensionalEngine, type NetworkStateSnapshot } from '../../models && skills/core/onebrain.js'
import { ThreadContext, activityOf, freezeActivity, thawActivity } from '../../models && skills/core/thread-context.js'

const N = 24
const D = 8
const engine = () => new HyperDimensionalEngine({ neuronCount: N, dimensions: D })
const turn = (e: HyperDimensionalEngine, level: number, learn = false) =>
  e.process(new Array(D).fill(level), undefined, new Set([0, 1]), undefined, { learn })

describe('freezing and thawing activity', () => {
  it('puts the neurons back exactly as they were', () => {
    const e = engine()
    const ctx = new ThreadContext()
    turn(e, 0.9)
    const atStop = e.captureNetworkState()
    ctx.freeze('a', e)

    turn(e, -0.7)            // something else happens to the mesh
    expect(e.captureNetworkState().states).not.toBe(atStop.states)

    expect(ctx.thaw('a', e).thawed).toBe(true)
    const back = e.captureNetworkState()
    expect(back.states).toBe(atStop.states)
    expect(back.energies).toBe(atStop.energies)
    expect(back.wavePoolRe).toBe(atStop.wavePoolRe)
  })

  it('keeps what the mesh learned in between, unlike restoring a whole snapshot', () => {
    const e = engine()
    const ctx = new ThreadContext()
    turn(e, 0.9)
    const whole = e.captureNetworkState()
    ctx.freeze('a', e)

    for (let i = 0; i < 5; i++) turn(e, 0.6, true)     // the mesh learns while the conversation is away
    const learned = e.captureNetworkState()
    expect(learned.connDiag).not.toBe(whole.connDiag)

    ctx.thaw('a', e)
    const afterThaw = e.captureNetworkState()
    expect(afterThaw.connDiag).toBe(learned.connDiag)  // learning kept
    expect(afterThaw.bias).toBe(learned.bias)
    expect(afterThaw.states).toBe(whole.states)        // activity back

    // The control: a whole-snapshot restore is the thing that would have erased it.
    e.restoreNetworkState(whole)
    expect(e.captureNetworkState().connDiag).toBe(whole.connDiag)
    expect(e.captureNetworkState().connDiag).not.toBe(learned.connDiag)
  })

  it('keeps conversations apart', () => {
    const e = engine()
    const ctx = new ThreadContext()
    turn(e, 0.9)
    const stateA = e.captureNetworkState().states
    ctx.freeze('a', e)
    turn(e, -0.8)
    const stateB = e.captureNetworkState().states
    ctx.freeze('b', e)
    expect(stateA).not.toBe(stateB)

    ctx.thaw('a', e)
    expect(e.captureNetworkState().states).toBe(stateA)
    ctx.thaw('b', e)
    expect(e.captureNetworkState().states).toBe(stateB)
    ctx.thaw('a', e)
    expect(e.captureNetworkState().states).toBe(stateA)
  })

  it('behaves exactly like a conversation that was never interrupted', () => {
    // Two copies of one mesh. One goes straight on with the next message; the
    // other is interrupted by an unrelated conversation, then thawed.
    const start = engine().captureNetworkState()
    const straight = engine()
    const interrupted = engine()
    straight.restoreNetworkState(start)
    interrupted.restoreNetworkState(start)

    turn(straight, 0.9)
    turn(interrupted, 0.9)
    const ctx = new ThreadContext()
    ctx.freeze('a', interrupted)

    turn(interrupted, -0.9)            // the other conversation (read-only, so the weights stay identical)
    turn(interrupted, 0.2)
    ctx.thaw('a', interrupted)

    turn(straight, 0.5)
    turn(interrupted, 0.5)
    const a = straight.captureNetworkState()
    const b = interrupted.captureNetworkState()
    expect(b.states).toBe(a.states)
    expect(b.energies).toBe(a.energies)
    expect(b.wavePoolRe).toBe(a.wavePoolRe)
  })
})

describe('with the wave layer on (the live configuration)', () => {
  const waveConfig = { neuronCount: 24, dimensions: 8, hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1, waveGain: 0.1, connectionBias: true, propagationSteps: 16 }

  it('a resumed conversation matches one that was never interrupted, down to the wave phase', () => {
    // Before wavePhase was frozen too, the thawed mesh ran at a different wave phase and the
    // two diverged by ~1e-2 even though every neuron state had been put back.
    const start = new HyperDimensionalEngine(waveConfig as never).captureNetworkState()
    const straight = new HyperDimensionalEngine(waveConfig as never)
    const interrupted = new HyperDimensionalEngine(waveConfig as never)
    straight.restoreNetworkState(start)
    interrupted.restoreNetworkState(start)

    turn(straight, 0.9)
    turn(interrupted, 0.9)
    const ctx = new ThreadContext()
    ctx.freeze('a', interrupted)
    turn(interrupted, -0.9)
    turn(interrupted, 0.2)
    ctx.thaw('a', interrupted)

    turn(straight, 0.5)
    turn(interrupted, 0.5)
    const a = straight.captureNetworkState()
    const b = interrupted.captureNetworkState()
    expect(b.states).toBe(a.states)
    expect(b.wavePhase).toBe(a.wavePhase)
    expect(b.wavePoolRe).toBe(a.wavePoolRe)
  })
})

describe('what is frozen', () => {
  it('is only the activity, never the learned network', () => {
    const e = engine()
    turn(e, 0.9)
    const full = e.captureNetworkState()
    const kept = Object.keys(activityOf(full))
    for (const learned of ['bias', 'connDiag', 'connShift', 'modWeight', 'addWeight', 'waveFreq', 'connWaveGain', 'connBias', 'senderGain']) {
      expect(kept).not.toContain(learned)
    }
    for (const live of ['shape', 'states', 'energies', 'wavePhase']) expect(kept).toContain(live)
  })

  it('is a lot smaller than the whole network', () => {
    const e = new HyperDimensionalEngine({ neuronCount: 64, dimensions: 32 })
    turn(e, 0.9)
    const size = (o: object) => JSON.stringify(o).length
    expect(size(freezeActivity(e))).toBeLessThan(size(e.captureNetworkState()) * 0.5)
  })
})

describe('short term fades and is bounded', () => {
  it('is dropped once it is older than the limit', () => {
    let clock = 1_000
    const ctx = new ThreadContext({ ttlMs: 60_000, now: () => clock })
    const e = engine()
    turn(e, 0.9)
    ctx.freeze('a', e)

    clock += 59_000
    expect(ctx.has('a')).toBe(true)
    clock += 2_000
    expect(ctx.has('a')).toBe(false)
    expect(ctx.thaw('a', e)).toEqual({ thawed: false, reason: 'expired' })
    expect(ctx.size).toBe(0)
  })

  it('reports the age of what it thawed', () => {
    let clock = 0
    const ctx = new ThreadContext({ now: () => clock })
    const e = engine()
    ctx.freeze('a', e)
    clock = 4_000
    expect(ctx.thaw('a', e)).toEqual({ thawed: true, ageMs: 4_000 })
  })

  it('holds a few conversations and drops the one untouched longest', () => {
    const ctx = new ThreadContext({ maxThreads: 2 })
    const e = engine()
    ctx.freeze('a', e)
    ctx.freeze('b', e)
    ctx.freeze('a', e)           // touching a makes b the oldest
    ctx.freeze('c', e)
    expect(ctx.has('a')).toBe(true)
    expect(ctx.has('b')).toBe(false)
    expect(ctx.has('c')).toBe(true)
    expect(ctx.size).toBe(2)
  })

  it('says there is nothing when there is nothing', () => {
    expect(new ThreadContext().thaw('nobody', engine())).toEqual({ thawed: false, reason: 'none' })
  })

  it('can forget a conversation', () => {
    const ctx = new ThreadContext()
    const e = engine()
    ctx.freeze('a', e)
    ctx.forget('a')
    expect(ctx.has('a')).toBe(false)
  })
})

describe('when the mesh has changed shape', () => {
  it('refuses to thaw and changes nothing', () => {
    const e = engine()
    const ctx = new ThreadContext()
    turn(e, 0.9)
    ctx.freeze('a', e)
    e.addNeurons(2)                         // a skill grafted in since
    turn(e, -0.4)
    const before = e.captureNetworkState()

    expect(ctx.thaw('a', e)).toEqual({ thawed: false, reason: 'mismatch' })
    const after = e.captureNetworkState()
    expect(after.states).toBe(before.states)
    expect(after.connDiag).toBe(before.connDiag)
  })

  it('thawActivity returns false on a mismatch', () => {
    const small = engine()
    const bigger = new HyperDimensionalEngine({ neuronCount: N + 4, dimensions: D })
    expect(thawActivity(bigger, freezeActivity(small))).toBe(false)
  })
})

describe('activity captured by a run that just stopped', () => {
  it('can be held straight from the snapshot the stop already took', () => {
    const e = engine()
    turn(e, 0.9)
    const snapshot: NetworkStateSnapshot = e.captureNetworkState()   // what zip-halt captures at every ending
    const ctx = new ThreadContext()
    ctx.hold('a', activityOf(snapshot))
    turn(e, -0.5)
    expect(ctx.thaw('a', e).thawed).toBe(true)
    expect(e.captureNetworkState().states).toBe(snapshot.states)
  })
})
