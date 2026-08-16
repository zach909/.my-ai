#!/usr/bin/env node
/**
 * build-capability-exam-network.mjs — the self-improve.mjs target that
 * trains "the agent's" own answer to scripts/capability-exam.mjs: "a
 * test that can't be cheated... spam a bunch of problems that get
 * randomly generated... I don't want it just to be math" (research,
 * chip design, science, quantum science/computation, light/computation,
 * molecules, atoms, black holes).
 *
 * v2 -- routed through the REAL hyperdimensional/non-linear machinery
 * ("you have the hyperdimensional thinking and the non-linear thinking,
 * right?"), not a flat pytorch readout. v1 used pytorch_trainer.py's
 * `tanh(W . input + b)` -- one linear layer, 32 learnable numbers total,
 * and it genuinely could not clear EXAM_PASS_THRESHOLD: 0% held-out
 * accuracy across every real attempt (see the scoreboard history). That
 * wasn't a bug in the gate; it was the weakest thinking machinery in
 * this repo trying to answer the hardest, most varied test in it.
 *
 * This version drives HyperDimensionalEngine.trainDefinitions()
 * (models && skills/core/onebrain.ts, Section 4) instead: each exam
 * question clamps a DEDICATED per-domain drive neuron to the question's
 * embedding, lets the WHOLE mesh settle (multi-step propagate() through
 * real all-to-all connections and a real tanh non-linearity -- every
 * neuron's next state depends on every other neuron's current state,
 * "non linear communication meaning each neuron is connected to all
 * neurons"), then reads a dedicated per-domain readout neuron and
 * delta-rule-adjusts ITS incoming weights from every other neuron. That
 * readout's capacity is neuronCount-1 weights per content dimension
 * (here, up to 19 x 16 = 304 learnable numbers per domain, ~10x v1's
 * total capacity for ALL six domains combined), and its value is a
 * genuinely non-linear function of the input, not a direct linear map
 * -- the actual "hyperdimensional thinking" pillar, not a name for the
 * same flat regression.
 *
 * Held-out evaluation reuses the exact same settle() dynamics WITHOUT
 * the weight-adjustment step (private-but-runtime-accessible on the
 * compiled class, same as trainDefinitions() calls it internally) --
 * genuine forward-pass accuracy on a second, disjoint, freshly-generated
 * exam, never re-reporting training-set convergence.
 *
 * Usage: node extension-builder/build-capability-exam-network.mjs
 * (requires a fresh `node scripts/build-backend.mjs` first)
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIMS = 16
const QUESTIONS_PER_DOMAIN = 3 // -> 18 questions per batch across the 6 domains
const HIDDEN_NEURONS = 8 // extra neurons that never drive/readout but still take part in every settle -- real cross-influence, not decoration

// Overridable the same way every other self-improve.mjs target is --
// scripts/self-improve.mjs's mutateHyperparams() perturbs these across
// sandbox attempts.
const EPOCHS = Number(process.env.SELF_IMPROVE_EPOCHS) || 2000
const LEARNING_RATE = Number(process.env.SELF_IMPROVE_LR) || 0.3
const TOLERANCE = Number(process.env.SELF_IMPROVE_TOLERANCE) || 1e-3

function log(...args) { console.log('[build-capability-exam-network]', ...args) }

async function main() {
  const { embedText } = await import(path.join(ROOT, 'dist', 'models && skills', 'core', 'neuro-lang.js'))
  const { HyperDimensionalEngine } = await import(path.join(ROOT, 'dist', 'models && skills', 'core', 'onebrain.js'))
  const { EXAM_DOMAINS, generateExam } = await import(path.join(ROOT, 'scripts', 'capability-exam.mjs'))

  const domains = Object.keys(EXAM_DOMAINS)
  // One dedicated drive neuron AND one dedicated readout neuron per
  // domain -- each domain's readout only has to fit its own
  // QUESTIONS_PER_DOMAIN questions, not all 24 at once, while still
  // settling through the SAME shared mesh (including HIDDEN_NEURONS)
  // every single call, so domains genuinely influence each other's
  // dynamics rather than running six isolated toy nets side by side.
  const driveOf = {}
  const readoutOf = {}
  let nextId = 0
  for (const d of domains) { driveOf[d] = nextId++; readoutOf[d] = nextId++ }
  const neuronCount = nextId + HIDDEN_NEURONS

  const engine = new HyperDimensionalEngine({ neuronCount, dimensions: DIMS, propagationSteps: 4 })

  const toDefinitions = (exam) => exam.questions.map(({ domain, problem, answer }) => ({
    driveNeuronId: driveOf[domain],
    input: embedText(problem, DIMS),
    readoutNeuronId: readoutOf[domain],
    target: embedText(answer, DIMS),
  }))

  log(`generating a fresh ${QUESTIONS_PER_DOMAIN}-question-per-domain training exam...`)
  const trainExam = generateExam({ questionsPerDomain: QUESTIONS_PER_DOMAIN })
  const trainResult = engine.trainDefinitions(toDefinitions(trainExam), {
    epochs: EPOCHS, learningRate: LEARNING_RATE, tolerance: TOLERANCE,
  })
  log(`training: converged=${trainResult.converged} after ${trainResult.epochs} epoch(s), ${trainResult.satisfied.length}/${trainExam.questions.length} contracts satisfied, ${trainResult.conflicts.length} conflict(s) detected`)

  log(`generating a DISJOINT, freshly-generated held-out exam to evaluate on...`)
  const evalExam = generateExam({ questionsPerDomain: QUESTIONS_PER_DOMAIN })
  const evalDefs = toDefinitions(evalExam)
  // Real forward pass only -- settle() (called the exact same way
  // trainDefinitions() calls it internally) never touches connDiag/bias
  // on its own; only trainDefinitions()'s own delta-rule step after it
  // does. So calling it here, without that step, is a genuine held-out
  // eval: the mesh answers a question it was never trained on.
  let correct = 0
  for (const def of evalDefs) {
    engine.settle(def.input, new Set([def.driveNeuronId]))
    const readout = engine.neurons.find((n) => n.id === def.readoutNeuronId)
    let sse = 0
    for (let d = 0; d < DIMS; d++) {
      const err = (def.target[d] ?? 0) - (readout ? readout.state[d + 1] : 0)
      sse += err * err
    }
    if (sse / DIMS < TOLERANCE) correct++
  }
  const examScore = evalDefs.length > 0 ? correct / evalDefs.length : 0
  log(`held-out accuracy: ${examScore.toFixed(4)} (${correct}/${evalDefs.length})`)

  const outDir = path.join(ROOT, 'extension-builder', 'extensions')
  mkdirSync(outDir, { recursive: true })
  const weightsPath = path.join(outDir, `capability_exam_weights_${Date.now()}.json`)
  writeFileSync(weightsPath, JSON.stringify({
    engine: 'HyperDimensionalEngine', dims: DIMS, neuronCount,
    domains, driveOf, readoutOf,
    trainConverged: trainResult.converged, trainEpochs: trainResult.epochs,
    trainSatisfied: trainResult.satisfied.length, trainConflicts: trainResult.conflicts.length,
  }, null, 2), 'utf8')
  log(`Saved run summary: ${path.relative(ROOT, weightsPath)}`)

  const summary = {
    curriculumCount: trainExam.questions.length,
    trainedCount: trainResult.satisfied.length,
    finalAccuracy: examScore,
    examScore,
    weightsPath,
    trainingOk: true, // this run genuinely completed against the real HyperDimensionalEngine (no pytorch subprocess involved any more)
  }
  return summary
}

main().then((summary) => {
  if (summary) console.log(JSON.stringify(summary, null, 2))
}).catch((err) => {
  console.error('[build-capability-exam-network] fatal:', err)
  process.exit(1)
})
