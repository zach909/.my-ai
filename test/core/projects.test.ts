/**
 * Projects: a fixed pot paid out by accepted tasks, with nobody reviewing
 * their own work, mirrored into the wiki, organised by the agent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createProject, addTask, claimTask, releaseTask, submitTask, reviewTask, getProject, loadProjects, summarize, rewardOf,
  planFromGoal, parsePlan, fallbackPlan, createProjectFromGoal, organizeTasks, parseFolderReply,
  renderProjectPage, parseProjectPage, importProject, cleanProject, selfWorker, resolveWorker,
  setPublished, ProjectError, MAX_ATTEMPTS, MAX_CLAIMS, MAX_POT, UNSORTED, taskPoolOf, bonusPoolOf, projectWikiName,
  type ProjectCtx, type Worker, type Think,
} from '../../models && skills/core/projects.js'
import { addMember, loadPoints, SELF_ID, REFERRAL_BONUS } from '../../models && skills/core/points.js'

let dir: string
let ctx: ProjectCtx
const savedStore = process.env.NEUROCLAW_STORE_DIR

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'corona-projects-'))
  ctx = { file: path.join(dir, 'projects.json'), pointsFile: path.join(dir, 'points.json') }
  process.env.NEUROCLAW_STORE_DIR = path.join(dir, 'store')
})
afterEach(() => {
  if (savedStore === undefined) delete process.env.NEUROCLAW_STORE_DIR
  else process.env.NEUROCLAW_STORE_DIR = savedStore
  rmSync(dir, { recursive: true, force: true })
})

const balance = (id: string) => loadPoints(ctx.pointsFile).members.find(m => m.id === id)?.points ?? 0
const person = (name: string): Worker => {
  const m = addMember(name, { referredBy: null }, ctx.pointsFile)
  return resolveWorker(m.id, ctx)
}
const agent = (id: string): Worker => resolveWorker(id, ctx, 'agent', id)

/** Do one task start to finish: `worker` takes it, hands it in, `reviewer` accepts. */
function finish(pid: string, tid: string, worker: Worker, reviewer: Worker) {
  claimTask(pid, tid, worker, ctx)
  submitTask(pid, tid, worker, 'done it', ctx)
  return reviewTask(pid, tid, reviewer, 'accept', 'good', ctx)
}

describe('making a project', () => {
  it('slugs the title, keeps ids unique, and files tasks into folders', () => {
    const a = createProject({ title: 'Map the Moon!', pot: 100, tasks: [{ title: 'Survey', folder: 'Field' }, { title: 'Write up' }] }, ctx)
    const b = createProject({ title: 'Map the Moon!', pot: 50 }, ctx)
    expect(a.id).toBe('map-the-moon')
    expect(b.id).toBe('map-the-moon-2')
    expect(a.folders).toEqual(['Field', UNSORTED])
    expect(a.tasks.map(t => [t.id, t.folder])).toEqual([['t1', 'Field'], ['t2', UNSORTED]])
  })

  it('the pot is bounded and positive', () => {
    expect(() => createProject({ title: 'x', pot: 0 }, ctx)).toThrow(ProjectError)
    expect(() => createProject({ title: 'x', pot: -5 }, ctx)).toThrow(ProjectError)
    expect(() => createProject({ title: 'x', pot: MAX_POT + 1 }, ctx)).toThrow(/final/)
    expect(() => createProject({ title: '', pot: 10 }, ctx)).toThrow(ProjectError)
    expect(() => createProject({ title: 'x', pot: 10, tasks: [{ title: 'ok', weight: -1 }] }, ctx)).toThrow(/weight/)
  })

  it('splits the pot 90/10 between tasks and the completion bonus', () => {
    expect(taskPoolOf(100)).toBe(90)
    expect(bonusPoolOf(100)).toBe(10)
    expect(taskPoolOf(1) + bonusPoolOf(1)).toBeCloseTo(1, 9)
  })

  it('a task is worth its weight\'s share of the task pool', () => {
    const p = createProject({ title: 'P', pot: 100, tasks: [{ title: 'big', weight: 3 }, { title: 'small', weight: 1 }] }, ctx)
    expect(rewardOf(p, p.tasks[0])).toBe(67.5)
    expect(rewardOf(p, p.tasks[1])).toBe(22.5)
  })

  it('the plan is fixed once a task has been paid', () => {
    const p = createProject({ title: 'P', pot: 100, tasks: [{ title: 'one' }, { title: 'two' }] }, ctx)
    addTask(p.id, { title: 'three' }, ctx) // still allowed: nothing paid yet
    finish(p.id, 't1', agent('a1'), agent('a2'))
    expect(() => addTask(p.id, { title: 'four' }, ctx)).toThrow(/fixed/)
  })
})

