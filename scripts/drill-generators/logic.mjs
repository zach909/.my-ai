/**
 * logic.mjs — drill generator for "logic".
 *
 * Propositional logic, graded by TRUTH TABLE. Every answer is obtained by
 * enumerating all 2^n assignments and evaluating the formula on each, so the
 * ground truth is a computation this file performs rather than a rule it
 * quotes. A tautology claim that came from pattern-matching the formula's
 * shape would be exactly the kind of answer that is right until it isn't.
 *
 * Pure given a rand() source. No external API.
 */

const pick = (rand, xs) => xs[Math.floor(rand() * xs.length)]
const int = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))

/** A formula as a tree, so it can be both printed and evaluated. */
function randomFormula(rand, vars, depth) {
  if (depth <= 0 || rand() < 0.25) {
    const v = pick(rand, vars)
    return rand() < 0.25 ? { op: 'NOT', a: { op: 'VAR', name: v } } : { op: 'VAR', name: v }
  }
  const op = pick(rand, ['AND', 'OR', 'IMPLIES', 'XOR'])
  return { op, a: randomFormula(rand, vars, depth - 1), b: randomFormula(rand, vars, depth - 1) }
}

function show(f) {
  if (f.op === 'VAR') return f.name
  if (f.op === 'NOT') return `NOT ${show(f.a)}`
  const sym = { AND: 'AND', OR: 'OR', IMPLIES: '->', XOR: 'XOR' }[f.op]
  return `(${show(f.a)} ${sym} ${show(f.b)})`
}

function evaluate(f, env) {
  switch (f.op) {
    case 'VAR': return env[f.name]
    case 'NOT': return !evaluate(f.a, env)
    case 'AND': return evaluate(f.a, env) && evaluate(f.b, env)
    case 'OR': return evaluate(f.a, env) || evaluate(f.b, env)
    case 'XOR': return evaluate(f.a, env) !== evaluate(f.b, env)
    case 'IMPLIES': return !evaluate(f.a, env) || evaluate(f.b, env)
    default: throw new Error(`unknown op ${f.op}`)
  }
}

/** Every assignment over `vars`, as an array of environments. */
function allRows(vars) {
  const rows = []
  for (let mask = 0; mask < 2 ** vars.length; mask++) {
    const env = {}
    vars.forEach((v, i) => { env[v] = Boolean((mask >> (vars.length - 1 - i)) & 1) })
    rows.push(env)
  }
  return rows
}

/** Evaluate one formula under one stated assignment. */
function evaluateProblem(rand) {
  const vars = ['P', 'Q', 'R'].slice(0, int(rand, 2, 3))
  const f = randomFormula(rand, vars, 2)
  const env = {}
  for (const v of vars) env[v] = rand() < 0.5
  const stated = vars.map(v => `${v}=${env[v] ? 'T' : 'F'}`).join(', ')
  return {
    problem: `Given ${stated}, evaluate: ${show(f)}\nAnswer T or F.`,
    answer: evaluate(f, env) ? 'T' : 'F',
  }
}

/** Tautology / contradiction / contingent -- decided by the whole table. */
function classifyProblem(rand) {
  const vars = ['P', 'Q'].slice(0, int(rand, 2, 2))
  const f = randomFormula(rand, vars, 2)
  const results = allRows(vars).map(env => evaluate(f, env))
  const answer = results.every(Boolean) ? 'tautology'
    : results.every(r => !r) ? 'contradiction'
      : 'contingent'
  return {
    problem: `Is ${show(f)} a tautology, a contradiction, or contingent?`,
    answer,
  }
}

/** How many of the 2^n rows make it true. */
function countModelsProblem(rand) {
  const vars = ['P', 'Q', 'R'].slice(0, int(rand, 2, 3))
  const f = randomFormula(rand, vars, 2)
  const n = allRows(vars).filter(env => evaluate(f, env)).length
  return {
    problem: `Over all ${2 ** vars.length} assignments of ${vars.join(', ')}, on how many is ${show(f)} true?`,
    answer: String(n),
  }
}

/** Are two formulas equivalent? Checked row by row, not by a known identity. */
function equivalenceProblem(rand) {
  const vars = ['P', 'Q']
  const f = randomFormula(rand, vars, 2)
  // Half the time offer a genuine De Morgan / implication rewrite, half the
  // time a plausible but different formula -- so "always yes" scores 50%.
  const g = rand() < 0.5
    ? { op: 'NOT', a: { op: 'NOT', a: f } }
    : randomFormula(rand, vars, 2)
  const same = allRows(vars).every(env => evaluate(f, env) === evaluate(g, env))
  return {
    problem: `Are these equivalent for every assignment?\n  A: ${show(f)}\n  B: ${show(g)}\nAnswer yes or no.`,
    answer: same ? 'yes' : 'no',
  }
}

/** Modus ponens / tollens and their invalid lookalikes, decided by table. */
function inferenceProblem(rand) {
  const forms = [
    { name: 'P -> Q, P therefore Q', prem: [{ op: 'IMPLIES', a: { op: 'VAR', name: 'P' }, b: { op: 'VAR', name: 'Q' } }, { op: 'VAR', name: 'P' }], concl: { op: 'VAR', name: 'Q' } },
    { name: 'P -> Q, NOT Q therefore NOT P', prem: [{ op: 'IMPLIES', a: { op: 'VAR', name: 'P' }, b: { op: 'VAR', name: 'Q' } }, { op: 'NOT', a: { op: 'VAR', name: 'Q' } }], concl: { op: 'NOT', a: { op: 'VAR', name: 'P' } } },
    { name: 'P -> Q, Q therefore P', prem: [{ op: 'IMPLIES', a: { op: 'VAR', name: 'P' }, b: { op: 'VAR', name: 'Q' } }, { op: 'VAR', name: 'Q' }], concl: { op: 'VAR', name: 'P' } },
    { name: 'P -> Q, NOT P therefore NOT Q', prem: [{ op: 'IMPLIES', a: { op: 'VAR', name: 'P' }, b: { op: 'VAR', name: 'Q' } }, { op: 'NOT', a: { op: 'VAR', name: 'P' } }], concl: { op: 'NOT', a: { op: 'VAR', name: 'Q' } } },
  ]
  const form = pick(rand, forms)
  // Valid means: no row satisfies every premise and denies the conclusion.
  const valid = allRows(['P', 'Q']).every(env =>
    !form.prem.every(p => evaluate(p, env)) || evaluate(form.concl, env))
  return {
    problem: `Is this inference valid? ${form.name}\nAnswer valid or invalid.`,
    answer: valid ? 'valid' : 'invalid',
  }
}

const KINDS = [evaluateProblem, classifyProblem, countModelsProblem, equivalenceProblem, inferenceProblem]

export function generateLogicProblem(rand = Math.random) {
  return pick(rand, KINDS)(rand)
}

export function generateLogicBatch(count, rand = Math.random) {
  return Array.from({ length: count }, () => generateLogicProblem(rand))
}
