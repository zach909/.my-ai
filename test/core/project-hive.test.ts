/**
 * The hive that works a project: equal votes, agents checking each other,
 * removal by the others, and a weighted merge when the project is done.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createProject, getProject, claimTask, submitTask, reviewTask, selfWorker, resolveWorker, type ProjectCtx,
} from '../../models && skills/core/projects.js'
import {
  staffHive, runHive, startHiveRun, mergeHive, getHive, hiveView, isHiveRunning, parseVerdict, parseYesNo, decide, removalCarries,
  MIN_AGENTS, MIN_COUNCIL, REVIEWERS, type HiveDeps, type HiveAgentRecord,
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
  const learner: AgentLearner = {
    async teach(id, text) { taught.set(id, [...(taught.get(id) ?? []), text]); return { ok: true } },
    delta(id) {
      if (forgotten.includes(id) || !taught.has(id)) return null
      const n = Number(id.split('-').pop())
      return { a: Float32Array.from([n]) } as CoreArrays
    },
    forget(id) { forgotten.push(id); taught.delete(id) },
    base: () => ({ baseId: 'b', shape: { neurons: 6, dimensions: 4 } }),
  }
  return { learner, taught, forgotten }
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

/** Agents do the work; reviewers accept. */
const agreeable: HiveDeps['think'] = async (_a, prompt) => (prompt.includes('checking another AI') ? 'ACCEPT: looks right' : prompt.includes('removed from the team') ? 'NO' : 'Here is the finished result.')

const balance = (id: string) => loadPoints(pctx.pointsFile).members.find(m => m.id === id)?.points ?? 0

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
    expect(parseVerdict('I would accept this')).toBeNull() // says it later, not first: not a vote
    expect(parseVerdict('')).toBeNull()
    expect(parseVerdict('¿¿ ???')).toBeNull()
    expect(parseYesNo('YES, remove it')).toBe('yes')
    expect(parseYesNo('keep')).toBe('no')
    expect(parseYesNo('maybe')).toBeNull()
  })

  it('accepts only when accepts strictly outnumber rejects, and a tie rejects', () => {
    expect(decide(['accept', 'accept'])).toBe('accept')
    expect(decide(['accept', null])).toBe('accept')
    expect(decide(['accept', 'reject'])).toBe('reject')
    expect(decide(['reject', null])).toBe('reject')
    expect(decide([null, null])).toBe('undecided')
    expect(decide([])).toBe('undecided')
  })

  it('a removal needs a strict majority of ALL the other agents; a muddled reply counts as keep', () => {
    expect(removalCarries(['yes', 'yes'])).toBe(true)
    expect(removalCarries(['yes', 'no'])).toBe(false)
    expect(removalCarries(['yes', null])).toBe(false)
    expect(removalCarries(['yes', 'yes', null])).toBe(true)
    expect(removalCarries(['yes', null, null])).toBe(false)
  })
})

describe('staffing', () => {
  it('makes one agent per folder, then checkers up to the minimum, all with equal value', () => {
    const p = twoFolderProject()
    const h = staffHive(p.id, deps({ think: agreeable }))
    expect(h.agents.map(a => a.name)).toEqual(['Backend agent', 'Frontend agent', 'Checker 3'])
    expect(h.agents.length).toBeGreaterThanOrEqual(MIN_COUNCIL)
    expect(h.agents.every(a => a.value === h.agents[0].value)).toBe(true)
    expect(h.agents.reduce((n, a) => n + a.value, 0)).toBeCloseTo(100, 4)
  })

  it('a single-folder project still gets enough agents to check each other', () => {
    const p = createProject({ title: 'Small', pot: 10, tasks: [{ title: 'only' }] }, pctx)
    expect(staffHive(p.id, deps({ think: agreeable })).agents).toHaveLength(MIN_COUNCIL)
  })

  it('staffing twice changes nothing', () => {
    const p = twoFolderProject()
    const d = deps({ think: agreeable })
    const first = staffHive(p.id, d)
    const again = staffHive(p.id, d)
    expect(again.agents.map(a => a.id)).toEqual(first.agents.map(a => a.id))
    expect(again.events).toHaveLength(first.events.length)
  })

  it('a folder with lots of tasks gets sub-AI helpers, with no vote of their own', () => {
    const p = createProject({ title: 'Big', pot: 50, tasks: Array.from({ length: 7 }, (_, i) => ({ title: `job ${i}`, folder: 'Work' })) }, pctx)
    const h = staffHive(p.id, deps({ think: agreeable }))
    expect(h.agents.find(a => a.folder === 'Work')!.helpers).toBe(2)
    expect(h.agents).toHaveLength(MIN_COUNCIL) // helpers are not council members
  })
})

