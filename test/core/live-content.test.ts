/**
 * Live content (made faster than it is used) and pre-need content (made before
 * it is asked for). What these protect: a film made faster than it plays can
 * start at once, a slower one waits just long enough, preparing changes nothing
 * and is dropped when the context moves on.
 */

import { describe, it, expect } from 'vitest'
import {
  startDelay, LiveStream, LiveStreams, PreNeedCache, MAX_LIVE_STREAMS, type LiveSource,
} from '../../models && skills/core/live-content.js'

const noYield = async () => {}

function source(pieces: number[]): LiveSource {
  let i = 0
  return { pull: async () => (i < pieces.length ? new Uint8Array(pieces[i++]).fill(i) : null) }
}

describe('startDelay', () => {
  it('needs no wait when it is made as fast as it plays or faster (5 minutes made in 4)', () => {
    expect(startDelay(300, 300 / 240)).toBe(0)
    expect(startDelay(300, 1)).toBe(0)
  })

  it('waits just long enough when it is made slower', () => {
    // 5 minutes of film made in 10: start after 5 minutes so playing ends as making does.
    expect(startDelay(300, 0.5)).toBeCloseTo(300)
    expect(startDelay(0, 0.5)).toBe(0)
    expect(startDelay(300, 0)).toBe(Infinity)
  })
})

describe('LiveStream', () => {
  it('can be played while it is still being made, and reads exactly what was made', async () => {
    let t = 0
    const stream = new LiveStream('s', source([100, 100, 100]), { bytesPerSecond: 100, totalSeconds: 3, now: () => t, yieldTo: noYield })
    stream.start()
    await stream.finished()

    const all = stream.read(0, 1000)
    expect(all.length).toBe(300)
    expect(stream.read(150, 100).length).toBe(100)
    expect(Array.from(stream.read(95, 10))).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2])
    expect(stream.read(300, 10).length).toBe(0)
    expect(stream.status()).toMatchObject({ finished: true, producedSeconds: 3, startDelaySeconds: 0, playableNow: true })
  })

  it('says to play now once it is made faster than it plays, before it has finished', async () => {
    let t = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>(r => { release = r })
    let n = 0
    const slowEnd: LiveSource = {
      pull: async () => {
        if (n++ < 5) { t += 1000; return new Uint8Array(125) }   // 1.25 s of content per second
        await gate
        return null
      },
    }
    const stream = new LiveStream('s', slowEnd, { bytesPerSecond: 100, totalSeconds: 300, now: () => t, yieldTo: noYield })
    stream.start()
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r))

    const status = stream.status()
    expect(status.finished).toBe(false)
    expect(status.rate).toBeCloseTo(1.25)
    expect(status.startDelaySeconds).toBe(0)
    expect(status.playableNow).toBe(true)
    release!()
    await stream.finished()
  })

  it('holds back playing when making is slower than playing', async () => {
    let t = 0
    let n = 0
    const slow: LiveSource = {
      pull: async () => { if (n++ < 4) { t += 2000; return new Uint8Array(100) } return null },   // 0.5 s of content per second
    }
    const stream = new LiveStream('s', slow, { bytesPerSecond: 100, totalSeconds: 100, now: () => t, yieldTo: noYield })
    let release: (() => void) | undefined
    const hold = new Promise<void>(r => { release = r })
    ;(stream as unknown as { source: LiveSource }).source = {
      pull: async () => { if (n < 4) return slow.pull(); await hold; return null },
    }
    stream.start()
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r))

    const status = stream.status()
    expect(status.rate).toBeCloseTo(0.5)
    expect(status.playableNow).toBe(false)
    // 100 s of content at 0.5/s takes 200 s; 8 s have gone by of the 100 s head start needed.
    expect(status.startDelaySeconds).toBeCloseTo(92)
    release!()
    await stream.finished()
  })

  it('reports a failing source and stops there', async () => {
    const broken: LiveSource = { pull: async () => { throw new Error('mesh stopped') } }
    const stream = new LiveStream('s', broken, { bytesPerSecond: 10, yieldTo: noYield })
    stream.start()
    await stream.finished()
    expect(stream.status()).toMatchObject({ finished: true, failed: 'mesh stopped', playableNow: false })
  })

  it('stops at its size limit', async () => {
    const stream = new LiveStream('s', source([60, 60, 60]), { bytesPerSecond: 10, maxBytes: 100, yieldTo: noYield })
    stream.start()
    await stream.finished()
    expect(stream.status().failed).toMatch(/size limit/)
  })

  it('rejects a stream with no content rate', () => {
    expect(() => new LiveStream('s', source([]), { bytesPerSecond: 0 })).toThrow()
  })
})

