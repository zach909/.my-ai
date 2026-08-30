/**
 * coding.mjs — drill generator for "coding".
 *
 * Every problem is a small program whose answer this file computes by
 * RUNNING the same logic the problem describes, rather than by asserting a
 * closed form. That distinction matters: a generator that states the answer
 * from a formula it also used to write the question can be wrong in both
 * places at once and never notice. Here the loop in the answer is the loop in
 * the question.
 *
 * Pure and deterministic given a rand() source, so it is directly unit
 * testable without a running server, and no external API is ever called --
 * the same constraint every other generator here operates under.
 */

const pick = (rand, xs) => xs[Math.floor(rand() * xs.length)]
const int = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))

/** What a counting loop accumulates. Computed by running it. */
function loopProblem(rand) {
  const n = int(rand, 3, 12)
  const k = int(rand, 2, 6)
  const kind = pick(rand, ['sum', 'product', 'evens', 'squares'])
  let total
  if (kind === 'sum') {
    total = 0
    for (let i = 1; i <= n; i++) total += i * k
    return { problem: `total = 0\nfor i in 1..${n}: total += i * ${k}\nWhat is total?`, answer: String(total) }
  }
  if (kind === 'product') {
    total = 1
    for (let i = 1; i <= n; i++) total *= 2
    return { problem: `total = 1\nfor i in 1..${n}: total *= 2\nWhat is total?`, answer: String(total) }
  }
  if (kind === 'evens') {
    total = 0
    for (let i = 1; i <= n * k; i++) if (i % 2 === 0) total += 1
    return { problem: `count = 0\nfor i in 1..${n * k}: if i is even, count += 1\nWhat is count?`, answer: String(total) }
  }
  total = 0
  for (let i = 1; i <= n; i++) total += i * i
  return { problem: `total = 0\nfor i in 1..${n}: total += i * i\nWhat is total?`, answer: String(total) }
}

/** Recursion, run rather than solved. */
function recursionProblem(rand) {
  const kind = pick(rand, ['fib', 'fact', 'gcd'])
  if (kind === 'fib') {
    const n = int(rand, 5, 15)
    let a = 0, b = 1
    for (let i = 0; i < n; i++) { const t = a + b; a = b; b = t }
    return { problem: `fib(0)=0, fib(1)=1, fib(n)=fib(n-1)+fib(n-2). What is fib(${n})?`, answer: String(a) }
  }
  if (kind === 'fact') {
    const n = int(rand, 3, 9)
    let f = 1
    for (let i = 2; i <= n; i++) f *= i
    return { problem: `fact(0)=1, fact(n)=n*fact(n-1). What is fact(${n})?`, answer: String(f) }
  }
  let a = int(rand, 12, 200), b = int(rand, 6, 120)
  const [x, y] = [a, b]
  while (b !== 0) { const t = b; b = a % b; a = t }
  return { problem: `gcd(a,0)=a, gcd(a,b)=gcd(b, a mod b). What is gcd(${x}, ${y})?`, answer: String(a) }
}

/** Array pipelines -- the answer is the pipeline, actually run. */
function arrayProblem(rand) {
  const len = int(rand, 4, 8)
  const xs = Array.from({ length: len }, () => int(rand, 1, 20))
  const kind = pick(rand, ['filterSum', 'maxMinusMin', 'countAbove', 'sortedMiddle'])
  if (kind === 'filterSum') {
    const t = int(rand, 5, 12)
    const answer = xs.filter(v => v > t).reduce((s, v) => s + v, 0)
    return { problem: `xs = [${xs.join(', ')}]\nSum of the elements strictly greater than ${t}?`, answer: String(answer) }
  }
  if (kind === 'maxMinusMin') {
    return { problem: `xs = [${xs.join(', ')}]\nWhat is max(xs) - min(xs)?`, answer: String(Math.max(...xs) - Math.min(...xs)) }
  }
  if (kind === 'countAbove') {
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length
    return { problem: `xs = [${xs.join(', ')}]\nHow many elements are strictly above the mean?`, answer: String(xs.filter(v => v > mean).length) }
  }
  const sorted = [...xs].sort((a, b) => a - b)
  return { problem: `xs = [${xs.join(', ')}]\nAfter sorting ascending, what is the element at index ${Math.floor(len / 2)} (0-based)?`, answer: String(sorted[Math.floor(len / 2)]) }
}

/** How many times the inner statement runs. Counted, not reasoned about. */
function complexityProblem(rand) {
  const n = int(rand, 3, 9)
  const kind = pick(rand, ['nested', 'triangular', 'halving'])
  let count = 0
  if (kind === 'nested') {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) count++
    return { problem: `for i in 0..${n - 1}:\n  for j in 0..${n - 1}:\n    step()\nHow many times does step() run?`, answer: String(count) }
  }
  if (kind === 'triangular') {
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) count++
    return { problem: `for i in 0..${n - 1}:\n  for j in i..${n - 1}:\n    step()\nHow many times does step() run?`, answer: String(count) }
  }
  let v = 2 ** n
  while (v > 1) { v = Math.floor(v / 2); count++ }
  return { problem: `v = ${2 ** n}\nwhile v > 1: v = floor(v / 2); step()\nHow many times does step() run?`, answer: String(count) }
}

/** String work, run. */
function stringProblem(rand) {
  const words = ['neuron', 'lattice', 'compiler', 'kernel', 'buffer', 'wavefront', 'gradient', 'register']
  const w = pick(rand, words)
  const kind = pick(rand, ['reverse', 'vowels', 'upperCount', 'replace'])
  if (kind === 'reverse') return { problem: `Reverse the string "${w}".`, answer: [...w].reverse().join('') }
  if (kind === 'vowels') return { problem: `How many vowels (aeiou) are in "${w}"?`, answer: String([...w].filter(c => 'aeiou'.includes(c)).length) }
  if (kind === 'upperCount') {
    const n = int(rand, 1, w.length)
    return { problem: `Take the first ${n} characters of "${w}" and uppercase them. What is the result?`, answer: w.slice(0, n).toUpperCase() }
  }
  const from = w[int(rand, 0, w.length - 1)]
  return { problem: `In "${w}", replace every "${from}" with "*". What is the result?`, answer: w.split(from).join('*') }
}

const KINDS = [loopProblem, recursionProblem, arrayProblem, complexityProblem, stringProblem]

export function generateCodingProblem(rand = Math.random) {
  return pick(rand, KINDS)(rand)
}

export function generateCodingBatch(count, rand = Math.random) {
  return Array.from({ length: count }, () => generateCodingProblem(rand))
}
