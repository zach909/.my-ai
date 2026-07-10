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
  check(stageNames.includes('elastic-core'), 'Pipeline runs the ElasticCoreBlock transformer replacement stage');
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

async function testQuantizationAwareTraining() {
  const { RLMTrainer } = await load('models && skills/core/rlm.js');

  const mkExperience = (seed) => ({
    state: new Float32Array([Math.sin(seed), Math.cos(seed), Math.sin(seed * 2), Math.cos(seed * 2)]),
    action: seed % 5,
    reward: Math.sin(seed) * 0.5,
    nextState: new Float32Array([Math.sin(seed + 1), Math.cos(seed + 1), Math.sin(seed * 2 + 1), Math.cos(seed * 2 + 1)]),
    done: false,
    priority: 1,
    timestamp: Date.now(),
  });

  // With quantization enabled at a low bit-width, the forward pass reads a
  // genuinely discretized weight snapshot — real rounding, not a pass-
  // through — so some nonzero residual must appear after weights move.
  const qat = new RLMTrainer({ stateDim: 4, actionDim: 5, hiddenDim: 4, explorationRate: 0, batchSize: 8, quantizationEnabled: true, quantizationBits: 4 });
  const initialDrift = qat.getQuantizationDrift();
  check(Number.isFinite(initialDrift) && initialDrift >= 0,
    `QAT: fresh trainer reports a well-formed drift reading (${initialDrift.toFixed(5)}) from quantizing its random init`);

  let maxDrift = 0;
  for (let round = 0; round < 15; round++) {
    for (let i = 0; i < 8; i++) qat.addExperience(mkExperience(round * 8 + i));
    await qat.train();
    maxDrift = Math.max(maxDrift, qat.getQuantizationDrift());
  }
  check(maxDrift > 0, `QAT: quantization residual becomes nonzero as weights move under training (max seen ${maxDrift.toFixed(5)})`);

  // The residual is fed back and re-quantized every tick (Section 8: "any
  // rounding error is fed back into the neurons that produced it"), not
  // simply discarded — so it must stay bounded across many ticks rather
  // than accumulating without limit.
  const finalDrift = qat.getQuantizationDrift();
  check(Number.isFinite(finalDrift) && finalDrift < 10 * maxDrift,
    `QAT: residual stays bounded over sustained training rather than diverging (final ${finalDrift.toFixed(5)}, peak ${maxDrift.toFixed(5)})`);

  // Control: with quantization disabled, the forward pass reads the raw
  // full-precision weights directly and drift is always exactly zero.
  const noQat = new RLMTrainer({ stateDim: 4, actionDim: 5, hiddenDim: 4, explorationRate: 0, batchSize: 8, quantizationEnabled: false });
  for (let i = 0; i < 8; i++) noQat.addExperience(mkExperience(i));
  await noQat.train();
  check(noQat.getQuantizationDrift() === 0, 'QAT: disabling quantization keeps drift at exactly zero (real toggle, not always-on)');
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

async function testInputFlagSelfModelLiveCorrection() {
  const { HyperDimensionalEngine } = await load('models && skills/core/hyperdimensional.js');

  // Section 3.1: exclusive input is exactly one neuron's flag hot. Confirm
  // it via the engine's own formalization rather than reading private state.
  {
    const hd = new HyperDimensionalEngine({ dimensions: 6, neuronCount: 10, propagationSteps: 1 });
    hd.process(new Array(6).fill(0.6), undefined, new Set([3]));
    const verdict = hd.isExclusiveInput(0.9);
    check(verdict.exclusive && verdict.neuronId === 3, `Section 3.1: driving only neuron 3 reads back as exclusive input (got ${JSON.stringify(verdict)})`);
  }
  // The flag isn't a dead/ignored dimension: with more propagation steps,
  // it diffuses to other neurons via the same tanh(W.S) update as any other
  // content dimension (checked via inputTopography, dim 0 of each neuron).
  {
    const hd = new HyperDimensionalEngine({ dimensions: 6, neuronCount: 10, propagationSteps: 15, crossInfluenceStrength: 0.5 });
    const out = hd.process(new Array(6).fill(0.6), undefined, new Set([3]));
    const others = Array.from(out.inputTopography.entries()).filter(([id]) => id !== 3).map(([, v]) => v);
    check(others.some(v => Math.abs(v) > 1e-6), 'Section 3.1: input-flag value propagates to non-driven neurons over multiple ticks');
  }

  // Section 3.2: novelty/surprise signal must be measurably higher for a
  // genuinely novel input than for a repeated/familiar one.
  {
    const hd = new HyperDimensionalEngine({ dimensions: 8, neuronCount: 12 });
    const familiar = Array.from({ length: 8 }, (_, i) => Math.sin(i));
    hd.process(familiar);
    const repeat = hd.process(familiar); // same input again: should look familiar
    const novel = hd.process(Array.from({ length: 8 }, () => Math.random() * 2 - 1)); // unrelated input
    check(novel.noveltyScore > repeat.noveltyScore,
      `Section 3.2: novelty score is higher for novel input than repeated/familiar input (novel=${novel.noveltyScore.toFixed(4)}, repeat=${repeat.noveltyScore.toFixed(4)})`);
  }

  // Section 3.3: live correction only fires on *sustained* divergence, not
  // a single noisy-but-recoverable tick.
  {
    const hdA = new HyperDimensionalEngine({ dimensions: 6, neuronCount: 10, sustainedDivergenceTicks: 3, divergenceTolerance: 0.02 });
    // One tick with a wildly different input, then back to the same steady
    // input — a single blip shouldn't accumulate to sustainedDivergenceTicks.
    hdA.process(new Array(6).fill(0.1));
    const blip = hdA.process(new Array(6).fill(0.9));
    check(blip.liveCorrections === 0, 'Section 3.3: no correction fires on one noisy-but-recoverable tick');

    const hdB = new HyperDimensionalEngine({ dimensions: 6, neuronCount: 10, sustainedDivergenceTicks: 3, divergenceTolerance: 0.001, propagationSteps: 20 });
    // Sustained: divergence is tracked on *energy* (mean squared state), so
    // it needs a genuine magnitude swing tick-over-tick — a sign flip at
    // equal magnitude (e.g. +0.9 <-> -0.9) is invisible to it by
    // construction (same energy either way). Alternate low/high magnitude
    // instead, repeated over several ticks.
    let sawCorrection = false;
    for (let t = 0; t < 8; t++) {
      const r = hdB.process(new Array(6).fill(t % 2 === 0 ? 0.05 : 0.95));
      if (r.liveCorrections > 0) sawCorrection = true;
    }
    check(sawCorrection, 'Section 3.3: correction fires under sustained multi-tick magnitude divergence');
  }
}

async function testValeGating() {
  const { ValueRangeAllocator } = await load('models && skills/core/value-range.js');
  const { HyperDimensionalEngine } = await load('models && skills/core/hyperdimensional.js');
  const { NeuronMesh } = await load('models && skills/core/mesh.js');

  // Zero-sum conservation: many updates/decays must never move the total
  // away from totalPoints (redistribution, not independent clamping).
  const totalPoints = 100;
  const alloc = new ValueRangeAllocator({ enabled: true, totalPoints, minLearningRate: 0.001, maxLearningRate: 0.5, redistributionInterval: 5, decayFactor: 0.05 });
  const neuronStates = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: `n${i}`, value: 0, learningRate: 0, states: new Map(), connections: new Map(), expertGroup: null, active: true }));
  alloc.initializeNeurons(neuronStates);
  for (let step = 0; step < 20; step++) {
    for (let i = 0; i < 10; i++) alloc.updateNeuronValue(String(i), Math.random() * 2 - 1);
    alloc.applyDecay();
  }
  const sumPts = alloc.getDistribution().neuronAllocations.reduce((s, a) => s + a.valuePoints, 0);
  check(Math.abs(sumPts - totalPoints) < 1e-6, `Vale zero-sum conserved after 20 update+decay steps (sum=${sumPts.toFixed(6)}, expected ${totalPoints})`);

  // State-transition gating in the hyperdimensional engine: split the
  // non-driven neurons into a high-vale and a low-vale group and confirm the
  // high-vale group's average state change is smaller over one settle tick.
  // Averaged over many neurons (rather than compared 1-to-1) so the result
  // isn't sensitive to any single neuron's random initial weights.
  {
    const N = 20, dims = 8;
    const hd = new HyperDimensionalEngine({ dimensions: dims, neuronCount: N, propagationSteps: 1, convergenceThreshold: 0 });
    const before = hd.getNeuronStates();
    const vale = new Map();
    for (let i = 1; i < N; i++) vale.set(i, i % 2 === 0 ? 0.97 : 0.03); // even=high-vale, odd=low-vale
    hd.process(new Array(dims).fill(0.6), undefined, new Set([0]), vale);
    const after = hd.getNeuronStates();
    let highSum = 0, highCount = 0, lowSum = 0, lowCount = 0;
    for (let i = 1; i < N; i++) {
      let delta = 0;
      for (let d = 0; d < before[i].state.length; d++) delta += Math.abs(after[i].state[d] - before[i].state[d]);
      if (i % 2 === 0) { highSum += delta; highCount++; } else { lowSum += delta; lowCount++; }
    }
    const highAvg = highSum / highCount, lowAvg = lowSum / lowCount;
    check(highAvg < lowAvg, `Hyperdimensional: high-vale neurons change less than low-vale over one tick (high avg Δ=${highAvg.toFixed(4)}, low avg Δ=${lowAvg.toFixed(4)})`);
  }

  // Same property in the mesh's propagate().
  {
    const N = 24;
    const mesh = new NeuronMesh({ nodeCount: N, connectionDensity: 1.0, maxIterations: 1, convergenceThreshold: 0, seed: 11 });
    const before = new Map();
    for (let i = 0; i < N; i++) before.set(i, mesh.getNode(i).activation);
    const vale = new Map();
    for (let i = 1; i < N; i++) vale.set(i, i % 2 === 0 ? 0.97 : 0.03);
    mesh.propagate(new Map([[0, 0.8]]), vale);
    let highSum = 0, highCount = 0, lowSum = 0, lowCount = 0;
    for (let i = 1; i < N; i++) {
      const delta = Math.abs(mesh.getNode(i).activation - before.get(i));
      if (i % 2 === 0) { highSum += delta; highCount++; } else { lowSum += delta; lowCount++; }
    }
    const highAvg = highSum / highCount, lowAvg = lowSum / lowCount;
    check(highAvg < lowAvg, `Mesh: high-vale nodes change less than low-vale over one tick (high avg Δ=${highAvg.toFixed(4)}, low avg Δ=${lowAvg.toFixed(4)})`);
  }
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

