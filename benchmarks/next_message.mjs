// Does the next-message predictor learn anything beyond replay?
//
//   node benchmarks/next_message.mjs [--dist dist] [--mesh live64|sparse24] [--seed 1]
//        [--memory 0.97] [--standardize 0|1] [--out results.json]
//
// A scripted chat with a rule in it. Every conversation is four messages about one
// name, in a fixed order:
//     hi, I'm <n>   ->   hello <n>   ->   bye from <n>   ->   see you <n>
// so the next message is fixed by the previous one AND carries its name over.
//
// TRAIN    5 conversations, names A..E, streamed through observe() (prequential
//          loss is recorded on every pair BEFORE it is learned).
// TEST     (frozen: nothing more is learned)
//   replay        the same 5 conversations again. A table lookup gets these right,
//                 so a pass here is NOT counted as prediction.
//   unseen-name   3 conversations with names never heard. Only a predictor that
//                 learned "the name comes along" can get these. This is the number.
//
// BASELINES on the same test pairs:
//   repeat-last   predict the message just heard
//   lookup        previous message -> the message that followed it in training;
//                 for an unseen message, the answer to the nearest-length known one
//   rule oracle   the template with the name copied (what a perfect learner of the
//                 rule would say; shows the task is solvable, scores 100% by construction)
//
// LOSS: bit-level, 1.0 = learned nothing, 0 = exact; "before" is the untrained mesh.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { parseVariant, applyDensity } from './lib/engine-variants.mjs';

const args = process.argv.slice(2);
const opt = (n, f) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : f; };
const dist = resolve(opt('dist', 'dist'));
const MESH = opt('mesh', 'live64');
const SEED = Number(opt('seed', 1));
const MEMORY = Number(opt('memory', 0.97));
const STD = opt('standardize', '0') === '1';
const OUT = opt('out', null);

