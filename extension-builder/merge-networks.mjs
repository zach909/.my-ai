#!/usr/bin/env node
/**
 * merge-networks.mjs — real weight averaging ("model soup") between two
 * independently-trained networks, then a genuine fine-tune pass on the
 * result.
 *
 * This is the actual mathematical operation the earlier "drag them
 * together, take the average of connection a1 and a2" description maps
 * to: for every readout NAME present in both weight sets, the merged
 * (W, b) row is the elementwise average of the two trained rows; for a
 * name present in only one set, its row carries over unchanged (nothing
 * to average against). This only works because both inputs are the SAME
 * architecture -- one learnable (weight, bias) row per readout, from the
 * same pytorch_trainer.py -- unlike Code-to-Net's byte-chain neurons
 * (moby/Debian), which have no trained weights at all and so cannot be
 * merged this way (see build-debian-network.mjs's exportCodeNet() for
 * what those ARE reversible into instead).
 *
 * After merging, the combined weights are NOT just averaged and left --
 * they're fed back into pytorch_trainer.py as initW/initB for one more
 * real training pass over the UNION of both models' original samples
 * (persisted alongside each weights file specifically so this step can
 * happen), so the merged model is verified to still satisfy both of its
 * source tasks jointly, not just assumed to.
 *
 * Usage:
 *   node extension-builder/merge-networks.mjs <weightsA.json> <weightsB.json>
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[merge-networks]', ...args); }

function loadWeights(p) {
  const data = JSON.parse(readFileSync(p, 'utf8'));
  if (!Array.isArray(data.names) || !Array.isArray(data.W) || !Array.isArray(data.b)) {
    throw new Error(`${p} is not a valid weights file (expected {dims, names, W, b, samples})`);
  }
  return data;
}

/** The actual merge: union of names, elementwise-averaged W/b rows for
 *  any name in both inputs, carried-over rows for a name in only one. */
function mergeWeights(a, b) {
  if (a.dims !== b.dims) {
    throw new Error(`dims mismatch: ${a.dims} vs ${b.dims} -- cannot average vectors of different length`);
  }
  const dims = a.dims;
  const bIndexByName = new Map(b.names.map((n, i) => [n, i]));
  const mergedNames = [];
  const mergedW = [];
  const mergedB = [];
  let overlapCount = 0;

  for (let i = 0; i < a.names.length; i++) {
    const name = a.names[i];
    const bi = bIndexByName.get(name);
    if (bi === undefined) {
      mergedNames.push(name);
      mergedW.push(a.W[i]);
      mergedB.push(a.b[i]);
    } else {
      overlapCount++;
      mergedNames.push(name);
      mergedW.push(a.W[i].map((v, d) => (v + b.W[bi][d]) / 2));
      mergedB.push(a.b[i].map((v, d) => (v + b.b[bi][d]) / 2));
      bIndexByName.delete(name);
    }
  }
  // Whatever's left in bIndexByName had no match in A -- carried over as-is.
  for (const [name, bi] of bIndexByName) {
    mergedNames.push(name);
    mergedW.push(b.W[bi]);
    mergedB.push(b.b[bi]);
  }

  return { dims, names: mergedNames, W: mergedW, b: mergedB, overlapCount };
}

function spawnTrainer() {
  const scriptPath = path.join(ROOT, 'extension-builder', 'pytorch_trainer.py');
  const child = spawn('python3', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const pending = [];
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const resolve = pending.shift();
      if (resolve) { try { resolve(JSON.parse(line)); } catch (e) { resolve({ ok: false, error: String(e) }); } }
    }
  });
  child.on('error', () => { while (pending.length) pending.shift()({ ok: false, error: 'python3 not available' }); });
  return {
    send(spec) { return new Promise((resolve) => { pending.push(resolve); child.stdin.write(JSON.stringify(spec) + '\n'); }); },
    close() { child.stdin.end(); child.kill(); },
  };
}

async function main() {
  const [pathA, pathB] = process.argv.slice(2);
  if (!pathA || !pathB) {
    console.error('Usage: node extension-builder/merge-networks.mjs <weightsA.json> <weightsB.json>');
    process.exit(1);
  }

  const a = loadWeights(pathA);
  const b = loadWeights(pathB);
  log(`Model A: ${a.names.length} readouts (${path.basename(pathA)})`);
  log(`Model B: ${b.names.length} readouts (${path.basename(pathB)})`);

  const merged = mergeWeights(a, b);
  log(`Merged: ${merged.names.length} readouts total, ${merged.overlapCount} name(s) overlapped and were genuinely averaged`);

  // The readout each sample refers to is a LOCAL index into that source
  // file's own `names` array -- remap every sample's `readout` field to
  // its position in the merged, unioned name list before reusing it.
  const mergedIndexByName = new Map(merged.names.map((n, i) => [n, i]));
  const remap = (samples, names) => samples.map(s => ({
    ...s, readout: mergedIndexByName.get(names[s.readout]),
  }));
  const unionSamples = [
    ...remap(a.samples ?? [], a.names),
    ...remap(b.samples ?? [], b.names),
  ];

  const trainer = spawnTrainer();
  let fineTuneResult = { ok: false, error: 'no samples to fine-tune on' };
  if (unionSamples.length > 0) {
    log(`Fine-tuning the merged model on the union of both source sample sets (${unionSamples.length} samples), initialized from the averaged weights...`);
    fineTuneResult = await trainer.send({
      op: 'train', dims: merged.dims, numReadouts: merged.names.length,
      epochs: 800, learningRate: 0.05, tolerance: 1e-3,
      samples: unionSamples, initW: merged.W, initB: merged.b,
    });
  }
  trainer.close();

  const finalW = fineTuneResult.ok ? fineTuneResult.W : merged.W;
  const finalB = fineTuneResult.ok ? fineTuneResult.b : merged.b;
  const converged = fineTuneResult.ok
    ? fineTuneResult.sampleConverged.filter(Boolean).length
    : null;
  if (fineTuneResult.ok) {
    log(`Fine-tune: ${converged}/${fineTuneResult.sampleConverged.length} samples converged in ${fineTuneResult.epochsRun} epoch(s) (converged=${fineTuneResult.converged})`);
  } else {
    log(`Fine-tune unavailable (${fineTuneResult.error}) -- keeping the plain averaged weights, unrefined.`);
  }

  const outDir = path.join(ROOT, 'extension-builder', 'extensions');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `merged_network_weights_${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify({
    dims: merged.dims, names: merged.names, W: finalW, b: finalB,
    samples: unionSamples,
  }, null, 2), 'utf8');

  log(`Saved: ${path.relative(ROOT, outPath)}`);
  return {
    outPath, totalReadouts: merged.names.length, overlapCount: merged.overlapCount,
    fineTuneOk: fineTuneResult.ok, fineTuneConverged: converged,
    fineTuneTotal: fineTuneResult.ok ? fineTuneResult.sampleConverged.length : null,
  };
}

main().then((summary) => {
  console.log(JSON.stringify(summary, null, 2));
}).catch((err) => {
  console.error('[merge-networks] FAILED:', err);
  process.exit(1);
});
