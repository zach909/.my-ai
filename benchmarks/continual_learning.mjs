// Continual learning on the real mesh: does learning something new destroy what was learned?
//
//   node benchmarks/continual_learning.mjs [--dist dist] [--mesh live64|sparse24] [--seed 1] [--protect 0.9] [--out results.json]
//
// There are two places a taught answer can be lost, and this measures both.
//
//  1. The READOUT. A ZipSpeaker is fitted on the mesh's state for task A's 12 questions. Teaching task B
//     by calling teach(B) REPLACES it: the naive way to learn a second task.
//  2. The MESH. Every chat message the live system hears is a learning event (learnFromEvent: Hebbian
//     weight updates on all-to-all connections). The readout was fitted against the weights as they
//     were, so exposure alone changes what it reads. Here task B arrives as 30 such events.
//
// Strategies after the 30 events (A and B are 12 question->answer pairs each; chance is ~0):
//   stale         keep A's readout untouched                         (does the mesh drift under it?)
//   overwrite     teach(B) only                                      (naive sequential teaching)
//   rehearsal     teach(A + B): re-read every stored pair on the changed mesh, refit
//   rehearsal-3   teach(3 of A + B): replay only a quarter of A       (do un-replayed A pairs survive?)
// and, for the exposure itself, protection of the neurons task A depends on (the elastic idea, applied to
// the live engine's per-neuron learning rates): the most important `--protect` fraction of neurons get
// learning rate 0 during the 30 events. Controls, so it is the RIGHT neurons or nothing:
//   protect       importance = how much each neuron's reading varies across A's questions
//   scrambled     the same number of neurons, chosen at random
//   slower        every neuron's rate cut by the same fraction as protect cuts it on average
// Each is scored on A with A's untouched readout (no refit, no replay) and on B with a readout fitted on B.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, f) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : f; };
const dist = resolve(opt('dist', 'dist'));
const MESH = opt('mesh', 'live64');
const SEED = Number(opt('seed', 1));
const PROTECT = Number(opt('protect', 0.9));
const OUT = opt('out', null);
const STD = opt('standardize', '1') === '1';
const base = pathToFileURL(`${dist}/models && skills/core/`).href;
const { HyperDimensionalEngine, ZipLoopInterface, zipLoopIdsFor } = await import(base + 'onebrain.js');
const { ZipSpeaker } = await import(base + 'zip-speech.js');

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const live = { dimensions: 64, ballStates: 8, stateTransitionThreshold: 0.4, noveltyDecay: 0.05, historyLength: 500, learningRate: 0.05, influenceDecay: 0.95, crossInfluenceStrength: 0.2, hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1, waveGain: 0.1, connectionBias: true, propagationSteps: 32 };
const cfg = () => (MESH === 'live64' ? { ...live, neuronCount: 64, seed: SEED } : { neuronCount: 24, dimensions: 8, seed: SEED });

const CITIES = ['paris', 'madrid', 'rome', 'berlin', 'tokyo', 'cairo', 'lima', 'oslo', 'athens', 'havana', 'nairobi', 'bern'];
const FRUITS = ['apple', 'pear', 'plum', 'fig', 'lime', 'kiwi', 'mango', 'peach', 'grape', 'lemon', 'melon', 'guava'];
const A = CITIES.map((c, i) => ({ question: `capital of ${c}?`, answer: `A${i}-${c}`.slice(0, 12) }));
const B = FRUITS.map((f, i) => ({ question: `colour of a ${f}?`, answer: `B${i}-${f}`.slice(0, 12) }));
const EVENTS = Array.from({ length: 30 }, (_, i) => { const p = B[i % B.length]; return `${p.question} ${p.answer}`; });

const nCorrect = (sp, pairs) => pairs.filter((p) => sp.speakText(p.question) === p.answer).length;

function build() {
  const engine = new HyperDimensionalEngine(cfg());
  const sp = new ZipSpeaker(engine, { maxAnswerBytes: 12, standardize: STD });
  sp.teach(A);
  return { engine, sp };
}
const meanAbsChange = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

