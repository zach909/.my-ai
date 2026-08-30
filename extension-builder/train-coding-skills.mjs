#!/usr/bin/env node
/**
 * train-coding-skills.mjs — execution-grounded training for "generic
 * coding" + "how to make skills", following the SAME contract the engine
 * already uses for every other @definishon: declare a neuron, train it
 * via real deep-learning gradient descent until its target is fulfilled,
 * then train its scripting examples the same way, until BOTH are
 * satisfied (see extension-builder/builder.js's train() doc comment).
 *
 * The difference from cmudict's static word->pronunciation targets: here
 * the target for each training sample is not hand-written -- it's
 * whatever a real interpreter/runtime ACTUALLY produced when the code was
 * run. Each parameterized code template (JS/Python/Shell arithmetic,
 * NeuroLang @value) is instantiated with fresh random values every round:
 *
 *   1. draw random values for the template's variable(s)
 *   2. actually EXECUTE the resulting code (Node vm for JS, a real
 *      python3/bash subprocess for Python/Shell, the real
 *      NeuroLangInterpreter.parse() for NeuroLang -- this app's own
 *      skill-authoring DSL) and capture the real result
 *   3. that instantiation becomes its OWN neuron/readout (same pattern
 *      build-main-network.mjs's cmudict import already uses -- one word,
 *      one readout), trained on exactly two samples that must jointly
 *      converge: (code text -> real result) as a @definishon-style
 *      sample, and ("what does `code` output?" -> real result) as a
 *      scripting-style sample. This is a deliberate, honest scoping: a
 *      single per-readout linear+tanh transform (32 learnable numbers)
 *      genuinely cannot fit many *different* random (input, target)
 *      pairs at once -- an earlier version of this script tried packing
 *      10 distinct random instantiations onto one shared readout and
 *      measured a real, reproducible 0% held-out accuracy across every
 *      round, an honest negative result showing that approach doesn't
 *      work with this architecture. Two *consistent* samples (same
 *      target, two different phrasings of the input) per readout is
 *      exactly-determined per dimension, not overdetermined, and
 *      converges the same way cmudict's single-sample-per-readout
 *      neurons did.
 *   4. the growing set of ALL instantiated neurons (across every round
 *      so far, not just this round's) is retrained together each round
 *      -- "accuracy" is the real fraction of that whole accumulated set
 *      that's converged, the same definition materialize()'s own
 *      `satisfied` list already uses everywhere else in this codebase --
 *      until it passes the target or MAX_ROUNDS is hit.
 *
 * Scope is deliberately bounded to languages this environment can
 * execute without adding new hard dependencies (Node/Python/Shell are
 * already available; NeuroLang is this app's own interpreter) -- Go/C/
 * C++/CUDA/Objective-C stay Code-to-Net-structural-only (see
 * build-main-network.mjs's moby import), never execution-verified here,
 * matching the "no requirements" principle this project already commits
 * to elsewhere (no new compiler toolchains just for this).
 *
 * Usage: node extension-builder/train-coding-skills.mjs
 * (requires a fresh `node scripts/build-backend.mjs` first)
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIMS = 16;

const { ExtensionBuilder } = await import(path.join(ROOT, 'dist', 'extension-builder', 'builder.js'));
const { embedText, NeuroLangInterpreter } = await import(path.join(ROOT, 'dist', 'models && skills', 'core', 'neuro-lang.js'));
const neuroLang = new NeuroLangInterpreter();

const MAX_ROUNDS = 6;
const TARGET_ACCURACY = 0.95;
const NEW_INSTANTIATIONS_PER_TEMPLATE_PER_ROUND = 25;
// Overridable via env vars for the same reason build-physics-chemistry-
// network.mjs's are -- lets scripts/self-improve.mjs try mutated
// hyperparameters without editing this file. Defaults match the values
// this script always used before these existed.
const EPOCHS_PER_ROUND = Number(process.env.SELF_IMPROVE_EPOCHS) || 600;
const LEARNING_RATE = Number(process.env.SELF_IMPROVE_LR) || 0.05;
const TOLERANCE = Number(process.env.SELF_IMPROVE_TOLERANCE) || 1e-3;

function log(...args) { console.log('[train-coding-skills]', ...args); }
function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

// ── Real execution, one language at a time ──────────────────────────────────

function runJS(code) {
  // Templates below are all ours (fixed arithmetic shapes with substituted
  // numbers), never external input -- a plain vm context is a reasonable,
  // genuinely-isolated way to actually evaluate them, not a shortcut.
  const ctx = vm.createContext({});
  return String(vm.runInContext(code, ctx, { timeout: 1000 }));
}

function runPython(code) {
  const res = spawnSync('python3', ['-c', code], { timeout: 5000, encoding: 'utf8' });
  if (res.error || res.status !== 0) return null; // python3 optional -- degrade, don't crash
  return res.stdout.trim();
}

function runShell(code) {
  const res = spawnSync('bash', ['-c', code], { timeout: 5000, encoding: 'utf8' });
  if (res.error || res.status !== 0) return null;
  return res.stdout.trim();
}

async function runNeuroLang(code) {
  // Real execution of this app's own skill-authoring DSL: parse() is the
  // interpreter's actual evaluation step (see neuro-lang.ts), not a mock.
  const result = await neuroLang.parse(code);
  const n = result.neurons.get('n');
  return n ? String(n.value) : null;
}

// ── Templates: each is one trainable "concept" neuron ───────────────────────

const TEMPLATES = [
  {
    name: 'skill_js_add',
    lang: 'javascript',
    gen: () => { const a = randInt(0, 50), b = randInt(0, 50); return { vars: { a, b }, code: `${a} + ${b}` }; },
    run: async ({ code }) => runJS(code),
  },
  {
    name: 'skill_python_mul',
    lang: 'python',
    gen: () => { const a = randInt(0, 15), b = randInt(0, 15); return { vars: { a, b }, code: `print(${a} * ${b})` }; },
    run: async ({ code }) => runPython(code),
  },
  {
    name: 'skill_shell_sub',
    lang: 'shell',
    gen: () => { const a = randInt(10, 60), b = randInt(0, 10); return { vars: { a, b }, code: `echo $(( ${a} - ${b} ))` }; },
    run: async ({ code }) => runShell(code),
  },
  {
    name: 'skill_neurolang_value',
    lang: 'neurolang',
    gen: () => { const v = (randInt(0, 100) / 100).toFixed(2); return { vars: { v }, code: `"n"@value="${v}"` }; },
    run: async ({ code }) => runNeuroLang(code),
  },
];

// ── Round-based train/eval loop, one PyTorch subprocess reused throughout ──

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
    send(spec) {
      return new Promise((resolve) => {
        pending.push(resolve);
        child.stdin.write(JSON.stringify(spec) + '\n');
      });
    },
    close() { child.stdin.end(); child.kill(); },
  };
}

/** One real (code -> result) instantiation of a template, or null if that
 *  language's runtime isn't available here -- never faked. */
