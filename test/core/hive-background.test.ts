/**
 * The AI works on projects by itself, gently: one project, one round, longest
 * waiting first, and never retrying something that cannot have changed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createProject, setPublished, setBackground, claimTask, selfWorker, importProject, getProject, loadProjects, listWikiProjects, renderProjectPage, type ProjectCtx } from '../../models && skills/core/projects.js'
import { backgroundTick, nextBackgroundProject, startBackgroundHives } from '../../models && skills/core/hive-background.js'
import { getHive, type HiveDeps } from '../../models && skills/core/project-hive.js'
import { publishWikiPage } from '../../models && skills/core/wiki-store.js'

let dir: string
let pctx: ProjectCtx
let hfile: string
const saved = process.env.NEUROCLAW_STORE_DIR
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'hive-bg-'))
  pctx = { file: path.join(dir, 'projects.json'), pointsFile: path.join(dir, 'points.json') }
  hfile = path.join(dir, 'hives.json')
  process.env.NEUROCLAW_STORE_DIR = path.join(dir, 'store')
})
afterEach(() => {
  if (saved === undefined) delete process.env.NEUROCLAW_STORE_DIR
  else process.env.NEUROCLAW_STORE_DIR = saved
  rmSync(dir, { recursive: true, force: true })
})

const opts = (think: HiveDeps['think'], extra: Partial<HiveDeps> = {}) => ({
  project: pctx, hivesFile: hfile,
  deps: async (): Promise<HiveDeps> => ({ think, file: hfile, project: pctx, ...extra }),
})
const agreeable: HiveDeps['think'] = async (_a, p) => (p.includes('Would it go better') ? 'HELP' : p.includes('checking another AI') ? 'ACCEPT' : p.includes('Start your reply with YES') ? 'NO' : 'done')
const quick = (title: string, background?: boolean) => createProject({ title, pot: 10, background, tasks: [{ title: 'a' }, { title: 'b' }] }, pctx)

describe('choosing what to work on', () => {
  it('projects are worked on in the background unless you say not to', () => {
    expect(quick('On').background).toBe(true)
    expect(quick('Off', false).background).toBe(false)
  })

  it('works on one that has it on, and leaves the rest alone', () => {
    quick('Off', false)
    const on = quick('On')
    expect(nextBackgroundProject(opts(agreeable))).toBe(on.id)
    setBackground(on.id, false, pctx)
    expect(nextBackgroundProject(opts(agreeable))).toBeNull()
  })

  it('skips a project with nothing in it, and one that is finished', async () => {
    createProject({ title: 'Empty', pot: 10 }, pctx)
    expect(nextBackgroundProject(opts(agreeable))).toBeNull()
    const p = quick('Done')
    await backgroundTick(opts(agreeable))
    await backgroundTick(opts(agreeable))
    expect(getProject(p.id, pctx)!.status).toBe('complete')
    expect(nextBackgroundProject(opts(agreeable))).toBeNull()
  })

  it('the one that has waited longest goes first', async () => {
    const a = quick('First')
    const b = quick('Second')
    const first = await backgroundTick(opts(async (_a, p) => (agreeable(_a, p))))
    expect(first.ran).not.toBeNull()
    // Whichever just ran has now been touched, so the other one is next.
    expect(nextBackgroundProject(opts(agreeable))).toBe(first.ran === a.id ? b.id : a.id)
  })

  it('leaves a stalled hive alone until something about its project changes', async () => {
    const p = quick('Stuck')
    const silent: HiveDeps['think'] = async () => ''
    await backgroundTick(opts(silent))
    expect(getHive(p.id, hfile)!.state).toBe('stalled')
    expect(nextBackgroundProject(opts(agreeable))).toBeNull() // nothing has changed: do not try again
    // Someone takes a task: the project changed, so it is worth another look.
    claimTask(p.id, 't1', selfWorker(pctx.pointsFile), { ...pctx, now: () => Date.now() + 10_000 })
    expect(nextBackgroundProject(opts(agreeable))).toBe(p.id)
  })
})

describe('a pass', () => {
  it('gives the project exactly one round', async () => {
    const p = createProject({ title: 'Big', pot: 10, tasks: Array.from({ length: 12 }, (_, i) => ({ title: `job ${i}`, folder: 'Work' })) }, pctx)
    const r = await backgroundTick(opts(agreeable))
    expect(r.ran).toBe(p.id)
    expect(getHive(p.id, hfile)!.round).toBe(1)
    expect(getProject(p.id, pctx)!.status).toBe('open')
  })

  it('does nothing, and says so, when there is nothing to do', async () => {
    expect(await backgroundTick(opts(agreeable))).toEqual({ ran: null })
  })

  it('never throws, whatever the brain does', async () => {
    quick('Boom')
    await expect(backgroundTick({ project: pctx, hivesFile: hfile, deps: async () => { throw new Error('no brain') } })).resolves.toEqual({ ran: expect.any(String) })
    await expect(backgroundTick(opts(async () => { throw new Error('mesh down') }))).resolves.toBeDefined()
  })

  it('the timer can be stopped', () => {
    const stop = startBackgroundHives({ ...opts(agreeable), intervalMs: 60_000 })
    expect(typeof stop).toBe('function')
    stop()
  })
})

describe('the league', () => {
  it('lists every project published to the wiki, and whether this device already has it', () => {
    const mine = quick('Mine')
    setPublished(mine.id, true, pctx)
    // Another install's project arrives as a wiki page.
    const theirs = { ...getProject(mine.id, pctx)!, id: 'theirs', title: 'Theirs', background: true }
    publishWikiPage('projects/theirs', 'Theirs', renderProjectPage(theirs))
    const league = listWikiProjects(pctx)
    expect(league.map(p => [p.id, p.local]).sort()).toEqual([['mine', true], ['theirs', false]])
    expect(league.find(p => p.id === 'theirs')).toMatchObject({ page: 'projects/theirs', tasks: 2, pot: 10 })
  })

  it('leaves out a page that only looks like a project', () => {
    publishWikiPage('projects/fake', 'Fake', '# Fake\n\nNot a project at all.')
    expect(listWikiProjects(pctx)).toEqual([])
  })

  it('a project joined from the league starts with the AI OFF, so nobody else\'s project uses this brain unasked', () => {
    const mine = quick('Shared')
    setPublished(mine.id, true, pctx)
    const page = renderProjectPage(getProject(mine.id, pctx)!)
    expect(page).toContain('"background":true')
    const other: ProjectCtx = { file: path.join(dir, 'other.json'), pointsFile: path.join(dir, 'other-points.json') }
    const { project } = importProject('projects/shared', other)
    expect(project.background).toBe(false)
    expect(loadProjects(other.file)[0].background).toBe(false)
  })
})
