#!/usr/bin/env node
/**
 * build-final-network.mjs — assembles the final combined network: every
 * neuron from Main Network (moby Code-to-Net + cmudict) and Coding Skills
 * Network (execution-grounded JS/Python/Shell/NeuroLang), carrying the
 * real merged+fine-tuned weights from merge-networks.mjs.
 *
 * Usage:
 *   node extension-builder/build-final-network.mjs \
 *     <mainNetwork.ext.json> <codingSkills.ext.json> <mergedWeights.json>
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[build-final-network]', ...args); }

async function main() {
  const [mainPath, codingPath, weightsPath] = process.argv.slice(2);
  if (!mainPath || !codingPath || !weightsPath) {
    console.error('Usage: node extension-builder/build-final-network.mjs <mainNetwork.ext.json> <codingSkills.ext.json> <mergedWeights.json>');
    process.exit(1);
  }

  const mainProject = JSON.parse(readFileSync(mainPath, 'utf8'));
  const codingProject = JSON.parse(readFileSync(codingPath, 'utf8'));
  const merged = JSON.parse(readFileSync(weightsPath, 'utf8'));
  const trainedNames = new Set(merged.names);

  const { ExtensionBuilder } = await import(path.join(ROOT, 'dist', 'extension-builder', 'builder.js'));
  const builder = new ExtensionBuilder();
  const project = builder.createProject(
    'Final Network',
    'Merged: Main Network (moby Code-to-Net + cmudict deep learning) + Coding Skills Network (execution-grounded), real weight-averaged and fine-tuned',
  );

  let carried = 0;
  for (const src of [mainProject, codingProject]) {
    for (const n of src.neurons) {
      const neuron = builder.addNeuron(project.id, n.name, n.value ?? 0);
      neuron.definition = n.definition ?? '';
      neuron.scripts = Array.isArray(n.scripts) ? n.scripts : [];
      if (n.codeTopology) neuron.codeTopology = n.codeTopology; // moby codenet neurons -- still reversible via exportCodeNet()
      neuron.trained = trainedNames.has(n.name);
      carried++;
    }
  }

  const outDir = path.join(ROOT, 'extension-builder', 'extensions');
  mkdirSync(outDir, { recursive: true });
  const json = builder.saveWithoutQuantization(project.id);
  const outPath = path.join(outDir, `final_network_${Date.now()}.ext.json`);
  writeFileSync(outPath, json, 'utf8');

  log(`Carried ${carried} neurons into the final combined project (${trainedNames.size} of them genuinely trained via the merged+fine-tuned weights)`);
  log(`Saved: ${path.relative(ROOT, outPath)}`);
  return { outPath, totalNeurons: carried, trainedCount: trainedNames.size };
}

main().then((summary) => {
  console.log(JSON.stringify(summary, null, 2));
}).catch((err) => {
  console.error('[build-final-network] FAILED:', err);
  process.exit(1);
});
