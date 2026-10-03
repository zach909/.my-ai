/**
 * The native X11 client, exercised against a real X server.
 *
 * Xvfb is used here only as the other end of the wire: it is a test oracle that
 * is not part of the repo, not imported and not shipped. When it is not
 * installed these tests skip (loudly, in the name) rather than pass vacuously.
 *
 * A bare Xvfb has no window manager, so most tests prove the
 * no-window-manager fallbacks. The EWMH paths (_NET_ACTIVE_WINDOW,
 * _NET_CLOSE_WINDOW, _NET_MOVERESIZE_WINDOW, _NET_CLIENT_LIST) are exercised
 * against a STAND-IN window manager written in this file: it holds
 * SubstructureRedirect on the root like a real one, so it proves the messages
 * are delivered, well-formed and acted on -- but it is my reading of the EWMH
 * spec answering my reading of the EWMH spec. No real window manager (mutter,
 * kwin, openbox...) has been tried, and that remains the largest unverified
 * piece.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { X11, X11Error, X11Unreachable, parseDisplay, parseXauthority, keysymFor, convertPixels } from '../../models && skills/core/desktop/x11.js'
import { encodePng, pngSize, crc32 } from '../../models && skills/core/desktop/png.js'

const haveXvfb = spawnSync('sh', ['-c', 'command -v Xvfb']).status === 0
const NUM = 90 + (process.pid % 50)
const DISPLAY = `:${NUM}`
let xvfb: ChildProcess | null = null

beforeAll(async () => {
  if (!haveXvfb) return
  xvfb = spawn('Xvfb', [DISPLAY, '-screen', '0', '640x480x24', '-nolisten', 'tcp', '-noreset'], { stdio: 'ignore' })
  for (let i = 0; i < 100 && !existsSync(`/tmp/.X11-unix/X${NUM}`); i++) await new Promise(r => setTimeout(r, 50))
  // The socket appears just before the server accepts; one real connect settles it.
  for (let i = 0; i < 40; i++) {
    try { (await X11.connect(DISPLAY)).close(); break } catch { await new Promise(r => setTimeout(r, 50)) }
  }
})
afterAll(() => { xvfb?.kill() })

const xdescribe = haveXvfb ? describe : describe.skip

/** Decode an RGB PNG written by encodePng: enough to read pixels back. */
function pixelAt(png: Buffer, x: number, y: number): [number, number, number] {
  const size = pngSize(png)!
  let off = 8
  const idat: Buffer[] = []
  while (off < png.length) {
    const len = png.readUInt32BE(off)
    if (png.toString('latin1', off + 4, off + 8) === 'IDAT') idat.push(png.subarray(off + 8, off + 8 + len))
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const row = 1 + size.width * 3
  const i = y * row + 1 + x * 3
  return [raw[i], raw[i + 1], raw[i + 2]]
}

describe('pure helpers', () => {
  it('parses display addresses', () => {
    expect(parseDisplay(':0')).toEqual({ host: '', display: 0, screen: 0 })
    expect(parseDisplay(':12.1')).toEqual({ host: '', display: 12, screen: 1 })
    expect(parseDisplay('box:3')).toEqual({ host: 'box', display: 3, screen: 0 })
    expect(() => parseDisplay('nonsense')).toThrow(X11Unreachable)
  })

  it('reads an Xauthority file and survives a truncated tail', () => {
    const rec = (family: number, addr: string, num: string, name: string, data: number[]) => {
      const parts = [Buffer.alloc(2)]
      parts[0].writeUInt16BE(family)
      for (const f of [Buffer.from(addr), Buffer.from(num), Buffer.from(name), Buffer.from(data)]) {
        const l = Buffer.alloc(2)
        l.writeUInt16BE(f.length)
        parts.push(l, f)
      }
      return Buffer.concat(parts)
    }
    const file = Buffer.concat([rec(256, 'myhost', '0', 'MIT-MAGIC-COOKIE-1', [1, 2, 3, 4]), Buffer.from([0x01, 0x00, 0x00])])
    const entries = parseXauthority(file)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ family: 256, address: 'myhost', number: '0', name: 'MIT-MAGIC-COOKIE-1' })
    expect([...entries[0].data]).toEqual([1, 2, 3, 4])
  })

  it('maps characters to keysyms', () => {
    expect(keysymFor('a')).toBe(0x61)
    expect(keysymFor('é')).toBe(0xe9)
    expect(keysymFor('\n')).toBe(0xff0d)
    expect(keysymFor('✓')).toBe(0x01000000 + 0x2713)
    expect(keysymFor('\u0001')).toBeNull()
  })

  it('converts the common 32-bit layout and an odd 16-bit one', () => {
    const px32 = Buffer.from([0x30, 0x20, 0x10, 0x00]) // B=0x30 G=0x20 R=0x10
    expect([...convertPixels(px32, 1, 1, 32, 32, 0, { red: 0xff0000, green: 0xff00, blue: 0xff })]).toEqual([0x10, 0x20, 0x30])
    // RGB565, pure red = 0xF800, little-endian
    const px16 = Buffer.from([0x00, 0xf8])
    expect([...convertPixels(px16, 1, 1, 16, 16, 0, { red: 0xf800, green: 0x07e0, blue: 0x001f })]).toEqual([255, 0, 0])
  })

  it('writes a PNG whose checksum and size read back', () => {
    const png = encodePng(2, 1, Buffer.from([255, 0, 0, 0, 255, 0]))
    expect(pngSize(png)).toEqual({ width: 2, height: 1 })
    expect(crc32(Buffer.from('IEND'))).toBe(0xae426082) // the well-known IEND checksum
    expect(pixelAt(png, 1, 0)).toEqual([0, 255, 0])
    expect(() => encodePng(2, 2, Buffer.alloc(3))).toThrow()
  })
})

