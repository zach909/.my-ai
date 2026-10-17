/**
 * Nobody sees anyone else's stuff: the same stores, used by different people,
 * hold different data. This is the property the whole accounts feature exists for.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runAs, userDir, type Who } from '../../models && skills/core/user-context.js'
import { award, loadPoints, addMember, SELF_ID, pointsFile } from '../../models && skills/core/points.js'
import { createProject, loadProjects, setPublished, getProject, projectsFile } from '../../models && skills/core/projects.js'
import { placeItem, viewTree } from '../../models && skills/core/folder-tree.js'
import { placeOrder, allOrders } from '../../models && skills/core/market.js'
import { createExpert, loadExperts } from '../../models && skills/core/experts.js'
import { createSchedule, loadSchedules } from '../../models && skills/core/scheduler.js'
import { staffHive, getHive, isHiveRunning, hivesFile } from '../../models && skills/core/project-hive.js'
import { TasksPlugin } from '../../plugins/tasks.js'

const A: Who = { kind: 'user', id: 'aaaaaaaa', name: 'ann', role: 'user' }
const B: Who = { kind: 'user', id: 'bbbbbbbb', name: 'bo', role: 'user' }
const ADMIN: Who = { kind: 'user', id: 'cccccccc', name: 'zach', role: 'admin' }

let dir: string
const keys = ['CORONA_DATA_DIR', 'NEUROCLAW_STORE_DIR'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'isolation-'))
  for (const k of keys) saved[k] = process.env[k]
  process.env.CORONA_DATA_DIR = path.join(dir, 'data')
  process.env.NEUROCLAW_STORE_DIR = path.join(dir, 'store')
})
afterEach(() => {
  for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  rmSync(dir, { recursive: true, force: true })
})

const names = (xs: Array<{ name: string }>) => xs.map(x => x.name)

describe('each person has their own', () => {
  it('points and leaderboard', () => {
    runAs(A, () => { award(SELF_ID, 50, 'task', 'ann work'); addMember('Friend of Ann', {}) })
    runAs(B, () => award(SELF_ID, 7, 'task', 'bo work'))
    expect(runAs(A, () => loadPoints().members.find(m => m.id === SELF_ID)!.points)).toBe(50)
    expect(runAs(B, () => loadPoints().members.find(m => m.id === SELF_ID)!.points)).toBe(7)
    expect(runAs(B, () => names(loadPoints().members))).not.toContain('Friend of Ann')
    // The owner's own ledger is untouched by either.
    expect(loadPoints().members.find(m => m.id === SELF_ID)!.points).toBe(0)
  })

  it('projects, including two people who both pick the same title', () => {
    runAs(A, () => createProject({ title: 'Secret plan', goal: 'ann only', pot: 10, tasks: [{ title: 'x' }] }))
    expect(runAs(B, () => loadProjects())).toEqual([])
    expect(loadProjects()).toEqual([])
    const b = runAs(B, () => createProject({ title: 'Secret plan', goal: 'bo only', pot: 20 }))
    expect(b.id).toBe('secret-plan') // not 'secret-plan-2': nobody else's project is in the way
    expect(runAs(A, () => getProject('secret-plan')!.goal)).toBe('ann only')
    expect(runAs(B, () => getProject('secret-plan')!.goal)).toBe('bo only')
  })

  it('folders', () => {
    runAs(A, () => placeItem({ kind: 'chat', ref: 'c1', title: 'Ann\'s private chat' }, [{ path: ['Diary'], weight: 1 }]))
    expect(runAs(A, () => viewTree().counts.items)).toBe(1)
    expect(runAs(B, () => viewTree())).toMatchObject({ top: [], unsorted: [], counts: { items: 0 } })
  })

  it('market orders, experts and schedules', () => {
    runAs(A, () => { placeOrder({ side: 'sell', cu: 5, points: 10 }); createExpert({ name: 'Email', specialty: 'email', mission: 'ann mail' }); createSchedule({ when: 'every 1 hours', action: 'ann reminder' }) })
    runAs(B, () => { createExpert({ name: 'Email', specialty: 'email', mission: 'bo mail' }); createSchedule({ when: 'every 2 hours', action: 'bo reminder' }) })
    expect(runAs(B, () => allOrders())).toEqual([])
    expect(runAs(A, () => loadExperts().map(e => e.mission))).toEqual(['ann mail'])
    expect(runAs(B, () => loadExperts().map(e => e.mission))).toEqual(['bo mail']) // same name is fine: separate people
    expect(runAs(A, () => loadSchedules().map(s => s.name))).toEqual(['ann reminder'])
    expect(runAs(B, () => loadSchedules().map(s => s.name))).toEqual(['bo reminder'])
    expect(loadExperts()).toEqual([])
  })

  it('hives, even for projects with the same id: one person\'s run is not blocked by the other\'s', () => {
    runAs(A, () => { createProject({ title: 'Plan', pot: 10, tasks: [{ title: 'x' }] }); staffHive('plan', { think: async () => '' }) })
    runAs(B, () => { createProject({ title: 'Plan', pot: 10, tasks: [{ title: 'x' }] }) })
    expect(runAs(A, () => getHive('plan'))).not.toBeNull()
    expect(runAs(B, () => getHive('plan'))).toBeNull()
    expect(runAs(A, () => isHiveRunning('plan'))).toBe(false)
    expect(runAs(A, () => hivesFile())).not.toBe(runAs(B, () => hivesFile()))
  })

  it('tasks: the Tasks plugin is one instance, but each person has their own list', async () => {
    const plugin = new TasksPlugin({ id: 'tasks', name: 'Tasks', type: 'api-connection', capabilities: ['tasks'] } as never)
    await runAs(A, () => plugin.create('ann buys milk'))
    await runAs(B, () => plugin.create('bo calls mum'))
    expect((await runAs(A, () => plugin.list())).map(t => t.title)).toEqual(['ann buys milk'])
    expect((await runAs(B, () => plugin.list())).map(t => t.title)).toEqual(['bo calls mum'])
  })

  it('every file lives under that person\'s own folder, and nowhere near anyone else\'s', () => {
    const aFiles = runAs(A, () => [pointsFile(), projectsFile(), hivesFile()])
    for (const f of aFiles) expect(f.startsWith(userDir(A.kind === 'user' ? A.id : ''))).toBe(true)
    for (const f of aFiles) expect(f.includes('bbbbbbbb')).toBe(false)
  })
})

describe('the owner and the admin', () => {
  it('are the same person here: their data is where it always was', () => {
    award(SELF_ID, 5, 'task', 'owner work')
    expect(runAs(ADMIN, () => loadPoints().members.find(m => m.id === SELF_ID)!.points)).toBe(5)
    expect(runAs(ADMIN, () => pointsFile())).toBe(pointsFile())
  })

  it('and a regular user cannot see it', () => {
    award(SELF_ID, 5, 'task', 'owner work')
    expect(runAs(A, () => loadPoints().members.find(m => m.id === SELF_ID)!.points)).toBe(0)
  })
})

describe('the wiki is public, so private means no page', () => {
  it('a project has no wiki page until its owner shares it, and sharing is theirs alone', () => {
    const page = path.join(dir, 'store', 'wiki', 'projects', 'diary-plan.md')
    runAs(A, () => createProject({ title: 'Diary plan', goal: 'nobody else\'s business', pot: 10, tasks: [{ title: 'x' }] }))
    expect(existsSync(page)).toBe(false)
    runAs(A, () => setPublished('diary-plan', true))
    expect(existsSync(page)).toBe(true)
    expect(() => runAs(B, () => setPublished('diary-plan', false))).toThrow(/No such project/) // B has no such project to touch
    expect(existsSync(page)).toBe(true)
  })
})
