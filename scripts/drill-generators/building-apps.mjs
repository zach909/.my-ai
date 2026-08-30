/**
 * building-apps.mjs — drill generator for "building apps".
 *
 * The arithmetic an application actually gets wrong in production:
 * pagination boundaries, retry backoff, cache expiry, debounce and throttle
 * counts, layout space, and state machines. Every answer is produced by
 * simulating the behaviour rather than by a closed form, because the
 * off-by-one at the boundary is the whole point -- a formula that is right
 * in the middle and wrong on the last page is the bug this drills.
 *
 * Pure given a rand() source. No external API.
 */

const pick = (rand, xs) => xs[Math.floor(rand() * xs.length)]
const int = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
const r4 = (v) => v.toFixed(4)

/** Pagination, counted out page by page. */
function paginationProblem(rand) {
  const total = int(rand, 1, 500)
  const perPage = pick(rand, [5, 10, 20, 25, 50])
  const pages = []
  for (let i = 0; i < total; i += perPage) pages.push(Math.min(perPage, total - i))
  const kind = pick(rand, ['count', 'last', 'offset'])
  if (kind === 'count') {
    return { problem: `${total} items, ${perPage} per page.\nHow many pages are there?`, answer: String(pages.length) }
  }
  if (kind === 'last') {
    return { problem: `${total} items, ${perPage} per page.\nHow many items are on the last page?`, answer: String(pages[pages.length - 1]) }
  }
  const page = int(rand, 1, pages.length)
  return {
    problem: `${total} items, ${perPage} per page.\nWhat is the zero-based offset of the first item on page ${page} (1-based page numbers)?`,
    answer: String((page - 1) * perPage),
  }
}

/** Exponential backoff, added up attempt by attempt. */
function backoffProblem(rand) {
  const base = pick(rand, [100, 200, 250, 500])
  const factor = pick(rand, [2, 3])
  const attempts = int(rand, 3, 6)
  const cap = pick(rand, [0, 2000, 5000])
  let total = 0
  let delay = base
  const delays = []
  for (let i = 0; i < attempts - 1; i++) {
    const d = cap > 0 ? Math.min(delay, cap) : delay
    delays.push(d)
    total += d
    delay *= factor
  }
  const capText = cap > 0 ? `, capped at ${cap} ms per wait` : ''
  return {
    problem: `A request is retried with exponential backoff: first wait ${base} ms, each next wait x${factor}${capText}.\nAcross ${attempts} attempts (so ${attempts - 1} waits), what is the total time spent waiting, in ms?`,
    answer: String(total),
  }
}

/** Cache TTL: how many requests actually reach the origin. */
function cacheTtlProblem(rand) {
  const ttl = int(rand, 2, 10)
  const times = []
  let t = 0
  const n = int(rand, 5, 12)
  for (let i = 0; i < n; i++) { times.push(t); t += int(rand, 1, 6) }
  let origin = 0
  let validUntil = -1
  for (const at of times) {
    if (at >= validUntil) { origin++; validUntil = at + ttl }
  }
  return {
    problem: `A cache entry lives ${ttl} seconds from the moment it is fetched.\nRequests arrive at t = ${times.join(', ')} seconds.\nHow many requests reach the origin?`,
    answer: String(origin),
  }
}

/** Debounce vs throttle, simulated over an event stream. */
function eventRateProblem(rand) {
  const window = int(rand, 2, 6)
  const n = int(rand, 5, 12)
  const times = []
  let t = 0
  for (let i = 0; i < n; i++) { times.push(t); t += int(rand, 1, 5) }
  const mode = pick(rand, ['debounce', 'throttle'])
  let fired = 0
  if (mode === 'throttle') {
    let nextAllowed = -Infinity
    for (const at of times) {
      if (at >= nextAllowed) { fired++; nextAllowed = at + window }
    }
  } else {
    // Debounce trailing: an event fires only if nothing follows within window.
    for (let i = 0; i < times.length; i++) {
      const next = times[i + 1]
      if (next === undefined || next - times[i] >= window) fired++
    }
  }
  const desc = mode === 'throttle'
    ? `throttled to at most one call per ${window} seconds (leading edge)`
    : `debounced with a ${window}-second trailing window`
  return {
    problem: `Events arrive at t = ${times.join(', ')} seconds.\nThe handler is ${desc}.\nHow many times does the handler run?`,
    answer: String(fired),
  }
}

/** Layout space, divided out. */
function layoutProblem(rand) {
  const container = int(rand, 3, 20) * 100
  const items = int(rand, 2, 6)
  const gap = pick(rand, [0, 8, 12, 16, 24])
  const kind = pick(rand, ['flexBasis', 'columns'])
  if (kind === 'flexBasis') {
    const each = (container - gap * (items - 1)) / items
    return {
      problem: `A ${container}px row holds ${items} equal items with a ${gap}px gap between neighbours.\nHow wide is each item, in px? (4 decimal places)`,
      answer: r4(each),
    }
  }
  const minWidth = int(rand, 1, 4) * 100
  let cols = 0
  while ((cols + 1) * minWidth + cols * gap <= container) cols++
  return {
    problem: `A ${container}px container, items at least ${minWidth}px wide, ${gap}px gap between columns.\nHow many columns fit on one row?`,
    answer: String(cols),
  }
}

/** A state machine, stepped. */
function stateMachineProblem(rand) {
  const transitions = {
    idle: { load: 'loading', reset: 'idle' },
    loading: { ok: 'ready', fail: 'error', reset: 'idle' },
    ready: { load: 'loading', reset: 'idle', fail: 'error' },
    error: { retry: 'loading', reset: 'idle' },
  }
  const events = ['load', 'ok', 'fail', 'reset', 'retry']
  const n = int(rand, 3, 7)
  const seq = Array.from({ length: n }, () => pick(rand, events))
  let state = 'idle'
  for (const e of seq) {
    const next = transitions[state][e]
    if (next) state = next
  }
  const table = Object.entries(transitions)
    .map(([s, t]) => `${s}: ${Object.entries(t).map(([e, d]) => `${e}->${d}`).join(', ')}`)
    .join('\n  ')
  return {
    problem: `A state machine (unlisted events are ignored):\n  ${table}\nStarting in idle, apply: ${seq.join(', ')}.\nWhat is the final state?`,
    answer: state,
  }
}

const KINDS = [paginationProblem, backoffProblem, cacheTtlProblem, eventRateProblem, layoutProblem, stateMachineProblem]

export function generateBuildingAppsProblem(rand = Math.random) {
  return pick(rand, KINDS)(rand)
}

export function generateBuildingAppsBatch(count, rand = Math.random) {
  return Array.from({ length: count }, () => generateBuildingAppsProblem(rand))
}
