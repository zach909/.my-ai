/**
 * Polling that cannot pile up.
 *
 * Every poll in this app was setInterval around an untimed fetch. An interval
 * fires whether or not the last request finished, and an untimed fetch waits
 * as long as the network makes it. So a stalled backend got a new request
 * every few seconds that never completed. Browsers cap concurrent connections
 * per host at around six, so one stalled status endpoint could consume the
 * whole budget within twenty seconds and starve everything else on the page --
 * including sending a chat message. "The whole app froze", caused by a status
 * indicator nobody was looking at.
 *
 * The test that matters is the overlap one: with a task slower than the
 * interval, there must never be two runs in flight.
 */

import { describe, it, expect, vi } from 'vitest'
import { startPolling, fetchWithTimeout } from '../../src/lib/poll.js'

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('not piling up', () => {
  it('never runs two attempts at once, even when the task is slower than the interval', async () => {
    let inFlight = 0
    let maxInFlight = 0
    let runs = 0

    const handle = startPolling(async () => {
      runs++
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await wait(60) // three times the interval
      inFlight--
    }, 20)

    await wait(300)
    handle.stop()

    // The old setInterval shape would have started ~15 runs here, with several
    // overlapping. This must be one at a time.
    expect(maxInFlight).toBe(1)
    expect(runs).toBeGreaterThan(1)
    expect(runs).toBeLessThan(8)
  })

  it('measures the gap from when a run finishes, not when it started', async () => {
    const starts: number[] = []
    const handle = startPolling(async () => {
      starts.push(Date.now())
      await wait(50)
    }, 50)
    await wait(260)
    handle.stop()

    for (let i = 1; i < starts.length; i++) {
      // ~100ms apart (50 work + 50 gap), not 50.
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(85)
    }
  })

  it('runs immediately rather than waiting out the first interval', async () => {
    let ran = false
    const handle = startPolling(async () => { ran = true }, 10_000)
    await wait(20)
    handle.stop()
    expect(ran).toBe(true)
  })

  it('keeps going after a failed attempt', async () => {
    // A status poll that stops forever on one network blip is worse than one
    // that retries.
    let runs = 0
    const handle = startPolling(async () => {
      runs++
      throw new Error('network blip')
    }, 20)
    await wait(120)
    handle.stop()
    expect(runs).toBeGreaterThan(2)
  })

  it('stops, and stays stopped', async () => {
    let runs = 0
    const handle = startPolling(async () => { runs++ }, 20)
    await wait(70)
    handle.stop()
    const after = runs
    await wait(100)
    expect(runs).toBe(after)
  })

  it('survives stop() being called more than once', () => {
    const handle = startPolling(async () => {}, 1000)
    expect(() => { handle.stop(); handle.stop() }).not.toThrow()
  })

  it('does not schedule another run when stopped mid-flight', async () => {
    let runs = 0
    const handle = startPolling(async () => { runs++; await wait(50) }, 10)
    await wait(20)
    handle.stop() // stopped while the first run is still going
    await wait(150)
    expect(runs).toBe(1)
  })
})

describe('fetch with a deadline', () => {
  it('aborts a request that takes too long', async () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(
      (_input, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    ) as unknown as typeof fetch
    try {
      await expect(fetchWithTimeout('/never', {}, 50)).rejects.toThrow()
    } finally {
      globalThis.fetch = original
    }
  })

  it('still honours a caller’s own abort signal', async () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(
      (_input, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    ) as unknown as typeof fetch
    try {
      const controller = new AbortController()
      const p = fetchWithTimeout('/slow', { signal: controller.signal }, 10_000)
      controller.abort()
      // Taking a timeout must not cost the ability to cancel.
      await expect(p).rejects.toThrow()
    } finally {
      globalThis.fetch = original
    }
  })
})