describe('without a display', () => {
  it('says so, as its own kind of error', async () => {
    await expect(X11.connect(':98')).rejects.toBeInstanceOf(X11Unreachable)
    await expect(X11.connect(undefined as unknown as string)).rejects.toBeInstanceOf(X11Unreachable)
  })
})

xdescribe(`against a real X server (${haveXvfb ? 'Xvfb' : 'Xvfb not installed'})`, () => {
  it('connects and reads the screen geometry', async () => {
    await X11.with(async x => {
      expect(x.setup.width).toBe(640)
      expect(x.setup.height).toBe(480)
      expect(x.setup.rootDepth).toBe(24)
    }, DISPLAY)
  })

  it('takes a screenshot that really contains what is on screen', async () => {
    await X11.with(async x => {
      await x.createWindow({ title: 'shot', x: 50, y: 60, width: 100, height: 80 })
      const png = await x.screenshot()
      expect(pngSize(png)).toEqual({ width: 640, height: 480 })
      expect(pixelAt(png, 80, 90)).toEqual([255, 255, 255]) // inside the white window
      expect(pixelAt(png, 5, 5)).not.toEqual([255, 255, 255]) // the root behind it
    }, DISPLAY)
  })

  it('lists windows with their titles, including non-Latin ones', async () => {
    await X11.with(async x => {
      await x.createWindow({ title: 'plain window', width: 40, height: 40 })
      await x.createWindow({ title: 'héllo ✓ 日本', width: 40, height: 40 })
      const titles = (await x.listWindows()).map(w => w.title)
      expect(titles).toContain('plain window')
      expect(titles).toContain('héllo ✓ 日本')
      const w = (await x.listWindows())[0]
      expect(w.id).toMatch(/^0x[0-9a-f]{8}$/)
    }, DISPLAY)
  })

  it('types text into the focused window, shifted characters and newline included', async () => {
    await X11.with(async x => {
      const win = await x.createWindow({ title: 'typing', width: 200, height: 100, events: true })
      const keys: Array<{ code: number; down: boolean }> = []
      x.onEvent = ev => {
        if (ev[0] === 2 || ev[0] === 3) keys.push({ code: ev[1], down: ev[0] === 2 })
      }
      const before = await x.keyboardMapping()
      await x.focus(win)
      await x.typeText('Hi 5\n', 0)
      await x.sync()
      await new Promise(r => setTimeout(r, 100))

      const { syms, perKeycode } = await x.keyboardMapping()
      const sym = (code: number, col = 0) => syms[code - x.setup.minKeycode][col]
      const downs = keys.filter(k => k.down).map(k => k.code)
      // Shift, H, i, space, 5, Return (Shift is held for the capital H only).
      const shift = downs[0]
      expect([0xffe1, 0xffe2]).toContain(sym(shift))
      expect(sym(downs[1], 1)).toBe('H'.charCodeAt(0))
      expect(sym(downs[2])).toBe('i'.charCodeAt(0))
      expect(sym(downs[3])).toBe(0x20)
      expect(sym(downs[4])).toBe('5'.charCodeAt(0))
      expect(sym(downs[5])).toBe(0xff0d)
      // Every press was released.
      expect(keys.filter(k => !k.down)).toHaveLength(downs.length)
      expect(perKeycode).toBe(before.perKeycode)
    }, DISPLAY)
  })

  it('types a character the layout has no key for, then puts the keymap back', async () => {
    await X11.with(async x => {
      const win = await x.createWindow({ title: 'unicode', width: 200, height: 100, events: true })
      const presses: number[] = []
      x.onEvent = ev => { if (ev[0] === 2) presses.push(ev[1]) }
      const before = await x.keyboardMapping()
      await x.focus(win)
      await x.typeText('✓', 0)
      await new Promise(r => setTimeout(r, 100))
      expect(presses).toHaveLength(1)
      const after = await x.keyboardMapping()
      expect(after.syms).toEqual(before.syms)
    }, DISPLAY)
  })

  it('clicks at window-relative coordinates', async () => {
    await X11.with(async x => {
      const win = await x.createWindow({ title: 'click', x: 100, y: 120, width: 200, height: 100, events: true })
      const clicks: Array<{ button: number; x: number; y: number }> = []
      x.onEvent = ev => { if (ev[0] === 4) clicks.push({ button: ev[1], x: ev.readInt16LE(24), y: ev.readInt16LE(26) }) }
      const at = await x.toRoot(win, 10, 20)
      expect(at).toEqual({ x: 110, y: 140 })
      await x.clickAt(at.x, at.y, 3)
      await new Promise(r => setTimeout(r, 100))
      expect(clicks).toEqual([{ button: 3, x: 10, y: 20 }])
    }, DISPLAY)
  })

  it('moves and resizes a window with no window manager running', async () => {
    await X11.with(async x => {
      const win = await x.createWindow({ title: 'move', x: 0, y: 0, width: 50, height: 50 })
      await x.moveResize(win, 30, 40, 120, 90)
      expect(await x.geometry(win)).toEqual({ x: 30, y: 40, width: 120, height: 90 })
    }, DISPLAY)
  })

  it('raises an X error at the call that caused it', async () => {
    await X11.with(async x => {
      await expect(x.focus(0x1234567)).rejects.toBeInstanceOf(X11Error)
      // And the connection is still usable afterwards.
      expect((await x.listWindows()).length).toBeGreaterThanOrEqual(0)
    }, DISPLAY)
  })

  it('refuses a button that does not exist', async () => {
    await X11.with(async x => {
      await expect(x.clickAt(1, 1, 0)).rejects.toThrow(/not a mouse button/)
    }, DISPLAY)
  })
})


