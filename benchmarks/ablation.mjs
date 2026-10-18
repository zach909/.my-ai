// Remove one mechanism at a time and measure what changes.
//
//   node scripts/build-backend.mjs
//   node benchmarks/ablation.mjs [--dist dist] [--seeds 1,2,3] [--out benchmarks/results/ablation] [--jobs 3] [--skip-gen]
//
// Every variant is the live mesh (64 neurons x 64 dims, memory 0.97) with ONE thing changed, run on the
// same tasks with the same seeds and the same data:
//   full            the live configuration
//   no-wave         waveGain, hyperWaveGain, hyperWaveAdd = 0       (the wave layer and its network terms)
//   no-hyper-term   hyperGain, hyperAdd = 0                         (the whole network's weight and bias in every connection)
//   no-conn-bias    connectionBias off                              (a bias per connection)
//   no-shift        crossInfluenceStrength 0                        (the neighbouring-dimension connections)
//   plain           all of the above off                            (a bare all-to-all tanh recurrent mesh)
//   density-0.5     half the connections kept (seeded mask)         (all-to-all -> sparse)
//   density-0.1     a tenth kept
// Tasks (each a separate script, reported as measured):
//   retention   zip_loop_recovery: can a readout recover the last 16 random bits sent?  (memory)
//   recall      zip_generalization: of 54 taught question->answer pairs, how many come back exactly; and the
//               held-out paraphrase score (0 everywhere so far, so it can only show an ablation making nothing worse)
//   next        next_message: held-out bit loss on unseen names and the loss of the constant average guess
//   cost        live_mesh_benchmark: ms per input bit, run alone at the end so the other jobs do not distort it
// The mesh is never trained here (the readouts are fitted in closed form on its state), so the question
// is what each mechanism adds to the representation the readout sees.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, f) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : f; };
const dist = resolve(opt('dist', 'dist'));
const seeds = opt('seeds', '1,2,3').split(',').map(Number);
const out = resolve(opt('out', 'benchmarks/results/ablation'));
const jobs = Number(opt('jobs', 3));
mkdirSync(out, { recursive: true });

const OFF_WAVE = { waveGain: 0, hyperWaveGain: 0, hyperWaveAdd: 0 };
const VARIANTS = {
  'full': { engine: {}, density: 1 },
  'no-wave': { engine: OFF_WAVE, density: 1 },
  'no-hyper-term': { engine: { hyperGain: 0, hyperAdd: 0 }, density: 1 },
  'no-conn-bias': { engine: { connectionBias: false }, density: 1 },
  'no-shift': { engine: { crossInfluenceStrength: 0 }, density: 1 },
  'plain': { engine: { ...OFF_WAVE, hyperGain: 0, hyperAdd: 0, connectionBias: false }, density: 1 },
  'density-0.5': { engine: {}, density: 0.5 },
  'density-0.1': { engine: {}, density: 0.1 },
};

const tasks = [];
for (const [name, v] of Object.entries(VARIANTS)) for (const seed of seeds) {
  const common = ['--dist', dist, '--seed', String(seed), '--engine', JSON.stringify(v.engine), '--density', String(v.density)];
  tasks.push({ key: `${name}.retention.${seed}`, script: 'zip_loop_recovery.mjs', argv: [...common, '--neurons', '64', '--bits', '16', '--train', '150', '--test', '80', '--memory', '0.97', '--json'], stdoutJson: true });
  tasks.push({ key: `${name}.next.${seed}`, script: 'next_message.mjs', argv: [...common, '--mesh', 'live64', '--out', join(out, `${name}.next.${seed}.json`)] });
  if (!args.includes('--skip-gen')) tasks.push({ key: `${name}.recall.${seed}`, script: 'zip_generalization.mjs', argv: [...common, '--mesh', 'live64', '--standardize', '1', '--out', join(out, `${name}.recall.${seed}.json`)] });
}
const run = (task) => new Promise((res) => {
  const file = join(out, `${task.key}.json`);
  if (existsSync(file)) return res();            // resumable
  const p = spawn(process.execPath, [join(import.meta.dirname, task.script), ...task.argv], { stdio: ['ignore', 'pipe', 'pipe'] });
  let so = ''; p.stdout.on('data', (d) => (so += d)); p.stderr.on('data', (d) => (so += d));
  p.on('close', (code) => { if (task.stdoutJson && code === 0) writeFileSync(file, so.trim().split('\n').pop()); else if (code !== 0) writeFileSync(join(out, `${task.key}.FAILED.txt`), so); console.log(task.key, code === 0 ? 'ok' : 'FAILED'); res(); });
});
let next = 0;
await Promise.all(Array.from({ length: jobs }, async () => { while (next < tasks.length) await run(tasks[next++]); }));

