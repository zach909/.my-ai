/**
 * The graphical half of the access layer.
 *
 * Honest scope: this machine has no display and none of the X tools, so what
 * is exercised here is the permission gating, the tool detection and every
 * degradation path -- the parts that decide what happens when the desktop is
 * NOT there. The window manipulation itself is unexercised, and the module's
 * own header says so rather than implying otherwise.
 *
 * That is still the half most worth testing: a desktop layer that silently
 * no-ops on a machine without a desktop is worse than one that refuses,
 * because the agent will happily report success at doing nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  DesktopControl,
  DESKTOP_TOOLS,
  ToolMissing,
  NoDisplay,
  AGENT_WINDOW_MARKER,
} from '../../models && skills/core/desktop-control.js'
import { AccessManager, AccessDenied, defaultGrants } from '../../models && skills/core/access-manager.js'

const savedDisplay = process.env.DISPLAY
const savedWayland = process.env.WAYLAND_DISPLAY

beforeEach(() => {
  delete process.env.DISPLAY
  delete process.env.WAYLAND_DISPLAY
})
afterEach(() => {
  if (savedDisplay === undefined) delete process.env.DISPLAY
  else process.env.DISPLAY = savedDisplay
  if (savedWayland === undefined) delete process.env.WAYLAND_DISPLAY
  else process.env.WAYLAND_DISPLAY = savedWayland
})

describe('probing', () => {
  it('says there is no desktop rather than reporting a usable one', async () => {
    const probe = await new DesktopControl(new AccessManager(defaultGrants())).probe()
    expect(probe.usable).toBe(false)
    expect(probe.summary).toMatch(/No graphical session/)
    expect(probe.display).toBeNull()
  })

  it('never throws, because reporting is the whole point of it', async () => {
    process.env.DISPLAY = ':99'
    await expect(new DesktopControl(new AccessManager()).probe()).resolves.toBeTruthy()
  })

  it('detects each tool independently, so one missing does not hide the rest', async () => {
    const probe = await new DesktopControl(new AccessManager(defaultGrants())).probe()
    expect(Object.keys(probe.tools).sort()).toEqual(Object.keys(DESKTOP_TOOLS).sort())
    for (const present of Object.values(probe.tools)) expect(typeof present).toBe('boolean')
  })
})

describe('refusing, and saying why', () => {
  it('checks the permission before it checks the machine', async () => {
    // Order matters: an ungranted caller must be told it is ungranted, not
    // handed a tooling error that suggests installing something would help.
    const control = new DesktopControl(new AccessManager())
    await expect(control.listWindows()).rejects.toThrow(AccessDenied)
    await expect(control.screenshot()).rejects.toThrow(AccessDenied)
  })

  it('reports no display as its own kind of problem — nothing to install fixes it', async () => {
    const control = new DesktopControl(new AccessManager(defaultGrants()))
    await expect(control.listWindows()).rejects.toThrow(NoDisplay)
  })

  it('names the package to install when a tool is what is missing', async () => {
    process.env.DISPLAY = ':99'
    const control = new DesktopControl(new AccessManager(defaultGrants()))
    try {
      await control.listWindows()
      throw new Error('should have refused')
    } catch (e) {
      // wmctrl is genuinely absent here, which is exactly the case this path exists for.
      expect(e).toBeInstanceOf(ToolMissing)
      expect((e as Error).message).toContain(DESKTOP_TOOLS.wmctrl.package)
      expect((e as Error).message).toContain('windows')
    }
  })

  it('refuses input synthesis that nobody granted, even with a display present', async () => {
    process.env.DISPLAY = ':99'
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

describe('marking the agent’s own windows', () => {
  it('uses a marker distinct enough not to collide with a user window title', () => {
    expect(AGENT_WINDOW_MARKER).toMatch(/^CORONA_/)
    expect(AGENT_WINDOW_MARKER).not.toMatch(/\s/)
  })
})