// ── EWMH, against a stand-in window manager ───────────────────────────────

const NUM_WM = 240 + (process.pid % 50)
let xvfbWm: ChildProcess | null = null

/** A just-enough window manager: owns SubstructureRedirect on the root and obeys three EWMH requests. */
async function standInWindowManager(mode: 'obey' | 'ignore-focus' = 'obey') {
  const wm = await X11.connect(`:${NUM_WM}`)
  const raw = wm as unknown as {
    send(req: Buffer): void
    frame(op: number, b1: number, body: Buffer): Buffer
    setProperty(win: number, prop: string, type: string, data: Buffer): Promise<void>
  }
  const log = { closed: [] as number[] }
  const windowsProp = async (name: string, type: string, ids: number[]) => {
    const data = Buffer.alloc(ids.length * 4)
    ids.forEach((id, i) => data.writeUInt32LE(id, i * 4))
    // setProperty writes format 8; windows need format 32, so build ChangeProperty by hand.
    const body = Buffer.alloc(20 + data.length)
    body.writeUInt32LE(wm.root, 0)
    body.writeUInt32LE(await wm.atom(name), 4)
    body.writeUInt32LE(await wm.atom(type), 8)
    body[12] = 32
    body.writeUInt32LE(ids.length, 16)
    data.copy(body, 20)
    raw.send(raw.frame(18, 0, body))
    await wm.sync()
  }
  const atoms = {
    active: await wm.atom('_NET_ACTIVE_WINDOW'),
    move: await wm.atom('_NET_MOVERESIZE_WINDOW'),
    close: await wm.atom('_NET_CLOSE_WINDOW'),
  }
  await windowsProp('_NET_SUPPORTING_WM_CHECK', 'WINDOW', [wm.root])
  // A previous manager on this server may have left a window marked active.
  await windowsProp('_NET_ACTIVE_WINDOW', 'WINDOW', [])
  await windowsProp('_NET_CLIENT_LIST', 'WINDOW', await wm.queryTree(wm.root))

  wm.onEvent = ev => {
    if ((ev[0] & 0x7f) !== 33) return // ClientMessage only (the top bit marks it as sent via SendEvent)
    const win = ev.readUInt32LE(4)
    const type = ev.readUInt32LE(8)
    const data = [0, 1, 2, 3, 4].map(i => ev.readUInt32LE(12 + i * 4))
    if (type === atoms.active && mode === 'obey') {
      void windowsProp('_NET_ACTIVE_WINDOW', 'WINDOW', [win])
    } else if (type === atoms.move) {
      const flags = data[0]
      const body = Buffer.alloc(24)
      body.writeUInt32LE(win, 0)
      body.writeUInt16LE(((flags >> 8) & 0xf), 4) // x,y,width,height presence bits map onto ConfigureWindow's mask
      body.writeInt32LE(data[1] | 0, 8)
      body.writeInt32LE(data[2] | 0, 12)
      body.writeUInt32LE(data[3], 16)
      body.writeUInt32LE(data[4], 20)
      raw.send(raw.frame(12, 0, body))
    } else if (type === atoms.close) {
      log.closed.push(win)
    }
  }
  // Redirect: ChangeWindowAttributes(root, CWEventMask = SubstructureRedirect | SubstructureNotify).
  const attrs = Buffer.alloc(12)
  attrs.writeUInt32LE(wm.root, 0)
  attrs.writeUInt32LE(0x800, 4)
  attrs.writeUInt32LE(0x100000 | 0x80000, 8)
  raw.send(raw.frame(2, 0, attrs))
  await wm.sync()
  return { wm, log }
}

