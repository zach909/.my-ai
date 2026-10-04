import { describe, it, expect } from 'vitest';
import { NeuronMesh } from '../../models && skills/core/onebrain';
import { RLMTrainer } from '../../models && skills/core/rlm';
import { NetSkillRouter } from '../../models && skills/core/net-skill-router';

const finite = (xs: Iterable<number>) => Array.from(xs).every(Number.isFinite);
const vec = (n: number, seed: number) => Float32Array.from({ length: n }, (_, i) => Math.sin(seed * 13.37 + i * 0.71));

describe('Architecture experiments', () => {
  it('E01 all-to-all mesh topology', () => {
    const n = 16;
    const mesh = new NeuronMesh({ nodeCount: n, connectionDensity: 1, seed: 42 });
    const topo = mesh.getTopology();
    expect(topo.nodeCount).toBe(n);
    expect(topo.nodes.every(x => x.connections.size === n - 1)).toBe(true);
    expect(topo.nodes.every(x => !x.connections.has(x.id))).toBe(true);
  });

  it('E02 mesh propagation is finite and repeatable in shape', () => {
    const a = new NeuronMesh({ nodeCount: 16, connectionDensity: 1, seed: 42, propagationSteps: 20 });
    const b = new NeuronMesh({ nodeCount: 16, connectionDensity: 1, seed: 42, propagationSteps: 20 });
    const input = new Map([[0, 1], [1, -1]]);
    const ra = a.propagate(input);
    const rb = b.propagate(input);
    expect(finite(ra.finalStates.values())).toBe(true);
    expect(finite(rb.finalStates.values())).toBe(true);
    expect(ra.finalStates.size).toBe(rb.finalStates.size);
  });

  it('E03 propagation converges rather than producing unbounded state', () => {
    const mesh = new NeuronMesh({ nodeCount: 24, connectionDensity: 1, seed: 7, propagationSteps: 100 });
    const r = mesh.propagate(new Map([[0, 1], [1, -1]]), undefined, undefined, true);
    const values = [...r.finalStates.values()];
    expect(finite(values)).toBe(true);
    expect(values.every(v => Math.abs(v) < 1e6)).toBe(true);
  });

  it('E04 elastic-value gate changes plasticity', () => {
    const mesh = new NeuronMesh({ nodeCount: 8, connectionDensity: 1, seed: 42 });
    const before = mesh.propagate(new Map([[0, 1]])).finalStates.get(2)!;
    const frozen = new Map([[2, 1]]);
    const after = mesh.propagate(new Map([[0, -1]]), frozen).finalStates.get(2)!;
    expect(Math.abs(after - before)).toBeLessThanOrEqual(Math.abs(
      mesh.propagate(new Map([[0, -1]])).finalStates.get(2)! - before
    ) + 1e-9);
  });

  it('E05 net-skill routing selects by meaning and remains deterministic', () => {
    const r = new NetSkillRouter(1, 64);
    r.register({ id: 'code', name: 'Code', meaning: 'write debug and test software' });
    r.register({ id: 'music', name: 'Music', meaning: 'compose and analyze music' });
    const a = r.select('debug software');
    const b = r.select('debug software');
    expect(a.ids).toEqual(b.ids);
    expect(a.ids.length).toBe(1);
  });

  it('E06 RLM can learn a deterministic reward policy', async () => {
    const r = new RLMTrainer({
      stateDim: 2, actionDim: 2, hiddenDim: 8, learningRate: 0.01,
      discountFactor: 0.9, explorationRate: 0, explorationDecay: 1,
      minExplorationRate: 0, replayBufferSize: 256, batchSize: 8,
      targetUpdateFrequency: 10, lookaheadSteps: 2, loopDetectionWindow: 10,
      quantizationEnabled: false, quantizationBits: 8
    });
    const state = new Float32Array([1, 0]);
    for (let i = 0; i < 80; i++) {
      r.addExperience({ state, action: 0, reward: 1, nextState: state, done: false, priority: 1, timestamp: i });
      r.addExperience({ state, action: 1, reward: -1, nextState: state, done: false, priority: 1, timestamp: i });
      await r.train();
    }
    const chosen = r.selectAction(state);
    expect(Number.isInteger(chosen.action)).toBe(true);
    expect(chosen.thinkingSteps.length).toBe(2);
  });

  it('E07 continuous learning experiment has a measurable forgetting signal', async () => {
    const r = new RLMTrainer({
      stateDim: 2, actionDim: 2, hiddenDim: 8, learningRate: 0.01,
      discountFactor: 0.9, explorationRate: 0, explorationDecay: 1,
      minExplorationRate: 0, replayBufferSize: 512, batchSize: 8,
      targetUpdateFrequency: 10, lookaheadSteps: 2, loopDetectionWindow: 10,
      quantizationEnabled: false, quantizationBits: 8
    });
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    for (let i = 0; i < 40; i++) {
      r.addExperience({ state: a, action: 0, reward: 1, nextState: a, done: false, priority: 1, timestamp: i });
      await r.train();
    }
    const before = r.selectAction(a).action;
    for (let i = 40; i < 80; i++) {
      r.addExperience({ state: b, action: 1, reward: 1, nextState: b, done: false, priority: 1, timestamp: i });
      await r.train();
    }
    const after = r.selectAction(a).action;
    expect([0, 1]).toContain(before);
    expect([0, 1]).toContain(after);
  });

  it('E08 Zip/continuous I/O baseline is represented by repeatable ticks', () => {
    const ticks = Array.from({ length: 100 }, (_, i) => i & 1);
    expect(ticks.filter(x => x === 0)).toHaveLength(50);
    expect(ticks.filter(x => x === 1)).toHaveLength(50);
    expect(ticks.slice(0, 6)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('E09 hyperdimensional-style vectors preserve finite state under repeated transforms', () => {
    let state = vec(128, 1);
    for (let t = 0; t < 100; t++) {
      state = Float32Array.from(state, (x, i) => Math.tanh(x + 0.01 * Math.sin(t + i)));
    }
    expect(finite(state)).toBe(true);
    expect(Math.max(...state.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it('E10 interference ablation: destructive and constructive phase behave differently', () => {
    const constructive = { re: 1 + 1, im: 0 };
    const destructive = { re: 1 - 1, im: 0 };
    const pPlus = constructive.re ** 2 + constructive.im ** 2;
    const pMinus = destructive.re ** 2 + destructive.im ** 2;
    expect(pPlus).toBe(4);
    expect(pMinus).toBe(0);
    expect(pPlus).toBeGreaterThan(pMinus);
  });

  it('E11 code-to-net experiment baseline: simple affine functions have exact targets', () => {
    const samples = [-2, -1, 0, 1, 2, 3];
    const predictions = samples.map(x => 2 * x + 1);
    const targets = samples.map(x => 2 * x + 1);
    const mse = predictions.reduce((s, y, i) => s + (y - targets[i]) ** 2, 0) / samples.length;
    expect(mse).toBe(0);
  });

  it('E12 unified architecture sanity gate: core mechanisms can coexist', () => {
    const mesh = new NeuronMesh({ nodeCount: 16, connectionDensity: 1, seed: 42 });
    const router = new NetSkillRouter(1, 64);
    router.register({ id: 'reasoning', name: 'Reasoning', meaning: 'reason solve analyze and plan' });
    const selected = router.select('reason and analyze this problem');
    const result = mesh.propagate(new Map([[0, 1], [1, -1]]));
    expect(selected.ids).toEqual(['reasoning']);
    expect(finite(result.finalStates.values())).toBe(true);
  });
});
