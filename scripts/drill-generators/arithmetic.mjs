/**
 * arithmetic.mjs — the one concrete drill generator this session shipped
 * for scripts/skill-drill-agent.mjs: "if it was a math skill, it would
 * constantly spam it with math problems".
 *
 * Pure and deterministic given a rand() source, so it's directly unit
 * testable without a running server. Every problem is a real arithmetic
 * fact the JS runtime itself computed -- never fabricated, never an
 * external API call.
 */

export function generateArithmeticProblem(rand = Math.random) {
  const a = Math.floor(rand() * 20) + 1
  const b = Math.floor(rand() * 20) + 1
  const ops = ['+', '-', '*']
  const op = ops[Math.floor(rand() * ops.length)]
  const answer = op === '+' ? a + b : op === '-' ? a - b : a * b
  return { problem: `${a} ${op} ${b}`, answer: String(answer) }
}

/** Generates `count` fresh problems -- a "held-out" batch, never
 *  reused as-is between calls (though the same (a,b,op) combination can
 *  recur by chance, same as any random quiz). */
export function generateArithmeticBatch(count, rand = Math.random) {
  return Array.from({ length: count }, () => generateArithmeticProblem(rand))
}
