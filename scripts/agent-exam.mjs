#!/usr/bin/env node
/**
 * agent-exam.mjs — a score for how well the agent actually operates.
 *
 * scripts/capability-exam.mjs already measures what it KNOWS: freshly
 * generated physics, chemistry and arithmetic it has to compute. This measures
 * something different and, for an agent, more important: whether it can find
 * the right tool, notice its own code is wrong and fix it, and carry a skill
 * from published to installed to usable.
 *
 * Those were all claims in commit messages until now. A claim is not a
 * measurement, and "the agent got smarter" is exactly the kind of statement
 * that should have a number attached or not be made.
 *
 * Each section scores independently so a regression names itself rather than
 * showing up as one number quietly drifting down. Nothing here calls out to a
 * network: the routing cases are labelled by hand, the code cases have known
 * answers, and the store round trip runs against a temporary directory.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const load = (rel) => import(path.join(ROOT, 'dist', rel))

/**
 * Messages and the plugin that should handle each. Written as a person would
 * type them, not as the plugin's own command syntax -- routing a plugin's
 * literal command to itself proves nothing, and the whole point is the
 * phrasings nobody thought to declare.
 */
const ROUTING_CASES = [
  ['put this in the shared catalogue so other people can get it', 'store'],
  ['what have I got installed from the catalogue', 'store'],
  ['stop the agent touching my desktop', 'computer-access'],
  ['what permissions does it currently have', 'computer-access'],
  ['write a page about neural meshes in the wiki', 'wiki'],
  ['run a shell command for me', 'terminal'],
  ['take a photo', 'camera'],
  ['what is on my calendar tomorrow', 'calendar'],
  ['send an email to my brother', 'email'],
  ['look up a phone number in my contacts', 'contacts'],
  ['read a file off the disk', 'file-system'],
  ['find out about a topic for me', 'research'],
  ['control the robot arm', 'robotics'],
  ['record some audio', 'microphone'],
  ['where am I right now', 'location'],
  ['this code has a bug in it', 'coding'],
]

async function scoreRouting() {
  const { getNeuroclawSystem } = await load('src/index.js')
  const reg = (await getNeuroclawSystem()).pluginRegistry
  let top1 = 0
  let top3 = 0
  const missed = []
  for (const [message, expected] of ROUTING_CASES) {
    const ranked = reg.rankPlugins(message, '')
    if (ranked[0]?.id === expected) top1++
    else if (ranked.slice(0, 3).some(r => r.id === expected)) top3++
    else missed.push(`${expected}: "${message}" -> ${ranked[0]?.id ?? 'nothing'}`)
  }
  return {
    name: 'routing',
    score: top1,
    outOf: ROUTING_CASES.length,
    detail: `top-1 ${top1}/${ROUTING_CASES.length}, within top-3 ${top1 + top3}/${ROUTING_CASES.length}`,
    missed,
  }
}

/**
 * Can it fix code from the real failure, and does it know when to stop?
 *
 * The reviser here is scripted, because this measures the LOOP -- the checking,
 * the failure reporting and the stopping conditions -- not the intelligence
 * proposing a change. Measuring the loop honestly is worth more than a number
 * that quietly credits a reviser for the harness's work.
 */
async function scoreCodeLoop() {
  const { iterateOnCode, verifyCode } = await load('models && skills/core/code-iteration.js')
  const checks = [
    { name: 'adds', expression: 'add(2, 3)', expected: 5 },
    { name: 'zero', expression: 'add(0, 0)', expected: 0 },
  ]
  let passed = 0
  const outOf = 4

  // 1. Converges when a fix exists.
  const fixed = await iterateOnCode({
    initial: 'function add(a, b) { return a - b }',
    checks,
    revise: () => 'function add(a, b) { return a + b }',
  })
  if (fixed.passed) passed++

  // 2. The failure it reports is specific enough to act on.
  const report = verifyCode('function add(a, b) { return a + b + 1 }', checks).report
  if (/expected 5/.test(report) && /got 6/.test(report)) passed++

  // 3. Stops instead of spinning when the reviser repeats itself.
  const spinning = await iterateOnCode({
    initial: 'function add(a, b) { return a - b }',
    checks,
    revise: () => 'function add(a, b) { return a - b }',
    maxAttempts: 20,
  })
  if (spinning.stopped === 'repeating' && spinning.attempts.length < 4) passed++

  // 4. Refuses to take a candidate's word for it: zero checks is not a pass.
  if (verifyCode('const x = 1', []).passed === false) passed++

  return { name: 'code-loop', score: passed, outOf, detail: `${passed}/${outOf}`, missed: [] }
}

/** Published -> installed -> activated -> usable, the chain end to end. */
async function scoreStoreLoop() {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-exam-'))
  const saved = { ...process.env }
  process.env.NEUROCLAW_STORE_DIR = path.join(root, 'store')
  process.env.CORONA_INSTALLED_DIR = path.join(root, 'installed')
  process.env.NEUROCLAW_STORE_NO_SYNC = '1'
  try {
    const store = await load('models && skills/core/store.js')
    const install = await load('models && skills/core/store-install.js')
    let passed = 0
    const outOf = 4

    // A prompting skill in the format the project's example arrived in.
    store.publishItem({
      kind: 'skills', name: 'exam-skill', title: 'Exam Skill',
      files: [{
        filename: 'SKILL.md',
        content: '---\nname: exam-skill\ndescription: Answer questions about the exam. Use when asked about examinations.\n---\n\n# Exam Skill\n\nAnswer carefully.\n',
      }],
    })
    if (store.readItem('skills', 'exam-skill')) passed++

    const installed = await install.installItem('skills', 'exam-skill')
    if (installed.record.files.length === 1) passed++

    const plan = install.planActivation('skills', 'exam-skill')
    if (plan.memories.length === 1 && plan.memories[0].payload.includes('Answer carefully')) passed++

    // Publishing alone must never activate: the deliberate-choice rule.
    store.publishItem({
      kind: 'skills', name: 'not-installed', title: 'X',
      files: [{ filename: 'SKILL.md', content: '---\nname: x\ndescription: d\n---\n\nbody' }],
    })
    if (install.planActivation('skills', 'not-installed').nothingLoadable) passed++

    return { name: 'store-loop', score: passed, outOf, detail: `${passed}/${outOf}`, missed: [] }
  } finally {
    for (const k of ['NEUROCLAW_STORE_DIR', 'CORONA_INSTALLED_DIR', 'NEUROCLAW_STORE_NO_SYNC']) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    rmSync(root, { recursive: true, force: true })
  }
}

const sections = [await scoreRouting(), await scoreCodeLoop(), await scoreStoreLoop()]
const score = sections.reduce((n, s) => n + s.score, 0)
const outOf = sections.reduce((n, s) => n + s.outOf, 0)

console.log('\n--- agent exam ---')
for (const s of sections) {
  console.log(`  ${s.name.padEnd(12)} ${s.detail}`)
  for (const m of s.missed) console.log(`      missed  ${m}`)
}
console.log(`\n  TOTAL ${score}/${outOf}  (${((score / outOf) * 100).toFixed(0)}%)`)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ score, outOf, sections }))
}
process.exit(0)
