/**
 * The graphical half of the access layer.
 *
 * Three kinds of ground are covered, and the header of each block says which:
 *   - machines with NO display, where the right behaviour is to refuse and say
 *     why -- a desktop layer that silently no-ops there is worse than one that
 *     refuses, because the agent will happily report success at doing nothing;
 *   - a REAL X server (Xvfb, used only as the other end of the wire; the block
 *     skips if it is absent), through DesktopControl itself, so the permission
 *     gate, the ownership rule and the X11 client are proved together;
 *   - a PHONE, against a stand-in for the app's HTTP bridge. That proves this
 *     side of the protocol; whether the Android/iOS apps implement their side
 *     correctly is not something these tests can say.
 *
 * Not covered anywhere: a window manager, and a live desktop portal.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  DesktopControl,
  DesktopError,
  NoDisplay,
  DisplayUnreachable,
  Unsupported,
  AGENT_WINDOW_MARKER,
} from '../../models && skills/core/desktop-control.js'
import { selectBackend } from '../../models && skills/core/desktop/backends.js'
import { X11 } from '../../models && skills/core/desktop/x11.js'
import { pngSize } from '../../models && skills/core/desktop/png.js'
import { AccessManager, AccessDenied, defaultGrants, type AccessGrant } from '../../models && skills/core/access-manager.js'

const ENV_KEYS = ['DISPLAY', 'WAYLAND_DISPLAY', 'NEUROCLAW_PHONE_BRIDGE_URL', 'NEUROCLAW_PHONE_BRIDGE_TOKEN'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const driving: AccessGrant[] = [
  ...defaultGrants(),
  { capability: 'keyboard.control', level: 'interact' },
  { capability: 'mouse.control', level: 'interact' },
  { capability: 'window.manage', level: 'interact' },
  { capability: 'app.launch', level: 'execute' },
]

describe('probing with no display', () => {
  it('says there is no desktop rather than reporting a usable one', async () => {
    const probe = await new DesktopControl(new AccessManager(defaultGrants())).probe()
    expect(probe.usable).toBe(false)
    expect(probe.backend).toBe('none')
    expect(probe.summary).toMatch(/No graphical session/)
    expect(probe.display).toBeNull()
  })

  it('never throws, because reporting is the whole point of it', async () => {
    process.env.DISPLAY = ':98' // nothing is listening there
    const probe = await new DesktopControl(new AccessManager()).probe()
    expect(probe.usable).toBe(false)
    expect(probe.backend).toBe('x11')
    expect(probe.summary).toMatch(/Could not connect/)
  })

  it('reports every capability as a boolean, so none is hidden', async () => {
    const probe = await new DesktopControl(new AccessManager(defaultGrants())).probe()
    expect(Object.keys(probe.capabilities).sort()).toEqual(
      ['keyboard', 'launch', 'moveResize', 'pointer', 'screenshot', 'settings', 'windows'],
    )
    for (const can of Object.values(probe.capabilities)) expect(typeof can).toBe('boolean')
  })
})

describe('refusing, and saying why', () => {
  it('checks the permission before it checks the machine', async () => {
    // Order matters: an ungranted caller must be told it is ungranted, not
    // handed a connection error that suggests fixing the display would help.
    const control = new DesktopControl(new AccessManager())
    await expect(control.listWindows()).rejects.toThrow(AccessDenied)
    await expect(control.screenshot()).rejects.toThrow(AccessDenied)
  })

  it('reports no display as its own kind of problem', async () => {
    const control = new DesktopControl(new AccessManager(defaultGrants()))
    await expect(control.listWindows()).rejects.toThrow(NoDisplay)
    await expect(control.screenshot()).rejects.toThrow(NoDisplay)
  })

  it('tells an unreachable display apart from a missing one', async () => {
    process.env.DISPLAY = ':98'
    const control = new DesktopControl(new AccessManager(defaultGrants()))
    const err = await control.listWindows().catch(e => e)
    expect(err).toBeInstanceOf(DisplayUnreachable)
    expect(err).not.toBeInstanceOf(NoDisplay)
    expect(err.message).toContain(':98')
  })

  it('refuses input synthesis that nobody granted, even with a display present', async () => {
    process.env.DISPLAY = ':98'
    // defaultGrants deliberately withholds mouse and keyboard control.
    const control = new DesktopControl(new AccessManager(defaultGrants()))
    await expect(control.typeInto('0x01', 'hello')).rejects.toThrow(AccessDenied)
    await expect(control.clickIn('0x01', 5, 5)).rejects.toThrow(AccessDenied)
  })

  it('has no method for controlling a window it does not own', () => {
    // The user/agent boundary as an absence: every mutating method is
    // ownership-checked, and there is no "force" variant of any of them.
    const names = Object.getOwnPropertyNames(DesktopControl.prototype)
    expect(names.some(n => /force|any|user/i.test(n))).toBe(false)
    expect(names).toContain('listWindows')
  })
})

describe('choosing where to run', () => {
  const pick = (env: NodeJS.ProcessEnv, platform = 'linux') => selectBackend(env, platform).kind

  it('maps each environment to the backend that can actually serve it', () => {
    expect(pick({})).toBe('none')
    expect(pick({ DISPLAY: ':0' })).toBe('x11')
    expect(pick({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' })).toBe('wayland')
    expect(pick({ WAYLAND_DISPLAY: 'wayland-0' })).toBe('wayland')
    expect(pick({ NEUROCLAW_PHONE_BRIDGE_URL: 'http://phone.local:7862' })).toBe('phone')
    expect(pick({}, 'android')).toBe('phone') // Node running on the phone itself
  })

  it('does not pretend to support Windows or macOS', async () => {
    for (const platform of ['win32', 'darwin']) {
      const backend = selectBackend({ DISPLAY: ':0' }, platform)
      expect(backend.kind).toBe('unsupported')
      expect((await backend.describe()).reachable).toBe(false)
      await expect(backend.listWindows()).rejects.toBeInstanceOf(Unsupported)
    }
  })

  it('says Wayland cannot list or drive windows when there is no XWayland', async () => {
    process.env.WAYLAND_DISPLAY = 'wayland-0'
    const control = new DesktopControl(new AccessManager(defaultGrants()))
    const err = await control.listWindows().catch(e => e)
    expect(err).toBeInstanceOf(Unsupported)
    expect(err.message).toMatch(/Wayland/)
  })
})

describe('marking the agent’s own windows', () => {
  it('uses a marker distinct enough not to collide with a user window title', () => {
    expect(AGENT_WINDOW_MARKER).toMatch(/^CORONA_/)
    expect(AGENT_WINDOW_MARKER).not.toMatch(/\s/)
  })
})

// ── a real X server ───────────────────────────────────────────────────────

const haveXvfb = spawnSync('sh', ['-c', 'command -v Xvfb']).status === 0
const NUM = 140 + (process.pid % 50)
let xvfb: ChildProcess | null = null

beforeAll(async () => {
  if (!haveXvfb) return
  xvfb = spawn('Xvfb', [`:${NUM}`, '-screen', '0', '800x600x24', '-nolisten', 'tcp', '-noreset'], { stdio: 'ignore' })
  for (let i = 0; i < 100 && !existsSync(`/tmp/.X11-unix/X${NUM}`); i++) await new Promise(r => setTimeout(r, 50))
  for (let i = 0; i < 40; i++) {
    try { (await X11.connect(`:${NUM}`)).close(); break } catch { await new Promise(r => setTimeout(r, 50)) }
  }
})
afterAll(() => { xvfb?.kill() })

;(haveXvfb ? describe : describe.skip)('DesktopControl against a real X server', () => {
  /** A window the agent "owns" (marked) and one that is the user's, both kept alive by this connection. */
  async function withWindows(fn: (x: X11, agent: string, user: string, control: DesktopControl) => Promise<void>) {
    process.env.DISPLAY = `:${NUM}`
    await X11.with(async x => {
      const a = await x.createWindow({ title: `${AGENT_WINDOW_MARKER} work`, x: 100, y: 100, width: 200, height: 120, events: true })
      const u = await x.createWindow({ title: 'someone’s editor', x: 400, y: 100, width: 200, height: 120, events: true })
      const id = (n: number) => `0x${n.toString(16).padStart(8, '0')}`
      await fn(x, id(a), id(u), new DesktopControl(new AccessManager(driving)))
    }, `:${NUM}`)
  }

  it('probes as ready and says what it can do', async () => {
    process.env.DISPLAY = `:${NUM}`
    const probe = await new DesktopControl(new AccessManager(driving)).probe()
    expect(probe).toMatchObject({ backend: 'x11', usable: true })
    expect(probe.capabilities).toMatchObject({ windows: true, screenshot: true, keyboard: true, pointer: true })
  })

  it('lists the user’s windows as observe-only and the marked one as the agent’s', async () => {
    await withWindows(async (_x, agent, user, control) => {
      const all = await control.listWindows()
      expect(all.find(w => w.id === agent)).toMatchObject({ agentOwned: true })
      expect(all.find(w => w.id === user)).toMatchObject({ agentOwned: false, title: 'someone’s editor' })
    })
  })

  it('takes a real screenshot', async () => {
    await withWindows(async (_x, _a, _u, control) => {
      expect(pngSize(await control.screenshot())).toEqual({ width: 800, height: 600 })
    })
  })

  it('types into the agent’s window and the keys arrive there', async () => {
    await withWindows(async (x, agent, _u, control) => {
      const downs: number[] = []
      x.onEvent = ev => { if (ev[0] === 2) downs.push(ev[1]) }
      await control.typeInto(agent, 'ok')
      await new Promise(r => setTimeout(r, 100))
      expect(downs).toHaveLength(2)
    })
  })

  it('will not type into, click, move or close the user’s window — and sends nothing to it', async () => {
    await withWindows(async (x, _a, user, control) => {
      const events: number[] = []
      x.onEvent = ev => { if (ev[0] === 2 || ev[0] === 4) events.push(ev[0]) }
      for (const act of [
        () => control.typeInto(user, 'secret'),
        () => control.clickIn(user, 5, 5),
        () => control.moveWindow(user, 0, 0, 10, 10),
        () => control.closeWindow(user),
      ]) {
        await expect(act()).rejects.toThrow(/belongs to the user/)
      }
      await new Promise(r => setTimeout(r, 100))
      expect(events).toEqual([])
    })
  })

  it('clicks inside the agent’s window and refuses a click outside it', async () => {
    await withWindows(async (x, agent, _u, control) => {
      const clicks: Array<[number, number]> = []
      x.onEvent = ev => { if (ev[0] === 4) clicks.push([ev.readInt16LE(24), ev.readInt16LE(26)]) }
      await control.clickIn(agent, 30, 40)
      await new Promise(r => setTimeout(r, 100))
      expect(clicks).toEqual([[30, 40]])
      await expect(control.clickIn(agent, 500, 5)).rejects.toThrow(/outside window/)
    })
  })

  it('resizes the agent’s window', async () => {
    await withWindows(async (x, agent, _u, control) => {
      await control.moveWindow(agent, 20, 30, 150, 90)
      expect(await x.geometry(parseInt(agent, 16))).toEqual({ x: 20, y: 30, width: 150, height: 90 })
    })
  })

  it('reports an unknown window id', async () => {
    await withWindows(async (_x, _a, _u, control) => {
      await expect(control.typeInto('0x0badf00d', 'x')).rejects.toThrow(/No window with id/)
    })
  })

  it('launches a real program and rejects one that does not exist', async () => {
    process.env.DISPLAY = `:${NUM}`
    const control = new DesktopControl(new AccessManager(driving))
    const ok = await control.launchAgentWindow('true')
    expect(ok.pid).toBeGreaterThan(0)
    expect(ok.marked).toBe(false) // not a terminal, so it cannot be marked and stays the user's
    await expect(control.launchAgentWindow('definitely-not-a-real-program-xyz')).rejects.toBeInstanceOf(DesktopError)
  })
})