const base = pathToFileURL(`${dist}/models && skills/core/`).href;
const { HyperDimensionalEngine } = await import(base + 'onebrain.js');
const { NextMessagePredictor } = await import(base + 'next-message.js');

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shuffled = (arr, seed) => { const r = rng(seed), a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const TEMPLATES = [(n) => `hi, I'm ${n}`, (n) => `hello ${n}`, (n) => `bye from ${n}`, (n) => `see you ${n}`];
const NAMES = shuffled(['Ann', 'Bob', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal'], SEED * 13 + 1);
const trainNames = NAMES.slice(0, 5), unseenNames = NAMES.slice(5);
const convo = (n) => TEMPLATES.map((t) => t(n));

function meshConfig() {
  const live = { dimensions: 64, ballStates: 8, stateTransitionThreshold: 0.4, noveltyDecay: 0.05, historyLength: 500, learningRate: 0.05, influenceDecay: 0.95, crossInfluenceStrength: 0.2,
    hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1, waveGain: 0.1, connectionBias: true, propagationSteps: 32 };
  return MESH === 'live64' ? { ...live, neuronCount: 64, seed: SEED } : { neuronCount: 24, dimensions: 8, seed: SEED };
}

const VARIANT = parseVariant(args);
const engine = new HyperDimensionalEngine({ ...meshConfig(), ...VARIANT.engineOverrides });
applyDensity(engine, VARIANT.density, SEED);
const pred = new NextMessagePredictor(engine, { memoryVale: MEMORY, standardize: STD, maxBytes: 16 });

// ── train (streamed, prequential) ──
const t0 = performance.now();
const trainLoss = [];
for (const n of trainNames) {
  pred.newConversation();
  for (const m of convo(n)) { const o = pred.observe(m); if (o) trainLoss.push(+o.loss.toFixed(3)); }
}
const trainSeconds = (performance.now() - t0) / 1000;

// ── test pairs ──
const pairsOf = (names) => names.flatMap((n) => { const c = convo(n); return c.slice(0, -1).map((m, i) => ({ prev: m, next: c[i + 1], name: n, step: i })); });
const replay = pairsOf(trainNames), unseen = pairsOf(unseenNames);

const table = new Map(replay.map((p) => [p.prev, p.next]));
const lookup = (prev) => table.get(prev) ?? [...table.entries()].sort((a, b) => Math.abs(a[0].length - prev.length) - Math.abs(b[0].length - prev.length))[0][1];
const rule = (p) => TEMPLATES[p.step + 1](p.name);
const repeatLast = (p) => p.prev;

function score(set, label) {
  const rows = set.map((p) => {
    const said = pred.predict(p.prev);
    return { prev: p.prev, gold: p.next, said, exact: said === p.next, headRight: said.startsWith(p.next.slice(0, p.next.length - p.name.length)), repeatLast: repeatLast(p) === p.next, lookup: lookup(p.prev) === p.next, rule: rule(p) === p.next };
  });
  const frac = (k) => +(rows.filter((r) => r[k]).length / rows.length).toFixed(3);
  // partial credit that is not a replay: did it get the template part (everything before the name) right?
  const head = (s, n) => s.slice(0, s.length - n.length);
  return { label, n: rows.length, mesh: frac('exact'), repeatLast: frac('repeatLast'), lookup: frac('lookup'), ruleOracle: frac('rule'), templateRight: frac('headRight'), rows };
}
// per-pair bit loss, frozen
const lossOf = (set) => +(set.reduce((a, p) => a + pred.speaker.loss(p.prev, p.next.slice(0, 16)), 0) / set.length).toFixed(3);
// Loss of the best constant guess (the average training target for every output): what "learned nothing but the average" scores.
const targetsOf = (a) => { const b = Buffer.from(a.slice(0, 16), 'utf8'); const o = []; for (let i = 0; i < 16; i++) { const real = i < b.length; for (let k = 7; k >= 0; k--) o.push(real ? (((b[i] >> k) & 1) ? 1 : -1) : -1); o.push(real ? 1 : -1); } return o; };
const meanT = replay.map((p) => targetsOf(p.next)).reduce((acc, t) => acc.map((v, i) => v + t[i] / replay.length), new Array(16 * 9).fill(0));
const constLoss = (set) => +(set.reduce((a, p) => a + targetsOf(p.next).reduce((x, t, i) => x + (meanT[i] - t) ** 2, 0) / meanT.length, 0) / set.length).toFixed(3);
const R = score(replay, 'replay'), U = score(unseen, 'unseen-name');
const report = {
  meta: { dist, mesh: MESH, seed: SEED, memory: MEMORY, standardize: STD, trainNames, unseenNames, trainPairs: pred.pairCount(), trainSeconds: +trainSeconds.toFixed(1) },
  lossBeforeTraining: 1.0,
  prequentialLossFirstHalf: +(trainLoss.slice(0, Math.floor(trainLoss.length / 2)).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(trainLoss.length / 2))).toFixed(3),
  prequentialLossSecondHalf: +(trainLoss.slice(Math.floor(trainLoss.length / 2)).reduce((a, b) => a + b, 0) / Math.max(1, trainLoss.length - Math.floor(trainLoss.length / 2))).toFixed(3),
  lossAfterTraining: { replay: lossOf(replay), unseenName: lossOf(unseen) },
  lossOfConstantAverageGuess: { replay: constLoss(replay), unseenName: constLoss(unseen) },
  replay: R, unseen: U,
};
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1));
const pct = (x) => (x * 100).toFixed(0).padStart(3) + '%';
console.log(`seed ${SEED} mesh ${MESH} std ${STD} mem ${MEMORY} | train names ${trainNames} | unseen ${unseenNames} (${report.meta.trainSeconds}s)`);
console.log(`bit loss (clipped; 1.0 = nothing learned, chance ~1)  before 1.000 | prequential first half ${report.prequentialLossFirstHalf} -> second half ${report.prequentialLossSecondHalf} | after: replay ${report.lossAfterTraining.replay}, unseen-name ${report.lossAfterTraining.unseenName} | constant-average guess: ${report.lossOfConstantAverageGuess.unseenName}`);
console.log('exact next-message accuracy      mesh  repeat-last  lookup  rule-oracle  template-part-right');
for (const x of [R, U]) console.log(`  ${x.label.padEnd(12)} n=${String(x.n).padEnd(3)}        ${pct(x.mesh)}   ${pct(x.repeatLast)}        ${pct(x.lookup)}   ${pct(x.ruleOracle)}        ${pct(x.templateRight)}${x.label === 'replay' ? '   (replay: not counted as prediction)' : ''}`);
