/**
 * optics.mjs — one domain generator for scripts/capability-exam.mjs:
 * "light, computation." Real photon-energy and thin-lens formulas over
 * randomized parameters -- both closed-form, so grading is a plain
 * numeric comparison, not a fabricated answer key.
 */

const PLANCK_H = 6.62607015e-34 // J*s
const EV_PER_JOULE = 1 / 1.602176634e-19

/** Photon energy E = hf for a random frequency (in THz, visible-to-UV
 *  range), answered in electron-volts. */
function photonEnergyProblem(rand) {
  const freqTHz = Math.round((300 + rand() * 700) * 10) / 10 // ~300-1000 THz
  const freqHz = freqTHz * 1e12
  const energyJ = PLANCK_H * freqHz
  const energyEv = energyJ * EV_PER_JOULE
  return {
    problem: `What is the energy in electron-volts (eV) of a photon with frequency ${freqTHz} THz (E = hf), to 3 significant figures?`,
    answer: energyEv.toPrecision(3),
  }
}

/** Thin-lens equation 1/f = 1/do + 1/di, solved for image distance di
 *  given a random focal length and object distance (do > f, real image). */
function lensProblem(rand) {
  const f = Math.round((5 + rand() * 45) * 10) / 10 // cm
  const objectDistance = Math.round((f * 1.5 + rand() * f * 3) * 10) / 10 // always > f
  const di = 1 / (1 / f - 1 / objectDistance)
  return {
    problem: `A thin lens has focal length ${f} cm. An object sits ${objectDistance} cm away. Using 1/f = 1/do + 1/di, what is the image distance di in cm, to 2 decimal places?`,
    answer: di.toFixed(2),
  }
}

export function generateOpticsProblem(rand = Math.random) {
  return rand() < 0.5 ? photonEnergyProblem(rand) : lensProblem(rand)
}

export function generateOpticsBatch(count, rand = Math.random) {
  return Array.from({ length: count }, () => generateOpticsProblem(rand))
}
