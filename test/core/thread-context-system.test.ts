/**
 * Short-term context on the real system: freezeThread() when a turn stops,
 * continueThread() when the conversation is opened again.
 *
 * continueThread tries the frozen state first and falls back to the long-term
 * replay, so these pin: which one is used, that it is the real mesh that comes
 * back, that what the mesh learned in between is not undone, and that a
 * conversation with neither is left alone.
 */

import { describe, it, expect } from 'vitest'
import { ThreadContext } from '../../models && skills/core/thread-context.js'

const history = (text: string) => [{ content: text }]
const LONG = 'we were planning the trip to the lake and the packing list'   // 32+ bytes, so a replay is considered

async function system() {
  const { getNeuroclawSystem } = await import('../../src/index.js')
  const sys = await getNeuroclawSystem()
  const engine = sys.pipeline.ensureBrain()
  return { sys, engine }
}

// continueThread also keeps the long-term replay current in the background, which briefly
// perturbs the mesh (and puts it back). Marking a conversation's replay as already current
// keeps that out of the way when the test is about the frozen state.
function settled(sys: { contextReplay: { set: (id: string, text: string, r: null) => unknown } }, ...threads: string[]) {
  for (const id of threads) sys.contextReplay.set(id, LONG, null)
}

const nudge = (engine: { process: (...a: unknown[]) => unknown }, level: number, learn = false) =>
  engine.process(new Array(64).fill(level), undefined, new Set([0]), undefined, { learn })

describe('a conversation opened again soon after its last turn stopped', () => {
  it('gets its neurons back exactly, from the frozen state', async () => {
    const { sys, engine } = await system()
    sys.threadContext = new ThreadContext()
    settled(sys, 'lake')
    nudge(engine, 0.8)
    const atStop = engine.captureNetworkState()
    expect(await sys.freezeThread('lake')).toBe(true)

    nudge(engine, -0.6)                              // another conversation uses the mesh
    expect(engine.captureNetworkState().states).not.toBe(atStop.states)

    const result = await sys.continueThread('lake', history(LONG))
    expect(result.via).toBe('frozen')
    expect(result.primed).toBe(true)
    expect(typeof result.frozenAgeMs).toBe('number')
    expect(engine.captureNetworkState().states).toBe(atStop.states)
  }, 120_000)

  it('does not undo what the mesh learned while the conversation was away', async () => {
    const { sys, engine } = await system()
    sys.threadContext = new ThreadContext()
    settled(sys, 'lake')
    nudge(engine, 0.8)
    await sys.freezeThread('lake')

    nudge(engine, 0.5, true)                         // learning happens elsewhere
    const learned = engine.captureNetworkState()

    await sys.continueThread('lake', history(LONG))
    expect(engine.captureNetworkState().connDiag).toBe(learned.connDiag)
  }, 120_000)

  it('keeps two conversations apart', async () => {
    const { sys, engine } = await system()
    sys.threadContext = new ThreadContext()
    settled(sys, 'one', 'two')
    nudge(engine, 0.9)
    const a = engine.captureNetworkState().states
    await sys.freezeThread('one')
    nudge(engine, -0.9)
    const b = engine.captureNetworkState().states
    await sys.freezeThread('two')

    await sys.continueThread('one', history(LONG))
    expect(engine.captureNetworkState().states).toBe(a)
    await sys.continueThread('two', history(LONG))
    expect(engine.captureNetworkState().states).toBe(b)
  }, 120_000)
})

describe('when the frozen state is gone', () => {
  it('falls back to the long-term replay of the history', async () => {
    const { sys, engine } = await system()
    let clock = 0
    sys.threadContext = new ThreadContext({ ttlMs: 1_000, now: () => clock })
    nudge(engine, 0.8)
    await sys.freezeThread('old')
    clock = 5_000                                     // short term has faded

    // The long-term half: a replay already worked out for this exact history.
    sys.contextReplay.set('old', LONG, { bytes: new Uint8Array([0x6c]), similarity: 0.95, originalBytes: LONG.length, method: 'tail', trials: 1 })

    const result = await sys.continueThread('old', history(LONG))
    expect(result.via).toBe('replay')
    expect(result.primed).toBe(true)
    expect(result.replayBytes).toBe(1)
    expect(result.compacting).toBe(false)             // the replay is current, nothing to redo
    sys.contextReplay.forget('old')
  }, 120_000)

  it('leaves the mesh alone when there is neither', async () => {
    const { sys, engine } = await system()
    sys.threadContext = new ThreadContext()
    nudge(engine, 0.3)
    const before = engine.captureNetworkState().states

    const result = await sys.continueThread('never-seen', history('hi'))     // too short to need a replay
    expect(result.via).toBe('none')
    expect(result.primed).toBe(false)
    expect(engine.captureNetworkState().states).toBe(before)
  }, 120_000)

  it('refuses to thaw into a mesh that has grown since', async () => {
    const { sys, engine } = await system()
    sys.threadContext = new ThreadContext()
    nudge(engine, 0.8)
    await sys.freezeThread('grown')
    engine.addNeurons(1)                              // a skill was grafted in

    const result = await sys.continueThread('grown', history('hi'))
    expect(result.via).toBe('none')
  }, 120_000)
})
