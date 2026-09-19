#!/usr/bin/env node
/**
 * build-main-network.mjs — one-time build driver for "Main Network".
 *
 * This file is infrastructure, not the deliverable. The deliverable is the
 * INSTALLED EXTENSION it produces (extension-builder/extensions/main_network_*.ext.json):
 * a real ExtensionBuilder project whose neurons got there through the same
 * two real engine mechanisms the live /builder UI exposes, not through
 * hand-coded lookup logic:
 *
 *   - project source: a representative sample of THIS repository's own
 *     source (Python, TypeScript, JS, and prose) is run through
 *     ExtensionBuilder.importCodeToNet() -- the engine's real
 *     bytecode->neuron-topology converter (models && skills/core/thorns.js's
 *     CodeToNet.importCode()), the same "Code-to-Net" feature the /builder
 *     UI's own Code-to-Net panel uses. One project neuron per source file,
 *     each one's underlying topology is a real chain of byte-segment
 *     neurons, not a text blob pretending to be a network. (This used to
 *     import a sample of the vendored moby/moby -- i.e. Docker -- source
 *     tree; that vendored copy has been removed, so this now points at our
 *     own files instead. Code-to-Net only ever needed *some* real bytes to
 *     import, never specifically Docker's.)
 *
 *   - word pronunciations: a sample of English words, harvested from this
 *     project's own prose (README.md, docs/*.md, etc.) rather than a
 *     vendored dictionary, becomes real @definishon-style training
 *     samples -- each word's pronunciation target is derived at build time
 *     by grapheme-to-phoneme.mjs's hand-written rule engine, not looked up
 *     in a third-party dataset. Trained via genuine torch.autograd
 *     gradient descent (extension-builder/pytorch_trainer.py -- the exact
 *     same "deep learning" backend POST /api/extension/train-pytorch uses,
 *     invoked directly here instead of over HTTP since this runs as a
 *     one-time build step, not a live request). Nothing here hand-writes
 *     "if word == X return Y" -- every word neuron's trained state is the
 *     output of real gradient descent against its (derived) pronunciation
 *     target, same as the spec describes: "scripting is only used for
 *     training the model to behave... then the script is removed and the
 *     model can stand alone."
 *
 * The full sample is capped well under the HyperDimensionalEngine's
 * all-to-all mesh limits (connDiag is O(neuronCount^2 * dims) -- see
 * onebrain.ts) on purpose: this script never instantiates that engine at
 * all for the pronunciation batch (pytorch_trainer.py's model is
 * independent per-readout linear+tanh, no engine mesh involved), so the
 * real ceiling here is just "how many words are worth training in one
 * pass", not a hard technical limit.
 *
 * Usage: node extension-builder/build-main-network.mjs
 * (requires a fresh `node scripts/build-backend.mjs` first -- this script
 * imports the compiled dist/ builder + neuro-lang modules, the same ones
 * interface/web-server.ts uses at runtime.)
 */

import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pronounce } from './grapheme-to-phoneme.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIMS = 16; // matches builder.js train()'s fixed dims / the train-pytorch endpoint

// Overridable via env vars so scripts/self-improve.mjs can try mutated
// hyperparameters without editing this file -- defaults match the values
// this script always used before these existed.
const EPOCHS = Number(process.env.SELF_IMPROVE_EPOCHS) || 1500;
const LEARNING_RATE = Number(process.env.SELF_IMPROVE_LR) || 0.05;
const TOLERANCE = Number(process.env.SELF_IMPROVE_TOLERANCE) || 1e-3;

const { ExtensionBuilder } = await import(path.join(ROOT, 'dist', 'extension-builder', 'builder.js'));
const { embedText } = await import(path.join(ROOT, 'dist', 'models && skills', 'core', 'neuro-lang.js'));

// Same fixed "recall your definition" drive vector definitionTrigger() uses
// in neuro-lang.ts for every @definishon contract -- mirrored here rather
// than exporting it just for this one caller (see interface/web-server.ts's
// train-pytorch endpoint, which does the same thing).
const DEFINITION_TRIGGER = new Array(DIMS).fill(0.7);

function log(...args) {
  console.log('[build-main-network]', ...args);
}

// ── 1. project source: real Code-to-Net conversion of our own source ──────

