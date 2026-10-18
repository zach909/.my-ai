/**
 * ElasticCoreBlock: the input reaches the output, and protecting what an
 * earlier task relies on.
 *
 * What these protect:
 *  - Driven neurons stay at the state the input gave them while the block
 *    settles. Before, the input was recomputed away on the first tick, the
 *    block converged to the same fixed point for every input (two orthogonal
 *    inputs gave the identical output), and nothing could be learned as a
 *    function of input.
 *  - outputSensitivity() measures how much each parameter matters to what an
 *    input produces, and leaves the block exactly as it found it.
 *  - applyGradients({ protect }) holds the important parameters and lets the
 *    rest move.
 *
 * The experiment that shows protection actually keeps an old task while a new
 * one is learned is gate-forgetting.test.ts (slow, NEUROCLAW_SLOW=1).
 */

import { describe, it, expect } from 'vitest'
import { ElasticCoreBlock } from '../../models && skills/core/onebrain.js'

const block = (seed = 1) => new ElasticCoreBlock({ neuronCount: 6, stateDim: 4, inputDim: 4, outputDim: 2, maxTicks: 8, seed }) as any
const GROUPS = ['weights', 'bias', 'inputProjection', 'outputProjection'] as const
const xA = Float32Array.from([1, 0.6, 0, 0])
const xB = Float32Array.from([0.6, 1, 0.3, 0])
const yA = [0.8, -0.5]
const yB = [-0.6, 0.7]

const out = (b: any, x: Float32Array, run: object = {}) => { b.state.fill(0); b.quantizationResidual.fill(0); return Array.from(b.forward(x, run).output as Float32Array) }
const loss = (b: any, x: Float32Array, y: number[]) => { const o = out(b, x); return ((o[0] - y[0]) ** 2 + (o[1] - y[1]) ** 2) / 2 }

function grad(b: any, x: Float32Array, y: number[]) {
  const eps = 1e-2
  const g: Record<string, Float32Array> = {}
  for (const name of GROUPS) {
    const arr: Float32Array = b[name]
    const gg = new Float32Array(arr.length)
    for (let i = 0; i < arr.length; i++) {
      const o = arr[i]
      arr[i] = o + eps; const lp = loss(b, x, y)
      arr[i] = o - eps; const lm = loss(b, x, y)
      arr[i] = o
      gg[i] = (lp - lm) / (2 * eps)
    }
    g[name === 'bias' ? 'biases' : name] = gg
  }
  return g
}

describe('the input reaches the output', () => {
  it('different inputs give different outputs, even before any training', () => {
    const b = block()
    const a = out(b, Float32Array.from([1, 0, 0, 0]))
    const c = out(b, Float32Array.from([0, 1, 0, 0]))
    expect(Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1])).toBeGreaterThan(1e-3)
  })

  it('the old behaviour (holdDriven: false) gave the same output for every input', () => {
    const b = block()
    const a = out(b, Float32Array.from([1, 0, 0, 0]), { holdDriven: false })
    const c = out(b, Float32Array.from([0, 1, 0, 0]), { holdDriven: false })
    expect(Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1])).toBeLessThan(1e-3)
  })

  it('can learn two different input -> output mappings at once', () => {
    const b = block()
    for (let s = 0; s < 120; s++) {
      b.applyGradients(grad(b, xA, yA), { learningRate: 1 })
      b.applyGradients(grad(b, xB, yB), { learningRate: 1 })
    }
    expect(loss(b, xA, yA)).toBeLessThan(0.02)
    expect(loss(b, xB, yB)).toBeLessThan(0.02)
  }, 60_000)
})

describe('outputSensitivity', () => {
  it('leaves the block exactly as it found it', () => {
    const b = block()
    out(b, xA)
    const before = { state: b.state.slice(), w: b.weights.slice(), bias: b.bias.slice(), ip: b.inputProjection.slice(), op: b.outputProjection.slice() }
    b.outputSensitivity(xA)
    expect(Array.from(b.state)).toEqual(Array.from(before.state))
    expect(Array.from(b.weights)).toEqual(Array.from(before.w))
    expect(Array.from(b.bias)).toEqual(Array.from(before.bias))
    expect(Array.from(b.inputProjection)).toEqual(Array.from(before.ip))
    expect(Array.from(b.outputProjection)).toEqual(Array.from(before.op))
  })

  it('is non-negative, and the parameters on the input path matter to that input', () => {
    const b = block()
    const s = b.outputSensitivity(xA)
    for (const name of ['weights', 'biases', 'inputProjection', 'outputProjection']) {
      expect(s[name].every((v: number) => v >= 0 && Number.isFinite(v))).toBe(true)
    }
    // Input channels that are zero in this input cannot matter to it.
    const zeroChannels = [2, 3]
    for (const i of zeroChannels) for (let od = 0; od < 4; od++) expect(s.inputProjection[i * 4 + od]).toBe(0)
    // Channels that carry signal do.
    let carrying = 0
    for (const i of [0, 1]) for (let od = 0; od < 4; od++) carrying += s.inputProjection[i * 4 + od]
    expect(carrying).toBeGreaterThan(0)
  })

  it('differs between inputs: what matters to one task is not what matters to another', () => {
    const b = block()
    const sa = b.outputSensitivity(Float32Array.from([1, 0, 0, 0]))
    const sb = b.outputSensitivity(Float32Array.from([0, 0, 1, 0]))
    let apart = 0
    for (let i = 0; i < sa.inputProjection.length; i++) apart += Math.abs(sa.inputProjection[i] - sb.inputProjection[i])
    expect(apart).toBeGreaterThan(0)
  })
})

describe('applyGradients({ protect })', () => {
  const ones = (n: number) => new Float32Array(n).fill(1)

  it('barely moves an important parameter and lets an unimportant one through', () => {
    const b = block()
    const n = b.bias.length
    const importance = new Float32Array(n)            // parameter 0 is all that matters; the rest do not
    importance[0] = n
    const before = Array.from(b.bias) as number[]
    b.applyGradients({ biases: ones(n) }, { learningRate: 1, protect: { biases: importance, strength: 1000 } })
    const moved = (i: number) => Math.abs(b.bias[i] - before[i])
    expect(moved(0)).toBeLessThan(0.01)               // held: 1 / (1 + 1000 * n/mean...) -> tiny
    expect(moved(1)).toBeCloseTo(1, 5)                // free: full step
  })

  it('changes nothing when no protection is given', () => {
    const a = block()
    const c = block()
    const n = a.bias.length
    a.applyGradients({ biases: ones(n) }, { learningRate: 0.5 })
    c.applyGradients({ biases: ones(n) }, { learningRate: 0.5, protect: {} })
    expect(Array.from(a.bias)).toEqual(Array.from(c.bias))
  })

  it('protects the input and output paths too, not only the weights', () => {
    const b = block()
    const ip = b.inputProjection.slice() as Float32Array
    const importance = new Float32Array(ip.length).fill(1)
    b.applyGradients({ inputProjection: new Float32Array(ip.length).fill(1) }, { learningRate: 1, protect: { inputProjection: importance, strength: 1e6 } })
    for (let i = 0; i < ip.length; i++) expect(Math.abs(b.inputProjection[i] - ip[i])).toBeLessThan(1e-3)
  })
})
