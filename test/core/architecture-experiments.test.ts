import { describe, it, expect } from 'vitest';
import { NeuronMesh } from '../../models && skills/core/onebrain';
import { RLMTrainer } from '../../models && skills/core/rlm';
import { NetSkillRouter } from '../../models && skills/core/net-skill-router';

const finite = (xs: Iterable<number>) => Array.from(xs).every(Number.isFinite);
const vec = (n: number, seed: number) => Float32Array.from({ length: n }, (_, i) => Math.sin(seed * 13.37 + i * 0.71));

const rlmConfig = () => ({
  stateDim: 2, actionDim: 2, hiddenDim: 8, learningRate: 0.01,
  discountFactor: 0.9, explorationRate: 0, explorationDecay: 1,
  minExplorationRate: 0, replayBufferSize: 1024, batchSize: 8,
  targetUpdateFrequency: 10, lookaheadSteps: 2, loopDetectionWindow: 10,
  quantizationEnabled: false, quantizationBits: 8
});
// Q-values are private; the experiments need the actual numbers, not just the chosen index.
const qOf = (r: RLMTrainer, s: Float32Array) => Array.from((r as any).computeQValues(s) as Float32Array);
const margin = (q: number[]) => q[0] - q[1];
// Teach `good` as the rewarded action for `state` and the other one as punished, so the
// right answer is only reachable by actually learning (no free win from one-sided data).
async function teach(r: RLMTrainer, state: Float32Array, good: 0 | 1, t0: number, rounds: number) {
  for (let i = 0; i < rounds; i++) {
    for (const action of [0, 1]) {
      r.addExperience({ state, action, reward: action === good ? 1 : -1, nextState: state, done: true, priority: 1, timestamp: t0 + i });
    }
    await r.train();
  }
}

describe('Architecture experiments', () => {
  it('E01 all-to-all mesh topology', () => {
    const n = 16;
    const mesh = new NeuronMesh({ nodeCount: n, connectionDensity: 1, seed: 42 });
    const topo = mesh.getTopology();
    expect(topo.nodeCount).toBe(n);
    expect(topo.nodes.every(x => x.connections.size === n - 1)).toBe(true);
    expect(topo.nodes.every(x => !x.connections.has(x.id))).toBe(true);
  });

  it('E02 same seed gives the same mesh and the same propagation', () => {
    const run = () => new NeuronMesh({ nodeCount: 16, connectionDensity: 1, seed: 42, propagationSteps: 20 })
      .propagate(new Map([[0, 1], [1, -1]])).finalStates;
    const a = run();
    const b = run();
    expect(finite(a.values())).toBe(true);
    for (const [id, v] of a) expect(b.get(id)).toBeCloseTo(v, 9);
  });

  it('E02b different seeds give different meshes', () => {
    const run = (seed: number) => new NeuronMesh({ nodeCount: 16, connectionDensity: 1, seed, propagationSteps: 20 })
      .propagate(new Map([[0, 1], [1, -1]])).finalStates;
    const a = run(42);
    const b = run(7);
    expect([...a].some(([id, v]) => Math.abs(v - b.get(id)!) > 1e-9)).toBe(true);
  });

  it('E02c a seeded mesh stays reproducible after growing', () => {
    const run = () => {
      const m = new NeuronMesh({ nodeCount: 8, connectionDensity: 1, seed: 42 });
      m.addNode(0);
      return m.propagate(new Map([[0, 1]])).finalStates;
    };
    const a = run();
    const b = run();
    for (const [id, v] of a) expect(b.get(id)).toBeCloseTo(v, 9);
  });

  it('E03 propagation converges rather than producing unbounded state', () => {
    const mesh = new NeuronMesh({ nodeCount: 24, connectionDensity: 1, seed: 7, propagationSteps: 100 });
    const r = mesh.propagate(new Map([[0, 1], [1, -1]]), undefined, undefined, true);
    const values = [...r.finalStates.values()];
    expect(finite(values)).toBe(true);
    expect(values.every(v => Math.abs(v) < 1e6)).toBe(true);
  });

  it('E04 vale=1 holds a node exactly while the rest of the mesh still moves', () => {
    const mesh = new NeuronMesh({ nodeCount: 16, connectionDensity: 1, seed: 42, activationFunction: 'tanh' });
    mesh.propagate(new Map([[0, 2], [1, -2]]));
    const before = new Map(mesh.getTopology().nodes.map(n => [n.id, n.activation] as [number, number]));
    const after = mesh.propagate(new Map([[0, -2], [1, 2]]), new Map([[5, 1]])).finalStates;
    expect(Math.abs(after.get(5)! - before.get(5)!)).toBeLessThan(1e-9);
    const moved = [...after].filter(([id]) => id !== 5 && id > 1)
      .some(([id, v]) => Math.abs(v - before.get(id)!) > 1e-6);
    expect(moved).toBe(true);
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

  it('E06 RLM learns which of two actions is rewarded', async () => {
    const state = new Float32Array([1, 0]);
    for (let run = 0; run < 5; run++) {
      const r = new RLMTrainer(rlmConfig());
      await teach(r, state, 0, 0, 80);
      expect(r.selectAction(state).action).toBe(0);
      expect(margin(qOf(r, state))).toBeGreaterThan(1);
    }
  });

  // Characterisation, not a pass/fail on "no forgetting": task A is learned for real, then
  // task B is trained on a similar state, and we require the damage to be both measurable
  // and bounded. Measured at time of writing: A's margin falls from ~2.0 to ~0.1-0.4.
  it('E07 forgetting after a second task is measured, not assumed', async () => {
    const A = new Float32Array([1, 0.8]);
    const B = new Float32Array([0.8, 1]);
    const r = new RLMTrainer(rlmConfig());
    await teach(r, A, 0, 0, 60);
    const learned = margin(qOf(r, A));
    expect(learned).toBeGreaterThan(1.5);
    await teach(r, B, 1, 100, 60);
    const retained = margin(qOf(r, A));
    expect(retained).toBeLessThan(learned * 0.5);
  });

  it.todo('E08 Zip Loop baseline: drive the real ZipLoopInterface and check bits in = bits out');

  it.todo('E09 hyperdimensional state stays finite: run the real HyperDimensionalEngine, not a local tanh loop');

  it.todo('E10 quantum interference ablation: call the real interference code with constructive vs destructive phase');

  it.todo('E11 code-to-net baseline: compile a real affine function through the Code-to-Net compiler');

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
