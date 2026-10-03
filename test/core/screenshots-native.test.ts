/**
 * ScreenshotsPlugin on the native backends: no program is run, no temp file is
 * written, and the answer says why when nothing could be captured.
 * Xvfb is the other end of the wire for the real-capture tests and they skip
 * without it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ScreenshotsPlugin } from '../../plugins/screenshots.js'
import { X11Backend, NoDisplayBackend } from '../../models && skills/core/desktop/backends.js'
import { X11 } from '../../models && skills/core/desktop/x11.js'

const def = { id: 'screenshots', name: 'Screenshots', type: 'api-connection', capabilities: ['screenshots'] } as any
const haveXvfb = spawnSync('sh', ['-c', 'command -v Xvfb']).status === 0
const NUM = 190 + (process.pid % 50)
let xvfb: ChildProcess | null = null

beforeAll(async () => {
  if (!haveXvfb) return
  xvfb = spawn('Xvfb', [`:${NUM}`, '-screen', '0', '320x200x24', '-nolisten', 'tcp', '-noreset'], { stdio: 'ignore' })
  for (let i = 0; i < 100 && !existsSync(`/tmp/.X11-unix/X${NUM}`); i++) await new Promise(r => setTimeout(r, 50))
  for (let i = 0; i < 40; i++) {
    try { (await X11.connect(`:${NUM}`)).close(); break } catch { await new Promise(r => setTimeout(r, 50)) }
  }
})
afterAll(() => { xvfb?.kill() })

describe('when nothing can be captured', () => {
  it('returns format "none" and says why, rather than an empty success', async () => {
    const shot = await new ScreenshotsPlugin(def, new NoDisplayBackend()).capture()
    expect(shot).toMatchObject({ data: '', format: 'none', width: 0, height: 0 })
    expect(shot.reason).toMatch(/no graphical session/i)
  })

  it('leaves nothing behind in the temp directory', async () => {
    const before = new Set(readdirSync(tmpdir()))
    await new ScreenshotsPlugin(def, new NoDisplayBackend()).capture()
    expect(readdirSync(tmpdir()).filter(n => !before.has(n) && n.startsWith('neuroclaw-ss-'))).toEqual([])
  })
})

;(haveXvfb ? describe : describe.skip)('capturing from a real X server', () => {
  const plugin = () => new ScreenshotsPlugin(def, new X11Backend(`:${NUM}`))

  it('captures the whole screen at its real size', async () => {
    const shot = await plugin().capture()
    expect(shot).toMatchObject({ format: 'png', width: 320, height: 200 })
    expect(Buffer.from(shot.data, 'base64').subarray(1, 4).toString()).toBe('PNG')
  })

  it('captures just an area', async () => {
    expect(await plugin().captureArea(10, 20, 100, 50)).toMatchObject({ format: 'png', width: 100, height: 50 })
  })

  it('clips an area that runs off the screen to what exists', async () => {
    expect(await plugin().captureArea(300, 190, 100, 100)).toMatchObject({ format: 'png', width: 20, height: 10 })
  })

  it('reports an area wholly off the screen instead of returning a blank image', async () => {
    const shot = await plugin().captureArea(5000, 5000, 10, 10)
    expect(shot.format).toBe('none')
    expect(shot.reason).toMatch(/outside the screen/)
  })
})