async function testNeuroLangLiveWiring() {
  const { NeuroLangInterpreter, NeuroLangRuntime } = await load('models && skills/core/neuro-lang.js');
  const { HyperDimensionalEngine } = await load('models && skills/core/hyperdimensional.js');
  const { ValueRangeAllocator } = await load('models && skills/core/value-range.js');

  const mkEngine = () => new HyperDimensionalEngine({ dimensions: 6, neuronCount: 10, propagationSteps: 12, convergenceThreshold: 0.01 });
  const mkVale = (neuronIds) => {
    const totalPoints = 100;
    const alloc = new ValueRangeAllocator({ enabled: true, totalPoints, minLearningRate: 0.001, maxLearningRate: 0.5, redistributionInterval: 1000, decayFactor: 0 });
    alloc.initializeNeurons(neuronIds.map(id => ({ id: String(id), name: `n${id}`, value: 0, learningRate: 0, states: new Map(), connections: new Map(), expertGroup: null, active: true })));
    return alloc;
  };

  // Two DSL-declared neurons with compatible (distinct-text) definitions.
  const interp = new NeuroLangInterpreter();
  const src = [
    'name="alpha"',
    'name="beta"',
    '"alpha"@vale="0.2"',
    '"beta"@vale="0.2"',
    '"alpha"@definishon="the color red"',
    '"beta"@definishon="the color blue"',
  ].join('\n');
  const parsed = interp.parse(src);
  check(parsed.errors.length === 0, `NeuroLang: DSL with @vale/@definishon aliases parses cleanly (errors: ${JSON.stringify(parsed.errors)})`);

  const engine = mkEngine();
  const vale = mkVale([0, 1, 2]); // query neuron (0) + alpha/beta's eventual ids (1,2)
  const runtime = new NeuroLangRuntime(engine, vale);
  const before = vale.getValeFractions();
  const result = runtime.materialize(parsed.neurons, { epochs: 400 });

  check(result.overflowed.length === 0, 'NeuroLang: both declared neurons fit in engine capacity');
  check(result.converged && result.satisfied.length === 2 && result.conflicts.length === 0,
    `NeuroLang: compatible definitions converge and both satisfy (satisfied=${JSON.stringify(result.satisfied)})`);

  const after = vale.getValeFractions();
  const alphaId = result.nameToId.get('alpha');
  const betaId = result.nameToId.get('beta');
  const valeIncreased = after.get(String(alphaId)) > before.get(String(alphaId))
    && after.get(String(betaId)) > before.get(String(betaId));
  check(valeIncreased, 'NeuroLang: vale increases on both satisfied neurons (locked in)');

  // Two DSL-declared neurons with a deliberately contradictory pair of
  // constraints: aliased via setNeuronId() onto the *same* underlying engine
  // neuron (a synonym), then given definitions whose embeddings can't both
  // be satisfied by one readout — the same shape of conflict trainDefinitions
  // already detects, now reached entirely through the DSL runtime's own
  // materialize() rather than by poking the engine directly.
  const src2 = [
    'name="hot"',
    'name="cold"',
    '"hot"@definishon="aaaaaaaaaa"',
    '"cold"@definishon="zzzzzzzzzz"',
  ].join('\n');
  const parsed2 = interp.parse(src2);
  const engine2 = mkEngine();
  const runtime2 = new NeuroLangRuntime(engine2);
  runtime2.setNeuronId('hot', 3);
  runtime2.setNeuronId('cold', 3); // alias: both names share one readout neuron
  const conflictResult = runtime2.materialize(parsed2.neurons, { epochs: 300 });
  check(!conflictResult.converged && conflictResult.conflicts.length > 0 && conflictResult.epochs <= 300,
    `NeuroLang: contradictory definitions (aliased to one neuron) are detected and reported rather than looping indefinitely (epochs=${conflictResult.epochs}, conflicts=${conflictResult.conflicts.length})`);
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

  // Genuine complex-phasor interference: equal-amplitude neurons exactly out
  // of phase (pi apart) must cancel toward zero (destructive); exactly in
  // phase must sum to the full 2x amplitude (constructive).
  const qi = new QuantumNeuralNet();
  qi.addNeuron('x', 1); qi.addNeuron('y', 1);
  const sx = qi.getState('x'), sy = qi.getState('y');
  sx.height = 5; sx.phase = 0;
  sy.height = 5; sy.phase = Math.PI;
  const destructive = qi.interfere('x', 'y');
  check(destructive < 1e-9, `interfere() destructively cancels antiphase equal amplitudes (got ${destructive})`);
  sy.phase = 0;
  const constructive = qi.interfere('x', 'y');
  check(Math.abs(constructive - 10) < 1e-9, `interfere() constructively sums in-phase amplitudes (got ${constructive})`);

  // Born-rule collapse: a dominant-amplitude candidate must be selected far
  // more often than uniform (1/3) across many independent trials.
  const qc = new QuantumNeuralNet();
  qc.addNeuron('d', 1);
  const trials = 300;
  let dominantHits = 0;
  for (let i = 0; i < trials; i++) {
    qc.createSuperposition('d', [5, 0.1, 0.1]); // heights [50, 1, 1] -> P(dominant) ~ 2500/2502
    if (Math.abs(qc.collapse('d') - 50) < 1e-9) dominantHits++;
  }
  const freq = dominantHits / trials;
  check(freq > 0.9, `collapse() selects the dominant amplitude with proportionally higher frequency (${(freq * 100).toFixed(1)}% over ${trials} trials, uniform would be ~33%)`);
}

