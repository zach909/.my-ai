#!/usr/bin/env node
/**
 * merge-self-extensions.mjs — fold every self-authored memory extension
 * (self_ext_N/model.json) in a directory into OneBrain, the single model
 * the wiki describes, using the same models && skills/onebrain-memory.js
 * logic NeuroclawLLM runs automatically for every new self-extension.
 *
 * Merging is label-aligned: one neuron per token label, and each
 * (input token -> output token) weight is the mean of every sample of that
 * edge across all sources (an existing OneBrain's samples included, via its
 * weightCounts). Writes onebrain/{model.json, model.q4.json, meta.json} and
 * makes it the only entry in index.jsonl. With --replace, the merged
 * self_ext_N folders are deleted.
 *
 * Usage:
 *   node extension-builder/merge-self-extensions.mjs [--replace] [extensionsDir]
 */

import { readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSelfExtension, emptyOneBrain, foldEdges, readOneBrain, writeOneBrain,
} from '../models && skills/onebrain-memory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const REPLACE = args.includes('--replace');
const DIR = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(__dirname, '..', 'models && skills'));

function log(...a) { console.log('[merge-self-extensions]', ...a); }

const sources = readdirSync(DIR)
  .filter((d) => /^self_ext_\d+$/.test(d) && existsSync(path.join(DIR, d, 'model.json')))
  .sort((a, b) => Number(a.split('_')[2]) - Number(b.split('_')[2]));
if (sources.length === 0) {
  console.error(`No self_ext_N/model.json found in ${DIR}`);
  process.exit(1);
}

const existing = readOneBrain(DIR);
const model = existing?.model ?? emptyOneBrain();
let samples = 0;
for (const src of sources) {
  const edges = parseSelfExtension(readFileSync(path.join(DIR, src, 'model.json'), 'utf8'));
  foldEdges(model, edges);
  samples += edges.length;
  log(`${src}: ${edges.length} weighted connections`);
}
writeOneBrain(DIR, model, existing?.meta ?? {}, sources);
if (REPLACE) {
  for (const src of sources) rmSync(path.join(DIR, src), { recursive: true, force: true });
  log(`--replace: removed ${sources.length} source models`);
}
log(`merged ${sources.length} models (${samples} samples) -> ${model.neurons.length} neurons, ` +
  `${model.connections.length} connections -> ${path.relative(process.cwd(), path.join(DIR, 'onebrain'))}/`);
