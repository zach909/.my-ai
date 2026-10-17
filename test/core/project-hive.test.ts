/**
 * The hive: one AI that grows into a collective of equals, where every
 * decision is a vote, good agents are cloned, bad ones deleted, and the last
 * ones standing are merged when the goal is done.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createProject, getProject, claimTask, submitTask, reviewTask, selfWorker, resolveWorker, type ProjectCtx,
} from '../../models && skills/core/projects.js'
import {
  staffHive, growHive, runHive, startHiveRun, mergeHive, getHive, hiveView, isHiveRunning, holdVote, scoreOf,
  parseVerdict, parseYesNo, parseHelp, decide, removalCarries,
  MIN_AGENTS, MIN_COUNCIL, MAX_AGENTS, REVIEWERS, ANY_FOLDER, SOLO_LIMIT, type HiveDeps, type HiveAgentRecord,
} from '../../models && skills/core/project-hive.js'
import type { AgentLearner } from '../../models && skills/core/hive-learning.js'
import type { CoreArrays } from '../../models && skills/core/shared-mesh.js'
import { loadPoints } from '../../models && skills/core/points.js'
import { writeJsonAtomic } from '../../models && skills/core/atomic-write.js'

let dir: string
let pctx: ProjectCtx
let hfile: string
const savedStore = process.env.NEUROCLAW_STORE_DIR

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'corona-hive-'))
  pctx = { file: path.join(dir, 'projects.json'), pointsFile: path.join(dir, 'points.json') }
  hfile = path.join(dir, 'hives.json')
  process.env.NEUROCLAW_STORE_DIR = path.join(dir, 'store')
})
afterEach(() => {
  if (savedStore === undefined) delete process.env.NEUROCLAW_STORE_DIR
  else process.env.NEUROCLAW_STORE_DIR = savedStore
  rmSync(dir, { recursive: true, force: true })
})

/** A learner that remembers what each agent was taught, and gives each agent its own number to merge. */
function fakeLearner() {
  const taught = new Map<string, string[]>()
  const forgotten: string[] = []
  const cloned: Array<[string, string]> = []
  const learner: AgentLearner = {
    async teach(id, text) { taught.set(id, [...(taught.get(id) ?? []), text]); return { ok: true } },
    delta(id) {
      if (forgotten.includes(id) || !taught.has(id)) return null
      return { a: Float32Array.from([Number(id.split('-').pop())]) } as CoreArrays
    },
    forget(id) { forgotten.push(id); taught.delete(id) },
    clone(from, to) { cloned.push([from, to]); if (!taught.has(from)) return false; taught.set(to, [...taught.get(from)!]); return true },
    base: () => ({ baseId: 'b', shape: { neurons: 6, dimensions: 4 } }),
  }
  return { learner, taught, forgotten, cloned }
}

interface Published { projectId: string; merged: CoreArrays }
function deps(over: Partial<HiveDeps> & { think: HiveDeps['think'] }): HiveDeps & { published: Published[] } {
  const published: Published[] = []
  return {
    file: hfile,
    project: pctx,
    publish: args => { published.push({ projectId: args.projectId, merged: args.merged }); return { id: 'abc', relPath: 'extension-builder/shared-mesh/deltas/abc.json', push: 'off', reason: 'local only' } },
    ...over,
    published,
  }
}

const isHelpQ = (p: string) => p.includes('Would it go better with help')
const isReview = (p: string) => p.includes('checking another AI')
const isVote = (p: string) => p.includes('Start your reply with YES or NO')

/** Agents do the work, reviewers accept, everyone votes no, and the Original asks for help. */
const agreeable: HiveDeps['think'] = async (_a, p) => (isHelpQ(p) ? 'HELP' : isReview(p) ? 'ACCEPT: looks right' : isVote(p) ? 'NO' : 'Here is the finished result.')

const balance = (id: string) => loadPoints(pctx.pointsFile).members.find(m => m.id === id)?.points ?? 0
const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0)

