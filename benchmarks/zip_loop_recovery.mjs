// Can the mesh HOLD a bit sequence that went through the Zip Loop?
//
// Transmission, not understanding. A random bit string goes in through the real
// doorway; the activity of every neuron outside the doorway is then read once,
// and a linear readout (closed-form ridge regression, fitted on training
// sequences) tries to recover each bit. Accuracy is scored on HELD-OUT random
// sequences. 50% is chance. If the mesh forgot a bit, no readout can bring it
// back, so this is a ceiling on any echo or recall built on top of the loop.
//
//   node benchmarks/zip_loop_recovery.mjs [--dist dist] [--neurons 64] [--bits 16]
//        [--train 200] [--test 100] [--memory 0|0.9|0.97] [--seed 1] [--json]
//
// The sequences are drawn from a seeded generator (not Math.random) and the
// engine is seeded, so a run is repeatable.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseVariant, applyDensity } from './lib/engine-variants.mjs';

const args = process.argv.slice(2);
const opt = (n, f) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : f; };
const dist = resolve(opt('dist', 'dist'));
const N = Number(opt('neurons', 64));
const L = Number(opt('bits', 16));
const TRAIN = Number(opt('train', 200));
const TEST = Number(opt('test', 100));
const MEMORY = Number(opt('memory', 0));
const SEED = Number(opt('seed', 1));
const STEPS = opt('steps', null);

const base = pathToFileURL(`${dist}/models && skills/core/`).href;
const { HyperDimensionalEngine, ZipLoopInterface, zipLoopIdsFor } = await import(base + 'onebrain.js');
const { freezeActivity, thawActivity } = await import(base + 'thread-context.js');

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const VARIANT = parseVariant(args);
const engine = new HyperDimensionalEngine({
  dimensions: 64, ballStates: 8, neuronCount: N, stateTransitionThreshold: 0.4, noveltyDecay: 0.05, historyLength: 500,
  learningRate: 0.05, influenceDecay: 0.95, crossInfluenceStrength: 0.2, hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1,
  hyperWaveAdd: 1, waveGain: 0.1, connectionBias: true, propagationSteps: 32, seed: SEED, ...VARIANT.engineOverrides,
});
const kept = applyDensity(engine, VARIANT.density, SEED);
const ids = zipLoopIdsFor(engine);
const zip = new ZipLoopInterface(engine, ids, MEMORY > 0 ? { memory: { vale: MEMORY } } : {});
const doorway = new Set(Object.values(ids).filter((v) => typeof v === 'number'));
const blank = freezeActivity(engine);
const dims = engine.getDimensions();
const scratch = new Float32Array(dims);

function features(bits) {
  thawActivity(engine, blank);
  for (const b of bits) zip.sendBit(b);
  const f = [];
  for (let i = 0; i < engine.getNeuronCount(); i++) {
    if (doorway.has(i)) continue;
    const w = engine.readNeuronContent(i, scratch);
    for (let d = 0; d < dims; d++) f.push(d < w ? scratch[d] : 0);
    f.push(engine.getNeuronEnergy(i));
  }
  return Float64Array.from(f);
}

const rand = rng(SEED * 7919 + 1);
const seqs = (n) => Array.from({ length: n }, () => Array.from({ length: L }, () => (rand() < 0.5 ? 0 : 1)));
const train = seqs(TRAIN), test = seqs(TEST);
const t0 = performance.now();
const Xtr = train.map(features), Xte = test.map(features);
const featMs = performance.now() - t0;

// Centre and scale, then dual ridge: alpha = (K + lambda I)^-1 y.
const S = Xtr.length, F = Xtr[0].length;
const mean = new Float64Array(F); for (const x of Xtr) for (let j = 0; j < F; j++) mean[j] += x[j] / S;
let e = 0; for (const x of Xtr) for (let j = 0; j < F; j++) e += (x[j] - mean[j]) ** 2;
const scale = Math.sqrt(e / (S * F)) || 1;
const Z = (x) => Float64Array.from(x, (v, j) => (v - mean[j]) / scale);
const Ztr = Xtr.map(Z), Zte = Xte.map(Z);
const dot = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s; };
const K = Array.from({ length: S }, () => new Float64Array(S));
for (let i = 0; i < S; i++) for (let j = i; j < S; j++) { K[i][j] = K[j][i] = dot(Ztr[i], Ztr[j]); }
let tr = 0; for (let i = 0; i < S; i++) tr += K[i][i];
const lambda = 1e-6 * (tr / S);
function solve(A, B) { // Gaussian elimination with partial pivoting, one right-hand side per column of B
  const n = A.length; const M = A.map((r, i) => { const m = Float64Array.from(r); m[i] += lambda; return m; }); const R = B.map((v) => Float64Array.from(v));
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (const v of R) [v[c], v[p]] = [v[p], v[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (!f) continue; for (let k = c; k < n; k++) M[r][k] -= f * M[c][k]; for (const v of R) v[r] -= f * v[c]; } }
  for (const v of R) for (let r = n - 1; r >= 0; r--) { let s = v[r]; for (let k = r + 1; k < n; k++) s -= M[r][k] * v[k]; v[r] = s / M[r][r]; }
  return R;
}
const targets = Array.from({ length: L }, (_, p) => Float64Array.from(train, (s) => (s[p] ? 1 : -1)));
const tmean = targets.map((t) => t.reduce((a, b) => a + b, 0) / S);
const alphas = solve(K, targets.map((t, p) => Float64Array.from(t, (v) => v - tmean[p])));
const predict = (z, p) => { let s = tmean[p]; for (let i = 0; i < S; i++) s += alphas[p][i] * dot(Ztr[i], z); return s >= 0 ? 1 : 0; };

const acc = (set, Zs) => Array.from({ length: L }, (_, p) => set.reduce((c, s, i) => c + (predict(Zs[i], p) === s[p] ? 1 : 0), 0) / set.length);
const trainAcc = acc(train, Ztr), testAcc = acc(test, Zte);
// Position p counts from the START of the sequence; "age" = bits sent after it.
const byAge = testAcc.map((a, p) => ({ age: L - 1 - p, testAccuracy: +a.toFixed(3), trainAccuracy: +trainAcc[p].toFixed(3) })).sort((a, b) => a.age - b.age);
const report = { variant: VARIANT, keptConnections: kept.kept, dist, neurons: N, memoryVale: MEMORY, sequenceBits: L, train: TRAIN, test: TEST, seed: SEED, features: F,
  chance: 0.5, meanTestAccuracy: +(testAcc.reduce((a, b) => a + b, 0) / L).toFixed(3), byAge, featureSeconds: +(featMs / 1000).toFixed(1) };
if (args.includes('--json')) console.log(JSON.stringify(report));
else { console.log(`neurons ${N}, memory ${MEMORY || 'off'}, ${L}-bit random sequences, ${TRAIN} train / ${TEST} test (chance 0.50), ${report.featureSeconds}s`);
  console.log('age (bits sent after it) -> held-out accuracy:'); console.log(byAge.map((r) => `${r.age}:${r.testAccuracy.toFixed(2)}`).join('  ')); }
