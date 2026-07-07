// Dependency-free smoke suite for the NeuroLang / Prometheus Elastic Core
// TypeScript stack. Run with `npm test` (which builds first). Imports the
// compiled output in dist/ via file URLs so the spaces and `&&` in the
// "models && skills" directory name don't break ESM specifier resolution.
//
// This encodes the end-to-end behaviour that was previously only verified by
// hand: the pipeline runs without NaN, adding experts doesn't poison routing,
// generation is stable, RLM lookahead actually selects, the zip loop's disk
// persistence round-trips, and the app entrypoint wires up.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = resolve(process.cwd(), 'dist');
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

let passed = 0;
let failed = 0;
const results = [];
function check(cond, msg) {
  if (cond) { passed++; results.push(`  ok   ${msg}`); }
  else { failed++; results.push(`  FAIL ${msg}`); }
}
const allFinite = (arr) => Array.from(arr).every(Number.isFinite);
function embedding(dim, seed) {
  const a = new Float32Array(dim);
  let s = seed;
  for (let i = 0; i < dim; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; a[i] = (s / 0x7fffffff) * 2 - 1; }
  return a;
}

async function testMoE() {
  const { MoERouter } = await load('models && skills/core/moe-router.js');
  const cfg = { numExperts: 8, topK: 2, inputDim: 32, outputDim: 32, expertHiddenDim: 32, loadBalancingLoss: 0.01 };
  const base = new MoERouter(cfg);
  const baseOut = Array.from(base.forward(embedding(32, 1), 0).output);
  check(baseOut.length === 32 && allFinite(baseOut), 'MoE base routing is finite');

  const withExperts = new MoERouter(cfg);
  for (let i = 0; i < 6; i++) withExperts.addExpert({ id: `p${i}`, name: `plugin${i}`, specialization: 'x' });
  const out = Array.from(withExperts.forward(embedding(32, 2), 0).output);
  check(out.length === 32 && allFinite(out), 'MoE routing stays finite after addExpert (NaN regression)');

  // removeExpert must keep the dense (input x expert) invariant so the next
  // forward() doesn't index out of bounds.
  const rm = new MoERouter(cfg);
  for (let i = 0; i < 4; i++) rm.addExpert({ id: `e${i}`, name: `e${i}`, specialization: 'x' });
  const beforeCount = rm.getExpertCount();
  rm.removeExpert(3); // delete a middle expert
  let removeOk = true;
  try {
    const o = Array.from(rm.forward(embedding(32, 3), 0).output);
    removeOk = o.length === 32 && allFinite(o) && rm.getExpertCount() === beforeCount - 1;
    rm.addExpert({ id: 'again', name: 'again', specialization: 'x' });
    const o2 = Array.from(rm.forward(embedding(32, 4), 0).output);
    removeOk = removeOk && allFinite(o2);
  } catch { removeOk = false; }
  check(removeOk, 'MoE forward works after removeExpert and remove+add (out-of-bounds regression)');
}

async function testPipeline() {
  const { NeuroPipeline } = await load('models && skills/core/pipeline.js');
  const p = new NeuroPipeline({ embeddingDim: 32, hiddenDim: 32, meshNodes: 16, hyperDimensions: 16 });
  let bad = 0;
  let stageNames = [];
  let lastAlignment = null;
  for (let t = 0; t < 3; t++) {
    const res = await p.run(embedding(32, t + 1), `tick ${t}`);
    if (!allFinite(res.output)) bad++;
    stageNames = res.steps.map(s => s.name);
    lastAlignment = res.alignment;
  }
  check(bad === 0, 'Pipeline output finite across 3 ticks (NaN regression)');
  check(stageNames.includes('alignment-veto'), 'Pipeline runs the alignment-veto stage');
  check(lastAlignment && typeof lastAlignment.allowed === 'boolean' && Array.isArray(lastAlignment.reasons),
    'Pipeline result carries an alignment verdict');
}

