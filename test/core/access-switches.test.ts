/**
 * The off switches.
 *
 * What is worth testing hardest here is that turning a switch off actually
 * refuses -- not that the UI shows it as off -- and that turning it back on
 * restores what was granted before rather than a guess at it. A kill switch
 * that loses your configuration is one nobody uses twice.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  AccessManager,
  AccessDenied,
  CAPABILITIES,
  CAPABILITY_SWITCH,
  defaultGrants,
} from '../../models && skills/core/access-manager.js'
import {
  loadSettings,
  saveSettings,
  loadAccessManager,
  describeAccess,
  defaultSettings,
} from '../../models && skills/core/access-settings.js'

const temps: string[] = []
function tempFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'corona-access-'))
  temps.push(dir)
  return path.join(dir, 'access.json')
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('the access switches', () => {
  it('starts with everything on, so the switches are not themselves a restriction', () => {
    expect(new AccessManager().switchState()).toEqual({ all: true, desktop: true, workspace: true })
  })

  it('refuses every capability when the master switch is off', () => {
    const access = new AccessManager(defaultGrants())
    expect(access.allows('files.read')).toBe(true)
    access.setSwitch('all', false)
    for (const capability of CAPABILITIES) expect(access.allows(capability)).toBe(false)
  })

  it('turns off one half without touching the other', () => {
    const access = new AccessManager(defaultGrants())
    access.setSwitch('desktop', false)
    expect(access.allows('screen.observe')).toBe(false)
    expect(access.allows('user.observe')).toBe(false)
    // The terminal/file half is untouched.
    expect(access.allows('terminal.execute')).toBe(true)
    expect(access.allows('files.read')).toBe(true)
  })

  it('turns off the terminal and file half without touching the desktop half', () => {
    const access = new AccessManager(defaultGrants())
    access.setSwitch('workspace', false)
    expect(access.allows('terminal.execute')).toBe(false)
    expect(access.allows('files.read')).toBe(false)
    expect(access.allows('screen.observe')).toBe(true)
  })

  it('keeps the grants, so turning it back on restores exactly what was there', () => {
    const access = new AccessManager([
      { capability: 'files.write', level: 'modify', paths: ['/home/me/work'] },
    ])
    access.setSwitch('all', false)
    expect(access.allows('files.write')).toBe(false)
    access.setSwitch('all', true)
    expect(access.allows('files.write')).toBe(true)
    expect(access.list()[0].paths).toEqual(['/home/me/work'])
  })

  it('says the switch is the reason, not the grant', () => {
    const access = new AccessManager(defaultGrants())
    access.setSwitch('workspace', false)
    try {
      access.require('terminal.execute')
      throw new Error('should have refused')
    } catch (e) {
      expect(e).toBeInstanceOf(AccessDenied)
      expect((e as AccessDenied).switchedOff).toBe('workspace')
      expect((e as Error).message).toMatch(/switch is off/)
    }
  })

  it('names the master switch when that is the one in the way', () => {
    const access = new AccessManager(defaultGrants())
    access.setSwitch('all', false)
    try {
      access.require('files.read')
      throw new Error('should have refused')
    } catch (e) {
      expect((e as AccessDenied).switchedOff).toBe('all')
      expect((e as Error).message).toMatch(/switched off/)
    }
  })

  it('still refuses a capability nobody granted, even with every switch on', () => {
    const access = new AccessManager(defaultGrants())
    expect(access.allows('mouse.control')).toBe(false)
    expect((() => { try { access.require('mouse.control') } catch (e) { return (e as AccessDenied).switchedOff } })()).toBeUndefined()
  })

  it('assigns every capability to exactly one switch', () => {
    for (const capability of CAPABILITIES) {
      expect(['desktop', 'workspace']).toContain(CAPABILITY_SWITCH[capability])
    }
  })

  it('confines a path grant the same way once a switch is flipped back on', () => {
    const access = new AccessManager([{ capability: 'files.read', level: 'observe', paths: ['/home/me/work'] }])
    access.setSwitch('workspace', false)
    expect(access.allowsPath('files.read', '/home/me/work/x')).toBe(true) // path check alone
    expect(access.allows('files.read')).toBe(false) // but the capability is off
    access.setSwitch('workspace', true)
    expect(access.allows('files.read')).toBe(true)
    expect(access.allowsPath('files.read', '/etc/passwd')).toBe(false)
  })
})

describe('remembering the switches', () => {
  it('writes the change to disk the moment it is flipped', () => {
    const file = tempFile()
    const access = loadAccessManager(file)
    expect(existsSync(file)).toBe(false)
    access.setSwitch('desktop', false)
    expect(JSON.parse(readFileSync(file, 'utf8')).switches.desktop).toBe(false)
  })

  it('comes back off after a restart — the whole point of persisting it', () => {
    const file = tempFile()
    loadAccessManager(file).setSwitch('all', false)
    const reloaded = loadAccessManager(file)
    expect(reloaded.switchState().all).toBe(false)
    expect(reloaded.allows('files.read')).toBe(false)
  })

  it('keeps the grants across a restart too', () => {
    const file = tempFile()
    saveSettings(
      { switches: { all: true, desktop: true, workspace: true }, grants: [{ capability: 'files.write', level: 'modify' }] },
      file,
    )
    expect(loadAccessManager(file).allows('files.write')).toBe(true)
  })

  it('falls back to defaults on an unreadable file rather than crashing at boot', () => {
    const file = tempFile()
    writeFileSync(file, '{ not json at all')
    expect(loadSettings(file)).toEqual(defaultSettings())
  })

  it('drops a grant naming a capability that no longer exists', () => {
    const file = tempFile()
    writeFileSync(
      file,
      JSON.stringify({ switches: {}, grants: [{ capability: 'ghost.capability', level: 'privileged' }] }),
    )
    expect(loadSettings(file).grants.some(g => (g.capability as string) === 'ghost.capability')).toBe(false)
  })

  it('skips a stored grant below its capability minimum instead of refusing to start', () => {
    const file = tempFile()
    saveSettings(
      {
        switches: { all: true, desktop: true, workspace: true },
        // "observe" is below what terminal.execute can be granted at.
        grants: [{ capability: 'terminal.execute', level: 'observe' }, { capability: 'files.read', level: 'observe' }],
      },
      file,
    )
    const access = loadAccessManager(file)
    expect(access.allows('terminal.execute')).toBe(false)
    expect(access.allows('files.read')).toBe(true)
  })
})

describe('describing access for a settings screen', () => {
  it('shows a capability as overridden by a switch rather than blaming the grant', () => {
    const access = new AccessManager(defaultGrants())
    access.setSwitch('workspace', false)
    const view = describeAccess(access)
    const terminal = view.capabilities.find(c => c.capability === 'terminal.execute')!
    expect(terminal.level).toBe('execute') // still granted
    expect(terminal.effective).toBe(false) // but not in effect
    expect(terminal.blockedBySwitch).toBe('workspace')
  })

  it('shows the sub-switches as overridden when the master is off', () => {
    const access = new AccessManager(defaultGrants())
    access.setSwitch('all', false)
    const view = describeAccess(access)
    const desktop = view.switches.find(s => s.name === 'desktop')!
    expect(desktop.on).toBe(true) // its own position is unchanged
    expect(desktop.effective).toBe(false) // but the master overrides it
  })

  it('lists every capability with the level it would need', () => {
    const view = describeAccess(new AccessManager(defaultGrants()))
    expect(view.capabilities).toHaveLength(CAPABILITIES.length)
    expect(view.capabilities.find(c => c.capability === 'network.configure')!.minimum).toBe('privileged')
  })
})