function twoFolderProject() {
  return createProject({
    title: 'Weather', goal: 'Build a weather app', pot: 100,
    tasks: [
      { title: 'Fetch forecasts', folder: 'Backend' }, { title: 'Cache them', folder: 'Backend' },
      { title: 'Draw the screen', folder: 'Frontend' }, { title: 'Wire it up', folder: 'Frontend' },
    ],
  }, pctx)
}

describe('reading replies', () => {
  it('a verdict is only what the reply starts by saying', () => {
    expect(parseVerdict('ACCEPT: looks right')).toBe('accept')
    expect(parseVerdict('  "Accepted" because it works')).toBe('accept')
    expect(parseVerdict('**Reject** - missing the cache')).toBe('reject')
    expect(parseVerdict('I would accept this')).toBeNull()
    expect(parseVerdict('¿¿ ???')).toBeNull()
    expect(parseYesNo('YES, remove it')).toBe('yes')
    expect(parseYesNo('keep')).toBe('no')
    expect(parseYesNo('maybe')).toBeNull()
    expect(parseHelp('HELP: it is big')).toBe('help')
    expect(parseHelp('"Alone" is fine')).toBe('alone')
    expect(parseHelp('hmm')).toBeNull()
  })

  it('accepts only when accepts strictly outnumber rejects, and a tie rejects', () => {
    expect(decide(['accept', 'accept'])).toBe('accept')
    expect(decide(['accept', null])).toBe('accept')
    expect(decide(['accept', 'reject'])).toBe('reject')
    expect(decide([null, null])).toBe('undecided')
  })

  it('a motion needs a strict majority of ALL who may vote; a muddled reply counts as no', () => {
    expect(removalCarries(['yes', 'yes'])).toBe(true)
    expect(removalCarries(['yes', 'no'])).toBe(false)
    expect(removalCarries(['yes', null])).toBe(false)
    expect(removalCarries(['yes', 'yes', null])).toBe(true)
  })

  it('an agent\'s score leans to the middle until there is evidence', () => {
    const a = { accepted: 0, rejected: 0 } as HiveAgentRecord
    expect(scoreOf(a)).toBe(0.5)
    expect(scoreOf({ accepted: 3, rejected: 0 } as HiveAgentRecord)).toBe(0.8)
    expect(scoreOf({ accepted: 0, rejected: 3 } as HiveAgentRecord)).toBe(0.2)
  })
})

