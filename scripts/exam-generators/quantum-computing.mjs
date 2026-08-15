/**
 * quantum-computing.mjs — one domain generator for
 * scripts/capability-exam.mjs: "quantum science, computation, quantum
 * computation." Real qubit-state and Grover-search formulas -- both
 * closed-form and randomized, so a fresh, verifiable question every call.
 */

/** Given a random amplitude alpha for |0> (with beta for |1> fixed by
 *  normalization, alpha^2 + beta^2 = 1), asks for the measurement
 *  probability of |0> -- alpha^2, a plain real-number computation. */
function measurementProbabilityProblem(rand) {
  const alpha = Math.round((0.2 + rand() * 0.6) * 100) / 100 // 0.20-0.80
  const probability = alpha * alpha
  return {
    problem: `A qubit is in state |psi> = ${alpha}|0> + beta|1>, normalized so alpha^2 + beta^2 = 1. What is the probability of measuring |0> (alpha^2), to 4 decimal places?`,
    answer: probability.toFixed(4),
  }
}

/** Number of distinct basis states for a random n-qubit register: 2^n. */
function stateCountProblem(rand) {
  const n = 2 + Math.floor(rand() * 10) // 2-11 qubits
  return {
    problem: `How many distinct basis states does a register of ${n} qubits have (2^n)?`,
    answer: String(2 ** n),
  }
}

/** Grover's algorithm's optimal iteration count for searching an
 *  unsorted database of N items: floor(pi/4 * sqrt(N)). */
function groverIterationsProblem(rand) {
  const n = 2 + Math.floor(rand() * 14) // register size in qubits, N = 2^n
  const N = 2 ** n
  const iterations = Math.floor((Math.PI / 4) * Math.sqrt(N))
  return {
    problem: `Grover's algorithm searches an unsorted database of N = ${N} items (from ${n} qubits). What is the optimal number of Grover iterations (floor(pi/4 * sqrt(N)))?`,
    answer: String(iterations),
  }
}

export function generateQuantumComputingProblem(rand = Math.random) {
  const r = rand()
  if (r < 1 / 3) return measurementProbabilityProblem(rand)
  if (r < 2 / 3) return stateCountProblem(rand)
  return groverIterationsProblem(rand)
}

export function generateQuantumComputingBatch(count, rand = Math.random) {
  return Array.from({ length: count }, () => generateQuantumComputingProblem(rand))
}
