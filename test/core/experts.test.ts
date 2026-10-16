/**
 * Experts: standing AIs, one job each, running by themselves, with a small
 * team that must clearly approve before anything is done, and no channel
 * between one expert and another.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createExpert, updateExpert, deleteExpert, loadExperts, getExpert, runExpert, runExpertChain, expertsTick, dueExperts, startExperts, isExpertRunning,
  parseReview, parsePlan, ExpertError, MAX_EXPERTS, MIN_INTERVAL_MIN, type ExpertDeps, type ExpertCtx,
} from '../../models && skills/core/experts.js'

let dir: string
let ctx: ExpertCtx
let t = 1_000_000
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'experts-'))
  t = 1_000_000
  ctx = { file: path.join(dir, 'experts.json'), now: () => t }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const email = () => createExpert({ name: 'Email', specialty: 'email management', mission: 'Keep the inbox clear and flag anything urgent.' }, ctx)

/** The Lead proposes, specialists add nothing, the Checker approves. Acting returns what it did. */
function deps(over: Partial<ExpertDeps> = {}): ExpertDeps & { acted: string[]; thought: Array<[string, string]> } {
  const acted: string[] = []
  const thought: Array<[string, string]> = []
  return {
    think: async (a, p) => {
      thought.push([a.role, p])
      if (a.role === 'lead') return 'Archive the newsletters'
      if (a.role === 'checker') return 'APPROVE: safe'
      return 'NOTHING'
    },
    act: async i => { acted.push(i); return 'Archived 12 newsletters.' },
    ...over,
    acted, thought,
  }
}

describe('making an expert', () => {
  it('is its own team: a lead, a checker, and specialists between', () => {
    const e = createExpert({ name: 'Maintenance', specialty: 'computer maintenance', mission: 'Keep the machine healthy.', teamSize: 4 }, ctx)
    expect(e.agents.map(a => a.role)).toEqual(['lead', 'specialist', 'specialist', 'checker'])
    expect(email().agents.map(a => a.role)).toEqual(['lead', 'specialist', 'checker'])
  })

  it('starts by itself: it is due the moment it is made', () => {
    const e = email()
    expect(e.enabled).toBe(true)
    expect(e.nextAt).toBe(t)
    expect(dueExperts(ctx).map(x => x.id)).toEqual([e.id])
  })

  it('refuses nonsense and duplicates, and limits how many there are', () => {
    expect(() => createExpert({ name: '', specialty: 'x', mission: 'y' }, ctx)).toThrow(ExpertError)
    expect(() => createExpert({ name: 'A', specialty: '', mission: 'y' }, ctx)).toThrow(/expert in/)
    expect(() => createExpert({ name: 'A', specialty: 'x', mission: '' }, ctx)).toThrow(/keep doing/)
    expect(() => createExpert({ name: 'A', specialty: 'x', mission: 'y', teamSize: 1 }, ctx)).toThrow(/team/)
    expect(() => createExpert({ name: 'A', specialty: 'x', mission: 'y', teamSize: 9 }, ctx)).toThrow(/team/)
    expect(() => createExpert({ name: 'A', specialty: 'x', mission: 'y', intervalMin: MIN_INTERVAL_MIN - 1 }, ctx)).toThrow(/minutes/)
    email()
    expect(() => createExpert({ name: 'email', specialty: 'x', mission: 'y' }, ctx)).toThrow(/already/)
    for (let i = 1; i < MAX_EXPERTS; i++) createExpert({ name: `E${i}`, specialty: 'x', mission: 'y' }, ctx)
    expect(() => createExpert({ name: 'One too many', specialty: 'x', mission: 'y' }, ctx)).toThrow(/At most/)
  })

  it('can be paused, resumed (which starts it again at once), changed, and deleted', () => {
    const e = email()
    updateExpert(e.id, { enabled: false }, ctx)
    expect(dueExperts(ctx)).toEqual([])
    t += 5000
    updateExpert(e.id, { enabled: true, intervalMin: 60, mission: 'New mission' }, ctx)
    expect(getExpert(e.id, ctx)).toMatchObject({ enabled: true, intervalMin: 60, mission: 'New mission', nextAt: t })
    expect(() => updateExpert(e.id, { intervalMin: 1 }, ctx)).toThrow(ExpertError)
    expect(() => updateExpert('0000000000', { enabled: true }, ctx)).toThrow(/No such/)
    expect(deleteExpert(e.id, ctx)).toBe(true)
    expect(deleteExpert(e.id, ctx)).toBe(false)
  })
})

