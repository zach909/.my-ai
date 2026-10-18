/**
 * More doorways than the Zip Loop, declared by extensions.
 *
 * What these protect: each doorway lives on its own neurons and speaks plain
 * bits, nothing turns bytes into tokens, neurons are only added when a doorway
 * is first used, and a bad declaration costs only itself.
 */

import { describe, it, expect } from 'vitest'
import { DoorwayRegistry, DoorwayError, MAX_DOORWAYS } from '../../models && skills/core/doorways.js'

/**
 * Just enough of the engine for ZipLoopInterface: it grows neurons, records
 * what each tick drove, and plays back scripted output so a byte can be read.
 */
function fakeEngine() {
  const driven: number[][] = []
  const roles = new Map<number, 'zero' | 'one' | 'toggle'>()
  let next = 100
  let neuronCount = 6
  let readTick = -1
  let script: Array<{ bit: 0 | 1; toggle: 0 | 1 }> = []
  const engine = {
    getDimensions: () => 4,
    getPropagationSteps: () => 8,
    setPropagationSteps: () => {},
    setWaveSignature: () => true,
    meanNeuronEnergy: () => 0.1,
    addNeurons: (count: number) => {
      const ids = Array.from({ length: count }, (_, i) => next + i)
      next += count
      neuronCount += count
      roles.set(ids[2], 'zero'); roles.set(ids[3], 'one'); roles.set(ids[5], 'toggle')
      return ids
    },
    process: (_input: number[], _a: unknown, set: Set<number>) => {
      driven.push([...set].sort((a, b) => a - b))
      if (set.size === 0) readTick++
      return { settleIterations: 1 }
    },
    getNeuronEnergy: (id: number) => {
      const step = script[readTick]
      if (!step) return 0
      const role = roles.get(id)
      if (role === 'toggle') return step.toggle
      if (role === 'one') return step.bit === 1 ? 1 : 0
      if (role === 'zero') return step.bit === 0 ? 1 : 0
      return 0
    },
    captureNetworkState: () => ({}),
  }
  return {
    engine: engine as never,
    driven,
    neurons: () => neuronCount,
    /** The mesh says this byte, one flip of the ramp per bit. */
    say(byte: number) {
      readTick = -1
      script = Array.from({ length: 8 }, (_, k) => ({ bit: ((byte >> (7 - k)) & 1) as 0 | 1, toggle: (k % 2 === 0 ? 1 : 0) as 0 | 1 }))
    },
  }
}

describe('declaring doorways', () => {
  const make = () => new DoorwayRegistry(() => null)

  it('accepts a name and a kind, and says nothing is open yet', () => {
    const info = make().declare({ name: 'Mic', kind: 'Audio', direction: 'in', source: 'ears' })
    expect(info).toMatchObject({ name: 'mic', kind: 'audio', direction: 'in', open: false, neurons: [], source: 'ears' })
  })

  it('refuses names that are not usable, and the Zip Loop name', () => {
    const r = make()
    expect(() => r.declare({ name: '../etc', kind: 'audio', direction: 'in' })).toThrow(DoorwayError)
    expect(() => r.declare({ name: 'mic', kind: 'no spaces', direction: 'in' })).toThrow(DoorwayError)
    expect(() => r.declare({ name: 'zip-loop', kind: 'audio', direction: 'in' })).toThrow(/built-in Zip Loop/)
    expect(() => r.declare({ name: 'mic', kind: 'audio', direction: 'sideways' as never })).toThrow(DoorwayError)
  })

  it('is fine to declare the same doorway again, and widens it if the other side is added', () => {
    const r = make()
    r.declare({ name: 'cam', kind: 'image', direction: 'in' })
    expect(r.declare({ name: 'cam', kind: 'image', direction: 'in' }).direction).toBe('in')
    expect(r.declare({ name: 'cam', kind: 'image', direction: 'out' }).direction).toBe('both')
  })

  it('will not let one name be two kinds', () => {
    const r = make()
    r.declare({ name: 'cam', kind: 'image', direction: 'in' })
    expect(() => r.declare({ name: 'cam', kind: 'audio', direction: 'in' })).toThrow(/already a "image"/)
  })

  it('stops at the most the mesh will carry', () => {
    const r = make()
    for (let i = 0; i < MAX_DOORWAYS; i++) r.declare({ name: `d${i}`, kind: 'file', direction: 'in' })
    expect(() => r.declare({ name: 'one-more', kind: 'file', direction: 'in' })).toThrow(/most the mesh will carry/)
  })
})