/** Run the 30 learning events on `engine`, with per-neuron learning rates if given. */
function expose(engine, rates) {
  const ids = zipLoopIdsFor(engine);
  const zip = new ZipLoopInterface(engine, ids, { memory: { vale: 0.97 } });
  const real = engine.process.bind(engine);
  if (rates) engine.process = (input, lr, driven, vale, options) => real(input, options?.learn === false ? lr : (lr ?? rates), driven, vale, options);
  for (const m of EVENTS) zip.sendBytes(Buffer.from(m));
  engine.process = real;
}

/** Per-neuron importance for A: summed variance of that neuron's reading across A's questions. */
function importance(sp, engine) {
  const X = A.map((p) => sp.features(Buffer.from(p.question)));
  const n = engine.getNeuronCount(), dims = engine.getDimensions() + 1;
  const ids = zipLoopIdsFor(engine);
  const door = new Set(Object.values(ids).filter((v) => typeof v === 'number'));
  const imp = new Array(n).fill(0);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (door.has(i)) continue;
    for (let d = 0; d < dims; d++, k++) { let m = 0; for (const x of X) m += x[k] / X.length; let v = 0; for (const x of X) v += (x[k] - m) ** 2 / X.length; imp[i] += v; }
  }
  return imp;
}

const results = { meta: { dist, mesh: MESH, seed: SEED, protectFraction: PROTECT, A: A.length, B: B.length, events: EVENTS.length }, strategies: {} };
const t0 = performance.now();
{ const { sp } = build(); results.beforeAnyDrift = { A: nCorrect(sp, A) }; }

const variant = (name, ratesFor) => {
  const { engine, sp } = build();
  const before = Float32Array.from(engine.connDiag);
  const rates = ratesFor ? ratesFor(engine, sp) : undefined;
  expose(engine, rates);
  const moved = meanAbsChange(before, engine.connDiag);
  sp.forget();
  const staleA = nCorrect(sp, A);                                      // A's readout, untouched, on the changed mesh
  const out = { weightsMovedMeanAbs: +moved.toExponential(3), staleA };
  // B can still be learned on the changed mesh (a fresh readout):
  const spB = new ZipSpeaker(engine, { maxAnswerBytes: 12, standardize: STD }); spB.teach(B); out.learnsB = nCorrect(spB, B);
  if (name === 'unprotected') {
    const sp2 = new ZipSpeaker(engine, { maxAnswerBytes: 12, standardize: STD }); sp2.teach(B);
    out.overwrite = { A: nCorrect(sp2, A), B: nCorrect(sp2, B) };
    const sp3 = new ZipSpeaker(engine, { maxAnswerBytes: 12, standardize: STD }); sp3.teach([...A, ...B]);
    out.rehearsal = { A: nCorrect(sp3, A), B: nCorrect(sp3, B) };
    const sp4 = new ZipSpeaker(engine, { maxAnswerBytes: 12, standardize: STD }); sp4.teach([...A.slice(0, 3), ...B]);
    out.rehearsal3 = { A: nCorrect(sp4, A), Areplayed: nCorrect(sp4, A.slice(0, 3)), Aunreplayed: nCorrect(sp4, A.slice(3)), B: nCorrect(sp4, B) };
  }
  results.strategies[name] = out;
  console.log(name.padEnd(12), JSON.stringify(out));
};

variant('unprotected', null);
variant('protect', (engine, sp) => {
  const imp = importance(sp, engine);
  const order = imp.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const k = Math.round(PROTECT * imp.length);
  const rates = new Map(); order.slice(0, k).forEach(([, i]) => rates.set(i, 0));
  return rates;
});
variant('scrambled', (engine) => {
  const n = engine.getNeuronCount(), r = rng(SEED * 977 + 5), idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const rates = new Map(); idx.slice(0, Math.round(PROTECT * n)).forEach((i) => rates.set(i, 0));
  return rates;
});
variant('slower', (engine) => {
  const rates = new Map(); const base = engine.config.learningRate; for (let i = 0; i < engine.getNeuronCount(); i++) rates.set(i, base * (1 - PROTECT));
  return rates;
});
results.seconds = +((performance.now() - t0) / 1000).toFixed(1);
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
