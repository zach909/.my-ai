#!/usr/bin/env node
/**
 * build-self-knowledge-network.mjs — "also train it on its own wiki" +
 * "and all the files that you're making": the same two real engine
 * mechanisms build-main-network.mjs already used for moby/cmudict, applied
 * to this project's own documentation and its own recently-authored code
 * instead of an external codebase/dictionary.
 *
 *   - wiki/*.md (this repo's real GitHub wiki source, 27 pages describing
 *     the engine's own architecture, extension system, and behavior):
 *     each page becomes one real @definishon-style training sample --
 *     neuron name is the page's slug (e.g. "hyperdimensional"), the
 *     neuron's `definition` is the page's actual Markdown content, and the
 *     training target is a genuine torch.autograd gradient-descent fit of
 *     embedText(content) against the same fixed DEFINITION_TRIGGER input
 *     vector build-main-network.mjs's cmudict batch already uses (see
 *     neuro-lang.ts's definitionTrigger()). Same contract as every other
 *     @definishon: nothing here hand-writes an answer, the trained state
 *     is whatever gradient descent actually converged on.
 *
 *   - a bounded set of the driver/plugin scripts authored this session
 *     (extension-builder/build-*.mjs, merge-networks.mjs,
 *     train-coding-skills.mjs, pytorch_trainer.py, plugins/research.ts):
 *     run through the engine's real Code-to-Net converter
 *     (ExtensionBuilder.importCodeToNet(), the same byte-chain converter
 *     moby's source already went through), so the model has a structural
 *     encoding of its own recently-added capabilities, not just a prose
 *     description of them. Scoped honestly to files this session actually
 *     authored and can name precisely -- not "every file in the repo",
 *     which would just be re-importing the whole codebase under a
 *     different name.
 *
 * Usage: node extension-builder/build-self-knowledge-network.mjs
 * (requires a fresh `node scripts/build-backend.mjs` first)
 */

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
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
// than exporting it just for this one caller, same as build-main-network.mjs.
const DEFINITION_TRIGGER = new Array(DIMS).fill(0.7);

function log(...args) { console.log('[build-self-knowledge-network]', ...args); }

// ── 1. wiki/*.md: real @definishon training samples over this repo's own docs ─

const WIKI_DIR = path.join(ROOT, 'wiki');

function slugify(basename) {
  return basename.replace(/\.md$/, '').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
}

function loadWikiPages() {
  if (!existsSync(WIKI_DIR)) return [];
  const files = readdirSync(WIKI_DIR).filter((f) => f.endsWith('.md')).sort();
  return files.map((f) => ({
    file: f,
    slug: `wiki_${slugify(f)}`,
    content: readFileSync(path.join(WIKI_DIR, f), 'utf8'),
  }));
}

function addWikiNeurons(builder, projectId, pages) {
  const readoutNames = [];
  for (const { slug, content } of pages) {
    const neuron = builder.addNeuron(projectId, slug, 0);
    if (!neuron) continue;
    neuron.definition = content; // the real @definishon-style training target: the actual page text
    readoutNames.push(neuron.name);
  }
  return readoutNames;
}

function trainWikiBatch(pages) {
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

    const samples = pages.map(({ content }, idx) => ({
      readout: idx,
      input: DEFINITION_TRIGGER,
      target: embedText(content, DIMS),
    }));
    const spec = {
      dims: DIMS,
      numReadouts: pages.length,
      epochs: EPOCHS,
      learningRate: LEARNING_RATE,
      tolerance: TOLERANCE,
      samples,
    };
    child.stdin.write(JSON.stringify(spec) + '\n');
    child.stdin.end();
  });
}

// ── 2. this session's own driver/plugin scripts: real Code-to-Net ──────────

// Named precisely rather than globbed -- "the files that you're making"
// means what was actually authored this session, not every .mjs/.ts file
// that happens to live under these directories.
const SESSION_FILES = [
  'extension-builder/build-debian-network.mjs',
  'extension-builder/build-debian-iso-network.mjs',
  'extension-builder/build-main-network.mjs',
  'extension-builder/build-final-network.mjs',
  'extension-builder/merge-networks.mjs',
  'extension-builder/train-coding-skills.mjs',
  'extension-builder/pytorch_trainer.py',
  'extension-builder/build-self-knowledge-network.mjs', // this file itself
  'plugins/research.ts',
];
const SESSION_FILE_BYTES_CAP = 65536; // generous -- these are hand-authored driver scripts, not vendored binaries