describe('doing the work', () => {
  it('pays the worker when a different party accepts', () => {
    const p = createProject({ title: 'P', pot: 100, tasks: [{ title: 'a' }, { title: 'b' }] }, ctx)
    const r = finish(p.id, 't1', agent('a1'), agent('a2'))
    expect(r.paid).toBe(45)
    expect(balance('a1')).toBe(45)
    expect(getProject(p.id, ctx)?.paidOut).toBe(45)
  })

  it('nobody reviews their own work', () => {
    const p = createProject({ title: 'P', pot: 100, tasks: [{ title: 'a' }] }, ctx)
    const a1 = agent('a1')
    claimTask(p.id, 't1', a1, ctx)
    submitTask(p.id, 't1', a1, 'done', ctx)
    expect(() => reviewTask(p.id, 't1', a1, 'accept', '', ctx)).toThrow(/own work/)
    expect(balance('a1')).toBe(0)
  })

  it('only one worker can hold a task, only they can hand it in, and a done task stays done', () => {
    const p = createProject({ title: 'P', pot: 100, tasks: [{ title: 'a' }, { title: 'b' }] }, ctx)
    const [a1, a2, a3] = [agent('a1'), agent('a2'), agent('a3')]
    claimTask(p.id, 't1', a1, ctx)
    expect(() => claimTask(p.id, 't1', a2, ctx)).toThrow(/already taken/)
    expect(() => submitTask(p.id, 't1', a2, 'mine now', ctx)).toThrow(/Only the worker/)
    submitTask(p.id, 't1', a1, 'done', ctx)
    reviewTask(p.id, 't1', a3, 'accept', '', ctx)
    expect(() => claimTask(p.id, 't1', a2, ctx)).toThrow(/already done/)
    expect(() => reviewTask(p.id, 't1', a3, 'accept', '', ctx)).toThrow(/handed-in/)
    expect(balance('a1')).toBe(45) // paid once
  })

  it('a worker can give a claimed task back', () => {
    const p = createProject({ title: 'P', pot: 100, tasks: [{ title: 'a' }] }, ctx)
    const [a1, a2] = [agent('a1'), agent('a2')]
    claimTask(p.id, 't1', a1, ctx)
    expect(() => releaseTask(p.id, 't1', a2, ctx)).toThrow(/Only the worker/)
    releaseTask(p.id, 't1', a1, ctx)
    expect(claimTask(p.id, 't1', a2, ctx).assignee?.id).toBe('a2')
  })

  it('limits how many tasks one worker can sit on', () => {
    const p = createProject({ title: 'P', pot: 100, tasks: Array.from({ length: MAX_CLAIMS + 1 }, (_, i) => ({ title: `t${i}` })) }, ctx)
    const a1 = agent('a1')
    for (let i = 1; i <= MAX_CLAIMS; i++) claimTask(p.id, `t${i}`, a1, ctx)
    expect(() => claimTask(p.id, `t${MAX_CLAIMS + 1}`, a1, ctx)).toThrow(/in progress/)
  })

  it('rejected work goes back to its worker, then opens up to others after too many tries', () => {
    const p = createProject({ title: 'P', pot: 100, tasks: [{ title: 'a' }] }, ctx)
    const [a1, a2, a3] = [agent('a1'), agent('a2'), agent('a3')]
    claimTask(p.id, 't1', a1, ctx)
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      submitTask(p.id, 't1', a1, `try ${i}`, ctx)
      reviewTask(p.id, 't1', a2, 'reject', 'not yet', ctx)
      expect(getProject(p.id, ctx)?.tasks[0]).toMatchObject({ status: 'claimed', attempts: i })
    }
    submitTask(p.id, 't1', a1, 'last try', ctx)
    reviewTask(p.id, 't1', a2, 'reject', 'no', ctx)
    expect(getProject(p.id, ctx)?.tasks[0]).toMatchObject({ status: 'open', assignee: null, attempts: 0 })
    expect(claimTask(p.id, 't1', a3, ctx).assignee?.id).toBe('a3')
    expect(balance('a1')).toBe(0)
  })

  it('completing the last task completes the project and pays the bonus by contribution', () => {
    const p = createProject({ title: 'P', pot: 100, tasks: [{ title: 'big', weight: 3 }, { title: 'small', weight: 1 }] }, ctx)
    const [a1, a2, a3] = [agent('a1'), agent('a2'), agent('a3')]
    finish(p.id, 't1', a1, a3)
    const last = finish(p.id, 't2', a2, a3)
    expect(last.completed).toBe(true)
    expect(last.bonuses.map(b => [b.worker.id, b.points])).toEqual([['a1', 7.5], ['a2', 2.5]])
    expect(balance('a1')).toBe(67.5 + 7.5)
    expect(balance('a2')).toBe(22.5 + 2.5)
    const done = getProject(p.id, ctx)!
    expect(done.status).toBe('complete')
    expect(done.paidOut).toBe(100)
    expect(() => claimTask(p.id, 't1', a1, ctx)).toThrow(ProjectError)
    expect(summarize(done)).toMatchObject({ done: 2, tasks: 2, remaining: 0 })
  })

  it('never pays out more than the pot, whatever the weights', () => {
    // Awkward weights and pots that do not divide evenly: every amount rounds down.
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let round = 0; round < 25; round++) {
      const pot = Math.round((rnd() * 999 + 1) * 1000) / 1000
      const n = 1 + Math.floor(rnd() * 9)
      const tasks = Array.from({ length: n }, (_, i) => ({ title: `task ${i}`, weight: Math.round((rnd() * 9 + 0.1) * 100) / 100 }))
      const p = createProject({ title: `Round ${round}`, pot, tasks }, ctx)
      const reviewer = agent('rev')
      p.tasks.forEach((t, i) => finish(p.id, t.id, agent(`w${i % 3}`), reviewer))
      const done = getProject(p.id, ctx)!
      expect(done.status).toBe('complete')
      expect(done.paidOut).toBeLessThanOrEqual(pot + 1e-9)
      expect(done.paidOut).toBeGreaterThan(pot - 0.001) // only rounding dust is left unpaid
      expect(done.tasks.reduce((s, t) => s + t.paid, 0)).toBeLessThanOrEqual(taskPoolOf(pot) + 1e-9)
    }
  })

  it('releases the referral bonus the first time someone you added gets paid', () => {
    const sam = addMember('Sam', {}, ctx.pointsFile) // added by the owner
    const p = createProject({ title: 'P', pot: 100, tasks: [{ title: 'a' }] }, ctx)
    finish(p.id, 't1', resolveWorker(sam.id, ctx), agent('a2'))
    expect(balance(SELF_ID)).toBe(REFERRAL_BONUS)
  })

  it('the owner shows up as a worker by name, and people must be on the board first', () => {
    expect(selfWorker(ctx.pointsFile)).toMatchObject({ id: SELF_ID, name: 'You', kind: 'person' })
    expect(() => resolveWorker('nobody', ctx)).toThrow(/Add them first/)
  })
})