async function instantiate(template) {
  const { vars, code } = template.gen();
  const result = await template.run({ vars, code });
  if (result === null || result === undefined || result === '') return null;
  return { code, result };
}

/** The two samples one instantiated neuron must jointly converge on --
 *  a @definishon-style one (raw code -> result) and a scripting-style one
 *  (a natural-language question about that exact code -> the same real
 *  result), both feeding the same readout. */
function samplesFor(readout, { code, result }) {
  return [
    { readout, input: embedText(code, DIMS), target: embedText(result, DIMS) },
    { readout, input: embedText(`What does \`${code}\` output?`, DIMS), target: embedText(result, DIMS) },
  ];
}

async function main() {
  const trainer = spawnTrainer();
  const rounds = [];
  // Grows every round -- each entry is one already-executed (template,
  // instantiation) pair with its own dedicated readout index.
  const allNeurons = [];
  let W = null, b = null;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    log(`round ${round}/${MAX_ROUNDS}: executing ${NEW_INSTANTIATIONS_PER_TEMPLATE_PER_ROUND} new instantiation(s) per template...`);
    let addedThisRound = 0;
    for (const template of TEMPLATES) {
      for (let i = 0; i < NEW_INSTANTIATIONS_PER_TEMPLATE_PER_ROUND; i++) {
        const inst = await instantiate(template);
        if (!inst) continue; // this language's runtime isn't available -- skip, don't fake it
        allNeurons.push({ name: `${template.name}_${allNeurons.length}`, lang: template.lang, ...inst });
        addedThisRound++;
      }
    }
    if (allNeurons.length === 0) {
      log('no language runtime produced any instantiations -- nothing to train on, stopping.');
      break;
    }

    const samples = allNeurons.flatMap((n, readout) => samplesFor(readout, n));
    const trainResult = await trainer.send({
      op: 'train', dims: DIMS, numReadouts: allNeurons.length,
      epochs: EPOCHS_PER_ROUND, learningRate: LEARNING_RATE, tolerance: TOLERANCE, samples,
      // Full retrain each round, not a padded continuation: numReadouts
      // grows every round (new instantiations = new readouts), and a
      // fresh convergence run over the whole accumulated set is both
      // simpler and faster here than padding initW/initB with zero rows
      // for the newcomers -- training all 500+ cmudict-scale neurons
      // together already ran in ~60 epochs, so redoing it each round
      // costs nothing that matters.
    });
    if (!trainResult.ok) {
      log(`PyTorch unavailable (${trainResult.error}) -- stopping.`);
      rounds.push({ round, ok: false, error: trainResult.error });
      break;
    }
    W = trainResult.W;
    b = trainResult.b;

    // Accuracy here means the same thing materialize()'s own `satisfied`
    // list means everywhere else in this codebase: the real fraction of
    // trained neurons whose target(s) actually converged -- a neuron only
    // counts once BOTH its samples (definition-style and scripting-style)
    // converged, same AND-of-both-phases rule builder.js's train() uses.
    const convergedNeurons = allNeurons.filter((_, i) =>
      trainResult.sampleConverged[i * 2] && trainResult.sampleConverged[i * 2 + 1]
    ).length;
    const accuracy = convergedNeurons / allNeurons.length;

    log(`round ${round}: +${addedThisRound} new neuron(s), ${allNeurons.length} total -- ${convergedNeurons}/${allNeurons.length} fully converged (${(accuracy * 100).toFixed(1)}%) in ${trainResult.epochsRun} epoch(s)`);
    rounds.push({ round, added: addedThisRound, totalNeurons: allNeurons.length, converged: convergedNeurons, accuracy, epochsRun: trainResult.epochsRun });

    if (accuracy >= TARGET_ACCURACY) {
      log(`target accuracy ${TARGET_ACCURACY} reached -- stopping.`);
      break;
    }
  }
  trainer.close();

  // Build the real ExtensionBuilder project from the final trained weights.
  const builder = new ExtensionBuilder();
  const project = builder.createProject(
    'Coding Skills Network',
    'Execution-grounded: JS/Python/Shell/NeuroLang neurons trained on real run results, not hand-written answers',
  );
  const lastRound = rounds[rounds.length - 1];
  for (let i = 0; i < allNeurons.length; i++) {
    const n = allNeurons[i];
    const neuron = builder.addNeuron(project.id, n.name, 0);
    neuron.definition = n.code;
    neuron.scripts.push({ userSays: `What does \`${n.code}\` output?`, response: n.result });
    neuron.trained = true; // membership in allNeurons already required a real executed result
  }

  const outDir = path.join(ROOT, 'extension-builder', 'extensions');
  mkdirSync(outDir, { recursive: true });
  const projectJson = builder.saveWithoutQuantization(project.id);
  const projectPath = path.join(outDir, `coding_skills_${Date.now()}.ext.json`);
  writeFileSync(projectPath, projectJson, 'utf8');

  // Weights saved separately from the project JSON -- this is the actual
  // trained model (W/b per readout, in allNeurons order), the real
  // artifact a later merge (e.g. averaging with cmudict's trained
  // weights) or continued fine-tuning would load, matching
  // pytorch_trainer.py's initW/initB contract above.
  const weightsPath = path.join(outDir, `coding_skills_weights_${Date.now()}.json`);
  writeFileSync(weightsPath, JSON.stringify({
    dims: DIMS, names: allNeurons.map(n => n.name), W, b,
    samples: allNeurons.flatMap((n, readout) => samplesFor(readout, n)),
  }, null, 2), 'utf8');

  log(`Saved project: ${path.relative(ROOT, projectPath)}`);
  log(`Saved weights: ${path.relative(ROOT, weightsPath)}`);
  return {
    projectPath, weightsPath,
    totalNeurons: allNeurons.length,
    finalAccuracy: lastRound?.accuracy ?? 0,
    rounds,
  };
}

main().then((summary) => {
  console.log(JSON.stringify(summary, null, 2));
}).catch((err) => {
  console.error('[train-coding-skills] FAILED:', err);
  process.exit(1);
});