// cost, alone
const cost = {};
for (const [name, v] of Object.entries(VARIANTS)) {
  const file = join(out, `${name}.cost.json`);
  if (!existsSync(file)) {
    await new Promise((res) => { const p = spawn(process.execPath, [join(import.meta.dirname, 'live_mesh_benchmark.mjs'), '--dist', dist, '--neurons', '64', '--bytes', '2', '--repeats', '5', '--seed', '1', '--engine', JSON.stringify(v.engine), '--density', String(v.density), '--json'], { stdio: ['ignore', 'pipe', 'inherit'] }); let so = ''; p.stdout.on('data', (d) => (so += d)); p.on('close', () => { writeFileSync(file, so); res(); }); });
  }
  cost[name] = JSON.parse(readFileSync(file, 'utf8')).msPerBit.median;
}

// summary
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const load = (key) => { const f = join(out, `${key}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
const rows = [];
for (const name of Object.keys(VARIANTS)) {
  const ret = seeds.map((s) => load(`${name}.retention.${s}`)).filter(Boolean);
  const nxt = seeds.map((s) => load(`${name}.next.${s}`)).filter(Boolean);
  const rec = seeds.map((s) => load(`${name}.recall.${s}`)).filter(Boolean);
  const meshOf = (r) => Object.entries(r.systems).find(([k]) => k.startsWith('mesh'))[1];
  rows.push({
    variant: name,
    retentionMeanAcc: ret.length ? [mean(ret.map((r) => r.meanTestAccuracy)), sd(ret.map((r) => r.meanTestAccuracy))] : null,
    retentionAtAge8: ret.length ? mean(ret.map((r) => r.byAge.find((x) => x.age === 8).testAccuracy)) : null,
    recallTaughtExact: rec.length ? [mean(rec.map((r) => meshOf(r).test.byCategory['taught-exact'].correct / meshOf(r).test.byCategory['taught-exact'].n)), sd(rec.map((r) => meshOf(r).test.byCategory['taught-exact'].correct / meshOf(r).test.byCategory['taught-exact'].n))] : null,
    recallParaphraseExact: rec.length ? mean(rec.map((r) => meshOf(r).test.byCategory['para-capital'].correct / meshOf(r).test.byCategory['para-capital'].n)) : null,
    nextUnseenLoss: nxt.length ? [mean(nxt.map((r) => r.lossAfterTraining.unseenName)), mean(nxt.map((r) => r.lossOfConstantAverageGuess.unseenName))] : null,
    nextReplayExact: nxt.length ? mean(nxt.map((r) => r.replay.mesh)) : null,
    msPerBit: cost[name], seeds: seeds.length,
  });
}
writeFileSync(join(out, 'summary.json'), JSON.stringify(rows, null, 1));
const f = (x, d = 3) => (x === null ? '  -  ' : Array.isArray(x) ? `${x[0].toFixed(d)}±${x[1].toFixed(d)}` : x.toFixed(d));
console.log('\nvariant         retention(mean acc)  acc@age8  recall taught-exact  paraphrase  next unseen loss (vs const)  replay  ms/bit');
for (const r of rows) console.log(r.variant.padEnd(15), f(r.retentionMeanAcc).padEnd(20), f(r.retentionAtAge8).padEnd(9), f(r.recallTaughtExact).padEnd(20), f(r.recallParaphraseExact).padEnd(11), (r.nextUnseenLoss ? `${r.nextUnseenLoss[0].toFixed(3)} (${r.nextUnseenLoss[1].toFixed(3)})` : '-').padEnd(28), f(r.nextReplayExact, 2).padEnd(7), r.msPerBit.toFixed(1));
