/**
 * classical-computers.mjs — drill generator for "building classical
 * computers": the arithmetic a machine architect actually does.
 *
 * Deliberately above the gate level, because exam-generators/digital-logic.mjs
 * already covers gates and base conversion. This is the layer up: two's
 * complement, cache and memory hierarchy, pipelines, and the speedup laws.
 * Every answer is computed here.
 *
 * Pure given a rand() source. No external API.
 */

const pick = (rand, xs) => xs[Math.floor(rand() * xs.length)]
const int = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
const r4 = (v) => v.toFixed(4)

/** Two's complement, both directions. */
function twosComplementProblem(rand) {
  const bits = pick(rand, [8, 16])
  const value = int(rand, -(2 ** (bits - 1)), 2 ** (bits - 1) - 1)
  if (rand() < 0.5) {
    const encoded = (value < 0 ? value + 2 ** bits : value).toString(2).padStart(bits, '0')
    return { problem: `Encode ${value} as a ${bits}-bit two's complement binary number.`, answer: encoded }
  }
  const raw = value < 0 ? value + 2 ** bits : value
  const bin = raw.toString(2).padStart(bits, '0')
  return { problem: `Interpret the ${bits}-bit two's complement number ${bin} as a signed decimal.`, answer: String(value) }
}

/** Where an address lands in a cache. */
function cacheAddressProblem(rand) {
  const offsetBits = pick(rand, [4, 5, 6])
  const indexBits = pick(rand, [5, 6, 7])
  const addrBits = 32
  const blockSize = 2 ** offsetBits
  const sets = 2 ** indexBits
  const kind = pick(rand, ['tag', 'sets', 'size'])
  if (kind === 'tag') {
    return {
      problem: `A ${addrBits}-bit address, a direct-mapped cache with ${blockSize}-byte blocks and ${sets} sets.\nHow many tag bits?`,
      answer: String(addrBits - indexBits - offsetBits),
    }
  }
  if (kind === 'sets') {
    return {
      problem: `A direct-mapped cache holds ${(blockSize * sets) / 1024} KiB in ${blockSize}-byte blocks.\nHow many blocks does it have?`,
      answer: String(sets),
    }
  }
  return {
    problem: `A cache has ${sets} sets of ${blockSize}-byte blocks, direct-mapped.\nWhat is its data capacity in bytes?`,
    answer: String(sets * blockSize),
  }
}

/** Average memory access time -- the hierarchy, multiplied out. */
function amatProblem(rand) {
  const hitTime = int(rand, 1, 4)
  const missPenalty = int(rand, 20, 200)
  const missRatePct = int(rand, 1, 20)
  const amat = hitTime + (missRatePct / 100) * missPenalty
  return {
    problem: `Cache hit time ${hitTime} cycles, miss rate ${missRatePct}%, miss penalty ${missPenalty} cycles.\nWhat is the average memory access time in cycles? (4 decimal places)`,
    answer: r4(amat),
  }
}

/** CPI and total cycles for a real instruction mix. */
function cpiProblem(rand) {
  const classes = [
    { name: 'ALU', cpi: 1, pct: int(rand, 30, 60) },
    { name: 'load/store', cpi: int(rand, 2, 5), pct: int(rand, 15, 35) },
  ]
  const used = classes.reduce((s, c) => s + c.pct, 0)
  classes.push({ name: 'branch', cpi: int(rand, 2, 4), pct: 100 - used })
  if (classes[2].pct <= 0) return cpiProblem(rand)
  const cpi = classes.reduce((s, c) => s + c.cpi * (c.pct / 100), 0)
  const mix = classes.map(c => `${c.name} ${c.pct}% at CPI ${c.cpi}`).join(', ')
  if (rand() < 0.5) {
    return { problem: `Instruction mix: ${mix}.\nWhat is the overall CPI? (4 decimal places)`, answer: r4(cpi) }
  }
  const instrs = int(rand, 1, 20) * 1000
  return {
    problem: `Instruction mix: ${mix}.\nHow many cycles does a program of ${instrs} instructions take? (4 decimal places)`,
    answer: r4(cpi * instrs),
  }
}

/** Pipeline throughput: the fill cost is the whole point. */
function pipelineProblem(rand) {
  const stages = int(rand, 3, 8)
  const instrs = int(rand, 5, 50)
  const cycles = stages + (instrs - 1)
  if (rand() < 0.5) {
    return {
      problem: `A ${stages}-stage pipeline, one instruction issued per cycle, no stalls.\nHow many cycles to complete ${instrs} instructions?`,
      answer: String(cycles),
    }
  }
  return {
    problem: `A ${stages}-stage pipeline completes ${instrs} instructions in ${cycles} cycles.\nAn unpipelined machine takes ${stages} cycles per instruction. What is the speedup? (4 decimal places)`,
    answer: r4((stages * instrs) / cycles),
  }
}

/** Amdahl -- the law that says what optimising one part buys you. */
function amdahlProblem(rand) {
  const parallelPct = int(rand, 50, 95)
  const speedup = pick(rand, [2, 4, 8, 16, 32])
  const p = parallelPct / 100
  const overall = 1 / ((1 - p) + p / speedup)
  return {
    problem: `${parallelPct}% of a program can be sped up by ${speedup}x; the rest cannot be sped up at all.\nWhat is the overall speedup? (4 decimal places)`,
    answer: r4(overall),
  }
}

const KINDS = [twosComplementProblem, cacheAddressProblem, amatProblem, cpiProblem, pipelineProblem, amdahlProblem]

export function generateClassicalComputersProblem(rand = Math.random) {
  return pick(rand, KINDS)(rand)
}

export function generateClassicalComputersBatch(count, rand = Math.random) {
  return Array.from({ length: count }, () => generateClassicalComputersProblem(rand))
}
