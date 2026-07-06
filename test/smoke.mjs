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
}

async function testPipeline() {
  const { NeuroPipeline } = await load('models && skills/core/pipeline.js');
  const p = new NeuroPipeline({ embeddingDim: 32, hiddenDim: 32, meshNodes: 16, hyperDimensions: 16 });
  let bad = 0;
  let stages = 0;
  for (let t = 0; t < 3; t++) {
    const res = await p.run(embedding(32, t + 1), `tick ${t}`);
    if (!allFinite(res.output)) bad++;
    stages = res.steps.length;
  }
  check(bad === 0, 'Pipeline output finite across 3 ticks (NaN regression)');
  check(stages === 6, `Pipeline runs all 6 stages (got ${stages})`);
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

async function testBootstrap() {
  const { bootstrap } = await load('interface/main.js');
  const cli = await bootstrap();
  check(cli && typeof cli.startInteractive === 'function', 'App bootstrap wires a startable CLI');
}

async function main() {
  const suites = [
    ['MoE router', testMoE],
    ['Pipeline', testPipeline],
    ['LLM generate', testLLM],
    ['RLM select', testRLM],
    ['ZipIO persistence', testZipPersistence],
    ['App bootstrap', testBootstrap],
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