describe('starting as one AI', () => {
  it('begins with just the Original, holding all the standing', () => {
    const p = twoFolderProject()
    const h = staffHive(p.id, deps({ think: agreeable }))
    expect(h.agents).toHaveLength(1)
    expect(h.agents[0]).toMatchObject({ name: 'Original', parent: null, generation: 0, folder: ANY_FOLDER, value: 100 })
    expect(h.events[0].text).toMatch(/starts as one AI/)
  })

  it('asks for help on a big project: an agent per folder, all variants of the Original, equal to start', async () => {
    const p = twoFolderProject()
    const d = deps({ think: agreeable })
    const h = await growHive(p.id, d)
    expect(h.help).toBe('help')
    expect(h.agents.map(a => [a.name, a.folder])).toEqual([['Original', 'Backend'], ['Frontend agent', 'Frontend'], ['Checker 3', '']])
    expect(h.agents.slice(1).every(a => a.parent === h.agents[0].id && a.generation === 1)).toBe(true)
    expect(h.agents.every(a => a.value === h.agents[0].value)).toBe(true)
    expect(sum(h.agents.map(a => a.value))).toBeCloseTo(100, 4)
    expect(h.events.map(e => e.text).join(' ')).toMatch(/chose to get help/)
    expect(h.events.map(e => e.text).join(' ')).toMatch(/every decision is a vote/)
  })

  it('can choose to start alone, and still adds enough variants to be checked', async () => {
    const p = twoFolderProject()
    const h = await growHive(p.id, deps({ think: async (_a, q) => (isHelpQ(q) ? 'ALONE' : 'x') }))
    expect(h.help).toBe('alone')
    expect(h.agents.map(a => a.folder)).toEqual([ANY_FOLDER, '', ''])
    expect(h.agents).toHaveLength(MIN_COUNCIL)
  })

  it('falls back to a plain rule when the Original gives no clear answer', async () => {
    const small = createProject({ title: 'Small', pot: 10, tasks: [{ title: 'one' }, { title: 'two' }] }, pctx)
    expect(small.tasks.length).toBeLessThanOrEqual(SOLO_LIMIT)
    expect((await growHive(small.id, deps({ think: async () => '¿¿ ???' }))).help).toBe('alone')
    const big = twoFolderProject()
    const h = await growHive(big.id, deps({ think: async () => '¿¿ ???' }))
    expect(h.help).toBe('help')
    expect(h.events.map(e => e.text).join(' ')).toMatch(/no clear answer/)
  })

  it('every variant starts from a copy of what its parent had learned', async () => {
    const p = twoFolderProject()
    const { learner, cloned } = fakeLearner()
    const h = await growHive(p.id, deps({ think: agreeable, learner }))
    expect(cloned.map(([from]) => from)).toEqual([h.agents[0].id, h.agents[0].id])
    expect(cloned.map(([, to]) => to)).toEqual(h.agents.slice(1).map(a => a.id))
  })

  it('a folder with lots of tasks gets sub-AI helpers with no vote of their own', async () => {
    const p = createProject({ title: 'Big', pot: 50, tasks: Array.from({ length: 7 }, (_, i) => ({ title: `job ${i}`, folder: 'Work' })) }, pctx)
    const h = await growHive(p.id, deps({ think: agreeable }))
    expect(h.agents.find(a => a.folder === 'Work')!.helpers).toBe(2)
    expect(h.agents).toHaveLength(MIN_COUNCIL)
  })

  it('growing twice changes nothing', async () => {
    const p = twoFolderProject()
    const d = deps({ think: agreeable })
    const first = await growHive(p.id, d)
    const again = await growHive(p.id, d)
    expect(again.agents.map(a => a.id)).toEqual(first.agents.map(a => a.id))
    expect(again.events).toHaveLength(first.events.length)
  })
})

