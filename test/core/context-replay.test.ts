/**
 * Context compression: a short prompt that moves the neurons the way a long
 * conversation did.
 *
 * What these protect: the replay really reproduces the neuron changes, it is
 * shorter than what it replaces or it is not used at all, finding it never
 * changes the mesh, and it stops when it runs out of time.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  compressContext,
  primeWithReplay,
  ReplayStore,
  digestOf,
  type ContextProbe,
} from '../../models && skills/core/context-replay.js'

const noYield = async () => {}

/**
 * A toy mesh with a memory: each bit pushes the state a little toward a
 * direction for 0 or for 1, and what came before fades by `keep` each bit. A
 * short `keep` means only the recent bits matter; close to 1 means all of them do.
 */
function toyMesh(keep = 0.9, push: [number[], number[]] = [[1, 0, 0.3, 0], [0, 1, 0.3, 0.5]], start = [0.2, 0.1, 0.4, 0.3]) {
  let state = [...start]
  const fed: Array<0 | 1> = []
  const probe: ContextProbe = {
    feedBit: bit => {
      fed.push(bit)
      state = state.map((v, i) => keep * v + 0.3 * push[bit][i])
    },
    signature: () => state,
    checkpoint: () => [...state],
    rewind: token => { state = [...(token as number[])] },
  }
  return { probe, fed, state: () => [...state], start }
}

/** A deterministic pseudo-random history. */
function history(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n)
  let x = seed
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out[i] = (x >> 8) & 0xff }
  return out
}

describe('compressContext', () => {
  it('finds a short replay that moves the neurons the same way, and leaves the mesh as it was', async () => {
    const mesh = toyMesh(0.9)
    const result = await compressContext(mesh.probe, history(200), { yieldTo: noYield })

    expect(result).not.toBeNull()
    expect(result!.bytes.length).toBeGreaterThan(0)
    expect(result!.bytes.length).toBeLessThanOrEqual(16)
    expect(result!.bytes.length).toBeLessThan(200)
    expect(result!.similarity).toBeGreaterThanOrEqual(0.97)
    expect(result!.originalBytes).toBe(200)
    expect(mesh.state()).toEqual(mesh.start)
  })

  it('uses the end of the history when that is enough, and says so', async () => {
    const result = await compressContext(toyMesh(0.9).probe, history(120), { yieldTo: noYield })
    expect(result!.method).toBe('tail')
    expect(Array.from(result!.bytes)).toEqual(Array.from(history(120).slice(120 - result!.bytes.length)))
  })

  it('searches bit by bit when the end of the history is not close enough, still within its limits', async () => {
    const mesh = toyMesh(0.999)   // every bit counts almost equally, so a tail is a poor stand-in
    const result = await compressContext(mesh.probe, history(150), {
      maxBytes: 2, target: 0.99999, minimum: 0.5, yieldTo: noYield,
    })

    expect(result).not.toBeNull()
    expect(result!.bytes.length).toBeLessThanOrEqual(2)
    expect(result!.trials).toBeGreaterThan(5)
    expect(mesh.state()).toEqual(mesh.start)
  })

  it('has nothing to replay when the history moved no neurons', async () => {
    const still = toyMesh(1, [[0, 0, 0, 0], [0, 0, 0, 0]])
    const result = await compressContext(still.probe, history(40), { yieldTo: noYield })
    expect(result).toMatchObject({ method: 'nothing-to-replay', similarity: 1 })
    expect(result!.bytes.length).toBe(0)
  })

  it('does not compress what is already as short as it can be', async () => {
    expect(await compressContext(toyMesh().probe, new Uint8Array(0), { yieldTo: noYield })).toBeNull()
    expect(await compressContext(toyMesh().probe, new Uint8Array([0xab]), { yieldTo: noYield })).toBeNull()
  })

  it('refuses a replay that is not close enough to use', async () => {
    const mesh = toyMesh(0.999)
    const result = await compressContext(mesh.probe, history(150), {
      maxBytes: 1, target: 0.99999, minimum: 0.99999, yieldTo: noYield,
    })
    expect(result).toBeNull()
    expect(mesh.state()).toEqual(mesh.start)
  })

  it('gives up when it runs out of time, with nothing changed', async () => {
    const mesh = toyMesh(0.999)
    let clock = 0
    const result = await compressContext(mesh.probe, history(150), {
      maxMs: 5, now: () => (clock += 10), yieldTo: noYield,
    })
    expect(result).toBeNull()
    expect(mesh.state()).toEqual(mesh.start)
  })

  it('puts the mesh back even if feeding it fails part way', async () => {
    const mesh = toyMesh()
    let calls = 0
    const flaky: ContextProbe = {
      ...mesh.probe,
      feedBit: bit => { if (++calls === 500) throw new Error('mesh fell over'); mesh.probe.feedBit(bit) },
    }
    await expect(compressContext(flaky, history(200), { yieldTo: noYield })).rejects.toThrow('mesh fell over')
    expect(mesh.state()).toEqual(mesh.start)
  })
})

describe('primeWithReplay', () => {
  it('feeds the replay as bits, most significant first, and nothing else', async () => {
    const mesh = toyMesh()
    await primeWithReplay(mesh.probe, new Uint8Array([0b10100001, 0b00000011]), noYield)
    expect(mesh.fed).toEqual([1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1])
  })
})

describe('ReplayStore', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'corona-replay-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  const result = { bytes: new Uint8Array([1, 2, 3]), similarity: 0.98, originalBytes: 200, method: 'tail' as const, trials: 9 }

  it('keeps a replay per conversation and knows whether it is made from the current text', () => {
    const store = new ReplayStore()
    store.set('t1', 'hello there', result)

    expect(Array.from(store.replayFor('t1')!)).toEqual([1, 2, 3])
    expect(store.isCurrent('t1', 'hello there')).toBe(true)
    expect(store.isCurrent('t1', 'hello there, and more')).toBe(false)
    expect(store.replayFor('nope')).toBeNull()
  })

  it('remembers that nothing worthwhile was found, so it is not searched for again and again', () => {
    const store = new ReplayStore()
    store.set('t1', 'short', null)
    expect(store.replayFor('t1')).toBeNull()
    expect(store.get('t1')).toMatchObject({ found: false, method: 'none' })
    expect(store.isCurrent('t1', 'short')).toBe(true)
  })

  it('survives a restart, and starts over from a damaged file', () => {
    const file = path.join(dir, 'replay.json')
    new ReplayStore(file).set('t1', 'hello', result)

    const again = new ReplayStore(file)
    expect(Array.from(again.replayFor('t1')!)).toEqual([1, 2, 3])
    again.forget('t1')
    expect(new ReplayStore(file).get('t1')).toBeNull()

    writeFileSync(file, '{ not json')
    expect(() => new ReplayStore(file)).not.toThrow()
    expect(new ReplayStore(file).get('t1')).toBeNull()
  })

  it('digests the same text the same way', () => {
    expect(digestOf('abc')).toBe(digestOf('abc'))
    expect(digestOf('abc')).not.toBe(digestOf('abd'))
  })
})
