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
import { HyperDimensionalEngine, ZipLoopInterface, zipLoopIdsFor } from '../../models && skills/core/onebrain.js'
import {
  neuronsTiedToDoorway,
  zipLoopProbe,
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
    const mesh = toyMesh(0.95)   // about the last 60 bits matter, so short tails are only near
    const result = await compressContext(mesh.probe, history(150), {
      maxBytes: 8, target: 0.9999999, minimum: 0.5, yieldTo: noYield,
    })

    expect(result).not.toBeNull()
    expect(result!.bytes.length).toBeLessThanOrEqual(8)
    expect(result!.trials).toBeGreaterThan(5)
    expect(mesh.state()).toEqual(mesh.start)
  })

  it('does not call a replay a match just because it points the same way: it has to move the neurons as far', async () => {
    const mesh = toyMesh(0.999)   // all 150 bytes pile up; one byte moves a tiny fraction as far
    const result = await compressContext(mesh.probe, history(150), {
      maxBytes: 1, target: 0.97, minimum: 0.5, yieldTo: noYield,
    })
    expect(result).toBeNull()
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

describe('on the real mesh', () => {
  const config = () => ({
    neuronCount: 16, dimensions: 8, propagationSteps: 24, convergenceThreshold: 0.01,
    hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
    waveGain: 0.1, connectionBias: true,
  })
  const doorway = [0, 1, 2, 3, 4, 5]

  it('watches the doorway neurons first, then the ones wired most tightly to them', () => {
    const engine = new HyperDimensionalEngine(config())
    // 9 is tied to two of the doorway's neurons as hard as a weight can be, 10 to one, so
    // they beat whatever small weights the mesh started with.
    for (let dim = 0; dim <= 8; dim++) {
      engine.setConnectionWeight(9, 0, dim, 2)
      engine.setConnectionWeight(9, 1, dim, 2)
      engine.setConnectionWeight(10, 5, dim, 2)
    }
    const watched = neuronsTiedToDoorway(engine, doorway, 2)

    expect(watched.slice(0, 6)).toEqual(doorway)
    expect(watched.slice(6)).toEqual([9, 10])
    expect(neuronsTiedToDoorway(engine, doorway, 100).length).toBe(16)
  })

  it('reads the whole state of those neurons, and finding a replay leaves the mesh as it was', async () => {
    const engine = new HyperDimensionalEngine(config())
    const zip = new ZipLoopInterface(engine, zipLoopIdsFor(engine))
    const probe = zipLoopProbe(engine, zip)

    expect(probe.signature().length).toBe(16 * (8 + 1))   // every neuron is within the 24 watched, each its content plus its energy
    const before = Array.from(probe.signature())
    const result = await compressContext(probe, new TextEncoder().encode('Help me plan a small garden'), {
      maxMs: 60_000, yieldTo: noYield,
    })

    expect(Array.from(probe.signature())).toEqual(before)
    if (result) {
      expect(result.bytes.length).toBeLessThan(27)
      expect(result.similarity).toBeGreaterThanOrEqual(0.85)
    }
  })
})

describe('a mesh that keeps no trace of earlier input', () => {
  it('gets no replay, and says why, instead of a one-byte "match" for any history', async () => {
    // keep = 0: each bit overwrites the last, so only the final bit shows. Whatever came
    // before, the neurons end up in the same place, and any short prompt "reproduces" it.
    const mesh = toyMesh(0)
    const diagnostics: { reason?: 'blind' } = {}
    const result = await compressContext(mesh.probe, history(80), { yieldTo: noYield, diagnostics })
    expect(result).toBeNull()
    expect(diagnostics.reason).toBe('blind')
    expect(mesh.state()).toEqual(mesh.start)
  })

  it('still finds a replay on a mesh that does remember', async () => {
    const diagnostics: { reason?: 'blind' } = {}
    const result = await compressContext(toyMesh(0.9).probe, history(200), { yieldTo: noYield, diagnostics })
    expect(result).not.toBeNull()
    expect(diagnostics.reason).toBeUndefined()
  })

  // Measured on the real mesh, in both a sparse and a live-sized configuration: the state after
  // a 58-byte history matches the state after only its final byte to eight decimals. Nothing
  // before the last byte of a message changes where the neurons end up (only its length does).
  // So a chat history cannot be carried by replay until input leaves a content-dependent trace.
  it('real mesh: no replay is offered, because the history cannot be told from its last byte', async () => {
    const engine = new HyperDimensionalEngine({ neuronCount: 24, dimensions: 8 })
    const zip = new ZipLoopInterface(engine, zipLoopIdsFor(engine))
    const diagnostics: { reason?: 'blind' } = {}
    const text = 'we were planning the trip to the lake and the packing list'
    const result = await compressContext(zipLoopProbe(engine, zip), new Uint8Array(Buffer.from(text, 'utf8')), { yieldTo: noYield, diagnostics })
    expect(result).toBeNull()
    expect(diagnostics.reason).toBe('blind')
  })

  // The property the idea needs, with the memory switched on (ZipLoopInterface's `memory`, or
  // NEUROCLAW_ZIP_MEMORY for the whole process): a long history leaves a different trace than
  // its last byte alone. It does not with the memory off (the test above).
  it('real mesh with memory on: a long history leaves a different trace than its last byte alone', () => {
    const cfg = { neuronCount: 24, dimensions: 8 }
    const snap = new HyperDimensionalEngine(cfg).captureNetworkState()
    const trace = (bytes: Uint8Array) => {
      const e = new HyperDimensionalEngine(cfg)
      e.restoreNetworkState(snap)
      const zip = new ZipLoopInterface(e, zipLoopIdsFor(e), { memory: { vale: 0.97 } })
      const p = zipLoopProbe(e, zip)
      const before = Array.from(p.signature())
      for (const byte of bytes) for (let k = 7; k >= 0; k--) p.feedBit(((byte >> k) & 1) as 0 | 1)
      return Array.from(p.signature()).map((v, i) => v - before[i])
    }
    const text = Buffer.from('we were planning the trip to the lake and the packing list', 'utf8')
    const full = trace(new Uint8Array(text))
    const last = trace(new Uint8Array([text[text.length - 1]]))
    let dot = 0, nf = 0, nl = 0
    for (let i = 0; i < full.length; i++) { dot += full[i] * last[i]; nf += full[i] ** 2; nl += last[i] ** 2 }
    expect(dot / Math.sqrt(nf * nl)).toBeLessThan(0.95)
  })

  it('real mesh with memory on: a replay is found, and it is closest to the history it came from', async () => {
    const cfg = { neuronCount: 24, dimensions: 8 }
    const snap = new HyperDimensionalEngine(cfg).captureNetworkState()
    const make = () => {
      const e = new HyperDimensionalEngine(cfg)
      e.restoreNetworkState(snap)
      const zip = new ZipLoopInterface(e, zipLoopIdsFor(e), { memory: { vale: 0.97 } })
      return zipLoopProbe(e, zip)
    }
    const effect = (bytes: Uint8Array) => {
      const p = make()
      const before = Array.from(p.signature())
      for (const byte of bytes) for (let k = 7; k >= 0; k--) p.feedBit(((byte >> k) & 1) as 0 | 1)
      return Array.from(p.signature()).map((v, i) => v - before[i])
    }
    const cosine = (a: number[], b: number[]) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2 } return d / Math.sqrt(x * y) }
    const histories = [
      'we were planning the trip to the lake and the packing list',
      'please remember my sister is called Ana and she lives in Lisbon',
      'the build failed because the config file was missing a key',
      'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
      'we agreed the deadline moves to friday and Sam owns the report',
    ].map(t => new Uint8Array(Buffer.from(t, 'utf8')))
    const fulls = histories.map(effect)
    let right = 0
    for (let i = 0; i < histories.length; i++) {
      const result = await compressContext(make(), histories[i], { yieldTo: noYield })
      expect(result).not.toBeNull()                            // no longer "blind"
      expect(result!.bytes.length).toBeLessThan(histories[i].length)
      const sims = fulls.map(f => cosine(effect(result!.bytes), f))
      if (sims.indexOf(Math.max(...sims)) === i) right++
    }
    expect(right).toBeGreaterThanOrEqual(3)                    // it carries what the mesh remembers: the recent stretch
  })

  it('NEUROCLAW_ZIP_MEMORY switches the memory on for every interface in the process', () => {
    const cfg = { neuronCount: 24, dimensions: 8 }
    // Compare effects on one shared snapshot, so the only difference is the switch.
    const snap = new HyperDimensionalEngine(cfg).captureNetworkState()
    const run = (envValue: string | undefined) => {
      const old = process.env.NEUROCLAW_ZIP_MEMORY
      if (envValue === undefined) delete process.env.NEUROCLAW_ZIP_MEMORY; else process.env.NEUROCLAW_ZIP_MEMORY = envValue
      try {
        const e = new HyperDimensionalEngine(cfg)
        e.restoreNetworkState(snap)
        const zip = new ZipLoopInterface(e, zipLoopIdsFor(e))
        for (const byte of Buffer.from('a question that ends the same', 'utf8')) zip.sendByte(byte)
        return e.captureNetworkState().states
      } finally {
        if (old === undefined) delete process.env.NEUROCLAW_ZIP_MEMORY; else process.env.NEUROCLAW_ZIP_MEMORY = old
      }
    }
    expect(run(undefined)).toBe(run('0'))            // off by default, and 0 is off
    expect(run('0.97')).not.toBe(run(undefined))     // on changes the mesh
  })
})
