/**
 * Expert weights are allocated when they are used, not when a plugin registers.
 *
 * Measured before this change: registering a plugin allocated
 * inputDim x expertHiddenDim floats -- 1.5MB -- and randomly initialised all
 * 393216 of them. Across 36 plugins that was 54MB of resident typed arrays and
 * ~235ms of boot spent initialising numbers nothing had asked for.
 *
 * The tests that matter are that laziness is real (nothing large is allocated
 * up front) and that it is invisible (an expert that IS used behaves exactly
 * as it did when the array was eager).
 */

import { describe, it, expect } from 'vitest'
import { MoERouter } from '../../models && skills/core/onebrain.js'

const CONFIG = { inputDim: 3072, expertHiddenDim: 128 }

/**
 * The expert table is private, and these tests are specifically about how it
 * allocates -- which is not something the public surface exposes, and is
 * exactly the property that regressed silently before.
 */
function expertsOf(moe: MoERouter): Map<number, { weights: Float32Array; bias: Float32Array }> {
  return (moe as unknown as { experts: Map<number, { weights: Float32Array; bias: Float32Array }> }).experts
}

describe('allocating expert weights', () => {
  it('does not allocate the weight matrix when the expert is registered', () => {
    const moe = new MoERouter(CONFIG)
    const before = process.memoryUsage().arrayBuffers
    for (let i = 0; i < 20; i++) {
      moe.addExpert({ id: `p${i}`, name: `Plugin ${i}`, specialization: 'test' })
    }
    const grew = process.memoryUsage().arrayBuffers - before
    // Eagerly this would be 20 x 3072 x 128 x 4 bytes = 30MB. The bias arrays
    // are small and still eager, so allow generous headroom and still catch it.
    expect(grew).toBeLessThan(5 * 1024 * 1024)
  })

  it('allocates on first read, at the right size', () => {
    const moe = new MoERouter(CONFIG)
    const id = moe.addExpert({ id: 'used', name: 'Used', specialization: 'test' })
    const expert = expertsOf(moe).get(id)
    expect(expert!.weights).toBeInstanceOf(Float32Array)
    expect(expert!.weights.length).toBe(CONFIG.inputDim * CONFIG.expertHiddenDim)
  })

  it('returns the same array every time, not a fresh one per read', () => {
    // A getter that rebuilt on each access would be correct-looking and
    // catastrophically slow, and any training written into it would vanish.
    const moe = new MoERouter(CONFIG)
    const id = moe.addExpert({ id: 'stable', name: 'Stable', specialization: 'test' })
    const experts = expertsOf(moe)
    const first = experts.get(id)!.weights
    expect(experts.get(id)!.weights).toBe(first)
  })

  it('initialises with real values, not zeros', () => {
    const moe = new MoERouter(CONFIG)
    const id = moe.addExpert({ id: 'init', name: 'Init', specialization: 'test' })
    const experts = expertsOf(moe)
    const w = experts.get(id)!.weights
    expect(w.slice(0, 500).some(v => v !== 0)).toBe(true)
    // He-style scale: sqrt(2/inputDim). Values must be bounded by it.
    const scale = Math.sqrt(2 / CONFIG.inputDim)
    expect(Math.max(...Array.from(w.slice(0, 5000), Math.abs))).toBeLessThanOrEqual(scale)
  })

  it('keeps what training writes back', () => {
    const moe = new MoERouter(CONFIG)
    const id = moe.addExpert({ id: 'trained', name: 'Trained', specialization: 'test' })
    const experts = expertsOf(moe)
    const replacement = new Float32Array(CONFIG.inputDim * CONFIG.expertHiddenDim).fill(0.25)
    experts.get(id)!.weights = replacement
    expect(experts.get(id)!.weights).toBe(replacement)
    expect(experts.get(id)!.weights[0]).toBe(0.25)
  })

  it('still accepts weights supplied directly', () => {
    const moe = new MoERouter(CONFIG)
    const given = new Float32Array(8).fill(1)
    const id = moe.addExpert(given, new Float32Array(2))
    const experts = expertsOf(moe)
    expect(experts.get(id)!.weights).toBe(given)
  })
})
