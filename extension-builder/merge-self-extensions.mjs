#!/usr/bin/env node
/**
 * merge-self-extensions.mjs — combine every self-authored memory extension
 * (models && skills/self_ext_N/model.json) into ONE model.
 *
 * The self-extensions are all the same shape: a bipartite graph of
 * `memory_input_<token>` -> `memory_output_<token>` neurons, one fp32
 * weight per connection (weights[conn.weightIndex]). Different generations
 * share most of their token labels, so the merge is label-aligned:
 *
 *   - neurons are unioned by label (one neuron per distinct label),
 *   - every (fromLabel, toLabel) edge becomes one connection whose weight
 *     is the mean of every non-null weight that edge had across all source
 *     models (including repeats inside a single model),
 *   - a neuron's value is the mean of its values across sources.
 *
 * Output keeps the on-disk self-extension format, plus the matching 4-bit
 * copy (same symmetric scheme as the existing model.q4.json files:
 * scale = 2/15, zero point 7, codes clamped to [0, 14]). The result is
 * written to onebrain/ ("OneBrain", the name the wiki gives the one model)
 * and indexed in index.jsonl so NeuroclawLLM.reloadSelfExtensions() loads
 * it as an expert. With --replace, the source self_ext_N folders are
 * deleted and index.jsonl is rewritten to list only OneBrain, leaving one
 * model instead of many.
 *
 * Usage:
 *   node extension-builder/merge-self-extensions.mjs [--replace] [extensionsDir]
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const REPLACE = args.includes('--replace');
const DIR = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(__dirname, '..', 'models && skills'));
const OUT_ID = 'onebrain';
const Q_SCALE = Math.fround(2 / 15);
const Q_ZP = 7;

function log(...args) { console.log('[merge-self-extensions]', ...args); }

const sources = readdirSync(DIR)
  .filter((d) => /^self_ext_\d+$/.test(d) && existsSync(path.join(DIR, d, 'model.json')))
  .sort((a, b) => Number(a.split('_')[2]) - Number(b.split('_')[2]));
if (sources.length === 0) {
  console.error(`No self_ext_N/model.json found in ${DIR}`);
  process.exit(1);
}

const neuronAcc = new Map(); // label -> { layerIndex, sum, n }
const edgeAcc = new Map();   // "from\0to" -> { from, to, sum, n }
let sourceConnections = 0;

for (const src of sources) {
  const m = JSON.parse(readFileSync(path.join(DIR, src, 'model.json'), 'utf8'));
  const labelById = new Map();
  for (const [id, n] of m.neurons) {
    labelById.set(id, n.label);
    const acc = neuronAcc.get(n.label) ?? { layerIndex: n.layerIndex, sum: 0, n: 0 };
    if (typeof n.value === 'number') { acc.sum += n.value; acc.n++; }
    neuronAcc.set(n.label, acc);
  }
  for (const [, c] of m.connections) {
    sourceConnections++;
    const from = labelById.get(c.fromNeuronId);
    const to = labelById.get(c.toNeuronId);
    const key = `${from}\0${to}`;
    const acc = edgeAcc.get(key) ?? { from, to, sum: 0, n: 0 };
    const w = m.weights[c.weightIndex];
    if (typeof w === 'number' && Number.isFinite(w)) { acc.sum += w; acc.n++; }
    edgeAcc.set(key, acc);
  }
  log(`${src}: ${m.neurons.length} neurons, ${m.connections.length} connections`);
}

// Inputs first, then outputs, each in natural token order.
const tokenNum = (label) => Number(label.split('_').pop());
const labels = [...neuronAcc.keys()].sort((a, b) =>
  neuronAcc.get(a).layerIndex - neuronAcc.get(b).layerIndex || tokenNum(a) - tokenNum(b) || a.localeCompare(b));

const idByLabel = new Map(labels.map((l, i) => [l, `neuron_c${i}`]));
const neurons = labels.map((label) => {
  const acc = neuronAcc.get(label);
  const id = idByLabel.get(label);
  return [id, {
    id, label, position: { x: 0, y: 0 },
    value: acc.n ? acc.sum / acc.n : 0,
    layerIndex: acc.layerIndex,
    inputs: [], outputs: [], properties: {},
  }];
});
const neuronById = new Map(neurons);

const connections = [];
const weights = [];
for (const e of edgeAcc.values()) {
  const fromId = idByLabel.get(e.from);
  const toId = idByLabel.get(e.to);
  const id = `conn_c${connections.length}`;
  connections.push([id, { id, fromNeuronId: fromId, toNeuronId: toId, weightIndex: weights.length }]);
  weights.push(e.n ? e.sum / e.n : null);
  neuronById.get(fromId).outputs.push(toId);
  neuronById.get(toId).inputs.push(fromId);
}

const now = Date.now();
const base = {
  id: 'project_onebrain',
  name: 'OneBrain',
  description: `Label-aligned weight average of ${sources.length} self-authored extensions (${sources.join(', ')})`,
  neurons, connections, layers: [], labels: [], apiOutputConfig: null,
};
const fp32 = {
  ...base, savedWithQuantization: false, createdAt: now, modifiedAt: now,
  weightCount: weights.length, weightFormat: 'fp32', weights,
};
const q4Weights = weights.map((w) => (w === null ? null : Math.min(7, Math.max(-7, Math.round(w / Q_SCALE))) + Q_ZP));
const packed = Math.ceil(weights.length / 2);
const q4 = {
  ...base, savedWithQuantization: true, quantized: true, createdAt: now, modifiedAt: now,
  weightCount: weights.length, weightFormat: 'int4', weightBits: 4, weights: q4Weights,
  quantScale: Q_SCALE, quantZeroPoint: Q_ZP,
  compressionNote: `4-bit packed (2 weights/byte), scale=${Q_SCALE.toFixed(6)}, zp=${Q_ZP}`,
  originalSizeFp32Bytes: weights.length * 4, packedSizeBytes: packed,
  compressionRatio: ((weights.length * 4) / packed).toFixed(2),
};
const meta = {
  id: OUT_ID, name: 'OneBrain',
  description: `OneBrain: all ${sources.length} self-authored extensions merged into one model`,
  createdAt: now, prompt: 'OneBrain', sources,
  neuronCount: neurons.length, connectionCount: connections.length,
};

const outDir = path.join(DIR, OUT_ID);
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'model.json'), JSON.stringify(fp32), 'utf8');
writeFileSync(path.join(outDir, 'model.q4.json'), JSON.stringify(q4), 'utf8');
writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

const indexPath = path.join(DIR, 'index.jsonl');
const entry = JSON.stringify({
  id: OUT_ID, name: meta.name, description: meta.description, createdAt: now, prompt: 'OneBrain',
  neuronCount: neurons.length, connectionCount: connections.length,
}) + '\n';
if (REPLACE) {
  for (const src of sources) rmSync(path.join(DIR, src), { recursive: true, force: true });
  writeFileSync(indexPath, entry, 'utf8');
  log(`--replace: removed ${sources.length} source models; index.jsonl now lists only ${OUT_ID}`);
} else {
  const alreadyIndexed = existsSync(indexPath) &&
    readFileSync(indexPath, 'utf8').split('\n').some((l) => { try { return JSON.parse(l).id === OUT_ID; } catch { return false; } });
  if (!alreadyIndexed) appendFileSync(indexPath, entry, 'utf8');
}

log(`merged ${sources.length} models: ${sourceConnections} source connections -> ` +
  `${neurons.length} neurons, ${connections.length} connections -> ${path.relative(process.cwd(), outDir)}/`);