;(haveXvfb ? describe : describe.skip)('EWMH paths, against a stand-in window manager', () => {
  beforeAll(async () => {
    xvfbWm = spawn('Xvfb', [`:${NUM_WM}`, '-screen', '0', '640x480x24', '-nolisten', 'tcp', '-noreset'], { stdio: 'ignore' })
    for (let i = 0; i < 100 && !existsSync(`/tmp/.X11-unix/X${NUM_WM}`); i++) await new Promise(r => setTimeout(r, 50))
    for (let i = 0; i < 40; i++) {
      try { (await X11.connect(`:${NUM_WM}`)).close(); break } catch { await new Promise(r => setTimeout(r, 50)) }
    }
  })
  afterAll(() => { xvfbWm?.kill() })

  it('lists windows from _NET_CLIENT_LIST, focuses through _NET_ACTIVE_WINDOW, and resizes through _NET_MOVERESIZE_WINDOW', async () => {
    // Windows first: once a WM holds SubstructureRedirect, a client's MapWindow
    // is redirected to it instead of taking effect.
    const holder = await X11.connect(`:${NUM_WM}`)
    const win = await holder.createWindow({ title: 'managed', x: 10, y: 10, width: 100, height: 80, events: true })
    const { wm } = await standInWindowManager('obey')
    try {
      await X11.with(async x => {
        expect(await x.hasWindowManager()).toBe(true)
        expect((await x.listWindows()).map(w => w.title)).toContain('managed')
        await x.focus(win) // resolves only once _NET_ACTIVE_WINDOW names it
        expect(await x.activeWindow()).toBe(win)
        await x.moveResize(win, 25, 35, 140, 90)
        // A window manager acts on the request in its own time (and may adjust
        // it), so this is a request, not an instant change: wait for it.
        let geo = await x.geometry(win)
        for (let i = 0; i < 40 && geo.width !== 140; i++) {
          await new Promise(r => setTimeout(r, 25))
          geo = await x.geometry(win)
        }
        expect(geo).toEqual({ x: 25, y: 35, width: 140, height: 90 })
      }, `:${NUM_WM}`)
    } finally {
      wm.close(); holder.close()
    }
  })

  it('asks the window manager to close, rather than destroying the window itself', async () => {
    const holder = await X11.connect(`:${NUM_WM}`)
    const win = await holder.createWindow({ title: 'closing', width: 50, height: 50 })
    const { wm, log } = await standInWindowManager('obey')
    try {
      await X11.with(x => x.closeWindow(win), `:${NUM_WM}`)
      await new Promise(r => setTimeout(r, 100))
      expect(log.closed).toEqual([win])
    } finally {
      wm.close(); holder.close()
    }
  })

  it('does not report success when the window manager never gives the focus', async () => {
    const holder = await X11.connect(`:${NUM_WM}`)
    const win = await holder.createWindow({ title: 'stubborn', width: 50, height: 50 })
    const { wm } = await standInWindowManager('ignore-focus')
    try {
      await X11.with(async x => {
        await expect(x.focus(win)).rejects.toThrow(/did not give window/)
      }, `:${NUM_WM}`)
    } finally {
      wm.close(); holder.close()
    }
  })
})