describe('working a project', () => {
  it('does every task, pays the agents, and merges the last ones standing by value', async () => {
    const p = twoFolderProject()
    const { learner, taught } = fakeLearner()
    const d = deps({ think: agreeable, learner })
    const h = await runHive(p.id, d)

    expect(getProject(p.id, pctx)).toMatchObject({ status: 'complete', paidOut: 100 })
    expect(h.state).toBe('complete')
    expect(h.events.filter(e => e.kind === 'review').length).toBe(4)
    expect(sum(h.agents.map(a => balance(a.id)))).toBeCloseTo(100, 4)
    expect(sum(h.agents.map(a => a.value))).toBeCloseTo(100, 3)
    expect([...taught.keys()].sort()).toEqual([h.agents[0].id, h.agents[1].id].sort())

    expect(d.published).toHaveLength(1)
    const working = h.agents.filter(a => a.accepted > 0)
    const total = sum(working.map(a => a.value))
    const expected = sum(working.map(a => (a.value / total) * Number(a.id.split('-').pop())))
    expect(d.published[0].merged.a[0]).toBeCloseTo(expected, 5)
    expect(h.merge).toMatchObject({ push: 'off', file: 'extension-builder/shared-mesh/deltas/abc.json' })
    expect(sum(h.merge!.agents.map(a => a.share))).toBeCloseTo(1, 5)
  })

  it('every agent has one vote: a tie rejects however much value each reviewer holds', async () => {
    const p = createProject({ title: 'Tie', pot: 10, tasks: [{ title: 'only', folder: 'A' }] }, pctx)
    const d = deps({ think: agreeable })
    const h = await growHive(p.id, d)
    const [author, r1, r2] = h.agents
    const stored = getHive(p.id, hfile)!
    stored.agents.forEach((a, i) => { a.value = [5, 90, 5][i] })
    writeJsonAtomic(hfile, { hives: [stored] })
    const replies: Record<string, string> = { [r1.id]: 'ACCEPT', [r2.id]: 'REJECT' }
    const think: HiveDeps['think'] = async (a, prompt) => (isReview(prompt) ? replies[a.id] : isVote(prompt) ? 'NO' : 'my work')
    const out = await runHive(p.id, { ...d, think, maxRounds: 1 })
    expect(REVIEWERS).toBe(2)
    expect(getProject(p.id, pctx)!.tasks[0].status).toBe('claimed')
    expect(out.agents[0].rejected).toBe(1)
    expect(author.id).toBe(out.agents[0].id)
  })

  it('junk replies are never decided on: the hand-in waits for a person and nobody is paid', async () => {
    const p = twoFolderProject()
    const junk: HiveDeps['think'] = async (_a, prompt) => (isReview(prompt) ? '¿¿ ???' : isVote(prompt) ? 'NO' : 'some work')
    const d = deps({ think: junk })
    const h = await runHive(p.id, d)
    expect(h.state).toBe('stalled')
    expect(h.note).toMatch(/need a person/)
    expect(getProject(p.id, pctx)!.tasks.every(t => t.status === 'submitted')).toBe(true)
    expect(h.agents.every(a => balance(a.id) === 0)).toBe(true)
    expect(d.published).toHaveLength(0)
  })

  it('a rejected hand-in goes back, costs the author value, and is fixed next round', async () => {
    const p = createProject({ title: 'Retry', pot: 100, tasks: [{ title: 'once', folder: 'A' }] }, pctx)
    let attempt = 0
    const think: HiveDeps['think'] = async (_a, prompt) => {
      if (isReview(prompt)) return prompt.includes('second try') ? 'ACCEPT' : 'REJECT: not enough'
      if (isVote(prompt)) return 'NO'
      if (isHelpQ(prompt)) return 'ALONE'
      attempt++
      expect(prompt).toContain(attempt === 1 ? 'Write the finished result' : 'sent back')
      return attempt === 1 ? 'first try' : 'second try'
    }
    const h = await runHive(p.id, deps({ think }))
    expect(getProject(p.id, pctx)!.status).toBe('complete')
    expect(h.agents[0]).toMatchObject({ rejected: 1, accepted: 1 })
  })

  it('a person\'s hand-in is never judged by the AIs, so a vote of AIs cannot pay a human', async () => {
    const p = createProject({ title: 'Mixed', pot: 100, tasks: [{ title: 'human job', folder: 'H' }, { title: 'agent job', folder: 'A' }] }, pctx)
    const me = selfWorker(pctx.pointsFile)
    claimTask(p.id, 't1', me, pctx)
    submitTask(p.id, 't1', me, 'my work', pctx)
    const h = await runHive(p.id, deps({ think: agreeable }))
    expect(getProject(p.id, pctx)!.tasks[0]).toMatchObject({ status: 'submitted', assignee: { id: 'me' } })
    expect(getProject(p.id, pctx)!.tasks[1].status).toBe('done')
    expect(h.state).toBe('stalled')
    expect(balance('me')).toBe(0)
    reviewTask(p.id, 't1', resolveWorker(h.agents[0].id, pctx), 'accept', 'looks fine', pctx)
    expect(getProject(p.id, pctx)!.status).toBe('complete')
  })

  it('an agent that cannot answer puts the task back, and one that throws is not a crash', async () => {
    const p = createProject({ title: 'Silent', pot: 10, tasks: [{ title: 'x', folder: 'A' }] }, pctx)
    const h = await runHive(p.id, deps({ think: async () => '' }))
    expect(getProject(p.id, pctx)!.tasks[0]).toMatchObject({ status: 'open', assignee: null })
    expect(h.state).toBe('stalled')
    const q = createProject({ title: 'Throws', pot: 10, tasks: [{ title: 'x', folder: 'A' }] }, pctx)
    expect((await runHive(q.id, deps({ think: async () => { throw new Error('mesh down') } }))).state).toBe('stalled')
  })

  it('finishes with no brain to learn on, and says there was nothing to merge', async () => {
    const p = twoFolderProject()
    const d = deps({ think: agreeable })
    const h = await runHive(p.id, d)
    expect(h.state).toBe('complete')
    expect(h.merge).toBeNull()
    expect(h.note).toMatch(/nothing to merge/)
  })

  it('only merges a finished project, and only once', async () => {
    const p = twoFolderProject()
    const { learner } = fakeLearner()
    const d = deps({ think: agreeable, learner })
    staffHive(p.id, d)
    expect(() => mergeHive(p.id, d)).toThrow(/once every task is done/)
    await runHive(p.id, d)
    expect(d.published).toHaveLength(1)
    mergeHive(p.id, d)
    expect(d.published).toHaveLength(1)
  })

  it('refuses a second run of the same hive at once, and reports "running" while it works', async () => {
    const p = twoFolderProject()
    let open!: () => void
    const gate = new Promise<void>(r => { open = r })
    const d = deps({ think: async (a, prompt) => { await gate; return agreeable(a, prompt) } })
    startHiveRun(p.id, d)
    expect(isHiveRunning(p.id, hfile)).toBe(true)
    expect(hiveView(p.id, hfile)!.state).toBe('running')
    await expect(runHive(p.id, d)).rejects.toThrow(/already working/)
    expect(() => startHiveRun(p.id, d)).toThrow(/already working/)
    open()
    for (let i = 0; i < 300 && isHiveRunning(p.id, hfile); i++) await new Promise(r => setTimeout(r, 10))
    expect(getHive(p.id, hfile)!.state).toBe('complete')
  })
})

