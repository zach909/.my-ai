/**
 * operating-systems.mjs — drill generator for "building operating systems".
 *
 * Scheduling, paging and address translation. Every answer is produced by
 * SIMULATING the policy -- the scheduler is run, the page table is walked,
 * the replacement algorithm evicts. Nothing here is a memorised formula,
 * because the interesting cases are exactly the ones where a formula would
 * be wrong: a page string whose LRU and FIFO answers differ, a queue where
 * shortest-job-first reorders.
 *
 * Pure given a rand() source. No external API.
 */

const pick = (rand, xs) => xs[Math.floor(rand() * xs.length)]
const int = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
const r4 = (v) => v.toFixed(4)

/** FCFS and SJF, both actually scheduled. */
function schedulingProblem(rand) {
  const n = int(rand, 3, 5)
  const jobs = Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, burst: int(rand, 1, 12) }))
  const policy = pick(rand, ['FCFS', 'SJF'])
  const order = policy === 'FCFS' ? [...jobs] : [...jobs].sort((a, b) => a.burst - b.burst)
  let clock = 0
  let totalWait = 0
  let totalTurnaround = 0
  for (const j of order) {
    totalWait += clock
    clock += j.burst
    totalTurnaround += clock
  }
  const listing = jobs.map(j => `${j.name} burst ${j.burst}`).join(', ')
  const asked = pick(rand, ['wait', 'turnaround'])
  return {
    problem: `All jobs arrive at time 0: ${listing}.\nUnder ${policy}, what is the average ${asked === 'wait' ? 'waiting' : 'turnaround'} time? (4 decimal places)`,
    answer: r4((asked === 'wait' ? totalWait : totalTurnaround) / n),
  }
}

/** Round robin, run one quantum at a time. */
function roundRobinProblem(rand) {
  const n = int(rand, 2, 4)
  const q = int(rand, 1, 4)
  const jobs = Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, left: int(rand, 1, 10) }))
  const listing = jobs.map(j => `${j.name} burst ${j.left}`).join(', ')
  const queue = jobs.map(j => ({ ...j }))
  let clock = 0
  const finish = {}
  while (queue.length) {
    const job = queue.shift()
    const slice = Math.min(q, job.left)
    clock += slice
    job.left -= slice
    if (job.left === 0) finish[job.name] = clock
    else queue.push(job)
  }
  const target = jobs[int(rand, 0, n - 1)].name
  return {
    problem: `All jobs arrive at time 0: ${listing}.\nRound robin, quantum ${q}, served in the listed order.\nAt what time does ${target} finish?`,
    answer: String(finish[target]),
  }
}

/** FIFO or LRU page faults, on a string built to make them differ. */
function pageReplacementProblem(rand) {
  const frames = int(rand, 2, 4)
  const distinct = frames + int(rand, 1, 3)
  const len = int(rand, 8, 14)
  const refs = Array.from({ length: len }, () => int(rand, 1, distinct))
  const policy = pick(rand, ['FIFO', 'LRU'])
  const inMemory = []
  const lastUsed = new Map()
  let faults = 0
  refs.forEach((page, t) => {
    if (inMemory.includes(page)) {
      lastUsed.set(page, t)
      return
    }
    faults++
    if (inMemory.length >= frames) {
      let victim
      if (policy === 'FIFO') victim = inMemory.shift()
      else {
        victim = inMemory.reduce((a, b) => (lastUsed.get(a) <= lastUsed.get(b) ? a : b))
        inMemory.splice(inMemory.indexOf(victim), 1)
      }
      lastUsed.delete(victim)
    }
    inMemory.push(page)
    lastUsed.set(page, t)
  })
  return {
    problem: `Reference string: ${refs.join(' ')}\n${frames} frames, ${policy} replacement, all frames initially empty.\nHow many page faults?`,
    answer: String(faults),
  }
}

/** Virtual address translation -- the split, done. */
function addressTranslationProblem(rand) {
  const pageBits = pick(rand, [10, 12, 13])
  const addrBits = pick(rand, [24, 32])
  const pageSize = 2 ** pageBits
  const addr = int(rand, 0, 2 ** Math.min(addrBits, 30) - 1)
  const kind = pick(rand, ['page', 'offset', 'entries'])
  if (kind === 'page') {
    return {
      problem: `Page size ${pageSize} bytes. What is the page number for virtual address ${addr}?`,
      answer: String(Math.floor(addr / pageSize)),
    }
  }
  if (kind === 'offset') {
    return {
      problem: `Page size ${pageSize} bytes. What is the offset within the page for virtual address ${addr}?`,
      answer: String(addr % pageSize),
    }
  }
  return {
    problem: `A ${addrBits}-bit virtual address space with ${pageSize}-byte pages.\nHow many entries does a single-level page table need?`,
    answer: String(2 ** (addrBits - pageBits)),
  }
}

/** Disk head movement, walked request by request. */
function diskProblem(rand) {
  const n = int(rand, 4, 7)
  const start = int(rand, 0, 199)
  const requests = Array.from({ length: n }, () => int(rand, 0, 199))
  const policy = pick(rand, ['FCFS', 'SSTF'])
  let head = start
  let total = 0
  if (policy === 'FCFS') {
    for (const r of requests) { total += Math.abs(r - head); head = r }
  } else {
    const left = [...requests]
    while (left.length) {
      let bi = 0
      for (let i = 1; i < left.length; i++) if (Math.abs(left[i] - head) < Math.abs(left[bi] - head)) bi = i
      total += Math.abs(left[bi] - head)
      head = left[bi]
      left.splice(bi, 1)
    }
  }
  return {
    problem: `Disk head at cylinder ${start}. Requests: ${requests.join(', ')}.\nUnder ${policy}, what is the total head movement in cylinders?`,
    answer: String(total),
  }
}

const KINDS = [schedulingProblem, roundRobinProblem, pageReplacementProblem, addressTranslationProblem, diskProblem]

export function generateOperatingSystemsProblem(rand = Math.random) {
  return pick(rand, KINDS)(rand)
}

export function generateOperatingSystemsBatch(count, rand = Math.random) {
  return Array.from({ length: count }, () => generateOperatingSystemsProblem(rand))
}