describe('the wiki', () => {
  it('a project is PRIVATE until it is shared: no wiki page exists for it, because the wiki is public', () => {
    const p = createProject({ title: 'Secret', pot: 10, tasks: [{ title: 'a' }] }, ctx)
    expect(existsSync(path.join(dir, 'store', 'wiki', 'projects', `${p.id}.md`))).toBe(false)
    finish(p.id, 't1', agent('a1'), agent('a2'))
    expect(existsSync(path.join(dir, 'store', 'wiki', 'projects', `${p.id}.md`))).toBe(false)
    expect(getProject(p.id, ctx)!.published).toBe(false)
  })

  it('sharing writes the page, keeps it current, and making it private takes it down again', () => {
    const p = createProject({ title: 'Map the Moon', pot: 100, tasks: [{ title: 'Survey', folder: 'Field' }] }, ctx)
    const file = path.join(dir, 'store', 'wiki', 'projects', `${p.id}.md`)
    setPublished(p.id, true, ctx)
    expect(existsSync(file)).toBe(true)
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('# Map the Moon')
    expect(text).toContain('## Field')
    expect(text).toContain('- [ ] **t1** Survey — 90 pts')
    finish(p.id, 't1', agent('a1'), agent('a2'))
    expect(readFileSync(file, 'utf8')).toContain('- [x] **t1** Survey')
    expect(projectWikiName(p.id)).toBe(`projects/${p.id}`)
    setPublished(p.id, false, ctx)
    expect(existsSync(file)).toBe(false)
  })

  it('round-trips through the page, so another install can import it', () => {
    const p = createProject({ title: 'Round Trip', goal: 'Do it', pot: 100, tasks: [{ title: 'a', folder: 'F', detail: 'with -- dashes --> and <b>tags</b>' }] }, ctx)
    setPublished(p.id, true, ctx)
    finish(p.id, 't1', selfWorker(ctx.pointsFile), agent('a2'))
    const page = renderProjectPage(getProject(p.id, ctx)!)
    expect(page.match(/-->/g)).toHaveLength(1) // only the real end of the data comment
    const back = parseProjectPage(page)!
    expect(back.tasks[0].detail).toBe('with -- dashes --> and <b>tags</b>')
    expect(back.tasks[0].assignee?.id).not.toBe(SELF_ID) // the owner travels by name, not by this device's "me"
    expect(back.tasks[0].assignee?.name).toBe('You')
  })

  it('imports another install\'s project, pays nobody, and keeps the newer copy', () => {
    const p = createProject({ title: 'Shared', pot: 100, tasks: [{ title: 'a' }, { title: 'b' }] }, { ...ctx, now: () => 1000 })
    setPublished(p.id, true, { ...ctx, now: () => 1000 })
    finish(p.id, 't1', agent('a1'), agent('a2'))
    const other: ProjectCtx = { file: path.join(dir, 'other-projects.json'), pointsFile: path.join(dir, 'other-points.json') }
    const imported = importProject(projectWikiName(p.id), other)
    expect(imported.replaced).toBe(false)
    expect(loadProjects(other.file)[0].paidOut).toBe(45)
    // Nobody was paid on the importing device.
    expect(loadPoints(other.pointsFile).members.every(m => m.points === 0)).toBe(true)
    // An older copy never overwrites a newer one.
    expect(importProject(projectWikiName(p.id), other).replaced).toBe(false)
  })

  it('refuses a page whose data was tampered with to claim more than the pot', () => {
    const p = createProject({ title: 'Tamper', pot: 100, tasks: [{ title: 'a' }] }, ctx)
    const good = getProject(p.id, ctx)!
    const forged = { ...good, paidOut: 5000 }
    expect(cleanProject(forged)).toBeNull()
    const forgedTask = { ...good, tasks: [{ ...good.tasks[0], status: 'done', assignee: { kind: 'person', id: 'x', name: 'X' }, paid: 99 }] }
    expect(cleanProject(forgedTask)).toBeNull()
    const noWorker = { ...good, tasks: [{ ...good.tasks[0], status: 'claimed', assignee: null }] }
    expect(cleanProject(noWorker)).toBeNull()
    expect(parseProjectPage('# not a project')).toBeNull()
    expect(parseProjectPage('<!-- neuroclaw-project\n{ broken\n-->')).toBeNull()
  })

  it('imports a project with workers this device has never met, and pays them from the pot when their work is accepted here', () => {
    const p = createProject({ title: 'Foreign', pot: 100, tasks: [{ title: 'a' }] }, ctx)
    setPublished(p.id, true, ctx)
    claimTask(p.id, 't1', agent('far-away'), ctx)
    submitTask(p.id, 't1', agent('far-away'), 'done', ctx)
    const other: ProjectCtx = { file: path.join(dir, 'o.json'), pointsFile: path.join(dir, 'o-points.json') }
    importProject(projectWikiName(p.id), other)
    const r = reviewTask(p.id, 't1', selfWorker(other.pointsFile), 'accept', '', other)
    expect(r.paid).toBe(90)
    expect(loadPoints(other.pointsFile).members.find(m => m.id === 'far-away')?.points).toBe(90 + 10)
  })
})