// ── a phone, via a stand-in for the app's bridge ──────────────────────────

describe('DesktopControl against a phone bridge', () => {
  let server: http.Server
  let url = ''
  const seen: string[] = []
  let features: Record<string, boolean> = { windows: true, screenshot: true, keyboard: true, pointer: false, launch: true }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.headers.authorization !== 'Bearer s3cret') return json(401, { error: 'bad token' })
      let body = ''
      req.on('data', c => (body += c))
      req.on('end', () => {
        seen.push(`${req.method} ${req.url} ${body}`)
        switch (`${req.method} ${req.url}`) {
          case 'GET /v1/info': return json(200, { platform: 'android', features, notes: ['Android: only NeuroClaw’s own windows can be driven.'] })
          case 'GET /v1/windows': return json(200, [
            { id: 'w1', title: 'NeuroClaw', owned: true },
            { id: 'w2', title: 'Messages', owned: false },
          ])
          case 'GET /v1/screenshot': {
            res.writeHead(200, { 'content-type': 'image/png' })
            return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
          }
          case 'POST /v1/type': return json(200, {})
          case 'POST /v1/close': return json(200, {})
          case 'POST /v1/launch': return json(200, {})
          case 'POST /v1/click': return json(501, { error: 'Android does not let an app tap on itself without an accessibility grant.' })
          default: return json(404, { error: 'no such endpoint' })
        }
      })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => { server.close() })

  const phone = (token = 's3cret') => {
    process.env.NEUROCLAW_PHONE_BRIDGE_URL = url
    process.env.NEUROCLAW_PHONE_BRIDGE_TOKEN = token
    seen.length = 0
    return new DesktopControl(new AccessManager(driving))
  }

  it('probes as a phone and reports only what the app says it can do', async () => {
    const probe = await phone().probe()
    expect(probe).toMatchObject({ backend: 'phone', platform: 'android', usable: true, display: null, wayland: false })
    expect(probe.capabilities).toMatchObject({ windows: true, keyboard: true, pointer: false, moveResize: false })
    expect(probe.summary).toContain('only NeuroClaw’s own windows')
  })

  it('takes the app’s word for which windows are the agent’s', async () => {
    const all = await phone().listWindows()
    expect(all.map(w => [w.id, w.agentOwned])).toEqual([['w1', true], ['w2', false]])
  })

  it('types into its own window and never sends anything for another app’s', async () => {
    const control = phone()
    await control.typeInto('w1', 'hello')
    expect(seen.at(-1)).toContain('POST /v1/type')
    expect(seen.at(-1)).toContain('"windowId":"w1"')
    seen.length = 0
    await expect(control.typeInto('w2', 'hello')).rejects.toThrow(/belongs to the user/)
    expect(seen.some(s => s.startsWith('POST'))).toBe(false)
  })

  it('returns real screenshot bytes', async () => {
    const png = await phone().screenshot()
    expect([...png]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('reports what the phone’s OS refuses as Unsupported, with its reason', async () => {
    const err = await phone().clickIn('w1', 5, 5).catch(e => e)
    expect(err).toBeInstanceOf(Unsupported)
    expect(err.message).toMatch(/accessibility/)
  })

  it('does not offer moving a phone window', async () => {
    await expect(phone().moveWindow('w1', 0, 0, 10, 10)).rejects.toBeInstanceOf(Unsupported)
  })

  it('launches through the app rather than spawning a process', async () => {
    const control = phone()
    const res = await control.launchAgentWindow('com.android.camera')
    expect(res).toEqual({ pid: 0, marked: false })
    expect(seen.at(-1)).toContain('POST /v1/launch')
  })

  it('says when the bridge token is wrong', async () => {
    await expect(phone('wrong').listWindows()).rejects.toThrow(/refused the bridge token/)
  })

  it('says when the phone cannot be reached', async () => {
    process.env.NEUROCLAW_PHONE_BRIDGE_URL = 'http://127.0.0.1:1'
    const control = new DesktopControl(new AccessManager(driving))
    await expect(control.listWindows()).rejects.toBeInstanceOf(DisplayUnreachable)
    const probe = await control.probe()
    expect(probe.usable).toBe(false)
    expect(probe.summary).toMatch(/Could not reach the NeuroClaw phone app/)
  })
})