describe('votes', () => {
  it('carry only with a strict majority of everyone allowed to vote, one vote each', async () => {
    const p = twoFolderProject()
    const h = await growHive(p.id, deps({ think: agreeable }))
    const say = (yesFor: string[]): HiveDeps['think'] => async (a) => (yesFor.includes(a.id) ? 'YES' : 'NO')
    const ids = h.agents.map(a => a.id)
    expect(await holdVote(h, deps({ think: say(ids.slice(0, 2)) }), 'Do it?', null, 1)).toMatchObject({ carried: true, yes: 2, no: 1, voters: 3 })
    expect(await holdVote(h, deps({ think: say(ids.slice(0, 1)) }), 'Do it?', null, 1)).toMatchObject({ carried: false, yes: 1, voters: 3 })
  })

  it('the one a vote is about does not vote on it, and retired or deleted agents have no vote', async () => {
    const p = twoFolderProject()
    const h = await growHive(p.id, deps({ think: agreeable }))
    const asked: string[] = []
    const think: HiveDeps['think'] = async a => { asked.push(a.id); return 'YES' }
    const r = await holdVote(h, deps({ think }), 'Remove?', h.agents[0].id, 1)
    expect(r.voters).toBe(2)
    expect(asked).not.toContain(h.agents[0].id)
    h.agents[1].retiredAt = 5
    asked.length = 0
    expect((await holdVote(h, deps({ think }), 'Anything?', null, 1)).voters).toBe(2)
    expect(asked).not.toContain(h.agents[1].id)
  })
})