describe('LiveStreams', () => {
  it('opens, finds, lists and stops streams, and limits how many run at once', async () => {
    const streams = new LiveStreams()
    const forever: LiveSource = { pull: () => new Promise(() => {}) }
    const a = streams.open(forever, { bytesPerSecond: 1, yieldTo: noYield })
    expect(streams.get(a.id)).toBe(a)
    expect(streams.list()).toHaveLength(1)
    expect(streams.stop(a.id)).toBe(true)
    expect(streams.stop(a.id)).toBe(false)

    for (let i = 0; i < MAX_LIVE_STREAMS; i++) streams.open(forever, { bytesPerSecond: 1, yieldTo: noYield })
    expect(() => streams.open(forever, { bytesPerSecond: 1, yieldTo: noYield })).toThrow(/at most/)
  })
})

describe('PreNeedCache', () => {
  it('hands over what was prepared, once, and nothing was run when asking', async () => {
    const cache = new PreNeedCache<string>()
    let made = 0
    await cache.prepare('answer', 'q1', async () => { made++; return 'ready' })
    await cache.prepare('answer', 'q1', async () => { made++; return 'again' })   // already held

    expect(made).toBe(1)
    expect(cache.take('answer', 'q1')).toBe('ready')
    expect(cache.take('answer', 'q1')).toBeUndefined()
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1 })
  })

  it('does not start the same preparation twice while one is under way', async () => {
    const cache = new PreNeedCache<number>()
    let made = 0
    const make = async () => { made++; await new Promise(r => setImmediate(r)); return 1 }
    await Promise.all([cache.prepare('k', 'a', make), cache.prepare('k', 'a', make)])
    expect(made).toBe(1)
  })

  it('throws away what was prepared for a context that has since changed', async () => {
    const cache = new PreNeedCache<string>()
    await cache.prepare('answer', 'q', async () => 'old')
    cache.invalidate()
    expect(cache.take('answer', 'q')).toBeUndefined()
    expect(cache.stats().discarded).toBe(1)
  })

  it('discards a preparation that finished after the context moved on', async () => {
    const cache = new PreNeedCache<string>()
    const job = cache.prepare('answer', 'q', async () => { await new Promise(r => setImmediate(r)); return 'late' })
    cache.invalidate()
    await job
    expect(cache.has('answer', 'q')).toBe(false)
  })

  it('forgets things that sat unused too long, and keeps to its size', async () => {
    let t = 0
    const cache = new PreNeedCache<number>(2, 1000, () => t)
    await cache.prepare('k', 'a', async () => 1)
    t = 2000
    expect(cache.has('k', 'a')).toBe(false)

    await cache.prepare('k', 'x', async () => 1)
    await cache.prepare('k', 'y', async () => 2)
    await cache.prepare('k', 'z', async () => 3)
    expect(cache.stats().held).toBe(2)
    expect(cache.has('k', 'x')).toBe(false)
  })

  it('treats a failed preparation as not there', async () => {
    const cache = new PreNeedCache<number>()
    await cache.prepare('k', 'a', async () => { throw new Error('nope') })
    expect(cache.has('k', 'a')).toBe(false)
    await cache.prepare('k', 'a', async () => 5)   // can be tried again
    expect(cache.take('k', 'a')).toBe(5)
  })
})
