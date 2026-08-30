/**
 * digital-logic.mjs — one domain generator for
 * scripts/capability-exam.mjs: "chip design... computation." Real
 * base-conversion and boolean-logic arithmetic -- exactly the kind of
 * ground truth a real digital circuit computes, so it's cheap to
 * generate and grade but not guessable without doing the computation.
 */

/** Random N-bit binary value converted to decimal, or vice versa. */
function baseConversionProblem(rand) {
  const bits = 4 + Math.floor(rand() * 5) // 4-8 bit values
  const value = Math.floor(rand() * 2 ** bits)
  if (rand() < 0.5) {
    return {
      problem: `Convert the ${bits}-bit binary number ${value.toString(2).padStart(bits, '0')} to decimal.`,
      answer: String(value),
    }
  }
  return {
    problem: `Convert the decimal number ${value} to ${bits}-bit binary (zero-padded).`,
    answer: value.toString(2).padStart(bits, '0'),
  }
}

/** Random boolean-logic gate applied to two random bits -- the same
 *  truth-table arithmetic a logic-synthesis tool checks. */
function gateProblem(rand) {
  const a = rand() < 0.5 ? 0 : 1
  const b = rand() < 0.5 ? 0 : 1
  const gates = {
    AND: (x, y) => x & y,
    OR: (x, y) => x | y,
    XOR: (x, y) => x ^ y,
    NAND: (x, y) => (x & y) ? 0 : 1,
    NOR: (x, y) => (x | y) ? 0 : 1,
  }
  const names = Object.keys(gates)
  const gate = names[Math.floor(rand() * names.length)]
  return {
    problem: `What is the output of a ${gate} gate with inputs A=${a}, B=${b}?`,
    answer: String(gates[gate](a, b)),
  }
}

/** How many address bits are needed to uniquely address N memory
 *  locations -- ceil(log2(N)), the real bit-width a chip designer would
 *  route for an address bus of that size. */
function addressWidthProblem(rand) {
  const locations = 2 ** (2 + Math.floor(rand() * 14)) // a power of two, 4 to 32768
  const bits = Math.ceil(Math.log2(locations))
  return {
    problem: `A memory has ${locations} addressable locations. How many address bits are required (ceil(log2(N)))?`,
    answer: String(bits),
  }
}

export function generateDigitalLogicProblem(rand = Math.random) {
  const r = rand()
  if (r < 1 / 3) return baseConversionProblem(rand)
  if (r < 2 / 3) return gateProblem(rand)
  return addressWidthProblem(rand)
}

export function generateDigitalLogicBatch(count, rand = Math.random) {
  return Array.from({ length: count }, () => generateDigitalLogicProblem(rand))
}