// A deliberately polyglot sample of this repository's own files -- Python,
// TypeScript, JS, and Markdown -- standing in for the vendored moby/moby
// sample this script used to import. Code-to-Net is content-agnostic (it
// chunks raw bytes into a neuron chain regardless of language), so any real
// file works; these were picked to show the project's actual range rather
// than someone else's Go source.
const PROJECT_SOURCE_FILES = [
  'README.md',
  'AGENTS.md',
  'package.json',
  'asi_core/unified_brain.py',
  'asi_core/neural_mesh.py',
  'asi_core/vale_system.py',
  'models && skills/core/onebrain.ts',
  'models && skills/core/neuro-lang.ts',
  'models && skills/core/thorns.js',
  'extension-builder/builder.js',
  'interface/web-server.ts',
  'scripts/build-backend.mjs',
];
// Cap bytes per file before it hits CodeToNet.importCode(), which chunks
// every 8 bytes into one internal neuron -- several of these files are
// hundreds of KB uncapped (onebrain.ts alone is 300+KB); capping keeps the
// whole import's internal topology in the low thousands total across all
// files, cheap Map entries, not an engine-mesh cost.
const SOURCE_BYTES_PER_FILE = 4096;

function buildProjectCodeNets(builder, projectId) {
  let imported = 0;
  for (const rel of PROJECT_SOURCE_FILES) {
    const full = path.join(ROOT, rel);
    if (!existsSync(full)) {
      log(`skip (not found): ${rel}`);
      continue;
    }
    const buf = readFileSync(full).subarray(0, SOURCE_BYTES_PER_FILE);
    const neuron = builder.importCodeToNet(projectId, `src_${rel.replace(/[\\/ &]/g, '_')}`, buf);
    if (neuron) {
      imported++;
      log(`Code-to-Net: ${rel} -> ${neuron.name} (${neuron.definition})`);
    }
  }
  return imported;
}

// ── 2. pronunciations: real @definishon training samples, trained via real deep learning ─

const PRONUNCIATION_SAMPLE_TARGET = 500;
// Harvest distinct English words directly from this project's own prose
// instead of reading them out of a vendored dictionary. Each word's
// pronunciation is then *derived*, not looked up (see grapheme-to-phoneme.mjs).
const WORD_SOURCE_FILES = [
  'README.md', 'STRUCTURE.md', 'AGENTS.md', 'PRIVACY.md', 'TERMS.md',
  'docs/ARCHITECTURE.md',
];

function harvestWords() {
  const seen = new Set();
  const words = [];
  for (const rel of WORD_SOURCE_FILES) {
    const full = path.join(ROOT, rel);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, 'utf8');
    // Plain alphabetic words only, 3-10 letters -- long enough to be a real
    // word, short enough to skip identifiers/compounds that slipped through.
    const matches = text.toLowerCase().match(/\b[a-z]{3,10}\b/g) ?? [];
    for (const w of matches) {
      if (seen.has(w)) continue;
      seen.add(w);
      words.push(w);
      if (words.length >= PRONUNCIATION_SAMPLE_TARGET) return words;
    }
  }
  return words;
}

function samplePronunciations() {
  const words = harvestWords();
  return words.map((word) => ({ word, pronunciation: pronounce(word) })).filter((s) => s.pronunciation);
}

function addPronunciationNeurons(builder, projectId, sample) {
  const readoutNames = [];
  for (const { word, pronunciation } of sample) {
    const neuron = builder.addNeuron(projectId, word.toLowerCase(), 0);
    if (!neuron) continue;
    neuron.definition = pronunciation; // the real @definishon-style training target
    readoutNames.push(neuron.name);
  }
  return readoutNames;
}

// Spawns pytorch_trainer.py directly -- the same protocol
// PyTorchTrainerWorker (interface/web-server.ts) uses over HTTP, invoked
// here as a one-shot subprocess since this is a one-time build step, not a
// live server. Genuinely optional, same as the live endpoint: if
// Python/torch isn't present, this returns ok:false and the build
// continues with the neurons present but untrained rather than crashing.
function trainPronunciationBatch(sample) {
  return new Promise((resolve) => {
    const scriptPath = path.join(ROOT, 'extension-builder', 'pytorch_trainer.py');
    let child;
    try {
      child = spawn('python3', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, error: `could not launch python3: ${err.message}` });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => resolve({ ok: false, error: `python3 not available: ${err.message}` }));
    child.on('close', () => {
      const line = stdout.trim().split('\n').pop() ?? '';
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve({ ok: false, error: stderr.trim() || 'no output from pytorch_trainer.py' });
      }
    });

    const samples = sample.map(({ word, pronunciation }, idx) => ({
      readout: idx,
      input: DEFINITION_TRIGGER,
      target: embedText(pronunciation, DIMS),
    }));
    const spec = {
      dims: DIMS,
      numReadouts: sample.length,
      epochs: EPOCHS,
      learningRate: LEARNING_RATE,
      tolerance: TOLERANCE,
      samples,
    };
    child.stdin.write(JSON.stringify(spec) + '\n');
    child.stdin.end();
  }).then((result) => ({ ...result, samples: sampleToSpecSamples(sample) }));
}