function buildSessionFileCodeNets(builder, projectId) {
  let imported = 0;
  for (const rel of SESSION_FILES) {
    const full = path.join(ROOT, rel);
    if (!existsSync(full)) {
      log(`skip (not found): ${rel}`);
      continue;
    }
    const buf = readFileSync(full).subarray(0, SESSION_FILE_BYTES_CAP);
    const neuron = builder.importCodeToNet(projectId, `session_${rel.replace(/[\\/.]/g, '_')}`, buf);
    if (neuron) {
      imported++;
      log(`Code-to-Net: ${rel} -> ${neuron.name} (${neuron.definition})`);
    }
  }
  return imported;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const builder = new ExtensionBuilder();
  const project = builder.createProject(
    'Self-Knowledge Network',
    "This project's own wiki via real @definishon training + this session's own driver/plugin scripts via real Code-to-Net",
  );

  log('Loading wiki/*.md...');
  const pages = loadWikiPages();
  log(`Loaded ${pages.length} wiki page(s): ${pages.map((p) => p.file).join(', ')}`);

  const readoutNames = addWikiNeurons(builder, project.id, pages);
  log(`Added ${readoutNames.length} wiki neurons with real @definishon-style targets (full page content)`);

  log('Training the wiki batch via genuine torch.autograd gradient descent...');
  const result = await trainWikiBatch(pages);

  let trainedCount = 0;
  if (result.ok) {
    log(`PyTorch training converged=${result.converged} after ${result.epochsRun} epoch(s) (torch ${result.torchVersion})`);
    for (let i = 0; i < readoutNames.length; i++) {
      const neuron = Array.from(project.neurons.values()).find((n) => n.name === readoutNames[i]);
      if (!neuron) continue;
      neuron.trained = result.sampleConverged[i] === true;
      if (neuron.trained) trainedCount++;
    }
    log(`${trainedCount}/${readoutNames.length} wiki neurons genuinely converged and are marked trained`);
  } else {
    log(`PyTorch training unavailable (${result.error}) -- wiki neurons kept as untrained definitions.`);
    log('This is the expected optional-dependency degradation, not a build failure: rerun with a working python3+torch to actually train them.');
  }

  log("Importing this session's own scripts through the engine's real Code-to-Net converter...");
  const sessionFileCount = buildSessionFileCodeNets(builder, project.id);
  log(`Code-to-Net: ${sessionFileCount} session file(s) imported as real byte-chain neuron topologies`);

  const outDir = path.join(ROOT, 'extension-builder', 'extensions');
  mkdirSync(outDir, { recursive: true });
  const projectJson = builder.saveWithoutQuantization(project.id);
  const outPath = path.join(outDir, `self_knowledge_network_${Date.now()}.ext.json`);
  writeFileSync(outPath, projectJson, 'utf8');

  let weightsPath = null;
  if (result.ok) {
    weightsPath = path.join(outDir, `self_knowledge_weights_${Date.now()}.json`);
    writeFileSync(weightsPath, JSON.stringify({
      dims: DIMS,
      names: readoutNames,
      W: result.W,
      b: result.b,
      samples: pages.map(({ content }, idx) => ({ readout: idx, input: DEFINITION_TRIGGER, target: embedText(content, DIMS) })),
    }, null, 2), 'utf8');
    log(`Saved weights: ${path.relative(ROOT, weightsPath)}`);
  }

  log(`Saved project: ${path.relative(ROOT, outPath)}`);
  log(`Total neurons: ${project.neurons.size} (${readoutNames.length} wiki @definishon + ${sessionFileCount} session-file Code-to-Net, ${trainedCount} wiki neurons trained)`);
  return { outPath, weightsPath, wikiCount: readoutNames.length, sessionFileCount, trainedCount, pytorchOk: result.ok };
}

main().then((summary) => {
  console.log(JSON.stringify(summary, null, 2));
}).catch((err) => {
  console.error('[build-self-knowledge-network] FAILED:', err);
  process.exit(1);
});