describe('a cycle', () => {
  it('the lead proposes, the checker approves, and the team acts', async () => {
    const e = email()
    const d = deps()
    const after = await runExpert(e.id, d, ctx)
    expect(d.acted).toEqual(['email management: Archive the newsletters'])
    expect(after.history[0]).toMatchObject({ plan: 'Archive the newsletters', review: 'approve', acted: true, result: 'Archived 12 newsletters.' })
    expect(after.notes[0]).toMatch(/Archive the newsletters -> done/)
    expect(after).toMatchObject({ runs: 1, failures: 0, lastRunAt: t })
    expect(after.nextAt).toBe(t + 15 * 60_000)
  })

  it('each agent is told its role and that the team does nothing outside its specialty', async () => {
    const e = email()
    const d = deps()
    await runExpert(e.id, d, ctx)
    const lead = d.thought.find(([r]) => r === 'lead')![1]
    expect(lead).toContain('Lead of the Email expert team')
    expect(lead).toContain('expert in email management and does nothing else')
    expect(lead).toContain('Keep the inbox clear')
  })

  it('specialists\' refinements are passed on to the checker and into what is done', async () => {
    const e = email()
    const d = deps({ think: async (a) => (a.role === 'lead' ? 'Archive the newsletters' : a.role === 'checker' ? 'APPROVE' : 'Keep anything from my boss') })
    await runExpert(e.id, d, ctx)
    expect(d.acted[0]).toContain('Keep anything from my boss')
  })

  it('anything but a clear APPROVE does nothing: hold, silence, or a muddled reply', async () => {
    for (const reply of ['HOLD: not sure', '', '¿¿ ???', 'I think it is probably fine']) {
      const e = createExpert({ name: `E${Math.random().toString(36).slice(2, 6)}`, specialty: 'x', mission: 'y' }, ctx)
      const d = deps({ think: async (a) => (a.role === 'lead' ? 'Do something' : a.role === 'checker' ? reply : 'NOTHING') })
      const after = await runExpert(e.id, d, ctx)
      expect(d.acted).toEqual([])
      expect(after.history[0].acted).toBe(false)
      expect(after.history[0].result).toMatch(/nothing was done/)
    }
  })

  it('says NOTHING when there is nothing to do, and acts on nothing', async () => {
    const e = email()
    const d = deps({ think: async () => 'NOTHING' })
    const after = await runExpert(e.id, d, ctx)
    expect(d.acted).toEqual([])
    expect(after.history[0]).toMatchObject({ plan: '', result: 'Nothing to do this time.' })
    expect(after.notes).toEqual([])
  })

  it('an expert set to only record plans never acts, even when approved', async () => {
    const e = createExpert({ name: 'Careful', specialty: 'x', mission: 'y', mayAct: false }, ctx)
    const d = deps()
    const after = await runExpert(e.id, d, ctx)
    expect(d.acted).toEqual([])
    expect(after.history[0]).toMatchObject({ review: 'approve', acted: false })
    expect(after.history[0].result).toMatch(/only record plans/)
  })

  it('remembers what it did, so the next cycle knows', async () => {
    const e = email()
    await runExpert(e.id, deps(), ctx)
    t += 20 * 60_000
    const d = deps()
    await runExpert(e.id, d, ctx)
    expect(d.thought.find(([r]) => r === 'lead')![1]).toContain('Archive the newsletters -> done')
    expect(getExpert(e.id, ctx)!.notes).toHaveLength(2)
  })

  it('a failure is recorded, never thrown, and stretches the wait; success resets it', async () => {
    const e = email()
    const broken = deps({ act: async () => { throw new Error('mail server down') } })
    const a = await runExpert(e.id, broken, ctx)
    expect(a.history[0].result).toMatch(/Acting failed: mail server down/)
    expect(a.failures).toBe(1)
    expect(a.nextAt).toBe(t + 15 * 60_000 * 2)
    t += 60 * 60_000
    const b = await runExpert(e.id, broken, ctx)
    expect(b.nextAt).toBe(t + 15 * 60_000 * 4)
    t += 3 * 60 * 60_000
    expect((await runExpert(e.id, deps(), ctx)).failures).toBe(0)
  })

  it('a brain that cannot think is a failed cycle, not a crash', async () => {
    const e = email()
    const after = await runExpert(e.id, deps({ think: async () => { throw new Error('mesh down') } }), ctx)
    expect(after.history[0].result).toMatch(/Could not think/)
    expect(after.failures).toBe(1)
  })

  it('will not run the same expert twice at once', async () => {
    const e = email()
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const slow = deps({ think: async (a) => { await gate; return a.role === 'checker' ? 'APPROVE' : 'Do it' } })
    const first = runExpert(e.id, slow, ctx)
    expect(isExpertRunning(ctx.file!, e.id)).toBe(true)
    await expect(runExpert(e.id, deps(), ctx)).rejects.toThrow(/already working/)
    release()
    await first
    expect(isExpertRunning(ctx.file!, e.id)).toBe(false)
  })

  it('keeps a bounded history and notes', async () => {
    const e = email()
    for (let i = 0; i < 45; i++) { t += 3 * 60 * 60_000; await runExpert(e.id, deps(), ctx) }
    const x = getExpert(e.id, ctx)!
    expect(x.history).toHaveLength(30)
    expect(x.notes).toHaveLength(12)
    expect(x.runs).toBe(45)
  })
})