// Recomputed (not captured from the closure above) so trainPronunciationBatch()'s
// returned `samples` is available even on the `ok:false` (no torch) path --
// merge-networks.mjs needs these regardless of whether this particular
// build run could train them itself.
function sampleToSpecSamples(sample) {
  return sample.map(({ pronunciation }, idx) => ({
    readout: idx,
    input: DEFINITION_TRIGGER,
    target: embedText(pronunciation, DIMS),
  }));
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const builder = new ExtensionBuilder();
  const project = builder.createProject(
    'Main Network',
    "this project's own source via real Code-to-Net + derived pronunciations via real deep-learning training",
  );

  log("Importing this project's own source through the engine's real Code-to-Net converter...");
  const sourceCount = buildProjectCodeNets(builder, project.id);
  log(`Code-to-Net: ${sourceCount} source file(s) imported as real byte-chain neuron topologies`);

  log("Harvesting words from this project's own prose and deriving pronunciations...");
  const sample = samplePronunciations();
  log(`Sampled ${sample.length} word -> pronunciation entries (harvested from ${WORD_SOURCE_FILES.length} of this project's own files, pronunciations derived by grapheme-to-phoneme.mjs)`);

  const readoutNames = addPronunciationNeurons(builder, project.id, sample);
  log(`Added ${readoutNames.length} pronunciation neurons with real @definishon-style targets`);

  log('Training the pronunciation batch via genuine torch.autograd gradient descent...');
  const result = await trainPronunciationBatch(sample);

  let trainedCount = 0;
  if (result.ok) {
    log(`PyTorch training converged=${result.converged} after ${result.epochsRun} epoch(s) (torch ${result.torchVersion})`);
    for (let i = 0; i < readoutNames.length; i++) {
      const neuron = Array.from(project.neurons.values()).find(n => n.name === readoutNames[i]);
      if (!neuron) continue;
      neuron.trained = result.sampleConverged[i] === true;
      if (neuron.trained) trainedCount++;
    }
    log(`${trainedCount}/${readoutNames.length} pronunciation neurons genuinely converged and are marked trained`);
  } else {
    log(`PyTorch training unavailable (${result.error}) -- pronunciation neurons kept as untrained definitions.`);
    log('This is the expected optional-dependency degradation, not a build failure: rerun with a working python3+torch to actually train them.');
  }

  const outDir = path.join(ROOT, 'extension-builder', 'extensions');
  mkdirSync(outDir, { recursive: true });
  const json = builder.saveWithoutQuantization(project.id);
  const outPath = path.join(outDir, `main_network_${Date.now()}.ext.json`);
  writeFileSync(outPath, json, 'utf8');

  let weightsPath = null;
  if (result.ok) {
    // The actual trained model, not just the project shape: W/b per
    // pronunciation readout (in readoutNames order), the same artifact
    // train-coding-skills.mjs saves for its own network -- what a real
    // weight merge (see merge-networks.mjs) averages together.
    weightsPath = path.join(outDir, `main_network_weights_${Date.now()}.json`);
    writeFileSync(weightsPath, JSON.stringify({
      dims: DIMS, names: readoutNames, W: result.W, b: result.b, samples: result.samples,
    }, null, 2), 'utf8');
    log(`Saved weights: ${path.relative(ROOT, weightsPath)}`);
  }

  log(`Saved: ${path.relative(ROOT, outPath)}`);
  log(`Total neurons: ${project.neurons.size} (${sourceCount} project-source Code-to-Net + ${readoutNames.length} pronunciation, ${trainedCount} trained)`);
  return { outPath, weightsPath, sourceCount, pronunciationCount: readoutNames.length, trainedCount, pytorchOk: result.ok };
}

main().then((summary) => {
  console.log(JSON.stringify(summary, null, 2));
}).catch((err) => {
  console.error('[build-main-network] FAILED:', err);
  process.exit(1);
});