async function testLLM() {
  const { NeuroclawLLM } = await load('models && skills/llm.js');
  const llm = new NeuroclawLLM();
  const prompts = ['hello world', 'build me a website', 'analyze this data', 'fix the bug'];
  let empties = 0, suspect = 0, errs = 0;
  for (const prompt of prompts) {
    try {
      const out = await llm.generate(prompt);
      if (!out || out.length === 0) empties++;
      if (/NaN|undefined/.test(out)) suspect++;
    } catch { errs++; }
  }
  check(errs === 0, 'LLM.generate does not throw (repeated addExpert path)');
  check(empties === 0, 'LLM.generate returns non-empty output');
  check(suspect === 0, 'LLM.generate output free of NaN/undefined');

  // A query-intent generation must not duplicate its Plan line (fallback path).
  const q = await llm.generate('hello world');
  check((q.match(/Plan:/g) || []).length <= 1, 'LLM.generate does not duplicate the Plan line on query intent');

  // Section 9 symbolic trace is reachable through the LLM (the `trace` CLI command).
  const tr = llm.traceNeuron(3, 2, 5);
  check(tr && typeof tr.equation === 'string' && Number.isFinite(tr.value), 'LLM.traceNeuron exposes a symbolic trace');
  check(llm.traceNeuron(999999, 0, 5) === null, 'LLM.traceNeuron returns null for an out-of-range neuron');
}

async function testRLM() {
  const { RLMTrainer } = await load('models && skills/core/rlm.js');
  const trainer = new RLMTrainer({ stateDim: 4, actionDim: 5, hiddenDim: 4, explorationRate: 0, lookaheadSteps: 3 });
  const r = trainer.selectAction(new Float32Array([0.5, -0.2, 0.1, 0.9]));
  check(r.action === r.thinkingSteps[0], 'RLM commits to the top-scored candidate');
  check(r.thinkingSteps.length === 3, `RLM emits lookaheadSteps candidates (got ${r.thinkingSteps.length})`);
  check(new Set(r.thinkingSteps).size === r.thinkingSteps.length, 'RLM thinkingSteps are distinct (no padding dupes)');
}