describe('working a project', () => {
  it('does every task, pays the agents, and merges by value when it is done', async () => {
    const p = twoFolderProject()
    const { learner, taught } = fakeLearner()
    const d = deps({ think: agreeable, learner })
    const h = await runHive(p.id, d)

    expect(getProject(p.id, pctx)).toMatchObject({ status: 'complete', paidOut: 100 })
    expect(h.state).toBe('complete')
    // Each task was checked by the other agents, never by its own author.
    expect(h.events.filter(e => e.kind === 'review').length).toBe(4)
    expect(h.agents.every(a => a.reviewed > 0)).toBe(true)
    // The agents earned the whole pot between them.
    const earned = h.agents.reduce((n, a) => n + balance(a.id), 0)
    expect(earned).toBeCloseTo(100, 4)
    // Values moved but stayed a fixed total.
    expect(h.agents.reduce((n, a) => n + a.value, 0)).toBeCloseTo(100, 3)
    expect(h.agents[0].value).toBeGreaterThan(h.agents[2].value) // the checker did no accepted work
    // Everyone who did work learned from it.
    expect([...taught.keys()].sort()).toEqual([h.agents[0].id, h.agents[1].id].sort())

    // One merged contributor, an average weighted by value.
    expect(d.published).toHaveLength(1)
    const working = h.agents.filter(a => a.accepted > 0)
    const total = working.reduce((n, a) => n + a.value, 0)
    const expected = working.reduce((n, a) => n + (a.value / total) * Number(a.id.split('-').pop()), 0)
    expect(d.published[0].merged.a[0]).toBeCloseTo(expected, 5)
    expect(h.merge).toMatchObject({ push: 'off', file: 'extension-builder/shared-mesh/deltas/abc.json' })
    expect(h.merge!.agents.reduce((n, a) => n + a.share, 0)).toBeCloseTo(1, 5)
  })

  it('every agent has one vote: a tie rejects however much value each reviewer holds', async () => {
    const p = createProject({ title: 'Tie', pot: 10, tasks: [{ title: 'only', folder: 'A' }] }, pctx)
    const d = deps({ think: agreeable })
    const h = staffHive(p.id, d)
    // Give the two prospective reviewers wildly different standing.
    const [author, r1, r2] = h.agents
    const replies: Record<string, string> = {}
    replies[r1.id] = 'ACCEPT'
    replies[r2.id] = 'REJECT'
    const think: HiveDeps['think'] = async (a, prompt) => (prompt.includes('checking another AI') ? replies[a.id] : 'my work')
    // The record on disk is what the run reads, so write the doctored values back first.
    const stored = getHive(p.id, hfile)!
    stored.agents.forEach((a, i) => { a.value = [5, 90, 5][i] })
    writeJsonAtomic(hfile, { hives: [stored] })
    const out = await runHive(p.id, { ...d, think, maxRounds: 1 })
    expect(REVIEWERS).toBe(2)
    expect(getProject(p.id, pctx)!.tasks[0].status).toBe('claimed') // sent back, not accepted
    expect(out.agents[0].rejected).toBe(1)
  })

  it('junk replies are never decided on: the hand-in waits for a person and nobody is paid', async () => {
    const p = twoFolderProject()
    const junk: HiveDeps['think'] = async (_a, prompt) => (prompt.includes('checking another AI') ? '¿¿ ???' : 'some work')
    const d = deps({ think: junk })
    const h = await runHive(p.id, d)
    expect(h.state).toBe('stalled')
    expect(h.note).toMatch(/need a person/)
    expect(getProject(p.id, pctx)!.tasks.every(t => t.status === 'submitted')).toBe(true)
    expect(h.agents.every(a => balance(a.id) === 0)).toBe(true)
    expect(d.published).toHaveLength(0)
    expect(h.merge).toBeNull()
  })

  it('a rejected hand-in goes back, costs the author value, and is fixed next round', async () => {
    const p = createProject({ title: 'Retry', pot: 100, tasks: [{ title: 'once', folder: 'A' }] }, pctx)
    let attempt = 0
    const think: HiveDeps['think'] = async (a, prompt) => {
      if (prompt.includes('checking another AI')) return prompt.includes('second try') ? 'ACCEPT' : 'REJECT: not enough'
      if (prompt.includes('removed from the team')) return 'NO'
      attempt++
      expect(prompt).toContain(attempt === 1 ? 'Write the finished result' : 'sent back')
      return attempt === 1 ? 'first try' : 'second try'
    }
    const h = await runHive(p.id, deps({ think }))
    expect(getProject(p.id, pctx)!.status).toBe('complete')
    const author = h.agents.find(a => a.folder === 'A')!
    expect(author).toMatchObject({ rejected: 1, accepted: 1 })
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
    // A person (or another party) can still finish it, and then the project completes.
    reviewTask(p.id, 't1', resolveWorker(h.agents[0].id, pctx), 'accept', 'looks fine', pctx)
    expect(getProject(p.id, pctx)!.status).toBe('complete')
  })

  it('an agent that cannot answer puts the task back instead of handing in nothing', async () => {
    const p = createProject({ title: 'Silent', pot: 10, tasks: [{ title: 'x', folder: 'A' }] }, pctx)
    const h = await runHive(p.id, deps({ think: async () => '' }))
    expect(getProject(p.id, pctx)!.tasks[0]).toMatchObject({ status: 'open', assignee: null })
    expect(h.state).toBe('stalled')
  })

  it('an agent that throws is treated as having no answer, not as a crash', async () => {
    const p = createProject({ title: 'Throws', pot: 10, tasks: [{ title: 'x', folder: 'A' }] }, pctx)
    const h = await runHive(p.id, deps({ think: async () => { throw new Error('mesh down') } }))
    expect(h.state).toBe('stalled')
  })

  it('works with no brain to learn on: it still finishes, and says there was nothing to merge', async () => {
    const p = twoFolderProject()
    const d = deps({ think: agreeable })
    const h = await runHive(p.id, d)
    expect(h.state).toBe('complete')
    expect(h.merge).toBeNull()
    expect(h.note).toMatch(/nothing to merge/)
    expect(d.published).toHaveLength(0)
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
    expect(d.published).toHaveLength(1) // not published a second time
  })

  it('refuses a second run of the same hive at once, and reports "running" while it works', async () => {
    const p = twoFolderProject()
    let open!: () => void
    const gate = new Promise<void>(r => { open = r })
    const slow: HiveDeps['think'] = async (a, prompt) => { await gate; return agreeable(a, prompt) }
    const d = deps({ think: slow })
    startHiveRun(p.id, d)
    expect(isHiveRunning(p.id)).toBe(true)
    expect(hiveView(p.id, hfile)!.state).toBe('running')
    await expect(runHive(p.id, d)).rejects.toThrow(/already working/)
    expect(() => startHiveRun(p.id, d)).toThrow(/already working/)
    open()
    for (let i = 0; i < 200 && isHiveRunning(p.id); i++) await new Promise(r => setTimeout(r, 10))
    expect(isHiveRunning(p.id)).toBe(false)
    expect(getHive(p.id, hfile)!.state).toBe('complete')
  })
})

