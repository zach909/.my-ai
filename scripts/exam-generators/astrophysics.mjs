/**
 * astrophysics.mjs — one domain generator for scripts/capability-exam.mjs:
 * "really big stuff like black holes." Real Schwarzschild-radius and
 * escape-velocity physics over a randomized mass, using real physical
 * constants -- a closed-form formula makes this cheap to generate and
 * grade, and hard to answer without actually doing the calculation.
 */

const G = 6.6743e-11 // gravitational constant, m^3 kg^-1 s^-2
const C = 2.99792458e8 // speed of light, m/s
const SOLAR_MASS_KG = 1.98892e30

/** Schwarzschild radius r_s = 2GM/c^2 for a random mass expressed in
 *  solar masses (1 to 10,000 -- stellar-mass to intermediate black
 *  holes), answered in kilometers. */
function schwarzschildProblem(rand) {
  const solarMasses = Math.round((1 + rand() * 9999) * 100) / 100
  const massKg = solarMasses * SOLAR_MASS_KG
  const radiusM = (2 * G * massKg) / (C * C)
  const radiusKm = radiusM / 1000
  return {
    problem: `A black hole has a mass of ${solarMasses} solar masses. What is its Schwarzschild radius in kilometers (r_s = 2GM/c^2), to 2 significant figures?`,
    answer: radiusKm.toPrecision(2),
  }
}

/** Escape velocity v = sqrt(2GM/r) for a random body mass (in Earth
 *  masses) and radius (in km), answered in km/s. */
const EARTH_MASS_KG = 5.9722e24
function escapeVelocityProblem(rand) {
  const earthMasses = Math.round((0.1 + rand() * 20) * 100) / 100
  const radiusKm = Math.round(1000 + rand() * 50000)
  const massKg = earthMasses * EARTH_MASS_KG
  const radiusM = radiusKm * 1000
  const vMs = Math.sqrt((2 * G * massKg) / radiusM)
  const vKms = vMs / 1000
  return {
    problem: `A body has a mass of ${earthMasses} Earth masses and a radius of ${radiusKm} km. What is its escape velocity in km/s (v = sqrt(2GM/r)), to 2 significant figures?`,
    answer: vKms.toPrecision(2),
  }
}

export function generateAstrophysicsProblem(rand = Math.random) {
  return rand() < 0.5 ? schwarzschildProblem(rand) : escapeVelocityProblem(rand)
}

export function generateAstrophysicsBatch(count, rand = Math.random) {
  return Array.from({ length: count }, () => generateAstrophysicsProblem(rand))
}
