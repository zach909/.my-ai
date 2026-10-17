/**
 * Schedule: read a time, do an action later or repeatedly, gently.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  parseWhen, parseClock, parseAction, nextAfter, createSchedule, updateSchedule, deleteSchedule, loadSchedules, runSchedule,
  dueSchedules, schedulerTick, startScheduler, describeAction, describeWhen,
  ScheduleError, MIN_EVERY_MINUTES, MAX_SCHEDULES, MAX_FAILURES, type SchedulerDeps, type ScheduleCtx,
} from '../../models && skills/core/scheduler.js'

// Friday 16 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 16, 10, 0, 0, 0).getTime()
const MIN = 60_000

let dir: string
let ctx: ScheduleCtx
let t = NOW
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'schedule-'))
  t = NOW
  ctx = { file: path.join(dir, 'schedules.json'), now: () => t }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const local = (ms: number) => { const d = new Date(ms); return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()] }

function deps(over: Partial<SchedulerDeps> = {}): SchedulerDeps & { log: string[] } {
  const log: string[] = []
  return {
    chat: async m => { log.push(`chat:${m}`); return `agent said: ${m}` },
    hive: async p => { log.push(`hive:${p}`); return `worked on ${p}` },
    organize: async () => { log.push('organize'); return 'filed 3' },
    expert: async e => { log.push(`expert:${e}`); return `ran ${e}` },
    ...over,
    log,
  }
}

describe('reading a time', () => {
  it('reads clock times in every common way', () => {
    expect(parseClock('9')).toEqual({ hour: 9, minute: 0 })
    expect(parseClock('9:30')).toEqual({ hour: 9, minute: 30 })
    expect(parseClock('9am')).toEqual({ hour: 9, minute: 0 })
    expect(parseClock('2:15 pm')).toEqual({ hour: 14, minute: 15 })
    expect(parseClock('14:30')).toEqual({ hour: 14, minute: 30 })
    expect(parseClock('12am')).toEqual({ hour: 0, minute: 0 })
    expect(parseClock('12pm')).toEqual({ hour: 12, minute: 0 })
  })

  it('refuses things that are not times', () => {
    for (const bad of ['25:00', '9:75', '13pm', '0am', 'noonish', '', '9 o clock']) expect(parseClock(bad)).toBeNull()
  })

  it('"in N units" is once, from now', () => {
    expect(parseWhen('in 30 minutes', NOW)).toEqual({ type: 'once', at: NOW + 30 * MIN })
    expect(parseWhen('in 2 hours', NOW)).toEqual({ type: 'once', at: NOW + 120 * MIN })
    expect(parseWhen('In 1.5 hours', NOW)).toEqual({ type: 'once', at: NOW + 90 * MIN })
    expect(parseWhen('in 3 days', NOW)).toEqual({ type: 'once', at: NOW + 3 * 1440 * MIN })
  })

  it('"every ..." repeats', () => {
    expect(parseWhen('every 15 minutes', NOW)).toEqual({ type: 'every', minutes: 15 })
    expect(parseWhen('every 2 hours', NOW)).toEqual({ type: 'every', minutes: 120 })
    expect(parseWhen('every hour', NOW)).toEqual({ type: 'every', minutes: 60 })
    expect(parseWhen('every day', NOW)).toEqual({ type: 'every', minutes: 1440 })
  })

  it('"daily at ..." is a time of day, defaulting to 9am', () => {
    expect(parseWhen('daily at 9am', NOW)).toEqual({ type: 'daily', hour: 9, minute: 0 })
    expect(parseWhen('every day at 6:45 pm', NOW)).toEqual({ type: 'daily', hour: 18, minute: 45 })
    expect(parseWhen('daily', NOW)).toEqual({ type: 'daily', hour: 9, minute: 0 })
    expect(parseWhen('every night', NOW)).toEqual({ type: 'daily', hour: 21, minute: 0 })
  })

  it('"tomorrow", "at 14:30" and exact dates are once', () => {
    expect(local((parseWhen('tomorrow at 14:30', NOW) as any).at)).toEqual([2026, 10, 17, 14, 30])
    expect(local((parseWhen('tomorrow', NOW) as any).at)).toEqual([2026, 10, 17, 9, 0])
    expect(local((parseWhen('at 14:30', NOW) as any).at)).toEqual([2026, 10, 16, 14, 30]) // later today
    expect(local((parseWhen('at 8am', NOW) as any).at)).toEqual([2026, 10, 17, 8, 0]) // already past today, so tomorrow
    expect(local((parseWhen('at 2026-11-02 09:15', NOW) as any).at)).toEqual([2026, 11, 2, 9, 15])
    expect(local((parseWhen('2026-12-25', NOW) as any).at)).toEqual([2026, 12, 25, 9, 0])
  })

  it('does not accept something it cannot read, or a date that does not exist', () => {
    for (const bad of ['whenever', 'soon', 'next tuesday', 'in a bit', 'every', 'at 2026-02-31 10:00', 'at 25:00', '']) expect(parseWhen(bad, NOW)).toBeNull()
  })

  it('the next time a daily one is due is strictly after now, today or tomorrow', () => {
    expect(local(nextAfter({ type: 'daily', hour: 11, minute: 0 }, NOW)!)).toEqual([2026, 10, 16, 11, 0])
    expect(local(nextAfter({ type: 'daily', hour: 10, minute: 0 }, NOW)!)).toEqual([2026, 10, 17, 10, 0])
    expect(local(nextAfter({ type: 'daily', hour: 9, minute: 0 }, NOW)!)).toEqual([2026, 10, 17, 9, 0])
    expect(nextAfter({ type: 'once', at: NOW - 1 }, NOW)).toBeNull()
    expect(nextAfter({ type: 'every', minutes: 7 }, NOW)).toBe(NOW + 7 * MIN)
  })
})

describe('reading an action', () => {
  it('knows the four kinds', () => {
    expect(parseAction('check my email and summarise it')).toEqual({ kind: 'chat', message: 'check my email and summarise it' })
    expect(parseAction('hive weather-app')).toEqual({ kind: 'hive', projectId: 'weather-app' })
    expect(parseAction('organize')).toEqual({ kind: 'organize' })
    expect(parseAction('expert 0a1b2c3d4e')).toEqual({ kind: 'expert', expertId: '0a1b2c3d4e' })
  })

  it('refuses nothing, a message that is too long, and a schedule that makes schedules', () => {
    expect(() => parseAction('schedule every 5 minutes: x')).toThrow(/cannot itself schedule/)
    expect(() => parseAction('  ')).toThrow(ScheduleError)
    expect(() => parseAction('x'.repeat(501))).toThrow(/at most/)
  })
})

describe('making schedules', () => {
  it('sets the next time, and can say it back in words', () => {
    const s = createSchedule({ when: 'every 2 hours', action: 'check my email' }, ctx)
    expect(s).toMatchObject({ enabled: true, nextAt: NOW + 120 * MIN, runs: 0, name: 'check my email' })
    expect(describeWhen(s.when)).toBe('every 2 hours')
    expect(describeWhen({ type: 'daily', hour: 9, minute: 5 })).toBe('daily at 09:05')
    expect(describeAction(s.action)).toBe('check my email')
  })

  it('explains what it can read when it cannot read the time', () => {
    expect(() => createSchedule({ when: 'whenever', action: 'x' }, ctx)).toThrow(/in 30 minutes/)
  })

  it('does not run more often than every few minutes, or wait longer than a month, or a time that has passed', () => {
    expect(() => createSchedule({ when: `every ${MIN_EVERY_MINUTES - 1} minutes`, action: 'x' }, ctx)).toThrow(/more often/)
    expect(() => createSchedule({ when: 'every 31 days', action: 'x' }, ctx)).toThrow(/longest/)
    expect(() => createSchedule({ when: { type: 'once', at: NOW - 1000 }, action: 'x' }, ctx)).toThrow(/passed/)
    expect(() => createSchedule({ when: 'at 2030-01-01 10:00', action: 'x' }, ctx)).toThrow(/year/)
  })

  it('has a limit, and cancelling frees a slot', () => {
    const ids: string[] = []
    for (let i = 0; i < MAX_SCHEDULES; i++) ids.push(createSchedule({ when: 'every 1 hours', action: `job ${i}` }, ctx).id)
    expect(() => createSchedule({ when: 'every 1 hours', action: 'one too many' }, ctx)).toThrow(/At most/)
    expect(deleteSchedule(ids[0], ctx)).toBe(true)
    expect(deleteSchedule(ids[0], ctx)).toBe(false)
    expect(() => createSchedule({ when: 'every 1 hours', action: 'fits now' }, ctx)).not.toThrow()
  })

  it('can be paused and resumed', () => {
    const s = createSchedule({ when: 'every 1 hours', action: 'x' }, ctx)
    updateSchedule(s.id, { enabled: false }, ctx)
    t += 10 * MIN
    expect(dueSchedules({ ...ctx, now: () => t + 3 * 60 * MIN })).toEqual([])
    const back = updateSchedule(s.id, { enabled: true }, ctx)
    expect(back.nextAt).toBe(t + 60 * MIN)
    expect(() => updateSchedule('00000000', { enabled: true }, ctx)).toThrow(/No such/)
  })
})

describe('running them', () => {
  it('does the action through the right door, and keeps what came back', async () => {
    const d = deps()
    for (const [action, expected] of [['check my email', 'chat:check my email'], ['hive weather', 'hive:weather'], ['organize', 'organize'], ['expert 0a1b2c3d4e', 'expert:0a1b2c3d4e']] as const) {
      const s = createSchedule({ when: 'every 1 hours', action }, ctx)
      const r = await runSchedule(s.id, d, ctx)
      expect(d.log.at(-1)).toBe(expected)
      expect(r.history[0]).toMatchObject({ ok: true })
      expect(r).toMatchObject({ runs: 1, failures: 0, lastRunAt: NOW })
    }
  })

  it('a one-off runs once and is then done', async () => {
    const s = createSchedule({ when: 'in 10 minutes', action: 'remind me' }, ctx)
    t += 11 * MIN
    expect(await schedulerTick(deps(), ctx)).toEqual([s.id])
    const after = loadSchedules(ctx.file)[0]
    expect(after).toMatchObject({ enabled: false, nextAt: null, runs: 1 })
    t += 99 * MIN
    expect(await schedulerTick(deps(), ctx)).toEqual([])
  })

  it('a repeating one carries on from when it actually ran', async () => {
    const s = createSchedule({ when: 'every 30 minutes', action: 'x' }, ctx)
    t += 31 * MIN
    await schedulerTick(deps(), ctx)
    expect(loadSchedules(ctx.file)[0].nextAt).toBe(t + 30 * MIN)
    expect(s.id).toBeTruthy()
  })

  it('a run missed while the server was off happens once, not once per missed time', async () => {
    createSchedule({ when: 'every 10 minutes', action: 'x' }, ctx)
    t += 5 * 60 * MIN // five hours off
    const d = deps()
    await schedulerTick(d, ctx)
    await schedulerTick(d, ctx)
    expect(d.log).toHaveLength(1)
  })

  it('does not run what is not due, or what is paused', async () => {
    createSchedule({ when: 'every 1 hours', action: 'later' }, ctx)
    const paused = createSchedule({ when: 'every 5 minutes', action: 'paused' }, ctx)
    updateSchedule(paused.id, { enabled: false }, ctx)
    t += 6 * MIN
    expect(await schedulerTick(deps(), ctx)).toEqual([])
  })

  it('due ones run one after another, longest overdue first', async () => {
    createSchedule({ when: 'every 20 minutes', action: 'second' }, ctx)
    createSchedule({ when: 'every 10 minutes', action: 'first' }, ctx)
    t += 25 * MIN
    const d = deps()
    await schedulerTick(d, ctx)
    expect(d.log).toEqual(['chat:first', 'chat:second'])
  })

  it('a failure is recorded, not thrown, and repeated failures pause it', async () => {
    const s = createSchedule({ when: 'every 5 minutes', action: 'broken' }, ctx)
    const failing = deps({ chat: async () => { throw new Error('brain down') } })
    for (let i = 1; i <= MAX_FAILURES; i++) {
      t += 6 * MIN
      const r = await runSchedule(s.id, failing, ctx)
      expect(r.history.at(-1)).toMatchObject({ ok: false })
      expect(r.history.at(-1)!.result).toMatch(/Failed: brain down/)
      expect(r.failures).toBe(i)
    }
    expect(loadSchedules(ctx.file)[0].enabled).toBe(false)
  })

  it('one success clears the failure count', async () => {
    const s = createSchedule({ when: 'every 5 minutes', action: 'flaky' }, ctx)
    await runSchedule(s.id, deps({ chat: async () => { throw new Error('x') } }), ctx)
    expect((await runSchedule(s.id, deps(), ctx)).failures).toBe(0)
  })

  it('will not run the same one twice at once', async () => {
    const s = createSchedule({ when: 'every 5 minutes', action: 'slow' }, ctx)
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const first = runSchedule(s.id, deps({ chat: async () => { await gate; return 'ok' } }), ctx)
    await expect(runSchedule(s.id, deps(), ctx)).rejects.toThrow(/already running/)
    release()
    await first
  })

  it('keeps a bounded history', async () => {
    const s = createSchedule({ when: 'every 5 minutes', action: 'x' }, ctx)
    for (let i = 0; i < 15; i++) { t += 6 * MIN; await runSchedule(s.id, deps(), ctx) }
    expect(loadSchedules(ctx.file)[0].history).toHaveLength(10)
  })

  it('survives a restart: what is saved is what resumes', async () => {
    createSchedule({ when: 'every 10 minutes', action: 'x' }, ctx)
    t += 11 * MIN
    expect(dueSchedules(ctx)).toHaveLength(1)
  })

  it('the clock can be started and stopped', () => {
    const stop = startScheduler({ deps: async () => deps(), ctx })
    expect(typeof stop).toBe('function')
    stop()
  })
})