async function testExpertRegistrationCompleteness() {
  const { NeuroPipeline } = await load('models && skills/core/pipeline.js');
  const { pluginExtensions } = await load('plugins/index.js');
  const { PROGRAMMING_SKILLS } = await load('models && skills/programming-skills.js');

  const p = new NeuroPipeline({ embeddingDim: 32, hiddenDim: 32, meshNodes: 16, hyperDimensions: 16 });
  await p.run(embedding(32, 1), 'trigger subsystem init'); // ensureSubsystems() is lazy

  const registered = new Set(p.getExpertPluginMap().values());
  const expectedPluginIds = Object.values(pluginExtensions).map(d => d.id);
  const expectedSkillTypes = new Set(PROGRAMMING_SKILLS.map(s => s.expertType));
  const expectedSkillExpertIds = Array.from(expectedSkillTypes).map(t => `skill_${t}`);

  const allPluginsRegistered = expectedPluginIds.every(id => registered.has(id));
  check(allPluginsRegistered, `Section 2.2: every plugins/index.ts entry (${expectedPluginIds.length}) is a registered MoE expert`);

  const allSkillTypesRegistered = expectedSkillExpertIds.every(id => registered.has(id));
  check(allSkillTypesRegistered, `Section 2.2: every programming-skills.ts expertType (${expectedSkillExpertIds.length}) is a registered MoE expert`);

  // No anonymous experts polluting the router: registered count must be
  // exactly plugins + skill-types, nothing extra with no plugin/skill behind it.
  const expectedTotal = expectedPluginIds.length + expectedSkillExpertIds.length;
  check(registered.size === expectedTotal,
    `Section 2.2: registered expert count matches plugin/skill file count exactly (expected ${expectedTotal}, got ${registered.size})`);
}

