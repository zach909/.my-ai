/**
 * Risky tools ask first. A held call is not run, approving runs it once,
 * and "complete access" turns the asking off, behind a typed phrase.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  RISKY_TOOLS, ToolGate, loadSafety, saveSafety, defaultSafety, needsApproval, describeTools, setAsk, setAutoContinue,
  enableCompleteAccess, disableCompleteAccess, SafetyError, COMPLETE_ACCESS_PHRASE, HOLD_SCORE, APPROVAL_TTL_MS, MAX_APPROVALS,
  normalizeToolId, type SafetySettings,
} from '../../models && skills/core/tool-safety.js'
import { AccessManager, CAPABILITIES } from '../../models && skills/core/access-manager.js'
import { PluginRegistry } from '../../plugin_manager/registry.js'
import { BasePlugin } from '../../plugin_manager/sdk.js'
import { parseContinue, chainSteps } from '../../models && skills/core/auto-continue.js'

let dir: string
let file: string
let t = 1_000_000
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'tool-safety-'))
  file = path.join(dir, 'tool-safety.json')
  t = 1_000_000
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const gate = (s: SafetySettings = defaultSafety()) => new ToolGate({ settings: () => s, now: () => t })

describe('the list', () => {
  it('covers the tools that act on your machine, speak for you, or look at you', () => {
    const ids = RISKY_TOOLS.map(r => r.id)
    for (const id of ['terminal', 'file-system', 'email', 'messaging', 'phone-calls', 'camera', 'microphone', 'desktop', 'linux-permission-tools', 'passkeys']) expect(ids).toContain(id)
    expect(RISKY_TOOLS.every(r => r.why.length > 10)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every risky tool asks by default, and describeTools says so', () => {
    expect(describeTools(defaultSafety()).every(x => x.ask)).toBe(true)
  })

  it('a tool you have not listed does not ask', () => {
    expect(needsApproval('wiki', defaultSafety())).toBe(false)
    expect(needsApproval('research', defaultSafety())).toBe(false)
  })

  it('spells tool names the way the registry does', () => {
    expect(normalizeToolId('Phone Calls')).toBe('phone-calls')
    expect(needsApproval('Phone Calls', defaultSafety())).toBe(true)
  })

  it('you can stop one tool asking without touching the rest', () => {
    saveSafety(defaultSafety(), file)
    const s = setAsk('email', false, file)
    expect(needsApproval('email', s)).toBe(false)
    expect(needsApproval('terminal', s)).toBe(true)
    expect(() => setAsk('not-a-tool', false, file)).toThrow(SafetyError)
    expect(needsApproval('email', loadSafety(file))).toBe(false)
  })

  it('an unreadable settings file means everything asks, never nothing', () => {
    expect(loadSafety(path.join(dir, 'missing.json'))).toEqual(defaultSafety())
    saveSafety({ ...defaultSafety(), fullAccess: true }, file)
    expect(loadSafety(file).fullAccess).toBe(true)
    require('node:fs').writeFileSync(file, '{ no')
    expect(loadSafety(file).fullAccess).toBe(false)
  })
})

describe('the gate', () => {
  it('holds a risky tool that the message clearly points at, and says nothing was done', () => {
    const g = gate()
    const d = g.check('terminal', 'terminal run rm -rf /tmp/x', 100)
    expect(d.allow).toBe(false)
    if (d.allow === false) {
      expect(d.message).toContain('Waiting for your permission')
      expect(d.message).toContain('Nothing has been done')
      expect(g.pending()).toHaveLength(1)
      expect(g.pending()[0]).toMatchObject({ toolId: 'terminal', status: 'pending', request: 'terminal run rm -rf /tmp/x' })
    }
  })

  it('lets a tool through that the message only vaguely resembles, so ordinary chat does not ask', () => {
    expect(gate().check('email', 'how are you today', HOLD_SCORE - 1)).toEqual({ allow: true })
    expect(gate().check('wiki', 'wiki list', 100)).toEqual({ allow: true })
  })

  it('asking twice for the same thing is one question', () => {
    const g = gate()
    g.check('email', 'email bob: hi', 100)
    g.check('email', 'email bob: hi', 100)
    g.check('email', 'email bob: bye', 100)
    expect(g.pending()).toHaveLength(2)
  })

  it('complete access asks nothing', () => {
    expect(gate({ ...defaultSafety(), fullAccess: true }).check('terminal', 'terminal run x', 100)).toEqual({ allow: true })
  })

  it('approving runs the call once, with what was asked, and keeps what came back', async () => {
    const g = gate()
    g.check('email', 'email bob: hi', 100)
    const id = g.pending()[0].id
    const ran: Array<[string, string]> = []
    const a = await g.decide(id, true, async (tool, req) => { ran.push([tool, req]); return 'sent' })
    expect(a).toMatchObject({ status: 'approved', result: 'sent' })
    expect(ran).toEqual([['email', 'email bob: hi']])
    await expect(g.decide(id, true, async () => 'again')).rejects.toThrow(/already approved/)
    expect(ran).toHaveLength(1) // a double click cannot run it twice
  })

  it('denying runs nothing', async () => {
    const g = gate()
    g.check('email', 'email bob: hi', 100)
    const ran: string[] = []
    const a = await g.decide(g.pending()[0].id, false, async t => { ran.push(t); return 'x' })
    expect(a.status).toBe('denied')
    expect(ran).toEqual([])
    expect(g.pending()).toEqual([])
  })

  it('a tool that fails or has nothing to do when approved is reported, not thrown', async () => {
    const g = gate()
    g.check('email', 'a', 100); g.check('email', 'b', 100)
    const [b, a] = g.pending().map(x => x.id)
    expect((await g.decide(a, true, async () => { throw new Error('smtp down') })).result).toMatch(/It failed: smtp down/)
    expect((await g.decide(b, true, async () => null)).result).toMatch(/did not need to do anything/)
  })

  it('an unknown request is a 404, and an old one expires', async () => {
    const g = gate()
    await expect(g.decide('nope', true, async () => 'x')).rejects.toMatchObject({ status: 404 })
    g.check('email', 'old', 100)
    t += APPROVAL_TTL_MS + 1
    expect(g.pending()).toEqual([])
    await expect(g.decide(g.list()[0].id, true, async () => 'x')).rejects.toThrow(/expired/)
  })

  it('keeps the queue bounded', () => {
    const g = gate()
    for (let i = 0; i < MAX_APPROVALS + 20; i++) g.check('email', `email ${i}`, 100)
    expect(g.list().length).toBeLessThanOrEqual(MAX_APPROVALS)
  })
})

describe('in the real plugin registry', () => {
  class Spy extends BasePlugin {
    calls: string[] = []
    describeCapabilities() { return { commands: ['wipe'], verbs: ['wipe'], nouns: ['disk'] } }
    override async onMessage(m: unknown) { this.calls.push(String(m)); return `ran: ${m}` }
  }
  async function setup(id: string, s: SafetySettings = defaultSafety()) {
    const reg = new PluginRegistry()
    const spy = new Spy({ id, name: id, type: 'api-connection', capabilities: [id] } as never)
    reg.register({ id, name: id, type: 'api-connection', capabilities: [id] } as never, spy)
    await reg.activate(id)
    const g = new ToolGate({ settings: () => s, now: () => t })
    reg.setGate(g)
    return { reg, spy, g }
  }

  it('a risky tool is never called: the message is held for permission instead', async () => {
    const { reg, spy, g } = await setup('terminal')
    const out = await reg.dispatch('wipe the disk', 'command')
    expect(out).toContain('Waiting for your permission')
    expect(spy.calls).toEqual([]) // it never saw the message
    expect(g.pending()).toHaveLength(1)
  })

  it('approving runs it once, through the registry', async () => {
    const { reg, spy, g } = await setup('terminal')
    await reg.dispatch('wipe the disk', 'command')
    const a = await g.decide(g.pending()[0].id, true, (tool, req) => reg.runApproved(tool, req))
    expect(a.result).toBe('ran: wipe the disk')
    expect(spy.calls).toEqual(['wipe the disk'])
  })

  it('a tool that is not on the list just runs', async () => {
    const { reg, spy } = await setup('research')
    expect(await reg.dispatch('wipe the disk', 'command')).toBe('ran: wipe the disk')
    expect(spy.calls).toHaveLength(1)
  })

  it('with complete access the risky tool just runs, no questions', async () => {
    const { reg, spy } = await setup('terminal', { ...defaultSafety(), fullAccess: true })
    expect(await reg.dispatch('wipe the disk', 'command')).toBe('ran: wipe the disk')
    expect(spy.calls).toHaveLength(1)
  })

  it('runApproved does nothing for a tool that is not active', async () => {
    const { reg } = await setup('terminal')
    expect(await reg.runApproved('missing', 'x')).toBeNull()
  })
})

describe('complete access', () => {
  const fresh = () => new AccessManager()

  it('needs the exact phrase, typed', () => {
    const m = fresh()
    expect(() => enableCompleteAccess(m, 'yes', file, path.join(dir, 'access.json'))).toThrow(/type exactly/)
    expect(() => enableCompleteAccess(m, undefined, file, path.join(dir, 'access.json'))).toThrow(SafetyError)
    expect(loadSafety(file).fullAccess).toBe(false)
  })

  it('turns the questions off and grants every capability at the top level', () => {
    const m = fresh()
    const s = enableCompleteAccess(m, `  ${COMPLETE_ACCESS_PHRASE.toUpperCase()} `, file, path.join(dir, 'access.json'))
    expect(s.fullAccess).toBe(true)
    expect(loadSafety(file).fullAccess).toBe(true)
    expect(CAPABILITIES.every(c => m.granted(c) === 'privileged' && m.allows(c))).toBe(true)
  })

  it('turning it off puts the questions and the default access back', () => {
    const m = fresh()
    enableCompleteAccess(m, COMPLETE_ACCESS_PHRASE, file, path.join(dir, 'access.json'))
    const s = disableCompleteAccess(m, file, path.join(dir, 'access.json'))
    expect(s.fullAccess).toBe(false)
    expect(needsApproval('terminal', s)).toBe(true)
    expect(m.granted('files.delete')).toBeNull()
    expect(m.allows('mods.apply')).toBe(false)
  })
})

describe('the agent decides whether to keep going', () => {
  it('only a clear CONTINUE continues; everything else stops', () => {
    expect(parseContinue('CONTINUE: more to do')).toBe('continue')
    expect(parseContinue('"Keep going"')).toBe('continue')
    expect(parseContinue('STOP')).toBe('stop')
    expect(parseContinue('')).toBe('stop')
    expect(parseContinue('I think we could continue')).toBe('stop')
    expect(parseContinue('¿¿ ???')).toBe('stop')
  })

  const run = (replies: string[], opts = { enabled: true, maxSteps: 5 }, progress: boolean[] = []) => {
    let i = 0
    return chainSteps(async n => ({ n, progressed: progress[n - 1] ?? true }), async () => replies[i++] ?? 'STOP', opts)
  }

  it('keeps going while it says CONTINUE, and stops when it says STOP', async () => {
    const r = await run(['CONTINUE', 'CONTINUE', 'STOP'])
    expect(r.steps.map(s => s.n)).toEqual([1, 2, 3])
    expect(r.ended).toBe('chose-to-stop')
  })

  it('never goes past the cap, however keen it is', async () => {
    const r = await run(Array(20).fill('CONTINUE'), { enabled: true, maxSteps: 3 })
    expect(r.steps).toHaveLength(3)
    expect(r.ended).toBe('step-limit')
    expect((await run(Array(99).fill('CONTINUE'), { enabled: true, maxSteps: 999 })).steps.length).toBeLessThanOrEqual(10)
  })

  it('does one step when switched off, and does not even ask', async () => {
    let asked = 0
    const r = await chainSteps(async n => ({ n, progressed: true }), async () => { asked++; return 'CONTINUE' }, { enabled: false, maxSteps: 5 })
    expect(r.steps).toHaveLength(1)
    expect(r.ended).toBe('off')
    expect(asked).toBe(0)
  })

  it('does not build on a step that got nowhere', async () => {
    const r = await run(['CONTINUE', 'CONTINUE'], { enabled: true, maxSteps: 5 }, [true, false])
    expect(r.steps).toHaveLength(2)
    expect(r.ended).toBe('no-progress')
  })

  it('a muddled answer or a thrown one stops', async () => {
    expect((await run(['¿¿ ???'])).steps).toHaveLength(1)
    const r = await chainSteps(async n => ({ n, progressed: true }), async () => { throw new Error('mesh down') }, { enabled: true, maxSteps: 5 })
    expect(r.steps).toHaveLength(1)
  })

  it('its settings are bounded', () => {
    saveSafety(defaultSafety(), file)
    expect(setAutoContinue({ maxSteps: 7 }, file).autoContinue.maxSteps).toBe(7)
    expect(setAutoContinue({ enabled: false }, file).autoContinue.enabled).toBe(false)
    expect(() => setAutoContinue({ maxSteps: 11 }, file)).toThrow(SafetyError)
    expect(() => setAutoContinue({ maxSteps: 0 }, file)).toThrow(SafetyError)
  })
})
