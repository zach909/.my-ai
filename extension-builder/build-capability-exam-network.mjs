#!/usr/bin/env node
/**
 * build-capability-exam-network.mjs — the self-improve.mjs target that
 * trains "the agent's" own answer to scripts/capability-exam.mjs: "a
 * test that can't be cheated... spam a bunch of problems that get
 * randomly generated... I don't want it just to be math" (research,
 * chip design, science, quantum science/computation, light/computation,
 * molecules, atoms, black holes).
 *
 * Unlike build-physics-chemistry-network.mjs / train-coding-skills.mjs
 * (one dedicated readout per fixed fact, keyed only by readout index --
 * see train-coding-skills.mjs's own doc comment on why that architecture
 * can't jointly fit many *different* input/target pairs), this network
 * uses a SINGLE shared readout across every exam question, the same
 * shape scripts/skill-drill-agent.mjs already uses for its "arithmetic"
 * drill category: output = tanh(W[0] . input + b[0]) genuinely depends
 * on the input embedding, so it's the one architecture in this repo
 * that can be meaningfully quizzed on a question it never saw at train
 * time -- which is the entire point of a held-out exam.
 *
 * Trained on one freshly-generated exam batch, evaluated on a SECOND,
 * disjoint, freshly-generated batch the weights never saw (real
 * held-out accuracy, not re-reporting training-set convergence) -- same
 * train-then-eval discipline as skill-drill-agent.mjs's drillOneSkill().
 *
 * Usage: node extension-builder/build-capability-exam-network.mjs
 * (requires a fresh `node scripts/build-backend.mjs` first)
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIMS = 16
const QUESTIONS_PER_DOMAIN = 6 // -> 36 questions per batch across the 6 domains

// Overridable the same way every other self-improve.mjs target is --
// scripts/self-improve.mjs's mutateHyperparams() perturbs these across
// sandbox attempts.
const EPOCHS = Number(process.env.SELF_IMPROVE_EPOCHS) || 1200
const LEARNING_RATE = Number(process.env.SELF_IMPROVE_LR) || 0.05
const TOLERANCE = Number(process.env.SELF_IMPROVE_TOLERANCE) || 1e-3

function log(...args) { console.log('[build-capability-exam-network]', ...args) }

function runPytorch(spec) {
  return new Promise((resolve) => {
    const scriptPath = path.join(ROOT, 'extension-builder', 'pytorch_trainer.py')
    let child
    try {
      child = spawn('python3', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ ok: false, error: `could not launch python3: ${err.message}` })
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (err) => resolve({ ok: false, error: `python3 not available: ${err.message}` }))
    child.on('close', () => {
      const line = stdout.trim().split('\n').pop() ?? ''
      try {
        resolve(JSON.parse(line))
      } catch {
        resolve({ ok: false, error: stderr.trim() || 'no output from pytorch_trainer.py' })
      }
    })
    child.stdin.write(JSON.stringify(spec) + '\n')
    child.stdin.end()
  })
}

async function main() {
  const { embedText } = await import(path.join(ROOT, 'dist', 'models && skills', 'core', 'neuro-lang.js'))
  const { generateExam } = await import(path.join(ROOT, 'scripts', 'capability-exam.mjs'))

  const toSamples = (exam) => exam.questions.map(({ problem, answer }) => ({
    readout: 0,
    input: embedText(problem, DIMS),
    target: embedText(answer, DIMS),
  }))

  log(`generating a fresh ${QUESTIONS_PER_DOMAIN}-question-per-domain training exam...`)
  const trainExam = generateExam({ questionsPerDomain: QUESTIONS_PER_DOMAIN })
  const trained = await runPytorch({
    op: 'train', dims: DIMS, numReadouts: 1, epochs: EPOCHS, learningRate: LEARNING_RATE, tolerance: TOLERANCE,
    samples: toSamples(trainExam),
  })
  if (!trained.ok) {
    log(`training unavailable (${trained.error}) -- no capability-exam network built this run.`)
    console.log(JSON.stringify({ curriculumCount: trainExam.questions.length, trainedCount: 0, finalAccuracy: 0, examScore: 0, weightsPath: null, pytorchOk: false, error: trained.error }, null, 2))
    return
  }

  log(`generating a DISJOINT, freshly-generated held-out exam to evaluate on...`)
  const evalExam = generateExam({ questionsPerDomain: QUESTIONS_PER_DOMAIN })
  const evaluated = await runPytorch({
    op: 'eval', dims: DIMS, numReadouts: 1, tolerance: TOLERANCE,
    samples: toSamples(evalExam), W: trained.W, b: trained.b,
  })
  const examScore = evaluated.ok ? evaluated.accuracy : 0
  log(`held-out accuracy: ${examScore.toFixed(4)} (${evaluated.ok ? 'eval ok' : evaluated.error})`)

  const outDir = path.join(ROOT, 'extension-builder', 'extensions')
  mkdirSync(outDir, { recursive: true })
  const weightsPath = path.join(outDir, `capability_exam_weights_${Date.now()}.json`)
  writeFileSync(weightsPath, JSON.stringify({
    dims: DIMS, numReadouts: 1, W: trained.W, b: trained.b,
    domains: Object.keys(trainExam.questions.reduce((acc, q) => ({ ...acc, [q.domain]: true }), {})),
  }, null, 2), 'utf8')
  log(`Saved weights: ${path.relative(ROOT, weightsPath)}`)

  const summary = {
    curriculumCount: trainExam.questions.length,
    trainedCount: trained.sampleConverged.filter(Boolean).length,
    finalAccuracy: examScore,
    examScore,
    weightsPath,
    pytorchOk: true,
  }
  return summary
}

main().then((summary) => {
  if (summary) console.log(JSON.stringify(summary, null, 2))
}).catch((err) => {
  console.error('[build-capability-exam-network] fatal:', err)
  process.exit(1)
})
