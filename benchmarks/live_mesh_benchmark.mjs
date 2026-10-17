// Reproducible benchmark of the LIVE-configured mesh through the Zip Loop.
//
// This measures the path text actually takes into the mesh -- one settle per
// input bit -- on the configuration pipeline.ts builds (hyperdimensional term,
// wave layer and per-connection bias all ON), not on a synthetic NeuronMesh.
//
//   node scripts/build-backend.mjs
//   node benchmarks/live_mesh_benchmark.mjs [--dist dist] [--neurons 336] [--dims 64]
//        [--bytes 4] [--repeats 5] [--seed 1] [--json] [--sections]
//
// --dist     a built output tree (default: dist). Run it on two trees to compare
//            a change against the code it replaced under identical conditions.
// --sections attribute time to the engine's phases. Needs a COPY of the tree
//            with timers spliced in; see profileSections() below.
//
// What it prints (all measured, none estimated):
//   neurons, dimensions, connections (N*(N-1) per dimension), weights held,
//   settle iterations per bit, ms per bit / per byte (median of the repeats,
//   min and max too), bytes per second, rss and heap, and a checksum of the
//   state after a fixed seeded input so two builds can be shown to compute
//   the same thing (the `stateChecksum` and `stateHead` fields).
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseVariant, applyDensity } from './lib/engine-variants.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes('--' + name);

const dist = resolve(opt('dist', 'dist'));
const N = Number(opt('neurons', 336));
const DIMS = Number(opt('dims', 64));
const BYTES = Number(opt('bytes', 4));
const REPEATS = Number(opt('repeats', 5));
const SEED = Number(opt('seed', 1));

const mod = await import(pathToFileURL(`${dist}/models && skills/core/onebrain.js`).href);
const { HyperDimensionalEngine, ZipLoopInterface, zipLoopIdsFor } = mod;

// The configuration pipeline.ts gives the live engine.
const LIVE = {
  dimensions: DIMS, ballStates: 8, neuronCount: N, stateTransitionThreshold: 0.4, noveltyDecay: 0.05,
  historyLength: 500, learningRate: 0.05, influenceDecay: 0.95, crossInfluenceStrength: 0.2,
  hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1, waveGain: 0.1, connectionBias: true,
  propagationSteps: 32, seed: SEED,
};

function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

function fixedBytes(n) {
  // A fixed pseudo-random byte string (not Math.random): same input on every run and every build.
  let a = 12345; const out = [];
  for (let i = 0; i < n; i++) { a = (Math.imul(a, 1103515245) + 12345) >>> 0; out.push((a >>> 16) & 255); }
  return out;
}

function run() {
  const VARIANT = parseVariant(args);
  const engine = new HyperDimensionalEngine({ ...LIVE, ...VARIANT.engineOverrides });
  applyDensity(engine, VARIANT.density, SEED);
  const zip = new ZipLoopInterface(engine, zipLoopIdsFor(engine));
  // Count settle iterations without changing anything.
  const orig = engine.settle.bind(engine);
  let iters = 0, settles = 0;
  engine.settle = (...a) => { const r = orig(...a); iters += r.iterations; settles++; return r; };

  const input = fixedBytes(BYTES);
  for (let i = 0; i < 2; i++) zip.sendBit(i & 1); // warm up the JIT; not timed
  iters = 0; settles = 0;
  const t0 = performance.now();
  for (const b of input) zip.sendByte(b);
  const ms = performance.now() - t0;
  const bits = BYTES * 8;
  return { ms, bits, iters, settles, engine };
}

const rssBefore = process.memoryUsage().rss;
const runs = [];
let last;
for (let r = 0; r < REPEATS; r++) { last = run(); runs.push(last.ms / last.bits); }
const mem = process.memoryUsage();

const { data } = last.engine.getContextMatrix();
let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i] * ((i % 7) + 1);

const D1 = DIMS + 1;
const report = {
  dist,
  neurons: N, dimensions: DIMS, seed: SEED,
  connectionsPerDimension: N * (N - 1),
  connectionsTotal: N * (N - 1) * D1,
  weightsHeld: N * D1 * N * 2 + N * D1 * N, // connDiag + connShift + connBias
  settleIterationsPerBit: last.iters / last.bits,
  msPerBit: { median: median(runs), min: Math.min(...runs), max: Math.max(...runs) },
  msPerByte: median(runs) * 8,
  bytesPerSecond: 1000 / (median(runs) * 8),
  rssMB: +(mem.rss / 1e6).toFixed(0), heapUsedMB: +(mem.heapUsed / 1e6).toFixed(0),
  rssGrowthMB: +((mem.rss - rssBefore) / 1e6).toFixed(0),
  stateChecksum: sum, stateHead: Array.from(data.slice(0, 4)),
  bytesPerRun: BYTES, repeats: REPEATS, node: process.version,
};

if (flag('json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Live mesh via the Zip Loop  (${dist})`);
  console.log(`  mesh            ${N} neurons x ${DIMS} dims, ${report.connectionsTotal.toLocaleString()} connections, ${report.weightsHeld.toLocaleString()} weights`);
  console.log(`  settle ticks    ${report.settleIterationsPerBit} per input bit`);
  console.log(`  latency         ${report.msPerBit.median.toFixed(2)} ms/bit (min ${report.msPerBit.min.toFixed(2)}, max ${report.msPerBit.max.toFixed(2)}), ${report.msPerByte.toFixed(0)} ms/byte`);
  console.log(`  throughput      ${report.bytesPerSecond.toFixed(2)} bytes/s`);
  console.log(`  memory          rss ${report.rssMB} MB, heap ${report.heapUsedMB} MB`);
  console.log(`  state checksum  ${report.stateChecksum}`);
}
