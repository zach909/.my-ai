/**
 * The chat front door to the scheduler: strict about what counts as a
 * schedule command, so ordinary chat that mentions the word falls through.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SchedulePlugin } from '../../plugins/schedule.js'
import { loadSchedules } from '../../models && skills/core/scheduler.js'
import { createPluginInstance, pluginExtensions } from '../../plugins/index.js'

let dir: string
const saved = process.env.CORONA_SCHEDULE_FILE
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'schedule-plugin-')); process.env.CORONA_SCHEDULE_FILE = path.join(dir, 's.json') })
afterEach(() => { if (saved === undefined) delete process.env.CORONA_SCHEDULE_FILE; else process.env.CORONA_SCHEDULE_FILE = saved; rmSync(dir, { recursive: true, force: true }) })

const plugin = () => new SchedulePlugin({ id: 'schedule', name: 'Schedule', type: 'api-connection', capabilities: ['schedule'] } as never)
const say = async (m: string) => ((await plugin().onMessage(m)) as { result: string } | null)

describe('SchedulePlugin', () => {
  it('ignores a message that does not start with the command, so chat falls through', async () => {
    expect(await say('what is on my schedule today?')).toBeNull()
    expect(await say('please schedule a meeting')).toBeNull()
    expect(await say('')).toBeNull()
  })

  it('schedules from a sentence, reading a time that has colons in it', async () => {
    const r = await say('schedule daily at 9:30: check my email and tell me what is urgent')
    expect(r!.result).toMatch(/^Scheduled [a-f0-9]{8}: "check my email/)
    expect(r!.result).toContain('daily at 09:30')
    expect(loadSchedules()[0]).toMatchObject({ when: { type: 'daily', hour: 9, minute: 30 }, action: { kind: 'chat' } })
  })

  it('lists and cancels', async () => {
    await say('schedule every 2 hours: organize')
    const list = await say('schedule list')
    expect(list!.result).toMatch(/every 2 hours.*File chats/)
    const id = loadSchedules()[0].id
    expect((await say(`schedule cancel ${id}`))!.result).toBe(`Cancelled ${id}.`)
    expect((await say(`schedule cancel ${id}`))!.result).toMatch(/no schedule/)
    expect((await say('schedule list'))!.result).toBe('Nothing is scheduled.')
  })

  it('says what is wrong instead of failing, and shows usage', async () => {
    expect((await say('schedule whenever: do it'))!.result).toMatch(/could not read/)
    expect((await say('schedule every 1 minutes: x'))!.result).toMatch(/more often/)
    expect((await say('schedule'))!.result).toContain('schedule <when>: <action>')
    expect((await say('schedule gibberish'))!.result).toContain('Schedule commands')
  })

  it('is registered, so the agent can reach it', () => {
    expect(pluginExtensions.schedule).toMatchObject({ id: 'schedule' })
    expect(createPluginInstance('schedule', pluginExtensions.schedule)).toBeInstanceOf(SchedulePlugin)
  })
})
