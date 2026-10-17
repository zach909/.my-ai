import { describe, it, expect } from 'vitest'
import { ElasticCoreBlock } from '../../models && skills/core/onebrain'

/**
 * Does protecting what the old task relies on keep it, while a new task is learned?
 *
 * An earlier version of this experiment found that "the gate only slows learning". It was
 * measuring a block that ignored its input (two different inputs produced the identical output,
 * so "tasks" were just constants and could not be held together), so its conclusion was not about
 * the gate. With the input reaching the output the block learns both tasks jointly to ~0, and the
 * experiment means something.
 *
 * Learn task A, then task B on an overlapping input, under:
 *   none        no protection
 *   protected   updates scaled down by how much each parameter matters to A's output (outputSensitivity)
 *   shuffled    the same importance numbers placed on the wrong parameters
 *   uniform     every update scaled by the same average amount
 * Measured (3 seeds, strength 1000): A's error after B is 1.6-1.7 with no protection (worse than the
 * untrained 0.45), 0.20 / 0.45 / 0.35 protected, and 1.56-1.73 for both controls. So it is WHICH
 * parameters are held that matters, not merely learning more slowly.
 *
 * Slow (finite-difference gradients through the settle): opt in with NEUROCLAW_SLOW=1.
 */

const xA = Float32Array.from([1, 0.6, 0, 0])
const yA = [0.8, -0.5]
const xB = Float32Array.from([0.6, 1, 0.3, 0])
const yB = [-0.6, 0.7]
const GROUPS = ['weights', 'bias', 'inputProjection', 'outputProjection'] as const

const mk = (seed: number) => new ElasticCoreBlock({ neuronCount: 6, stateDim: 4, inputDim: 4, outputDim: 2, maxTicks: 8, seed }) as any
const loss = (b: any, x: Float32Array, y: number[]) => {
  b.state.fill(0); b.quantizationResidual.fill(0)
  const o = b.forward(x).output as Float32Array
  return ((o[0] - y[0]) ** 2 + (o[1] - y[1]) ** 2) / 2
}
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
const train = (b: any, x: Float32Array, y: number[], steps: number, lr: number, opt: object = {}) => {
  for (let s = 0; s < steps; s++) b.applyGradients(grad(b, x, y), { learningRate: lr, ...opt })
}
const snap = (b: any) => Object.fromEntries(GROUPS.map(g => [g, b[g].slice()]))
const restore = (b: any, x: any) => { for (const g of GROUPS) b[g].set(x[g]) }
const permute = (a: Float32Array) => {
  const o = new Float32Array(a.length)
  const k = Math.floor(a.length / 3) + 1
  for (let i = 0; i < a.length; i++) o[(i + k) % a.length] = a[i]
  return o
}
const meanScale = (sens: any, strength: number) => {
  let total = 0, n = 0
  for (const k of ['weights', 'biases', 'inputProjection', 'outputProjection']) {
    const a: Float32Array = sens[k]
    let mean = 0
    for (const v of a) mean += v
    mean /= a.length || 1
    for (const v of a) { total += 1 / (1 + strength * (v / (mean || 1))); n++ }
  }
  return total / n
}

describe.skipIf(!process.env.NEUROCLAW_SLOW)('Protecting an old task while a new one is learned (slow)', () => {
  it('E13 importance-targeted protection keeps task A; scrambled importance and a uniform slowdown do not', () => {
    const LR = 1, TARGET_B = 0.02, CHUNK = 50, MAX_STEPS = 2000, STRENGTH = 1000
    for (let seed = 1; seed <= 3; seed++) {
      const b = mk(seed)
      const untrainedA = loss(b, xA, yA)
      train(b, xA, yA, 150, LR)
      expect(loss(b, xA, yA)).toBeLessThan(0.02)           // A is learned
      const base = snap(b)
      const sens = b.outputSensitivity(xA)

      const protect = (shuffle: boolean) => ({
        protect: {
          weights: shuffle ? permute(sens.weights) : sens.weights,
          biases: shuffle ? permute(sens.biases) : sens.biases,
          inputProjection: shuffle ? permute(sens.inputProjection) : sens.inputProjection,
          outputProjection: shuffle ? permute(sens.outputProjection) : sens.outputProjection,
          strength: STRENGTH,
        },
      })
      const after: Record<string, { a: number; bLearned: boolean }> = {}
      const conditions: Array<[string, object]> = [
        ['none', {}], ['protected', protect(false)], ['shuffled', protect(true)], ['uniform', { scale: meanScale(sens, STRENGTH) }],
      ]
      for (const [name, opt] of conditions) {
        restore(b, base)
        let learned = false
        for (let steps = 0; steps < MAX_STEPS && !learned; steps += CHUNK) {
          train(b, xB, yB, CHUNK, LR, opt)
          learned = loss(b, xB, yB) <= TARGET_B
        }
        after[name] = { a: loss(b, xA, yA), bLearned: learned }
      }

      // Learning B with no protection destroys A: worse than never having learned it.
      expect(after.none.a).toBeGreaterThan(untrainedA * 2)
      // The protected run learns B and keeps A.
      expect(after.protected.bLearned).toBe(true)
      expect(after.protected.a).toBeLessThan(0.5)
      // Neither control does: it is which parameters are held that matters.
      expect(after.shuffled.a).toBeGreaterThan(1.2)
      expect(after.uniform.a).toBeGreaterThan(1.2)
    }
  }, 900_000)
})