describe('removing an agent', () => {
  /** Agent A's work is always bad; everyone agrees to remove it. */
  const badAgent: HiveDeps['think'] = async (a, prompt) => {
    if (prompt.includes('checking another AI')) return prompt.includes('BAD WORK') ? 'REJECT: wrong' : 'ACCEPT'
    if (prompt.includes('removed from the team')) return 'YES'
    return a.name === 'A agent' ? 'BAD WORK' : 'fine work'
  }

  it('the other agents vote out one whose work keeps failing, it is replaced, and its learning is thrown away', async () => {
    const p = createProject({
      title: 'Bad apple', pot: 100,
      tasks: [{ title: 'a1', folder: 'A' }, { title: 'a2', folder: 'A' }, { title: 'b1', folder: 'B' }],
    }, pctx)
    const { learner, forgotten } = fakeLearner()
    const d = deps({ think: badAgent, learner })
    const h = await runHive(p.id, d)

    const bad = h.agents.find(a => a.name === 'A agent')!
    expect(bad.removedAt).not.toBeNull()
    expect(bad.removedReason).toMatch(/voted out/)
    expect(forgotten).toContain(bad.id)
    expect(h.events.some(e => e.kind === 'remove')).toBe(true)
    // The rest picked up its work, so the project still finished.
    expect(getProject(p.id, pctx)!.status).toBe('complete')
    // Its learning is not in the merge.
    expect(h.merge!.agents.map(a => a.id)).not.toContain(bad.id)
    // The survivors' value is still a fixed total.
    expect(h.agents.filter(a => a.removedAt === null).reduce((n, a) => n + a.value, 0)).toBeCloseTo(100, 3)
  })

  it('does not remove anyone when the others do not agree', async () => {
    const p = createProject({ title: 'Merciful', pot: 100, tasks: [{ title: 'a1', folder: 'A' }, { title: 'a2', folder: 'A' }, { title: 'b1', folder: 'B' }] }, pctx)
    const merciful: HiveDeps['think'] = async (a, prompt) => (prompt.includes('removed from the team') ? 'NO' : badAgent(a, prompt))
    const h = await runHive(p.id, deps({ think: merciful, maxRounds: 4 }))
    expect(h.agents.every(a => a.removedAt === null)).toBe(true)
  })

  it('never takes the team below the minimum', async () => {
    // Everyone but the checker does bad work, and the checker votes YES to everything.
    const p = createProject({ title: 'Mutiny', pot: 100, tasks: [{ title: 'a1', folder: 'A' }, { title: 'a2', folder: 'A' }, { title: 'b1', folder: 'B' }, { title: 'b2', folder: 'B' }] }, pctx)
    const allBad: HiveDeps['think'] = async (a, prompt) => {
      if (prompt.includes('checking another AI')) return prompt.includes('BAD WORK') ? 'REJECT' : 'ACCEPT'
      if (prompt.includes('removed from the team')) return 'YES'
      return a.folder ? 'BAD WORK' : 'fine'
    }
    const h = await runHive(p.id, deps({ think: allBad, maxRounds: 6 }))
    const left = h.agents.filter((a: HiveAgentRecord) => a.removedAt === null)
    expect(left.length).toBeGreaterThanOrEqual(MIN_AGENTS)
  })
})