async function testZipPersistence() {
  const { ZipIOSystem } = await load('models && skills/core/zip-io.js');
  const dir = mkdtempSync(join(tmpdir(), 'zipio-test-'));
  try {
    const a = new ZipIOSystem(1000, dir, 1);
    await a.ingest('the quick brown fox jumps over the lazy dog');
    await a.persist();

    const b = new ZipIOSystem(1000, dir, 1);
    await b.restore();
    let restored = '';
    for await (const chunk of b.getFullContext()) restored += chunk;
    check(restored.includes('quick brown fox'), 'ZipIO context survives persist -> restore');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function testProductionConfigAndEdges() {
  const { NeuroPipeline } = await load('models && skills/core/pipeline.js');
  const p = new NeuroPipeline(); // default 768/512/32/64 production config
  const r1 = await p.run(embedding(768, 1), 'production config');
  check(r1.output.length === 768 && allFinite(r1.output), 'Pipeline finite at default production config');
  const r2 = await p.run(embedding(768, 2), '');
  check(allFinite(r2.output), 'Pipeline finite on empty input text');
  const r3 = await p.run(embedding(768, 3), 'word '.repeat(5000));
  check(allFinite(r3.output), 'Pipeline finite on very long input');
  const r4 = await p.run(new Float32Array(768), 'zeros');
  check(allFinite(r4.output), 'Pipeline finite on all-zero embedding');
  const r5 = await p.run(embedding(768, 5));
  check(allFinite(r5.output), 'Pipeline finite with no input-text arg');
}

async function testHyperdimensional() {
  const { HyperDimensionalEngine } = await load('models && skills/core/hyperdimensional.js');
  const hd = new HyperDimensionalEngine({ dimensions: 8, neuronCount: 12 });
  const a = hd.process(Array.from({ length: 8 }, (_, i) => Math.sin(i)));
  check(allFinite(a.outputVector) && a.selfModelSurprise === 0, 'Hyper first tick finite, surprise=0');
  const b = hd.process(Array.from({ length: 8 }, (_, i) => Math.cos(i)));
  check(Number.isFinite(b.selfModelSurprise) && b.selfModelSurprise >= 0, 'Hyper self-model surprise finite and >= 0');
  check(b.inputTopography instanceof Map && b.inputTopography.size === 12, 'Hyper reports per-neuron input topography');
  hd.process(new Array(8).fill(0.5), undefined, new Set([0]));
  check(typeof hd.isExclusiveInput(0.9).exclusive === 'boolean', 'Hyper isExclusiveInput returns a verdict');
  const ctx = hd.getContextMatrix();
  check(ctx.data.length === 12 * 9 && allFinite(ctx.data), 'Hyper getContextMatrix sized (neurons x totalDims) and finite');
}

async function testSymbolicTrace() {
  const { HyperDimensionalEngine } = await load('models && skills/core/hyperdimensional.js');
  const hd = new HyperDimensionalEngine({ dimensions: 6, neuronCount: 10, crossInfluenceStrength: 0.3, propagationSteps: 30, convergenceThreshold: 0.01 });
  // Drive only neuron 0, so neurons 1..9 settle purely via tanh(W·S) and their traces are faithful.
  hd.process([0.4, -0.2, 0.7, -0.5, 0.1, 0.9], undefined, new Set([0]));
  const states = hd.getNeuronStates();

  // Exact algebra: bias + sum(all term contributions) === preActivation, value === tanh(preActivation).
  const full = hd.traceNeuron(5, 2, 999);
  const summed = full.bias + full.terms.reduce((s, t) => s + t.contribution, 0);
  check(Math.abs(summed - full.preActivation) < 1e-5, 'Symbolic trace terms sum exactly to pre-activation');
  check(Math.abs(full.value - Math.tanh(full.preActivation)) < 1e-9, 'Symbolic trace value is tanh(pre-activation)');

  // Faithful to the settled mesh within the convergence residual, and flags clamping.
  check(!full.inputClamped && Math.abs(full.value - states[5].state[2]) < 0.05, 'Symbolic trace matches settled state (non-driven neuron)');
  check(hd.traceNeuron(0, 2, 3).inputClamped === true, 'Symbolic trace flags an input-clamped neuron as counterfactual');

  // Ranked by magnitude and out-of-range safe.
  const ranked = hd.traceNeuron(5, 2, 4);
  check(ranked.terms.length === 4 && Math.abs(ranked.terms[0].contribution) >= Math.abs(ranked.terms[3].contribution), 'Symbolic trace returns topK terms ranked by magnitude');
  check(hd.traceNeuron(5, 999, 3) === null && hd.traceNeuron(9999, 0, 3) === null, 'Symbolic trace returns null for out-of-range neuron/dim');
}

async function testDefinitionTraining() {
  const { HyperDimensionalEngine } = await load('models && skills/core/hyperdimensional.js');
  const mk = () => new HyperDimensionalEngine({ dimensions: 4, neuronCount: 8, propagationSteps: 12, convergenceThreshold: 0.01 });

  // A satisfiable definishon converges and reports its readout satisfied.
  const c1 = mk().trainDefinitions(
    [{ driveNeuronId: 0, input: [1, 0, -1, 0.5], readoutNeuronId: 5, target: [0.5, -0.5, 0.5, -0.5] }],
    { epochs: 300 },
  );
  check(c1.converged && c1.satisfied.includes(5) && c1.conflicts.length === 0, 'Definishon training satisfies a solvable contract');

  // Contradictory contracts (same readout, opposite targets) are flagged, neither satisfied.
  const c2 = mk().trainDefinitions([
    { driveNeuronId: 0, input: [1, 0, 0, 0], readoutNeuronId: 5, target: [0.9, 0.9, 0.9, 0.9] },
    { driveNeuronId: 0, input: [1, 0, 0, 0], readoutNeuronId: 5, target: [-0.9, -0.9, -0.9, -0.9] },
  ], { epochs: 300 });
  check(!c2.converged && c2.satisfied.length === 0 && c2.conflicts.some(x => x.a === 0 && x.b === 1), 'Definishon training detects a contradictory pair');

  // Independent contracts on different readouts both satisfy, no false conflict.
  const c3 = mk().trainDefinitions([
    { driveNeuronId: 0, input: [1, 0, 0, 0], readoutNeuronId: 5, target: [0.3, -0.3, 0.3, -0.3] },
    { driveNeuronId: 1, input: [0, 1, 0, 0], readoutNeuronId: 6, target: [-0.4, 0.4, -0.4, 0.4] },
  ], { epochs: 300 });
  check(c3.satisfied.length === 2 && c3.conflicts.length === 0, 'Definishon training satisfies independent contracts without false conflict');
}

async function testQuantum() {
  const { QuantumNeuralNet } = await load('models && skills/core/quantum-net.js');
  const q = new QuantumNeuralNet();
  q.addNeuron('a', 0.3); q.addNeuron('b', -0.6);
  q.createSuperposition('a', [0.3, 0.4, 0.2]); q.createSuperposition('b', [-0.6, -0.5, -0.7]);
  check(Number.isFinite(q.interfere('a', 'b')), 'Quantum interfere() finite');
  check(Number.isFinite(q.phaseConsensus(['a', 'b'])), 'Quantum phaseConsensus() finite');
  q.evolvePhase('a', 0.1);
  check(Number.isFinite(q.collapse('a')), 'Quantum collapse() finite after phase evolution');
}

async function testMeshStability() {
  const { NeuronMesh } = await load('models && skills/core/mesh.js');
  const mesh = new NeuronMesh({ nodeCount: 24, connectionDensity: 1.0, propagationSteps: 15, convergenceThreshold: 0.01, activationFn: 'tanh', learningRate: 0.01, initialConnectionWeight: 0.01, dampingFactor: 0.85, seed: 7 });
  let ok = true;
  for (let t = 0; t < 10; t++) {
    const inputs = new Map();
    for (let i = 0; i < 12; i++) inputs.set(i, Math.sin(i + t));
    if (!allFinite(Array.from(mesh.propagate(inputs).finalStates.values()))) ok = false;
  }
  check(ok, 'Mesh stays finite/stable over 10 propagation cycles');
}

async function testAlignmentVeto() {
  const { AlignmentVeto } = await load('models && skills/core/alignment-veto.js');
  const veto = new AlignmentVeto();

  // Benign, reversible, internal action → allowed, no confirmation.
  const benign = veto.evaluate({ id: 'a', name: 'read file', capabilities: ['file-read'], reversible: true });
  check(benign.allowed && !benign.requiresConfirmation, 'Veto allows a benign reversible action');

  // Objectionable capability → blocked outright.
  const deceptive = veto.evaluate({ id: 'b', name: 'mislead user', capabilities: ['deceive'], reversible: true });
  check(!deceptive.allowed, 'Veto blocks an objectionable capability');

  // Irreversible → human in the loop (requires confirmation), not silently allowed.
  const irreversible = veto.evaluate({ id: 'c', name: 'delete data', capabilities: ['file-delete'], reversible: false });
  check(irreversible.requiresConfirmation, 'Veto escalates an irreversible action to confirmation');

  // Severe self-model drift fails safe → blocked.
  const drifting = veto.evaluate({ id: 'd', name: 'routine', capabilities: ['noop'], reversible: true }, { selfModelSurprise: 0.9 });
  check(!drifting.allowed, 'Veto blocks under severe self-model drift (fails safe)');

  // Mild drift → escalate to confirmation, not block.
  const mildDrift = veto.evaluate({ id: 'e', name: 'routine', capabilities: ['noop'], reversible: true }, { selfModelSurprise: 0.4 });
  check(mildDrift.requiresConfirmation && mildDrift.allowed, 'Veto escalates (not blocks) under mild drift');

  // Decisions are inspectable and score bounded [0,1].
  check(Array.isArray(deceptive.reasons) && deceptive.reasons.length > 0, 'Veto decisions carry inspectable reasons');
  check(benign.score >= 0 && benign.score <= 1, 'Veto benevolence score is bounded [0,1]');

  // Injectable scorer is honored (an input to the veto, never a learned objective).
  const strict = new AlignmentVeto({ scorer: () => 0.1, scoreThreshold: 0.5 });
  check(!strict.evaluate({ id: 'f', name: 'x', reversible: true }).allowed, 'Veto honors an injected benevolence scorer');
}

async function testNumberSystems() {
  const C = await load('models && skills/core/complex.js');
  const D = await load('models && skills/core/dual.js');
  const near = (a, b, t = 1e-9) => Math.abs(a - b) < t;

  // Complex: division-algebra laws (Section 13, Hurwitz size 2).
  check(near(C.mul(C.I, C.I).re, -1) && near(C.mul(C.I, C.I).im, 0), 'Complex: i·i = -1');
  const z = C.complex(3, -4);
  check(near(C.abs(z), 5), 'Complex: |3-4i| = 5');
  check(near(C.abs(C.mul(z, C.complex(1, 2))), C.abs(z) * C.abs(C.complex(1, 2))), 'Complex: |z·w| = |z||w|');
  const one = C.mul(z, C.inv(z));
  check(near(one.re, 1) && near(one.im, 0), 'Complex: z·z⁻¹ = 1 (division-algebra inverse)');

  // Dual: forward-mode derivatives (Section 13 → live correction).
  const x = D.variable(3);
  const sq = D.mul(x, x);
  check(near(sq.val, 9) && near(sq.der, 6), 'Dual: d/dx x² at 3 = 6');
  const th = D.tanh(D.variable(0.5));
  check(near(th.der, 1 - Math.tanh(0.5) ** 2), 'Dual: tanh carries derivative 1-tanh²');

  // QIL uses the complex substrate; interference is |zA + zB|.
  const { QuantumNeuralNet } = await load('models && skills/core/quantum-net.js');
  const q = new QuantumNeuralNet();
  q.addNeuron('a', 0.5); q.addNeuron('b', 0.5);
  check(q.getComplexAmplitude('a') && typeof q.getComplexAmplitude('a').re === 'number', 'QIL exposes genuine complex amplitude');
  check(Number.isFinite(q.interfere('a', 'b')), 'QIL interfere() (complex |zA+zB|) is finite');

  // Self-model derivative in one pass matches finite difference.
  const { HyperDimensionalEngine } = await load('models && skills/core/hyperdimensional.js');
  const hd = new HyperDimensionalEngine({ dimensions: 6, neuronCount: 8 });
  hd.process([0.2, -0.3, 0.5, 0.1, -0.4, 0.6]);
  const base = [0.2, -0.3, 0.5, 0.1, -0.4, 0.6];
  const der = hd.predictSelfModelWithDerivative(base, [1, 0, 0, 0, 0, 0]).derivative[0];
  const eps = 1e-5, bumped = [...base]; bumped[0] += eps;
  const p0 = hd.predictSelfModelWithDerivative(base, new Array(6).fill(0)).value[0];
  const p1 = hd.predictSelfModelWithDerivative(bumped, new Array(6).fill(0)).value[0];
  check(near(der, (p1 - p0) / eps, 1e-3), 'Self-model dual derivative matches finite difference');
}

async function testBootstrap() {
  const { bootstrap } = await load('interface/main.js');
  const cli = await bootstrap();
  check(cli && typeof cli.startInteractive === 'function', 'App bootstrap wires a startable CLI');

  // Bootstrap must populate the plugin/skill catalog, not launch empty.
  const { PluginRegistry } = await load('plugin_manager/registry.js');
  const reg = new PluginRegistry();
  await reg.bootstrap();
  check(reg.getPluginCount() > 0, `App bootstrap registers a plugin catalog (${reg.getPluginCount()} plugins)`);
}

async function testWebBackend() {
  const http = await import('node:http');
  const { startWeb } = await load('interface/main.js');
  const port = 7900 + Math.floor(Math.random() * 90);
  const web = await startWeb(port);
  try {
    const get = (path) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path }, res => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
      }).on('error', reject);
    });
    const post = (path, obj) => new Promise((resolve, reject) => {
      const payload = JSON.stringify(obj);
      const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      req.on('error', reject); req.write(payload); req.end();
    });

    const status = await get('/api/status');
    const statusJson = JSON.parse(status.body);
    check(status.status === 200 && statusJson.running === true, 'Web backend /api/status returns live status');

    const chat = await post('/api/chat', { message: 'analyze this data' });
    const chatJson = JSON.parse(chat.body);
    check(chat.status === 200 && typeof chatJson.response === 'string' && chatJson.response.length > 0,
      'Web backend /api/chat returns a real neural-pipeline response (server.py bridge target)');
  } finally {
    await web.stop();
  }
}

async function main() {
  const suites = [
    ['MoE router', testMoE],
    ['Pipeline', testPipeline],
    ['LLM generate', testLLM],
    ['RLM select', testRLM],
    ['Production config & edges', testProductionConfigAndEdges],
    ['Hyperdimensional', testHyperdimensional],
    ['Symbolic trace', testSymbolicTrace],
    ['Definishon training', testDefinitionTraining],
    ['Quantum interference', testQuantum],
    ['Mesh stability', testMeshStability],
    ['Alignment veto', testAlignmentVeto],
    ['Number systems (complex/dual)', testNumberSystems],
    ['ZipIO persistence', testZipPersistence],
    ['App bootstrap', testBootstrap],
    ['Web backend (server.py bridge)', testWebBackend],
  ];
  for (const [name, fn] of suites) {
    results.push(`\n${name}:`);
    try { await fn(); }
    catch (e) { failed++; results.push(`  FAIL ${name} threw: ${e && e.message}`); }
  }
  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
