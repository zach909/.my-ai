/**
 * index.mjs — every drill category the agent can actually be trained on.
 *
 * Before this, exactly one concrete generator existed (arithmetic) and every
 * other topic fell through to "generic": a regression check that replays the
 * skill's own wiki content back at it. That check is honest about what it is,
 * but it cannot teach anything -- there is no held-out material in it, so
 * "accuracy improved" only ever meant "it memorised its own page harder".
 * A skill drilled generically was not being trained; it was being rehearsed.
 *
 * Each generator here produces genuinely novel problems whose answers this
 * runtime computes -- by running the loop, walking the page table, enumerating
 * the truth table. That is what makes a held-out batch held out, and it is
 * what lets the drill agent's before/after comparison mean something.
 *
 * No external API is called to produce a question or an answer, which is the
 * constraint that made this the harder path and also the only honest one:
 * generating novel problems from an external LLM would make the agent's
 * measured improvement a measurement of that LLM.
 */

import { generateArithmeticBatch } from './arithmetic.mjs'
import { generateCodingBatch } from './coding.mjs'
import { generateLogicBatch } from './logic.mjs'
import { generateBuildingAiBatch } from './building-ai.mjs'
import { generateClassicalComputersBatch } from './classical-computers.mjs'
import { generateOperatingSystemsBatch } from './operating-systems.mjs'
import { generateBuildingAppsBatch } from './building-apps.mjs'
import { generateQuantumComputingBatch } from '../exam-generators/quantum-computing.mjs'
import { generateChemistryBatch } from '../exam-generators/chemistry.mjs'
import { generateAstrophysicsBatch } from '../exam-generators/astrophysics.mjs'
import { generateOpticsBatch } from '../exam-generators/optics.mjs'

/** Science draws from all three science generators, so a science drill is
 *  not silently a chemistry drill. Round-robin rather than random, so a
 *  batch of 3 covers all three rather than possibly landing on one. */
function generateScienceBatch(count, rand = Math.random) {
  const sources = [generateChemistryBatch, generateAstrophysicsBatch, generateOpticsBatch]
  return Array.from({ length: count }, (_, i) => sources[i % sources.length](1, rand)[0])
}

/**
 * Every category, keyed by the slug classifyDrillCategory() returns.
 *
 * `generate` is always `(count, rand) => [{ problem, answer }]`, the same
 * contract drill-generators/arithmetic.mjs established.
 */
export const DRILL_CATEGORIES = {
  arithmetic: { label: 'Math', generate: generateArithmeticBatch },
  coding: { label: 'Coding', generate: generateCodingBatch },
  logic: { label: 'Logic', generate: generateLogicBatch },
  'building-ai': { label: 'Building AI', generate: generateBuildingAiBatch },
  'classical-computers': { label: 'Building classical computers', generate: generateClassicalComputersBatch },
  'quantum-computers': { label: 'Building quantum computers', generate: generateQuantumComputingBatch },
  'operating-systems': { label: 'Building operating systems', generate: generateOperatingSystemsBatch },
  'building-apps': { label: 'Building apps', generate: generateBuildingAppsBatch },
  science: { label: 'Science', generate: generateScienceBatch },
}

/**
 * Which category a topic belongs to, or 'generic' when nothing matches.
 *
 * Order matters and is not alphabetical: the more specific pattern has to be
 * tested first. "quantum computer" must not be taken by the classical-computer
 * rule, and "building an AI app" is an app rather than an AI question. Each
 * rule is anchored on word boundaries so "logic" does not match "logical
 * fallacy in the astrophysics page" by accident -- it should, in fact, and
 * that is why logic is tested late rather than early.
 */
const RULES = [
  ['quantum-computers', /\b(quantum\s*(comput\w*|circuit|gate|bit)s?|qubits?|superconduct\w*\s*qubit)\b/i],
  ['building-ai', /\b(neural\s*net\w*|machine\s*learning|deep\s*learning|backprop\w*|gradient\s*descent|transformer|embedding|building\s*ai|build\s*an?\s*ai)\b/i],
  ['operating-systems', /\b(operating\s*systems?|kernels?|schedulers?|schedul\w*|paging|page\s*tables?|virtual\s*memory|syscalls?|process\s*management)\b/i],
  ['classical-computers', /\b(cpu|processor|microarchitecture|pipelin\w*|cache|instruction\s*set|two'?s\s*complement|amdahl|computer\s*architecture|classical\s*comput\w*)\b/i],
  ['building-apps', /\b(apps?|applications?|frontend|front-end|ui|ux|pagination|state\s*machines?|web\s*apps?|mobile\s*apps?)\b/i],
  ['coding', /\b(coding|programming|software|code|algorithm|data\s*structure|recursion|complexity|refactor\w*|debug\w*)\b/i],
  ['arithmetic', /\b(arithmetic|math(?:s|ematics)?|algebra|calculus|number\s*theory|numerical)\b/i],
  ['logic', /\b(logic|boolean|propositional|truth\s*table|tautolog\w*|inference|syllogism)\b/i],
  ['science', /\b(science|scientific|physics|chemistry|chemical|astrophys\w*|astronom\w*|optics|molecul\w*|black\s*hole)\b/i],
]

export function classifyDrillCategory(topic) {
  const text = String(topic ?? '')
  for (const [slug, pattern] of RULES) if (pattern.test(text)) return slug
  return 'generic'
}

/** A fresh batch for a category, or null when the category has no generator
 *  (which is what 'generic' means -- see this file's doc comment). */
export function generateForCategory(category, count, rand = Math.random) {
  const entry = DRILL_CATEGORIES[category]
  return entry ? entry.generate(count, rand) : null
}
