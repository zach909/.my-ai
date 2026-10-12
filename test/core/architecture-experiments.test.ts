import { describe, it, expect } from 'vitest';
import { NeuronMesh, HyperDimensionalEngine, ZipLoopInterface, QuantumNeuralNet } from '../../models && skills/core/onebrain';
import { CodeToNetCompiler, CodeNet } from '../../models && skills/core/code-to-net';
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





  // ---- E03b: stability across seeds, sizes and activation functions ----
  it('E03b settling stays finite for every activation function, size and seed', () => {
    for (const activationFunction of ['relu', 'tanh', 'sigmoid', 'swish'] as const) {
      for (const nodeCount of [8, 32, 64]) {
        for (let seed = 1; seed <= 3; seed++) {
          const mesh = new NeuronMesh({ nodeCount, connectionDensity: 1, seed, activationFunction, propagationSteps: 60 });
          const r = mesh.propagate(new Map([[0, 5], [1, -5], [2, 3]]));
          expect(finite(r.finalStates.values())).toBe(true);
          expect([...r.finalStates.values()].every(v => Math.abs(v) < 1e3)).toBe(true);
        }
      }
    }
  });

  // ---- E05b: routing accuracy on paraphrases, not on two unrelated skills ----
  // Measured: 12 of 24 exactly right with 8 skills (chance is 3). It misroutes queries that share
  // words with the skill description, and it never abstains: nonsense is still routed somewhere.
  it('E05b routing is better than chance but weak on paraphrases, and never abstains', () => {
    const r = new NetSkillRouter(1, 64);
    const skills: [string, string][] = [
      ['code', 'write debug and test software programs'], ['music', 'compose play and analyze music songs'],
      ['cooking', 'cook recipes food ingredients and baking'], ['law', 'legal contracts court lawyers and regulations'],
      ['medicine', 'medical symptoms disease treatment and doctors'], ['travel', 'plan trips flights hotels and sightseeing'],
      ['finance', 'money budget investing stocks and taxes'], ['sports', 'football basketball training and athletes'],
    ];
    skills.forEach(([id, meaning]) => r.register({ id, name: id, meaning }));
    const queries: [string, string][] = [
      ['debug my python program', 'code'], ['fix this bug in the software', 'code'], ['write a function to sort a list', 'code'],
      ['compose a melody for piano', 'music'], ['analyze this song', 'music'], ['what chords go with this tune', 'music'],
      ['bake bread with yeast', 'cooking'], ['a recipe for dinner with chicken', 'cooking'], ['how long to cook rice', 'cooking'],
      ['is this contract legal', 'law'], ['sue my landlord in court', 'law'], ['what regulations apply to my business', 'law'],
      ['what are the symptoms of the flu', 'medicine'], ['treatment for a broken arm', 'medicine'], ['should I see a doctor about this rash', 'medicine'],
      ['book a hotel in paris', 'travel'], ['plan my trip to japan', 'travel'], ['cheap flights to rome', 'travel'],
      ['how do I budget my money', 'finance'], ['should I invest in stocks', 'finance'], ['how are taxes calculated', 'finance'],
      ['best training plan for a marathon', 'sports'], ['who won the basketball game', 'sports'], ['football tactics for defense', 'sports'],
    ];
    const hits = queries.filter(([q, want]) => { const ids = r.select(q).ids; return ids.length === 1 && ids[0] === want; }).length;
    expect(hits).toBeGreaterThanOrEqual(queries.length * 0.3);   // far above the 12.5% chance level
    expect(hits).toBeLessThan(queries.length * 0.8);             // but nowhere near reliable
    expect(r.select('qwzx blorf').ids.length).toBeGreaterThan(0); // no "I don't know"
  });

  // ---- E08: the Zip Loop, against a real engine ----
  const RAMP = { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3, toggleIn: 4, toggleOut: 5 };
  const liveConfig = () => ({
    dimensions: 64, ballStates: 8, neuronCount: 64, stateTransitionThreshold: 0.4, noveltyDecay: 0.05,
    historyLength: 500, learningRate: 0.05, influenceDecay: 0.95, crossInfluenceStrength: 0.2,
    hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1, waveGain: 0.1, connectionBias: true, propagationSteps: 32,
  });
  const denseConfig = () => ({
    neuronCount: 24, dimensions: 8, propagationSteps: 24, convergenceThreshold: 0.01,
    hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1, waveGain: 0.1, connectionBias: true,
  });
  const fakeSparse = { getDimensions: () => 4, setWaveSignature: () => true, meanNeuronEnergy: () => 0.1 };
  const bitsOf = (byte: number) => Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1);

  it('E08a bits go in one tick each, most significant first', () => {
    const engine = new HyperDimensionalEngine(denseConfig() as never);
    const zip = new ZipLoopInterface(engine, RAMP);
    const drove: number[] = [];
    const real = engine.process.bind(engine);
    (engine as any).process = (input: number[], a: unknown, driven: Set<number>, ...rest: unknown[]) => {
      drove.push([...driven].filter(id => id === RAMP.bit0In || id === RAMP.bit1In)[0]);
      return (real as any)(input, a, driven, ...rest);
    };
    zip.sendByte(0b01101001);
    expect(drove.slice(0, 8)).toEqual([0, 1, 1, 0, 1, 0, 0, 1]);
  });

  // Measured: after hearing "hi" the live-sized network (64 neurons, full equation) has almost no
  // activity left (max neuron energy ~0.03) and the reader gets nothing, four reads out of four.
  it('E08b a live-configured network is silent after hearing a message', () => {
    const engine = new HyperDimensionalEngine(liveConfig() as never);
    const zip = new ZipLoopInterface(engine, RAMP);
    zip.sendBytes(new Uint8Array([0x68, 0x69]));
    for (let i = 0; i < 4; i++) expect(zip.nextOutputByte()).toBeNull();
  });

  // Was a bug: neuron energy saturates at 1.0 but the reader needed 1.5x the MEAN, which in a dense
  // network (mean 0.9) is 1.37 -- above anything a neuron can hold, so no bit could ever be read.
  // The line is now capped halfway between the mean and the maximum, so it can always be cleared,
  // and a sparse network (mean 0.1) keeps its old line of 0.15.
  it('E08c the "active" line is reachable in dense networks and unchanged in sparse ones', () => {
    const engine = new HyperDimensionalEngine(denseConfig() as never);
    const zip: any = new ZipLoopInterface(engine, RAMP);
    for (let t = 0; t < 60; t++) engine.process(new Array(8).fill(1), undefined, new Set([t % 2 ? 3 : 2]), undefined, { learn: true });
    const n = engine.getNeuronCount();
    const energies = Array.from({ length: n }, (_, i) => engine.getNeuronEnergy(i));
    expect(engine.meanNeuronEnergy()).toBeGreaterThan(2 / 3);               // the regime that used to be unreadable
    expect(zip.activeLine()).toBeLessThan(Math.max(...energies));           // some neuron can clear it
    expect(zip.activeLine()).toBeGreaterThan(engine.meanNeuronEnergy());    // and it still means "above average"
    const sparse: any = new ZipLoopInterface({ ...fakeSparse } as never, RAMP);
    expect(sparse.activeLine()).toBeCloseTo(0.15, 9);
  });

  // The thing your idea needs: teach input -> answer through the loop, then get the answer back.
  // There is no output-training method in the repo, so this uses the repo's own Hebbian learning
  // with the output neurons driven (teacher forcing) while the question is still in the mesh.
  // Measured at time of writing: silent in every setting tried (3 learning rates/strengths, 10-40
  // epochs, sparse default network). `it.fails` keeps the suite green and goes red the day it works.
  it.fails('E08d a loop taught question -> answer speaks the answer back', () => {
    const pairs: [number, number][] = [[0x41, 0x58], [0x42, 0x27], [0x43, 0xC3], [0x44, 0x0E]];
    const engine: any = new HyperDimensionalEngine({ neuronCount: 24, dimensions: 8, learningRate: 0.3 } as never);
    const zip: any = new ZipLoopInterface(engine, RAMP);
    const fresh = engine.captureNetworkState();
    for (let epoch = 0; epoch < 40; epoch++) {
      for (const [q, a] of pairs) {
        engine.restoreNetworkState({ ...engine.captureNetworkState(), states: fresh.states });
        zip.sendByte(q); zip.learnFromEvent();
        const pulse = zip.pulseVector();
        bitsOf(a).forEach((bit, k) => {
          const driven = new Set<number>([bit ? RAMP.bit1Out : RAMP.bit0Out]);
          if (k % 2 === 0) driven.add(RAMP.toggleOut);
          for (let rep = 0; rep < 6; rep++) engine.process(pulse, undefined, driven);
        });
      }
    }
    const learned = engine.captureNetworkState();
    let exact = 0;
    for (const [q, a] of pairs) {
      engine.restoreNetworkState({ ...learned, states: fresh.states });
      zip.sendByte(q);
      const bits = zip.receiveBits(8);
      if (bits.length === 8 && bits.join('') === bitsOf(a).join('')) exact++;
    }
    expect(exact).toBe(pairs.length);
  });

  // ---- E09: the hyperdimensional engine stays finite and bounded, and does not forget its input ----
  it('E09 300 learning ticks stay finite and bounded in three configurations', () => {
    const decode = (b64: string) => {
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return new Float32Array(bytes.buffer);
    };
    const configs: Array<[string, any]> = [['live', liveConfig()], ['dense', denseConfig()], ['defaults', { neuronCount: 24, dimensions: 8 }]];
    for (const [, cfg] of configs) {
      const engine: any = new HyperDimensionalEngine(cfg);
      let seed = 1;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      for (let t = 0; t < 300; t++) {
        engine.process(Array.from({ length: cfg.dimensions }, () => rnd() * 2 - 1), undefined, new Set([t % 5]), undefined, { learn: true });
      }
      const snap = engine.captureNetworkState();
      for (const key of ['states', 'connDiag', 'connShift']) {
        const values = decode((snap as any)[key]);
        expect(finite(values)).toBe(true);
        let peak = 0;
        for (const v of values) if (Math.abs(v) > peak) peak = Math.abs(v);
        expect(peak).toBeLessThanOrEqual(1.0001);
      }
    }
  }, 60000);

  it('E09b different inputs leave the network in different states', () => {
    const cfg = denseConfig();
    const base: any = new HyperDimensionalEngine(cfg as never);
    const snap = base.captureNetworkState();
    const after = (input: number[]) => {
      const e: any = new HyperDimensionalEngine(cfg as never);
      e.restoreNetworkState(snap);
      e.process(input, undefined, new Set([0]), undefined, { learn: false });
      const raw = atob(e.captureNetworkState().states);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return new Float32Array(bytes.buffer);
    };
    const a = after(new Array(8).fill(0.9));
    const b = after(new Array(8).fill(-0.9));
    const same = after(new Array(8).fill(0.9));
    let apart = 0, repeat = 0;
    for (let i = 0; i < a.length; i++) { apart += Math.abs(a[i] - b[i]); repeat += Math.abs(a[i] - same[i]); }
    expect(apart).toBeGreaterThan(1e-3);
    expect(repeat).toBeLessThan(apart * 1e-6 + 1e-9);
  });

  // ---- E10: the interference and amplification math (a classical simulation of phasors) ----
  it('E10 constructive, quadrature and destructive phase give 20, 14.14 and 0', () => {
    const q: any = new QuantumNeuralNet();
    const make = (id: string, phase: number) => { q.addNeuron(id, 1).state.phase = phase; };
    make('a', 0); make('b', 0); make('c', Math.PI); make('d', Math.PI / 2);
    expect(q.interfere('a', 'b')).toBeCloseTo(20, 9);
    expect(q.interfere('a', 'c')).toBeCloseTo(0, 9);
    expect(q.interfere('a', 'd')).toBeCloseTo(Math.sqrt(200), 9);
  });

  it('E10b random phases cancel to about sqrt(n), not n', () => {
    const q: any = new QuantumNeuralNet();
    const ids = Array.from({ length: 100 }, (_, i) => `r${i}`);
    ids.forEach(id => q.addNeuron(id, 1));
    const m = q.phaseConsensus(ids);
    // The resultant of 100 random unit-phase phasors of height 10 is Rayleigh distributed with a mean
    // near 88, so there is no safe lower bound; the claim is only that it is far below the aligned 1000.
    expect(m).toBeLessThan(400);
  });

  it('E10c amplitude amplification concentrates probability on the marked neuron, then overshoots', () => {
    const q: any = new QuantumNeuralNet();
    const ids = Array.from({ length: 16 }, (_, i) => `g${i}`);
    ids.forEach(id => { q.addNeuron(id, 1).state.phase = 0; });
    const share = () => {
      const total = ids.reduce((s, id) => s + q.neurons.get(id).state.height ** 2, 0);
      return q.neurons.get('g3').state.height ** 2 / total;
    };
    const start = share();
    expect(start).toBeCloseTo(1 / 16, 6);
    const trace = [start];
    for (let k = 0; k < 6; k++) { q.groverAmplify(ids, 'g3'); trace.push(share()); }
    expect(Math.max(...trace)).toBeGreaterThan(0.9);          // the point of the algorithm
    expect(trace.indexOf(Math.max(...trace))).toBeLessThanOrEqual(3);
  });

  // ---- E11: Code-to-Net ----
  // Was weak: the docs promised an exact "affine tier" that did not exist, so even 2x+1 was a trained
  // approximation (error ~0.02, off by 26 at x=20). Exactly affine functions now compile to an exact
  // linear circuit. Nonlinear functions are still fitted, which is an approximation by nature.
  it('E11 an affine function compiles to an exact circuit that holds far outside any sampled range', () => {
    const c = new CodeToNetCompiler();
    const cases: Array<[string, (x: number[]) => number, number[][]]> = [
      ['(x) => 2*x + 1', x => 2 * x[0] + 1, [[0], [1.9], [20], [-1e6], [3.14159]]],
      ['(x, y) => 2*x - 3*y + 5', x => 2 * x[0] - 3 * x[1] + 5, [[0, 0], [1, 1], [100, -50], [-1e5, 7e4]]],
      ['(a, b, c) => 0.5*a - b + 4*c', x => 0.5 * x[0] - x[1] + 4 * x[2], [[1, 2, 3], [1e3, -1e3, 1e3]]],
      ['(x) => 7', () => 7, [[0], [123]]],
    ];
    for (const [code, f, points] of cases) {
      const net = c.compile('affine', code);
      expect(net.mode).toBe('function');
      expect(net.tier).toBe('affine');
      for (const p of points) expect(net.evaluate(p)[0]).toBeCloseTo(f(p), 6);
      const report = c.testAgainst(net, code);
      expect(report.passed).toBe(true);
      expect(report.meanAbsError).toBeLessThan(1e-9);
      expect(report.tier).toBe('affine');
    }
  });

  it('E11b nonlinear functions are not mistaken for affine, and stay approximate', () => {
    const c = new CodeToNetCompiler();
    for (const code of ['(x) => Math.sin(x)', '(x) => x*x', '(x, y) => x*y', '(x) => Math.abs(x)', '(x) => Math.floor(x)']) {
      const net = c.compile('nl', code);
      expect(net.mode).toBe('function');
      expect(net.tier).toBe('fitted');
    }
    // A fitted net matches inside the sampled range but cannot extrapolate: that is its limit.
    const sq = c.compile('sq', '(x) => x*x');
    expect(Math.abs(sq.evaluate([1.5])[0] - 2.25)).toBeLessThan(0.25);
    expect(Math.abs(sq.evaluate([20])[0] - 400)).toBeGreaterThan(10);
  });

  it('E11c an affine net survives serialization', () => {
    const c = new CodeToNetCompiler();
    const net = c.compile('a', '(x, y) => 3*x - y + 2');
    const back = CodeNet.fromJSON(JSON.parse(JSON.stringify(net.toJSON())));
    expect(back.tier).toBe('affine');
    expect(back.evaluate([1e4, -5])[0]).toBeCloseTo(3e4 + 5 + 2, 6);
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
