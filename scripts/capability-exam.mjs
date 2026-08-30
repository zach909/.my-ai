/**
 * capability-exam.mjs — "a test that can't be cheated": completely
 * random questions, in random order, freshly regenerated every single
 * time the exam is taken, spanning math, chemistry (molecules/atoms),
 * astrophysics (black holes and "really big stuff"), optics
 * (light/computation), quantum computing, and digital logic (chip
 * design/computation). Every question comes from a real, closed-form
 * formula this JS runtime actually evaluates -- cheap to generate and
 * to grade, but not guessable without doing the computation. No
 * external API is ever called to produce a question or an answer (see
 * "NO EXTERNAL APIS" throughout wiki/Self-Improvement.md) -- this is
 * the same honesty constraint scripts/drill-generators/arithmetic.mjs
 * and scripts/skill-drill-agent.mjs already operate under, just spread
 * across more domains.
 *
 * "I don't want it just to be math" -- every domain below is a real,
 * distinct generator module under scripts/exam-generators/, each pure
 * and directly unit testable given a rand() source.
 */

import { generateArithmeticBatch } from './drill-generators/arithmetic.mjs'
import { generateChemistryBatch } from './exam-generators/chemistry.mjs'
import { generateAstrophysicsBatch } from './exam-generators/astrophysics.mjs'
import { generateOpticsBatch } from './exam-generators/optics.mjs'
import { generateQuantumComputingBatch } from './exam-generators/quantum-computing.mjs'
import { generateDigitalLogicBatch } from './exam-generators/digital-logic.mjs'
import { generateCodingBatch } from './drill-generators/coding.mjs'
import { generateLogicBatch } from './drill-generators/logic.mjs'
import { generateBuildingAiBatch } from './drill-generators/building-ai.mjs'
import { generateClassicalComputersBatch } from './drill-generators/classical-computers.mjs'
import { generateOperatingSystemsBatch } from './drill-generators/operating-systems.mjs'
import { generateBuildingAppsBatch } from './drill-generators/building-apps.mjs'

/** Every domain the exam can draw from, keyed by a stable slug used in
 *  history/UI. Each generator is `(count, rand) => [{ problem, answer }]`. */
export const EXAM_DOMAINS = {
  arithmetic: { label: 'Math', generate: generateArithmeticBatch },
  chemistry: { label: 'Chemistry (molecules & atoms)', generate: generateChemistryBatch },
  astrophysics: { label: 'Astrophysics (black holes & scale)', generate: generateAstrophysicsBatch },
  optics: { label: 'Optics (light & computation)', generate: generateOpticsBatch },
  'quantum-computing': { label: 'Quantum computing', generate: generateQuantumComputingBatch },
  'digital-logic': { label: 'Digital logic (chip design)', generate: generateDigitalLogicBatch },
  // The domains the agent is now actually DRILLED on, so the exam covers
  // what training covers. An exam that tests six domains while training
  // covers nine measures the wrong thing in both directions: improvement in
  // the three it cannot see is invisible, and the exam score stops being a
  // read on the training loop. Same generators, fresh problems every run --
  // there is no shared question bank to leak between the two.
  coding: { label: 'Coding', generate: generateCodingBatch },
  logic: { label: 'Logic', generate: generateLogicBatch },
  'building-ai': { label: 'Building AI', generate: generateBuildingAiBatch },
  'classical-computers': { label: 'Building classical computers', generate: generateClassicalComputersBatch },
  'operating-systems': { label: 'Building operating systems', generate: generateOperatingSystemsBatch },
  'building-apps': { label: 'Building apps', generate: generateBuildingAppsBatch },
}

/** Fisher-Yates shuffle driven by the same rand() source as everything
 *  else here -- deterministic given a seeded rand, genuinely random
 *  given Math.random, and never just Array.sort(() => rand() - 0.5)
 *  (a well-known biased shuffle). */
export function shuffle(items, rand = Math.random) {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Generates one full exam: `questionsPerDomain` fresh questions from
 * EVERY domain in `domains` (defaults to all of them), then shuffles
 * the combined set into a single random order. Nothing here is cached,
 * seeded from a file, or reused between calls -- every call is a brand
 * new exam, matching "completely random questions and random order,
 * changing every time you take the test."
 */
export function generateExam({ questionsPerDomain = 5, domains = Object.keys(EXAM_DOMAINS), rand = Math.random } = {}) {
  const questions = []
  for (const domain of domains) {
    const gen = EXAM_DOMAINS[domain]
    if (!gen) continue
    for (const { problem, answer } of gen.generate(questionsPerDomain, rand)) {
      questions.push({ domain, problem, answer })
    }
  }
  return { generatedAt: new Date().toISOString(), questions: shuffle(questions, rand) }
}

/** True if `given` matches `expected` closely enough to count as
 *  correct: an exact case-insensitive trimmed string match, OR (for
 *  numeric answers, the overwhelming majority of this exam) a value
 *  within a small relative tolerance -- forgiving harmless formatting
 *  differences (trailing zeros, "1e+03" vs "1000") without forgiving a
 *  genuinely wrong answer. */
export function gradeAnswer(expected, given, { relTolerance = 0.01 } = {}) {
  if (typeof given !== 'string' && typeof given !== 'number') return false
  const expectedStr = String(expected).trim()
  const givenStr = String(given).trim()
  if (expectedStr.toLowerCase() === givenStr.toLowerCase()) return true

  const expectedNum = Number(expectedStr)
  const givenNum = Number(givenStr)
  if (Number.isFinite(expectedNum) && Number.isFinite(givenNum)) {
    if (expectedNum === givenNum) return true
    const scale = Math.max(Math.abs(expectedNum), 1e-9)
    return Math.abs(expectedNum - givenNum) / scale <= relTolerance
  }
  return false
}

/** Grades a full set of (question, givenAnswer) attempts against the
 *  exam's own answer key and returns the score plus a per-question
 *  breakdown (used both for the pass/fail gate and for the dashboard). */
export function gradeExam(exam, answers) {
  const results = exam.questions.map((q, i) => {
    const given = answers[i]
    const correct = gradeAnswer(q.answer, given)
    return { domain: q.domain, problem: q.problem, expected: q.answer, given, correct }
  })
  const correctCount = results.filter((r) => r.correct).length
  return {
    score: exam.questions.length > 0 ? correctCount / exam.questions.length : 0,
    correctCount,
    totalCount: exam.questions.length,
    results,
  }
}
