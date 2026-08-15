/**
 * chemistry.mjs — one domain generator for scripts/capability-exam.mjs:
 * "molecules, atoms." Real molar-mass arithmetic over a small, real
 * periodic-table subset -- cheap to generate and to grade (sum a few
 * known atomic weights), not trivially guessable (the formula and its
 * element counts are randomized fresh every call).
 */

// Standard atomic weights (g/mol), rounded to 2 decimals -- a small,
// real subset covering the elements common enough to appear in simple
// molecular formulas.
export const ATOMIC_WEIGHTS = {
  H: 1.01, He: 4.0, C: 12.01, N: 14.01, O: 16.0, Na: 22.99, Mg: 24.31,
  Al: 26.98, Si: 28.09, P: 30.97, S: 32.07, Cl: 35.45, K: 39.1, Ca: 40.08,
  Fe: 55.85, Cu: 63.55, Zn: 65.38, Ag: 107.87, Au: 196.97,
}

const ELEMENTS = Object.keys(ATOMIC_WEIGHTS)

/** Generates a random small molecular formula (2-3 distinct elements,
 *  1-4 atoms each) and the molar mass a real periodic table gives it.
 *  Picks distinct elements by walking a fixed offset from a random
 *  start rather than re-rolling and hoping for a miss -- re-rolling can
 *  never terminate if `rand` ever returns the same value twice in a row
 *  (a real, encountered case: a fixed/degenerate rand() used in tests
 *  picks the same index forever and this loop never reached its target
 *  count). Walking a coprime-ish stride instead guarantees N distinct
 *  picks in exactly N steps, for ANY rand() including a constant one. */
export function generateChemistryProblem(rand = Math.random) {
  const elementCount = 2 + Math.floor(rand() * 2) // 2 or 3 distinct elements
  const start = Math.floor(rand() * ELEMENTS.length)
  const picked = Array.from({ length: elementCount }, (_, i) => ELEMENTS[(start + i) % ELEMENTS.length])
  const counts = picked.map(() => 1 + Math.floor(rand() * 4))
  const formula = picked.map((el, i) => `${el}${counts[i] > 1 ? counts[i] : ''}`).join('')
  const mass = picked.reduce((sum, el, i) => sum + ATOMIC_WEIGHTS[el] * counts[i], 0)
  return {
    problem: `What is the molar mass (g/mol) of ${formula}, to 2 decimal places?`,
    answer: mass.toFixed(2),
  }
}

export function generateChemistryBatch(count, rand = Math.random) {
  return Array.from({ length: count }, () => generateChemistryProblem(rand))
}