describe('declaring from an extension', () => {
  it('turns inputs and outputs into doorways, and a name on both sides into one that goes both ways', () => {
    const r = new DoorwayRegistry(() => null)
    const { declared, skipped } = r.declareFromExtension('voice-ext', {
      inputs: [{ name: 'mic', kind: 'audio' }, { name: 'terminal', kind: 'text' }],
      outputs: [{ name: 'speaker', kind: 'audio' }, { name: 'terminal', kind: 'text' }],
    })
    expect(skipped).toEqual([])
    expect(declared.map(d => [d.name, d.direction])).toEqual([['mic', 'in'], ['terminal', 'both'], ['speaker', 'out']])
    expect(declared.every(d => d.source === 'voice-ext')).toBe(true)
  })

  it('skips only the bad entries and says why', () => {
    const r = new DoorwayRegistry(() => null)
    const { declared, skipped } = r.declareFromExtension('x', {
      inputs: [{ name: 'good', kind: 'audio' }, { name: 5 }, { name: 'bad name!', kind: 'audio' }],
      outputs: 'not a list',
    })
    expect(declared.map(d => d.name)).toEqual(['good'])
    expect(skipped).toHaveLength(3)
  })

  it('ignores an extension with no io at all', () => {
    const r = new DoorwayRegistry(() => null)
    expect(r.declareFromExtension('x', undefined)).toEqual({ declared: [], skipped: [] })
    expect(r.list()).toEqual([])
  })
})

describe('using a doorway', () => {
  it('adds no neurons until it is used, then six, and only once', async () => {
    const f = fakeEngine()
    const r = new DoorwayRegistry(() => f.engine)
    r.declare({ name: 'mic', kind: 'audio', direction: 'in' })
    expect(f.neurons()).toBe(6)

    await r.send('mic', new Uint8Array([1]))
    expect(f.neurons()).toBe(12)
    await r.send('mic', new Uint8Array([0]))
    expect(f.neurons()).toBe(12)
    expect(r.list()[0]).toMatchObject({ open: true, bytesIn: 2 })
    expect(r.list()[0].neurons).toHaveLength(6)
  })

  it('puts raw bits in on its own neurons and not the Zip Loop neurons', async () => {
    const f = fakeEngine()
    const r = new DoorwayRegistry(() => f.engine)
    r.declare({ name: 'mic', kind: 'audio', direction: 'in' })

    await r.send('mic', new Uint8Array([0b10000000]))

    const mine = new Set(r.list()[0].neurons)
    const used = f.driven.flat()
    expect(used.length).toBeGreaterThan(0)
    expect(used.every(id => mine.has(id))).toBe(true)
    // MSB first: the first bit is a 1, so the first tick drives bit1In (the second neuron) and the ramp.
    const [bit0In, bit1In, , , rampIn] = r.list()[0].neurons
    expect(f.driven[0]).toEqual([bit1In, rampIn].sort((a, b) => a - b))
    expect(f.driven[1]).toEqual([bit0In])
  })

  it('gives two doorways different neurons', async () => {
    const f = fakeEngine()
    const r = new DoorwayRegistry(() => f.engine)
    r.declare({ name: 'a', kind: 'file', direction: 'in' })
    r.declare({ name: 'b', kind: 'file', direction: 'in' })
    await r.send('a', new Uint8Array([1]))
    await r.send('b', new Uint8Array([1]))
    const [a, b] = r.list()
    expect(a.neurons.some(n => b.neurons.includes(n))).toBe(false)
  })

  it('reads back the byte the mesh says', async () => {
    const f = fakeEngine()
    const r = new DoorwayRegistry(() => f.engine)
    r.declare({ name: 'speaker', kind: 'audio', direction: 'out' })
    await r.receive('speaker', 1).catch(() => undefined)   // opens it
    f.say(0b01000001)

    const out = await r.receive('speaker', 1)

    expect(Array.from(out)).toEqual([0b01000001])
    expect(r.list()[0].bytesOut).toBeGreaterThanOrEqual(1)
  })

  it('returns fewer bytes when the network stops sending', async () => {
    const f = fakeEngine()
    const r = new DoorwayRegistry(() => f.engine)
    r.declare({ name: 'speaker', kind: 'audio', direction: 'out' })
    f.say(0xff)
    expect((await r.receive('speaker', 4)).length).toBe(1)
  })

  it('keeps each direction to what it was declared for', async () => {
    const f = fakeEngine()
    const r = new DoorwayRegistry(() => f.engine)
    r.declare({ name: 'mic', kind: 'audio', direction: 'in' })
    r.declare({ name: 'speaker', kind: 'audio', direction: 'out' })
    await expect(r.receive('mic', 1)).rejects.toThrow(/only takes input/)
    await expect(r.send('speaker', new Uint8Array([1]))).rejects.toThrow(/only sends out/)
  })

  it('fails clearly for an unknown doorway, no mesh, and oversized or empty requests', async () => {
    const f = fakeEngine()
    const r = new DoorwayRegistry(() => f.engine)
    r.declare({ name: 'mic', kind: 'audio', direction: 'both' })
    await expect(r.send('nope', new Uint8Array([1]))).rejects.toThrow(/no doorway/)
    await expect(r.receive('mic', 0)).rejects.toThrow(/whole number/)
    await expect(r.send('mic', new Uint8Array((1 << 20) + 1))).rejects.toThrow(/at most/)
    expect(await r.send('mic', new Uint8Array(0))).toEqual({ bytes: 0 })

    const noMesh = new DoorwayRegistry(() => null)
    noMesh.declare({ name: 'mic', kind: 'audio', direction: 'in' })
    await expect(noMesh.send('mic', new Uint8Array([1]))).rejects.toThrow(/not been built/)
  })
})
