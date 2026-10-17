import { describe, it, expect } from 'vitest';
import { NeuronMesh, HyperDimensionalEngine, ZipLoopInterface, QuantumNeuralNet } from '../../models && skills/core/onebrain';
import { CodeToNetCompiler, CodeNet } from '../../models && skills/core/code-to-net';
import { ZipSpeaker } from '../../models && skills/core/zip-speech';
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

  // Was recorded as a failure ("task A's margin falls from 2.0 to 0.1-0.4"), which was a badly
  // designed test: A and B were nearly the same input with opposite answers. Measured properly
  // (20 fresh runs per row), replay keeps the old task right at every overlap, and without replay
  // it is lost:
  //   overlap 0.5  with replay 20/20 right, without 2/20      overlap 0.8  20/20 vs 0/20
  // The real limit is capacity, not forgetting: a linear policy cannot hold two nearly identical
  // inputs with opposite answers, so at overlap 0.95 the NEW task is learned only 5 times in 20.
  const unit = (c: number) => new Float32Array([c, Math.sqrt(1 - c * c)]);
  function clearBuffer(r: any) {
    r.replayBuffer = new Array(r.config.replayBufferSize);
    r.prioritiesBuffer = new Array(r.config.replayBufferSize);
    r.bufferSize = 0; r.bufferPosition = 0; r.cachedTotalPriority = 0;
  }
  async function learnTwoTasks(overlap: number, replay: boolean) {
    const A = new Float32Array([1, 0]);
    const B = unit(overlap);
    const r: any = new RLMTrainer(rlmConfig());
    await teach(r, A, 0, 0, 60);
    if (!replay) clearBuffer(r);
    await teach(r, B, 1, 100, 60);
    const qa = qOf(r, A), qb = qOf(r, B);
    return { aRight: qa[0] > qa[1], bRight: qb[1] > qb[0] };
  }
  const tally = async (overlap: number, replay: boolean, runs = 12) => {
    let a = 0, b = 0;
    for (let i = 0; i < runs; i++) { const res = await learnTwoTasks(overlap, replay); if (res.aRight) a++; if (res.bRight) b++; }
    return { a: a / runs, b: b / runs };
  };

  it('E07 replay keeps the old task right after a second task, at every overlap', async () => {
    for (const overlap of [0, 0.5, 0.8]) {
      const withReplay = await tally(overlap, true);
      expect(withReplay.a).toBeGreaterThanOrEqual(0.9);
    }
  }, 60000);

  it('E07b without replay the old task is lost (the control that shows replay is what protects it)', async () => {
    const without = await tally(0.8, false);
    expect(without.a).toBeLessThanOrEqual(0.2);
    expect(without.b).toBeGreaterThanOrEqual(0.9);
  }, 60000);

  it('E07c the limit is capacity: near-identical inputs with opposite answers cannot both be held', async () => {
    const easy = await tally(0, true);
    const hard = await tally(0.95, true);
    expect(easy.b).toBeGreaterThanOrEqual(0.9);
    expect(hard.b).toBeLessThan(0.7);           // the new task is mostly NOT learned
    expect(hard.a).toBeGreaterThanOrEqual(0.9);  // while the old one is still protected
  }, 60000);

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

  // ---- E05b: routing, measured on queries it was NOT tuned on ----
  // Measured (8 skills, chance 12.5%): queries that share words with a skill's description route
  // 88% right (it was 50% at 64 dimensions). Paraphrases that share no words are at chance (13%):
  // the router matches character patterns, not meaning, so a description alone cannot generalise.
  // It learns from outcomes (judge() teaches it which skill was right): one example per skill takes
  // unseen paraphrases from 13% to 33%.
  const SKILLS: [string, string][] = [
    ['code', 'write debug and test software programs'], ['music', 'compose play and analyze music songs'],
    ['cooking', 'cook recipes food ingredients and baking'], ['law', 'legal contracts court lawyers and regulations'],
    ['medicine', 'medical symptoms disease treatment and doctors'], ['travel', 'plan trips flights hotels and sightseeing'],
    ['finance', 'money budget investing stocks and taxes'], ['sports', 'football basketball training and athletes'],
  ];
  const SHARES_WORDS: [string, string][] = [
    ['debug my python program', 'code'], ['fix this bug in the software', 'code'], ['write a function to sort a list', 'code'],
    ['compose a melody for piano', 'music'], ['analyze this song', 'music'], ['what chords go with this tune', 'music'],
    ['bake bread with yeast', 'cooking'], ['a recipe for dinner with chicken', 'cooking'], ['how long to cook rice', 'cooking'],
    ['is this contract legal', 'law'], ['sue my landlord in court', 'law'], ['what regulations apply to my business', 'law'],
    ['what are the symptoms of the flu', 'medicine'], ['treatment for a broken arm', 'medicine'], ['should I see a doctor about this rash', 'medicine'],
    ['book a hotel in paris', 'travel'], ['plan my trip to japan', 'travel'], ['cheap flights to rome', 'travel'],
    ['how do I budget my money', 'finance'], ['should I invest in stocks', 'finance'], ['how are taxes calculated', 'finance'],
    ['best training plan for a marathon', 'sports'], ['who won the basketball game', 'sports'], ['football tactics for defense', 'sports'],
  ];
  const PARAPHRASES: [string, string][] = [
    ['my program crashes with a null pointer', 'code'], ['refactor this class and add unit tests', 'code'], ['why does my loop never terminate', 'code'],
    ['teach me a song on the guitar', 'music'], ['what key is this symphony in', 'music'], ['write lyrics and a chorus', 'music'],
    ['how do I make pasta sauce from scratch', 'cooking'], ['substitute butter in a cake', 'cooking'], ['grill a steak medium rare', 'cooking'],
    ['can my employer fire me without notice', 'law'], ['draft a lease agreement', 'law'], ['what does the judge decide in this case', 'law'],
    ['my throat hurts and I have a fever', 'medicine'], ['which pills are safe with antibiotics', 'medicine'], ['what is a normal blood pressure', 'medicine'],
    ['find a cheap hostel in berlin', 'travel'], ['what to see in a week in italy', 'travel'], ['do I need a visa for the trip', 'travel'],
    ['is it better to rent or buy a house with my savings', 'finance'], ['how do bonds and interest rates work', 'finance'], ['how to file my income return', 'finance'],
    ['how many players on a soccer team', 'sports'], ['improve my sprint speed and stamina', 'sports'], ['who is the best striker in the league', 'sports'],
  ];
  const freshRouter = () => {
    const r = new NetSkillRouter(1, 64);
    SKILLS.forEach(([id, meaning]) => r.register({ id, name: id, meaning }));
    return r;
  };
  const routedRight = (r: NetSkillRouter, set: [string, string][]) =>
    set.filter(([q, want]) => { const ids = r.select(q).ids; return ids.length === 1 && ids[0] === want; }).length / set.length;

  it('E05b queries that share words with a skill are routed to it', () => {
    expect(routedRight(freshRouter(), SHARES_WORDS)).toBeGreaterThanOrEqual(0.8);
  });

  it('E05c paraphrases with no shared words are at chance: a description alone cannot generalise', () => {
    expect(routedRight(freshRouter(), PARAPHRASES)).toBeLessThan(0.3);   // chance is 12.5%
  });

  it('E05d it learns from outcomes: one judged example per skill lifts unseen paraphrases above chance', () => {
    const r = freshRouter();
    const before = routedRight(r, PARAPHRASES);
    const seen = new Set<string>();
    for (const [q, skill] of SHARES_WORDS) {
      if (seen.has(skill)) continue;
      seen.add(skill);
      r.judge(q, [skill]);           // the same call the live system makes when a turn's outcome is known
    }
    const after = routedRight(r, PARAPHRASES);
    expect(after).toBeGreaterThan(before + 0.1);
    expect(after).toBeGreaterThanOrEqual(0.25);
  });

  it('E05f text that is about nothing is not routed anywhere (the mesh then runs ungated)', () => {
    const r = freshRouter();
    const nothing = ['qwzx blorf', 'zzzz', 'the quick brown fox', 'asdf ghjk', 'hello', 'lorem ipsum dolor sit amet', 'what time is it in tokyo is not sure'];
    expect(nothing.filter(q => r.select(q).ids.length === 0).length).toBeGreaterThanOrEqual(6);
  });

  it('E05e learning from one skill does not pull everything toward it', () => {
    const r = freshRouter();
    for (let i = 0; i < 20; i++) r.learn('how do I plan a trip with flights', ['travel']);
    expect(routedRight(r, SHARES_WORDS.filter(([, s]) => s !== 'travel'))).toBeGreaterThanOrEqual(0.7);
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

  // The thing the idea needs: teach question -> answer through the loop, then get the answer back.
  // The raw reader above cannot do it (nothing trains the output side, and a plain mesh forgets the
  // question). ZipSpeaker (zip-speech.ts) can: the mesh keeps the question with the memory switched
  // on, and a small learned readout turns that memory into the answer's bits. Measured: 8 of 8 on a
  // sparse mesh and on the live-sized one, with the memory off 1 of 4. See zip-speech.test.ts for
  // the limits (about 16 questions, and only the tail of a question is remembered).
  it('E08d a loop taught question -> answer speaks the answer back', () => {
    const sp = new ZipSpeaker(new HyperDimensionalEngine({ neuronCount: 24, dimensions: 8 } as never), { maxAnswerBytes: 8 });
    const facts: Array<[string, string]> = [['what is the capital of france?', 'Paris'], ['what is the capital of spain?', 'Madrid'], ['who wrote the book on whales?', 'Melville'], ['2+2=', '4']];
    sp.teach(facts.map(([question, answer]) => ({ question, answer })));
    for (const [q, a] of facts) expect(sp.speakText(q)).toBe(a);
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

  it('E11b an exact polynomial (x*x, x*y, a cubic) compiles to an exact circuit too', () => {
    const c = new CodeToNetCompiler();
    const cases: Array<[string, (x: number[]) => number, number[][]]> = [
      ['(x) => x*x', x => x[0] * x[0], [[0], [1.5], [20], [-300]]],
      ['(x, y) => x*y', x => x[0] * x[1], [[3, 4], [100, -50], [1e3, 1e3]]],
      ['(x, y) => x*x - 2*y*y + 3*x*y + x - 4', x => x[0] ** 2 - 2 * x[1] ** 2 + 3 * x[0] * x[1] + x[0] - 4, [[0, 0], [7, -3], [250, 80]]],
      ['(x) => (x + 1) * (x - 2) * (x + 3)', x => (x[0] + 1) * (x[0] - 2) * (x[0] + 3), [[0], [5], [-40], [100]]],
      ['(x, y, z) => x*y*z + z*z', x => x[0] * x[1] * x[2] + x[2] ** 2, [[1, 2, 3], [10, -10, 10]]],
    ];
    for (const [code, f, points] of cases) {
      const net = c.compile('poly', code);
      expect(net.tier).toBe('polynomial');
      for (const p of points) expect(net.evaluate(p)[0]).toBeCloseTo(f(p), 5);
      expect(c.testAgainst(net, code).meanAbsError).toBeLessThan(1e-6);
    }
  });

  it('E11b2 things that are not polynomials are not mistaken for one, and stay approximate', () => {
    const c = new CodeToNetCompiler();
    for (const code of ['(x) => Math.sin(x)', '(x) => Math.abs(x)', '(x) => Math.floor(x)', '(x) => Math.exp(x/3)', '(x) => 1/(1 + x*x)', '(x) => x > 0 ? x : 0', '(x, y) => Math.max(x, y)']) {
      const net = c.compile('nl', code);
      expect(net.mode).toBe('function');
      expect(net.tier).toBe('fitted');
    }
    // A fitted net matches inside the sampled range but cannot extrapolate: that is its limit.
    const sine = c.compile('sin', '(x) => Math.sin(x)');
    expect(Math.abs(sine.evaluate([1.5])[0] - Math.sin(1.5))).toBeLessThan(0.2);
    expect(Math.abs(sine.evaluate([20])[0] - Math.sin(20))).toBeGreaterThan(0.3);
  });

  it('E11c exact nets survive serialization', () => {
    const c = new CodeToNetCompiler();
    const affine = CodeNet.fromJSON(JSON.parse(JSON.stringify(c.compile('a', '(x, y) => 3*x - y + 2').toJSON())));
    expect(affine.tier).toBe('affine');
    expect(affine.evaluate([1e4, -5])[0]).toBeCloseTo(3e4 + 5 + 2, 6);
    const poly = CodeNet.fromJSON(JSON.parse(JSON.stringify(c.compile('p', '(x, y) => x*y + x*x').toJSON())));
    expect(poly.tier).toBe('polynomial');
    expect(poly.evaluate([1e3, 7])[0]).toBeCloseTo(1e3 * 7 + 1e6, 4);
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