describe('deciding to keep going', () => {
  const chainDeps = (continueReply: string) => deps({ think: async (a, p) => (a.role === 'lead' ? (p.includes('CONTINUE or STOP') ? continueReply : 'Archive the newsletters') : a.role === 'checker' ? 'APPROVE' : 'NOTHING') })

  it('does another cycle straight away while its lead says CONTINUE, up to the cap', async () => {
    const e = email()
    const d = chainDeps('CONTINUE: more to do')
    const r = await runExpertChain(e.id, d, ctx, { enabled: true, maxSteps: 3 })
    expect(r.steps).toHaveLength(3)
    expect(r.ended).toBe('step-limit')
    expect(getExpert(e.id, ctx)!.runs).toBe(3)
    expect(d.acted).toHaveLength(3)
  })

  it('stops when its lead says STOP, or says anything unclear', async () => {
    const a = email()
    expect((await runExpertChain(a.id, chainDeps('STOP'), ctx, { enabled: true, maxSteps: 5 })).steps).toHaveLength(1)
    const b = createExpert({ name: 'Other', specialty: 'x', mission: 'y' }, ctx)
    expect((await runExpertChain(b.id, chainDeps('maybe later'), ctx, { enabled: true, maxSteps: 5 })).steps).toHaveLength(1)
  })

  it('never chains off a cycle that did not act: held, nothing to do, or failed', async () => {
    const e = email()
    const held = deps({ think: async (a, p) => (a.role === 'lead' ? (p.includes('CONTINUE or STOP') ? 'CONTINUE' : 'Do it') : a.role === 'checker' ? 'HOLD' : 'NOTHING') })
    const r = await runExpertChain(e.id, held, ctx, { enabled: true, maxSteps: 5 })
    expect(r.steps).toHaveLength(1)
    expect(r.ended).toBe('no-progress')
  })

  it('does a single cycle when switched off', async () => {
    const e = email()
    const r = await runExpertChain(e.id, chainDeps('CONTINUE'), ctx, { enabled: false, maxSteps: 5 })
    expect(r.steps).toHaveLength(1)
    expect(r.ended).toBe('off')
  })
})