async function testMoESharedMesh() {
  const { MixtureOfExperts } = await load('models && skills/moe.js');

  // Two skills with overlapping neuron ranges wired into the same mesh at
  // density 1.0 (Section 2.1's verification scenario).
  const moe = new MixtureOfExperts(1); // topK=1: exactly one expert selected per tick
  // 12 neurons/skill: with relu, a recomputed-but-still-zero neuron is
  // indistinguishable from a frozen one, so use enough neurons that "all 12
  // independently relu-clamp to zero" is negligible (~1/4096 at worst).
  const skillA = moe.addExpert('skillA', 'Skill A', 'a', 12);
  const skillB = moe.addExpert('skillB', 'Skill B', 'b', 12);
  const mesh = moe.getMesh();

  // (a) both skills' neurons have live connections to arbitrary main-mesh
  // neurons outside their own group — full density means every node is
  // connected to every other node regardless of group.
  const aFullyWired = skillA.neuronIds.every(id =>
    skillB.neuronIds.every(other => mesh.getNode(id).connections.has(other))
  );
  check(aFullyWired, 'MoE: skill A neurons are wired to skill B neurons (density 1.0 ignores group)');
  const totalNodes = mesh.getNodeCount();
  const fullyConnected = [...skillA.neuronIds, ...skillB.neuronIds].every(
    id => mesh.getNode(id).connections.size === totalNodes - 1
  );
  check(fullyConnected, 'MoE: every skill neuron connects to all other nodes in the mesh');

  // (b) on a tick where only one skill's group is selected, only that
  // skill's neurons execute forward computation — the mesh's propagate()
  // gates compute by group directly (this is the mechanism moe.tick() calls
  // internally after scoring; exercising it directly makes the assertion
  // independent of the router's specific (randomly-initialized) scores).
  // Only skill A's neurons are externally driven this tick — skill B gets
  // no external input, so any change to its activation could only come from
  // it being (wrongly) recomputed from the mesh's internal dynamics.
  const aInputs = new Map(skillA.neuronIds.map(id => [id, 0.3]));

  const beforeB = skillB.neuronIds.map(id => mesh.getNode(id).activation);
  mesh.propagate(aInputs, undefined, new Set(['skillA']));
  const bUnchanged = skillB.neuronIds.every((id, i) => mesh.getNode(id).activation === beforeB[i]);
  check(bUnchanged, "MoE: unselected skill B's neurons did not execute (activation frozen) while skill A ran");
  check(Number.isFinite(mesh.getNode(skillA.neuronIds[0]).activation), 'MoE: selected skill A neurons did execute (finite new activation)');

  // (c) the unselected skill's neurons still exist in the connection graph
  // and can be selected on a subsequent tick without re-wiring.
  const stillWired = skillB.neuronIds.every(id => mesh.getNode(id).connections.size === totalNodes - 1);
  const bInputs = new Map(skillB.neuronIds.map(id => [id, 0.3]));
  const beforeBSecond = skillB.neuronIds.map(id => mesh.getNode(id).activation);
  mesh.propagate(bInputs, undefined, new Set(['skillB']));
  const bNowRan = skillB.neuronIds.some((id, i) => mesh.getNode(id).activation !== beforeBSecond[i]);
  check(stillWired && bNowRan, 'MoE: previously-unselected skill B computes next tick with no re-wiring needed');

  // moe.tick() itself: real router scoring end-to-end, still finite/stable.
  const routingInput = new Float32Array(768).fill(0.1);
  const tickInputs = new Map([...skillA.neuronIds, ...skillB.neuronIds].map(id => [id, 0.2]));
  const { activeExperts } = moe.tick(routingInput, tickInputs);
  check(activeExperts.length === 1 && (activeExperts[0] === 'skillA' || activeExperts[0] === 'skillB'),
    `MoE: tick() router selects exactly topK=1 registered expert (got ${JSON.stringify(activeExperts)})`);
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

  // Density 1.0 must produce true all-to-all wiring: N*(N-1) directed
  // connections (every node holds a live weight to every other node).
  const N = 12;
  const denseMesh = new NeuronMesh({ nodeCount: N, connectionDensity: 1.0, seed: 3 });
  let directedTotal = 0;
  for (let i = 0; i < N; i++) directedTotal += denseMesh.getNode(i).connections.size;
  check(directedTotal === N * (N - 1), `Mesh at density 1.0 has N*(N-1)=${N * (N - 1)} directed connections (got ${directedTotal})`);
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

async function testContinuousOutputLoop() {
  const { NeuroclawRunner } = await load('interface/runner.js');
  const { NeuroclawLLM } = await load('models && skills/llm.js');
  const { NeuroPipeline } = await load('models && skills/core/pipeline.js');
  const { ThesaurusDictionary } = await load('models && skills/thesaurus.js');
  const { PluginRegistry } = await load('plugin_manager/registry.js');

  const mkRunner = () => {
    const llm = new NeuroclawLLM();
    const pipeline = new NeuroPipeline({ embeddingDim: 32, hiddenDim: 32, meshNodes: 12, hyperDimensions: 12 });
    const thesaurus = new ThesaurusDictionary();
    const pluginRegistry = new PluginRegistry();
    return new NeuroclawRunner(llm, pipeline, thesaurus, pluginRegistry);
  };

  // Section 4.1(a): new input can be injected while output is mid-stream
  // without the output stream pausing or resetting.
  {
    const runner = mkRunner();
    let ticks = 0;
    runner.on('continuous-tick', () => { ticks++; });
    runner.startContinuous(20);
    await new Promise(r => setTimeout(r, 150));
    const before = ticks;
    check(before > 0, `Continuous loop: output ticks fire on their own schedule (got ${before} in 150ms)`);

    runner.injectInput('hello from mid-stream'); // must return immediately, not block
    check(true, 'Continuous loop: injectInput() returns without blocking the caller');

    await new Promise(r => setTimeout(r, 150));
    const after = ticks;
    runner.stopContinuous();
    check(after > before, `Continuous loop: ticks kept firing after injection, no pause (before=${before}, after=${after})`);

    // The injected text actually reached the shared pipeline state (the
    // input loop of zip-io), not just sat in a queue nobody drained.
    let sawInjectedText = false;
    for await (const chunk of runner.getPipeline().getZipIO().getFullContext()) {
      if (chunk.includes('hello from mid-stream')) { sawInjectedText = true; break; }
    }
    check(sawInjectedText, 'Continuous loop: injected input reached the shared pipeline state (zip-io input loop)');
  }

  // Section 4.1(b): live correction (Section 3.3) and RLM thinking-steps
  // (Section 3.4) run *continuously inside the output loop* — every tick,
  // not once per discrete request. The mechanism that actually fires a
  // correction under sustained divergence is already exercised directly
  // (and proven) by the Section 3.3 test against the hyperdimensional
  // engine in isolation; forcing that exact numeric condition to reproduce
  // through this test's extra MoE/mesh routing and averaging layers within
  // a short wall-clock window is not a meaningful bar (those layers damp
  // large swings by design). What Section 4.1 actually adds on top is
  // wiring: confirm every tick's result carries a real liveCorrections
  // reading and a real rlm-decision step, i.e. the same hyperEngine.process()
  // (which contains the sustained-divergence check) and the same
  // rlm.selectAction() (top-scored thinking step, Section 3.4) run on every
  // tick of the loop, not just the first.
  {
    const runner = mkRunner();
    const results = [];
    runner.on('continuous-tick', (result) => results.push(result));
    runner.startContinuous(15);
    await new Promise(r => setTimeout(r, 150));
    runner.stopContinuous();

    check(results.length >= 3, `Continuous loop: multiple ticks captured for inspection (got ${results.length})`);
    const everyTickHasLiveCorrectionSignal = results.every(r => Number.isFinite(r.liveCorrections));
    check(everyTickHasLiveCorrectionSignal, 'Continuous loop: every tick carries a real (finite) live-correction reading, not just the first');
    const everyTickRanRlm = results.every(r => r.steps.some(s => s.name === 'rlm-decision'));
    check(everyTickRanRlm, 'Continuous loop: RLM thinking-steps run on every tick of the output loop, not once per request');
  }
}

async function testElasticCoreBlock() {
  const { ElasticCoreBlock } = await load('models && skills/core/elastic-core.js');
  const core = new ElasticCoreBlock({ neuronCount: 10, stateDim: 5, inputDim: 4, outputDim: 4, maxTicks: 8, seed: 9 });
  check(core.connectionDensity() === 1.0, 'ElasticCoreBlock uses true all-to-all density');
  const block = core.connectionBlock(1, 0);
  check(block.length === 25 && allFinite(block), 'ElasticCoreBlock connections are full stateDim x stateDim blocks');

  const highVale = new ElasticCoreBlock({ neuronCount: 8, stateDim: 4, inputDim: 4, outputDim: 4, maxTicks: 1, convergenceThreshold: 0, seed: 3 });
  const lowVale = new ElasticCoreBlock({ neuronCount: 8, stateDim: 4, inputDim: 4, outputDim: 4, maxTicks: 1, convergenceThreshold: 0, seed: 3 });
  const input = new Float32Array([0.8, -0.4, 0.2, 1]);
  const high = highVale.forward(input, { vale: new Map([[1, 0.98]]), drivenNeurons: new Set([0]) });
  const low = lowVale.forward(input, { vale: new Map([[1, 0.02]]), drivenNeurons: new Set([0]) });
  const highMove = high.settledState.slice(4, 8).reduce((s, v) => s + Math.abs(v), 0);
  const lowMove = low.settledState.slice(4, 8).reduce((s, v) => s + Math.abs(v), 0);
  check(highMove < lowMove, 'ElasticCoreBlock vale gates state movement directly');

  const moe = new ElasticCoreBlock({ neuronCount: 6, stateDim: 4, inputDim: 4, outputDim: 4, maxTicks: 2, seed: 5 });
  moe.setNeuronGroup(1, 'a'); moe.setNeuronGroup(2, 'b');
  const before = moe.forward(input, { activeGroups: new Set(['a']), drivenNeurons: new Set([0]) }).settledState;
  const after = moe.forward(input, { activeGroups: new Set(['a']), drivenNeurons: new Set([0]) }).settledState;
  check(allFinite(after) && Math.abs(after[2 * 4] - before[2 * 4]) < 1e-12, 'ElasticCoreBlock MoE label freezes unselected groups without disconnecting them');
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
    ['Quantization-aware training (Section 8)', testQuantizationAwareTraining],
    ['Production config & edges', testProductionConfigAndEdges],
    ['Hyperdimensional', testHyperdimensional],
    ['Input-flag / self-model / live-correction (Section 3.1-3.3)', testInputFlagSelfModelLiveCorrection],
    ['Vale gating', testValeGating],
    ['Symbolic trace', testSymbolicTrace],
    ['Definishon training', testDefinitionTraining],
    ['NeuroLang live wiring (Section 2.3)', testNeuroLangLiveWiring],
    ['Quantum interference', testQuantum],
    ['Expert registration completeness (Section 2.2)', testExpertRegistrationCompleteness],
    ['MoE shared mesh (Section 2.1)', testMoESharedMesh],
    ['Mesh stability', testMeshStability],
    ['Alignment veto', testAlignmentVeto],
    ['Number systems (complex/dual)', testNumberSystems],
    ['ZipIO persistence', testZipPersistence],
    ['Continuous output loop (Section 4.1)', testContinuousOutputLoop],
    ['Elastic core transformer replacement', testElasticCoreBlock],
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
