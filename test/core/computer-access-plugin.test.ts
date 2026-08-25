/**
 * The computer-access plug-in: the reachable surface over the GNOME and
 * terminal/file layers.
 *
 * The two things worth testing hardest are the two that would be silent
 * failures. First, that flipping a switch actually stops the workspace doing
 * work -- not just that a settings screen renders differently. Second, that
 * the agent cannot turn its own access back on, which is the whole reason the
 * off switch means anything.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ComputerAccessPlugin } from '../../plugins/computer-access.js'
import { AccessDenied } from '../../models && skills/core/access-manager.js'
import { resetSharedAccessManager } from '../../models && skills/core/access-settings.js'

let dir: string
let plugin: ComputerAccessPlugin

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'corona-plugin-'))
  process.env.CORONA_ACCESS_FILE = path.join(dir, 'access.json')
  resetSharedAccessManager()
  plugin = new ComputerAccessPlugin({
    id: 'computer-access',
    name: 'Computer Access',
    type: 'api-connection',
    capabilities: ['desktop-control'],
  } as never)
})

afterEach(() => {
  delete process.env.CORONA_ACCESS_FILE
  resetSharedAccessManager()
  rmSync(dir, { recursive: true, force: true })
})

describe('reaching the access layers at all', () => {
  it('hands out a workspace that works while the switch is on', async () => {
    const ws = plugin.workspace()
    ws.openTerminal('t')
    expect((await ws.run('t', 'echo', ['reachable'])).stdout.trim()).toBe('reachable')
    ws.dispose()
  })

  it('reports what the desktop can actually do rather than pretending', async () => {
    const probe = await plugin.probe()
    // On a machine with no display this must say so, not claim success.
    expect(typeof probe.summary).toBe('string')
    expect(probe.usable).toBe(Boolean(probe.display || probe.wayland) && probe.tools.wmctrl)
  })
})

describe('the off switch, from the agent side', () => {
  it('stops the workspace running commands once it is off', async () => {
    const ws = plugin.workspace()
    ws.openTerminal('t')
    plugin.turnOff('workspace')
    await expect(ws.run('t', 'echo', ['nope'])).rejects.toThrow(AccessDenied)
    ws.dispose()
  })

  it('stops the desktop layer once it is off', async () => {
    plugin.turnOff('desktop')
    await expect(plugin.desktop().listWindows()).rejects.toThrow(AccessDenied)
  })

  it('turns everything off from one sentence', async () => {
    const out = (await plugin.onMessage('turn off computer access')) as { result: string }
    expect(out.result).toMatch(/All computer access is now off/)
    expect(plugin.access().switches.find(s => s.name === 'all')!.on).toBe(false)
  })

  it('turns off just the desktop half when that is what was asked', async () => {
    await plugin.onMessage('turn off gnome access')
    const switches = plugin.access().switches
    expect(switches.find(s => s.name === 'desktop')!.on).toBe(false)
    expect(switches.find(s => s.name === 'workspace')!.on).toBe(true)
  })

  it('turns off just the terminal and file half when that is what was asked', async () => {
    await plugin.onMessage('turn off terminal access')
    const switches = plugin.access().switches
    expect(switches.find(s => s.name === 'workspace')!.on).toBe(false)
    expect(switches.find(s => s.name === 'desktop')!.on).toBe(true)
  })

  it('refuses to turn access back on, and says where the switch is', async () => {
    plugin.turnOff('all')
    const out = (await plugin.onMessage('turn on computer access')) as { result: string }
    expect(out.result).toMatch(/not back on/i)
    expect(out.result).toMatch(/Access page/)
    // The important half: it did not actually do it.
    expect(plugin.access().switches.find(s => s.name === 'all')!.on).toBe(false)
  })

  it('has no method that turns anything on', () => {
    const names = Object.getOwnPropertyNames(ComputerAccessPlugin.prototype)
    expect(names).toContain('turnOff')
    expect(names.some(n => /turnOn|enable|grant/i.test(n))).toBe(false)
  })
})

describe('dispatch', () => {
  it('answers a status question', async () => {
    const out = (await plugin.onMessage('computer access')) as { result: string }
    expect(out.result).toMatch(/All computer access: on/)
    expect(out.result).toMatch(/In effect:/)
  })

  it('stays out of the way of messages that are not about access', async () => {
    for (const text of ['what is the capital of France', 'calculate 17 * 23', 'store', '']) {
      expect(await plugin.onMessage(text)).toBeNull()
    }
  })
})