describe('running by itself', () => {
  it('a tick runs every due expert, one after another, and none that are not due or paused', async () => {
    const a = email()
    const b = createExpert({ name: 'Maintenance', specialty: 'computer maintenance', mission: 'Keep it healthy.' }, ctx)
    const c = createExpert({ name: 'Paused', specialty: 'x', mission: 'y' }, ctx)
    updateExpert(c.id, { enabled: false }, ctx)
    const order: string[] = []
    const d = deps({ think: async (agent, p) => { if (agent.role === 'lead' && p.includes('single most useful')) order.push(p.includes('Email') ? 'email' : 'maintenance'); return agent.role === 'checker' ? 'APPROVE' : agent.role === 'lead' ? 'Do it' : 'NOTHING' } })
    expect((await expertsTick(d, ctx)).sort()).toEqual([a.id, b.id].sort())
    expect(order.sort()).toEqual(['email', 'maintenance'])
    expect(await expertsTick(d, ctx)).toEqual([]) // not due again yet
    t += 16 * 60_000
    expect(await expertsTick(d, ctx)).toHaveLength(2)
  })

  it('the loop starts itself, and can be stopped', () => {
    const stop = startExperts({ deps: async () => deps(), ctx, tickMs: 60_000 })
    expect(typeof stop).toBe('function')
    stop()
  })

  it('survives a restart: what is saved is what resumes', async () => {
    const e = email()
    await runExpert(e.id, deps(), ctx)
    const reloaded = loadExperts(ctx.file)[0]
    expect(reloaded).toMatchObject({ id: e.id, enabled: true, runs: 1 })
    t += 16 * 60_000
    expect(dueExperts(ctx).map(x => x.id)).toEqual([e.id])
  })
})

describe('reading replies', () => {
  it('only a reply that starts by approving approves', () => {
    expect(parseReview('APPROVE: fine')).toBe('approve')
    expect(parseReview('"Approved" - go')).toBe('approve')
    expect(parseReview('HOLD')).toBe('hold')
    expect(parseReview('I would approve')).toBe('unclear')
    expect(parseReview('')).toBe('unclear')
  })

  it('a plan is the first line, or nothing', () => {
    expect(parsePlan('Archive the newsletters\nbecause...')).toBe('Archive the newsletters')
    expect(parsePlan('NOTHING')).toBeNull()
    expect(parsePlan('  ')).toBeNull()
    expect(parsePlan('x'.repeat(900))!.length).toBe(400)
  })
})

describe('independence', () => {
  it('experts are not part of the hive mind or the projects, and share nothing with each other', () => {
    const src = readFileSync(path.join(__dirname, '../../models && skills/core/experts.ts'), 'utf8')
    const imports = [...src.matchAll(/^import .* from "([^"]+)";/gm)].map(m => m[1])
    expect(imports.some(i => /hive|project|blackboard|points|market/i.test(i))).toBe(false)
  })

  it('one expert\'s notes and history are its own: another cannot see them', async () => {
    const a = email()
    const b = createExpert({ name: 'Maintenance', specialty: 'computer maintenance', mission: 'Keep it healthy.' }, ctx)
    await runExpert(a.id, deps(), ctx)
    const leadPrompts: string[] = []
    const d = deps({ think: async (agent, p) => { if (agent.role === 'lead') leadPrompts.push(p); return agent.role === 'lead' ? 'Clear the temp folder' : agent.role === 'checker' ? 'APPROVE' : 'NOTHING' } })
    await runExpert(b.id, d, ctx)
    expect(leadPrompts[0]).toContain('no notes yet')
    expect(leadPrompts[0]).not.toContain('newsletters')
    expect(getExpert(b.id, ctx)!.notes.join(' ')).not.toContain('newsletters')
  })
})
