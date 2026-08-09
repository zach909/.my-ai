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
 *   - moby (github.com/moby/moby, vendored under extension-builder/Moby/):
 *     a representative sample of the actual Docker engine source is run
 *     through ExtensionBuilder.importCodeToNet() -- the engine's real
 *     bytecode->neuron-topology converter (models && skills/core/thorns.js's
 *     CodeToNet.importCode()), the same "Code-to-Net" feature the /builder
 *     UI's own Code-to-Net panel uses. One project neuron per source file,
 *     each one's underlying topology is a real chain of byte-segment
 *     neurons, not a text blob pretending to be a network.
 *
 *   - cmudict (github.com/cmusphinx/cmudict, vendored under
 *     extension-builder/CMUDict/): a bounded, evenly-sampled subset of its
 *     ~135k word->pronunciation entries becomes real @definishon-style
 *     training samples, trained via genuine torch.autograd gradient
 *     descent (extension-builder/pytorch_trainer.py -- the exact same
 *     "deep learning" backend POST /api/extension/train-pytorch uses,
 *     invoked directly here instead of over HTTP since this runs as a
 *     one-time build step, not a live request). Nothing here hand-writes
 *     "if word == X return Y" -- every word neuron's trained state is the
 *     output of real gradient descent against its pronunciation target,
 *     same as the spec describes: "scripting is only used for training the
 *     model to behave... then the script is removed and the model can
 *     stand alone."
 *
 * The full sample is capped well under the HyperDimensionalEngine's
 * all-to-all mesh limits (connDiag is O(neuronCount^2 * dims) -- see
 * onebrain.ts) on purpose: this script never instantiates that engine at
 * all for the cmudict batch (pytorch_trainer.py's model is independent
 * per-readout linear+tanh, no engine mesh involved), so the real ceiling
 * here is just "how many words are worth training in one pass", not a
 * hard technical limit.
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

// ── 1. moby: real Code-to-Net conversion of actual Docker engine source ────

const MOBY_DIR = path.join(ROOT, 'extension-builder', 'Moby');
const MOBY_FILES = [
  'README.md',
  'CONTRIBUTING.md',
  'go.mod',
  'Dockerfile',
  'cmd/dockerd/main.go',
  'daemon/daemon.go',
  'daemon/container.go',
  'daemon/network.go',
  'daemon/volumes.go',
  'daemon/create.go',
  'daemon/start.go',
  'client/client.go',
];
// Cap bytes per file before it hits CodeToNet.importCode(), which chunks
// every 8 bytes into one internal neuron -- an uncapped 68KB file
// (daemon/daemon.go) would produce ~8,500 internal codeToNet neurons on
// its own; capping keeps the whole moby import's internal topology in the
// low thousands total across all 12 files, cheap Map entries, not an
// engine-mesh cost.
const MOBY_BYTES_PER_FILE = 4096;

function buildMobyCodeNets(builder, projectId) {
  let imported = 0;
  for (const rel of MOBY_FILES) {
    const full = path.join(MOBY_DIR, rel);
    if (!existsSync(full)) {
      log(`skip (not found): ${rel}`);
      continue;
    }
    const buf = readFileSync(full).subarray(0, MOBY_BYTES_PER_FILE);
    const neuron = builder.importCodeToNet(projectId, `moby_${rel.replace(/[\\/]/g, '_')}`, buf);
    if (neuron) {
      imported++;
      log(`Code-to-Net: ${rel} -> ${neuron.name} (${neuron.definition})`);
    }
  }
  return imported;
}

// ── 2. cmudict: real @definishon training samples, trained via real deep learning ─

const CMUDICT_PATH = path.join(ROOT, 'extension-builder', 'CMUDict', 'cmudict.dict');
const CMUDICT_SAMPLE_TARGET = 500;

function sampleCmudict() {
  const lines = readFileSync(CMUDICT_PATH, 'utf8').split('\n');
  // Plain single-pronunciation entries only -- skip variants like
  // "word(1)" and non-alphabetic entries like "'bout" so every sampled
  // neuron name is a clean, unambiguous English word. cmudict.dict's
  // words are lowercase; pronunciations are the uppercase ARPAbet part.
  const plain = lines.filter(l => /^[a-z]+\s+\S/.test(l));
  const stride = Math.max(1, Math.floor(plain.length / CMUDICT_SAMPLE_TARGET));
  const sample = [];
  for (let i = 0; i < plain.length && sample.length < CMUDICT_SAMPLE_TARGET; i += stride) {
    const [word, ...phones] = plain[i].trim().split(/\s+/);
    sample.push({ word, pronunciation: phones.join(' ') });
  }
  return sample;
}

function addCmudictNeurons(builder, projectId, sample) {
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
function trainCmudictBatch(sample) {
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

// Recomputed (not captured from the closure above) so trainCmudictBatch()'s
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
    'moby/moby source via real Code-to-Net + cmudict pronunciations via real deep-learning training',
  );

  log('Importing moby source through the engine\'s real Code-to-Net converter...');
  const mobyCount = buildMobyCodeNets(builder, project.id);
  log(`Code-to-Net: ${mobyCount} source file(s) imported as real byte-chain neuron topologies`);

  log('Sampling cmudict...');
  const sample = sampleCmudict();
  log(`Sampled ${sample.length} word -> pronunciation entries (stride sampling across the full ${CMUDICT_PATH})`);

  const readoutNames = addCmudictNeurons(builder, project.id, sample);
  log(`Added ${readoutNames.length} cmudict neurons with real @definishon-style pronunciation targets`);

  log('Training the cmudict batch via genuine torch.autograd gradient descent...');
  const result = await trainCmudictBatch(sample);

  let trainedCount = 0;
  if (result.ok) {
    log(`PyTorch training converged=${result.converged} after ${result.epochsRun} epoch(s) (torch ${result.torchVersion})`);
    for (let i = 0; i < readoutNames.length; i++) {
      const neuron = Array.from(project.neurons.values()).find(n => n.name === readoutNames[i]);
      if (!neuron) continue;
      neuron.trained = result.sampleConverged[i] === true;
      if (neuron.trained) trainedCount++;
    }
    log(`${trainedCount}/${readoutNames.length} cmudict neurons genuinely converged and are marked trained`);
  } else {
    log(`PyTorch training unavailable (${result.error}) -- cmudict neurons kept as untrained definitions.`);
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
    // cmudict readout (in readoutNames order), the same artifact
    // train-coding-skills.mjs saves for its own network -- what a real
    // weight merge (see merge-networks.mjs) averages together.
    weightsPath = path.join(outDir, `main_network_weights_${Date.now()}.json`);
    writeFileSync(weightsPath, JSON.stringify({
      dims: DIMS, names: readoutNames, W: result.W, b: result.b, samples: result.samples,
    }, null, 2), 'utf8');
    log(`Saved weights: ${path.relative(ROOT, weightsPath)}`);
  }

  log(`Saved: ${path.relative(ROOT, outPath)}`);
  log(`Total neurons: ${project.neurons.size} (${mobyCount} moby Code-to-Net + ${readoutNames.length} cmudict, ${trainedCount} trained)`);
  return { outPath, weightsPath, mobyCount, cmudictCount: readoutNames.length, trainedCount, pytorchOk: result.ok };
}

main().then((summary) => {
  console.log(JSON.stringify(summary, null, 2));
}).catch((err) => {
  console.error('[build-main-network] FAILED:', err);
  process.exit(1);
});