describe('cloning the good, deleting the bad', () => {
  it('clones a proven agent by vote when there is more work than hands, and the copy starts from what it learned', async () => {
    const p = createProject({ title: 'Many', pot: 100, tasks: Array.from({ length: 9 }, (_, i) => ({ title: `job ${i}`, folder: 'Work' })) }, pctx)
    const { learner, cloned } = fakeLearner()
    const think: HiveDeps['think'] = async (a, q) => (isHelpQ(q) ? 'HELP' : isReview(q) ? 'ACCEPT' : isVote(q) ? 'YES' : 'done')
    const d = deps({ think, learner })
    const h = await runHive(p.id, d)

    const copy = h.agents.find(a => a.name.includes('clone'))!
    expect(copy).toBeDefined()
    expect(copy).toMatchObject({ parent: h.agents[0].id, generation: 1, folder: 'Work' })
    expect(h.agents[0].clones).toBeGreaterThanOrEqual(1)
    expect(cloned.some(([from, to]) => from === h.agents[0].id && to === copy.id)).toBe(true)
    expect(h.events.some(e => e.kind === 'clone')).toBe(true)
    expect(h.agents.filter(a => a.removedAt === null).length).toBeLessThanOrEqual(MAX_AGENTS)
    expect(getProject(p.id, pctx)!.status).toBe('complete')
    // The copy shares its parent's standing instead of printing new standing: the total is still fixed.
    expect(sum(h.agents.filter(a => a.removedAt === null && a.retiredAt === null).map(a => a.value))).toBeCloseTo(100, 2)
  })

  it('does not clone when the others vote no', async () => {
    const p = createProject({ title: 'Many', pot: 100, tasks: Array.from({ length: 9 }, (_, i) => ({ title: `job ${i}`, folder: 'Work' })) }, pctx)
    const think: HiveDeps['think'] = async (a, q) => (isHelpQ(q) ? 'HELP' : isReview(q) ? 'ACCEPT' : isVote(q) ? 'NO' : 'done')
    const h = await runHive(p.id, deps({ think }))
    expect(h.agents.some(a => a.name.includes('clone'))).toBe(false)
  })

  it('adds a new variant of the Original by vote when there is far more work than hands and nobody is proven', async () => {
    const p = createProject({ title: 'Flood', pot: 100, tasks: Array.from({ length: 16 }, (_, i) => ({ title: `job ${i}`, folder: 'Work' })) }, pctx)
    const think: HiveDeps['think'] = async (_a, q) => (isHelpQ(q) ? 'HELP' : isReview(q) ? '¿¿ ???' : isVote(q) ? 'YES' : 'done')
    const h = await runHive(p.id, deps({ think, maxRounds: 1 }))
    const fresh = h.agents.find(a => a.name.startsWith('Variant'))!
    expect(fresh).toMatchObject({ parent: h.agents[0].id, folder: ANY_FOLDER })
    expect(h.events.some(e => e.kind === 'add' && /joined by vote/.test(e.text))).toBe(true)
  })

  it('never grows past the maximum', async () => {
    const p = createProject({ title: 'Huge', pot: 100, tasks: Array.from({ length: 60 }, (_, i) => ({ title: `job ${i}`, folder: `F${i % 8}` })) }, pctx)
    const think: HiveDeps['think'] = async (_a, q) => (isHelpQ(q) ? 'HELP' : isReview(q) ? 'ACCEPT' : isVote(q) ? 'YES' : 'done')
    const h = await runHive(p.id, deps({ think, maxRounds: 6 }))
    expect(h.agents.filter(a => a.removedAt === null && a.retiredAt === null).length).toBeLessThanOrEqual(MAX_AGENTS)
  })

  /** One of the B agent's hand-ins is always bad; everyone votes yes to removing it. */
  const badB: HiveDeps['think'] = async (a, q) => {
    if (isHelpQ(q)) return 'HELP'
    if (isReview(q)) return q.includes('BAD WORK') ? 'REJECT: wrong' : 'ACCEPT'
    if (isVote(q)) return 'YES'
    return a.name === 'B agent' ? 'BAD WORK' : 'fine work'
  }
  const fourTasks = () => createProject({ title: 'Bad apple', pot: 100, tasks: [{ title: 'a1', folder: 'A' }, { title: 'a2', folder: 'A' }, { title: 'b1', folder: 'B' }, { title: 'b2', folder: 'B' }] }, pctx)

  it('deletes an agent whose work keeps failing, the others pick up its folder, and its learning is thrown away', async () => {
    const p = fourTasks()
    const { learner, forgotten } = fakeLearner()
    const h = await runHive(p.id, deps({ think: badB, learner }))
    const bad = h.agents.find(a => a.name === 'B agent')!
    expect(bad.removedAt).not.toBeNull()
    expect(bad.removedReason).toMatch(/voted out/)
    expect(forgotten).toContain(bad.id)
    expect(getProject(p.id, pctx)!.status).toBe('complete')
    // Only the survivor that learned is in the merge.
    expect(h.merge!.agents.map(a => a.id)).toEqual([h.agents[0].id])
  })

  it('a deleted agent\'s learning is not in the merge', async () => {
    const p = fourTasks()
    const { learner } = fakeLearner()
    const d = deps({ think: badB, learner })
    const h = await runHive(p.id, d)
    const bad = h.agents.find(a => a.name === 'B agent')!
    expect(bad.removedAt).not.toBeNull()
    if (h.merge) expect(h.merge.agents.map(a => a.id)).not.toContain(bad.id)
    expect(sum(h.agents.filter(a => a.removedAt === null).map(a => a.value))).toBeCloseTo(100, 3)
  })

  it('does not delete anyone when the others do not agree', async () => {
    const p = fourTasks()
    const merciful: HiveDeps['think'] = async (a, q) => (isVote(q) ? 'NO' : badB(a, q))
    const h = await runHive(p.id, deps({ think: merciful, maxRounds: 4 }))
    expect(h.agents.every(a => a.removedAt === null)).toBe(true)
  })

  it('never takes the team below the minimum, even when everyone wants everyone gone', async () => {
    const p = fourTasks()
    const allBad: HiveDeps['think'] = async (a, q) => {
      if (isHelpQ(q)) return 'HELP'
      if (isReview(q)) return q.includes('BAD WORK') ? 'REJECT' : 'ACCEPT'
      if (isVote(q)) return 'YES'
      return a.folder ? 'BAD WORK' : 'fine'
    }
    const h = await runHive(p.id, deps({ think: allBad, maxRounds: 6 }))
    expect(h.agents.filter(a => a.removedAt === null && a.retiredAt === null).length).toBeGreaterThanOrEqual(MIN_AGENTS)
  })

  it('retires an agent by vote when there is less work than agents, and keeps what it learned', async () => {
    const p = createProject({
      title: 'Wind down', pot: 100,
      tasks: [{ title: 'a1', folder: 'A' }, { title: 'a2', folder: 'A' }, { title: 'b1', folder: 'B' }, { title: 'c1', folder: 'C' }, { title: 'd1', folder: 'D' }],
    }, pctx)
    const { learner, forgotten } = fakeLearner()
    const think: HiveDeps['think'] = async (a, q) => {
      if (isHelpQ(q)) return 'HELP'
      if (isReview(q)) return q.includes('BAD') ? 'REJECT: no' : 'ACCEPT'
      if (isVote(q)) return 'YES'
      return q.includes('Task: a2') && !q.includes('sent back') ? 'BAD' : 'good'
    }
    const d = deps({ think, learner })
    const h = await runHive(p.id, d)
    const retired = h.agents.find(a => a.retiredAt !== null)!
    expect(retired).toBeDefined()
    expect(retired.parent).not.toBeNull()
    expect(forgotten).not.toContain(retired.id) // stepping down is not being deleted
    expect(h.events.some(e => e.kind === 'retire' && /learned is kept/.test(e.text))).toBe(true)
    expect(getProject(p.id, pctx)!.status).toBe('complete')
    // It voted on nothing after leaving, but its learning is in the merge.
    expect(h.merge!.agents.map(a => a.id)).toContain(retired.id)
  })
})