describe('the agent plans and organises', () => {
  it('reads Folder: and - lines, ignoring chatter around them', () => {
    const folders = parsePlan([
      'Sure! Here is a plan:',
      'Folder: Research',
      '- Read the papers',
      '- **Summarise** the findings',
      'Folder: Build',
      '1. Write the code',
      '2) Test it',
      'Hope that helps!',
    ].join('\n'))
    expect(folders).toEqual([
      { name: 'Research', tasks: [{ title: 'Read the papers' }, { title: 'Summarise the findings' }] },
      { name: 'Build', tasks: [{ title: 'Write the code' }, { title: 'Test it' }] },
    ])
  })

  it('puts tasks with no folder line under Plan, and drops duplicates', () => {
    expect(parsePlan('- one\n- ONE\n- two')).toEqual([{ name: 'Plan', tasks: [{ title: 'one' }, { title: 'two' }] }])
  })

  it('falls back to one task per sentence when the reply cannot be read', async () => {
    const think: Think = async () => '¿¿ ???  garbled bytes'
    const plan = await planFromGoal('Gather the data. Clean it; then publish the result', think)
    expect(plan.source).toBe('fallback')
    expect(plan.folders[0].tasks.map(t => t.title)).toEqual(['Gather the data', 'Clean it', 'then publish the result'])
    expect(fallbackPlan('').length).toBe(1)
  })

  it('falls back when the agent throws', async () => {
    const plan = await planFromGoal('One thing', async () => { throw new Error('mesh busy') })
    expect(plan).toMatchObject({ source: 'fallback' })
  })

  it('makes a project from a goal using the agent\'s folders', async () => {
    const think: Think = async prompt => {
      expect(prompt).toContain('Project: Build a weather app')
      return 'Folder: Backend\n- Fetch forecasts\nFolder: Frontend\n- Draw the screen\n- Wire it up'
    }
    const { project, source } = await createProjectFromGoal({ title: 'Weather', goal: 'Build a weather app', pot: 200 }, think, ctx)
    expect(source).toBe('agent')
    expect(project.folders).toEqual(['Backend', 'Frontend'])
    expect(project.tasks.map(t => [t.title, t.folder])).toEqual([['Fetch forecasts', 'Backend'], ['Draw the screen', 'Frontend'], ['Wire it up', 'Frontend']])
    await expect(createProjectFromGoal({ title: 'x', goal: '  ', pot: 10 }, think, ctx)).rejects.toThrow(/goal|for/i)
  })

  it('reads a folder name from a sloppy reply', () => {
    expect(parseFolderReply('"Backend".')).toBe('Backend')
    expect(parseFolderReply('Folder: Front end\nbecause it is UI')).toBe('Front end')
    expect(parseFolderReply('   \n  ')).toBeNull()
    expect(parseFolderReply('<script>alert(1)</script>')).toBeNull()
    expect(parseFolderReply('x'.repeat(200))).toBeNull()
  })

  it('files unsorted tasks where the agent says, and leaves the ones it cannot place', async () => {
    const p = createProject({ title: 'P', pot: 100, folders: ['Backend'], tasks: [{ title: 'Fetch data' }, { title: 'Draw screen' }, { title: 'Mystery' }, { title: 'Filed already', folder: 'Backend' }] }, ctx)
    const answers: Record<string, string> = { 'Fetch data': 'backend', 'Draw screen': 'Design', Mystery: '' }
    const think: Think = async prompt => answers[/Task: ([^-\n]+?)(?: - |\n)/.exec(prompt)?.[1] ?? ''] ?? ''
    const r = await organizeTasks(p.id, think, ctx)
    expect(r).toEqual({ moved: 2, asked: 3 })
    const after = getProject(p.id, ctx)!
    expect(after.tasks.map(t => t.folder)).toEqual(['Backend', 'Design', UNSORTED, 'Backend'])
    expect(after.folders).toEqual(['Backend', UNSORTED, 'Design'])
  })

  it('does not lose a task that moved while the agent was thinking', async () => {
    const p = createProject({ title: 'P', pot: 100, tasks: [{ title: 'Race' }] }, ctx)
    const think: Think = async () => {
      // The agent is slow: meanwhile somebody takes and finishes the task elsewhere.
      claimTask(p.id, 't1', agent('a1'), ctx)
      return 'Elsewhere'
    }
    await organizeTasks(p.id, think, ctx)
    const after = getProject(p.id, ctx)!
    expect(after.tasks[0]).toMatchObject({ status: 'claimed', folder: 'Elsewhere' })
  })
})
