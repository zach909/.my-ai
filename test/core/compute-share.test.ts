/**
 * Lending earns credit, borrowing spends it, and a lease can never cost more
 * than the cap it was granted with.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  setLending, grantLease, revokeLease, leaseStatus, runLeasedJob, loadCompute, computeUnits,
  benchmarkMops, addPeer, removePeer, borrow, setCreditLimit, computeSummary, ComputeError, REFERENCE_MOPS,
  type JobRunner,
} from '../../models && skills/core/compute-share.js'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'corona-compute-'))
  file = path.join(dir, 'compute.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** A clock the fake job advances, so metering is exact instead of timing-dependent. */
function clock() {
  let t = Date.now()
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('compute units', () => {
  it('prices work, not clock time: a faster machine earns more per second', () => {
    expect(computeUnits(1000, REFERENCE_MOPS)).toBe(1)
    expect(computeUnits(1000, REFERENCE_MOPS * 3)).toBe(3)
    expect(computeUnits(0, 500)).toBe(0)
  })
  it('the benchmark reports a positive speed', () => {
    expect(benchmarkMops(20)).toBeGreaterThan(0)
  })
})

describe('lending', () => {
  it('is off by default and refuses to grant while off', () => {
    expect(loadCompute(file).lending.enabled).toBe(false)
    expect(() => grantLease({ label: 'Sam', hours: 1, capCu: 10 }, file)).toThrow(/off/)
  })

  it('meters a job, pays the lender, and charges the lease', async () => {
    setLending(true, file)
    const { token, lease } = grantLease({ label: 'Sam', hours: 1, capCu: 100 }, file)
    const c = clock()
    const runner: JobRunner = { chat: async () => { c.advance(2000); return 'hi' } }
    const r = await runLeasedJob(token, { job: 'chat', prompt: 'hello' }, runner, { file, now: c.now, mops: 2 * REFERENCE_MOPS })
    expect(r.result).toBe('hi')
    expect(r.cu).toBe(4) // 2s on a 2x machine
    expect(r.remainingCu).toBe(96)
    expect(loadCompute(file).balance).toBe(4)
    expect(leaseStatus(token, file, c.now())?.usedCu).toBe(4)
    expect(lease.capCu).toBe(100)
  })

  it('never lets a lease cost more than its cap', async () => {
    setLending(true, file)
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 3 }, file)
    const c = clock()
    const runner: JobRunner = { chat: async () => { c.advance(10_000); return 'slow' } }
    // 3 CU on a 1x machine is 3s of budget; a 10s job is cut off by the clock race only in real time,
    // so assert the charge clamp: whatever the clock says, the lease is never charged past its cap.
    await runLeasedJob(token, { job: 'chat', prompt: 'x' }, runner, { file, now: c.now, mops: REFERENCE_MOPS }).catch(() => undefined)
    expect(leaseStatus(token, file, c.now())!.usedCu).toBeLessThanOrEqual(3)
    await expect(runLeasedJob(token, { job: 'chat', prompt: 'x' }, runner, { file, now: c.now, mops: REFERENCE_MOPS })).rejects.toThrow(/used all|revoked|out of time|Not enough/)
  })

  it('refuses expired, revoked and unknown leases, and unknown jobs', async () => {
    setLending(true, file)
    const { token, lease } = grantLease({ label: 'Sam', hours: 1, capCu: 50 }, file)
    const runner: JobRunner = { chat: async () => 'ok' }
    const c = clock()
    await expect(runLeasedJob('cl_wrong', { job: 'chat', prompt: 'x' }, runner, { file, now: c.now, mops: REFERENCE_MOPS })).rejects.toMatchObject({ status: 401 })
    await expect(runLeasedJob(token, { job: 'shell' as never, prompt: 'x' }, runner, { file, now: c.now, mops: REFERENCE_MOPS })).rejects.toThrow(/Unknown job/)
    c.advance(2 * 3_600_000)
    await expect(runLeasedJob(token, { job: 'chat', prompt: 'x' }, runner, { file, now: c.now, mops: REFERENCE_MOPS })).rejects.toThrow(/run out of time/)
    const c2 = clock()
    revokeLease(lease.id, file, c2.now())
    await expect(runLeasedJob(token, { job: 'chat', prompt: 'x' }, runner, { file, now: () => Date.now(), mops: REFERENCE_MOPS })).rejects.toThrow(/revoked/)
  })

  it('turning lending off stops an existing lease at once', async () => {
    setLending(true, file)
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 50 }, file)
    setLending(false, file)
    await expect(runLeasedJob(token, { job: 'chat', prompt: 'x' }, { chat: async () => 'ok' }, { file, mops: REFERENCE_MOPS })).rejects.toMatchObject({ status: 403 })
  })

  it('bounds a lease: hours and cap are required and limited', () => {
    setLending(true, file)
    expect(() => grantLease({ label: 'Sam', hours: 0, capCu: 5 }, file)).toThrow(ComputeError)
    expect(() => grantLease({ label: 'Sam', hours: 25, capCu: 5 }, file)).toThrow(ComputeError)
    expect(() => grantLease({ label: 'Sam', hours: 1, capCu: 0 }, file)).toThrow(ComputeError)
  })

  it('keeps only a hash of the lease token', () => {
    setLending(true, file)
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 5 }, file)
    expect(JSON.stringify(computeSummary(file))).not.toContain(token)
    expect(require('node:fs').readFileSync(file, 'utf8')).not.toContain(token)
  })
})

describe('a job that is cut off', () => {
  it('is still billed, and the borrower is told the same amount so the ledgers agree', async () => {
    setLending(true, file)
    // 2 CU on a 1x machine buys 2 seconds; the job never answers.
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 0.05 }, file)
    const c = clock()
    const never: JobRunner = { chat: () => new Promise<string>(() => { c.advance(60) }) }
    const err: ComputeError = await runLeasedJob(token, { job: 'chat', prompt: 'x' }, never, { file, now: c.now, mops: REFERENCE_MOPS }).catch(e => e)
    expect(err).toBeInstanceOf(ComputeError)
    expect(err.status).toBe(408)
    expect(err.cu).toBeGreaterThan(0)
    expect(loadCompute(file).balance).toBeCloseTo(err.cu!, 6)
  })

  it('the borrower pays what the peer reports for a failed job', async () => {
    setCreditLimit(60, file)
    const p = addPeer({ name: 'Home', baseUrl: 'http://h:1', leaseToken: 'cl_abc' }, file)
    await expect(borrow(p.id, 'q', { file, fetchImpl: async () => ({ ok: false, status: 408, json: async () => ({ error: 'ran past', cu: 7 }) }) })).rejects.toThrow(/ran past/)
    expect(loadCompute(file).balance).toBe(-7)
  })
})

describe('borrowing', () => {
  const ok = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body })

  it('needs credit first, unless a credit limit lets the balance dip below zero', async () => {
    setCreditLimit(0, file)
    const p = addPeer({ name: 'Home', baseUrl: 'http://192.168.1.20:7861/', leaseToken: 'cl_abc' }, file)
    await expect(borrow(p.id, 'hi', { file, fetchImpl: ok({}) })).rejects.toMatchObject({ status: 402 })
    setCreditLimit(4, file)
    let asked = 0
    const r = await borrow(p.id, 'hi', { file, fetchImpl: async (_u, init) => { asked = JSON.parse(init.body ?? '{}').maxCu; return { ok: true, status: 200, json: async () => ({ result: 'x', cu: 9, remainingCu: 0, mops: REFERENCE_MOPS }) } } })
    expect(asked).toBe(4) // the peer is told the most it may charge
    expect(r.cu).toBe(4) // an over-metering peer is clamped to the limit
    expect(loadCompute(file).balance).toBe(-4)
    await expect(borrow(p.id, 'again', { file, fetchImpl: ok({}) })).rejects.toMatchObject({ status: 402 })
  })

  it('spends what the peer metered, tells the peer the balance as its limit, and never goes negative', async () => {
    setLending(true, file)
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 100 }, file)
    const c = clock()
    await runLeasedJob(token, { job: 'chat', prompt: 'x' }, { chat: async () => { c.advance(5000); return 'ok' } }, { file, now: c.now, mops: REFERENCE_MOPS })
    expect(loadCompute(file).balance).toBe(5)
    setCreditLimit(0, file)

    const p = addPeer({ name: 'Home', baseUrl: 'http://192.168.1.20:7861/', leaseToken: 'cl_abc' }, file)
    expect(p.baseUrl).toBe('http://192.168.1.20:7861')
    let sent: { url: string; headers: Record<string, string>; body: string } | null = null
    const r = await borrow(p.id, 'question', {
      file,
      fetchImpl: async (url, init) => {
        sent = { url, headers: init.headers, body: init.body ?? '' }
        // A peer that over-meters: asks for 50 against a balance of 5.
        return { ok: true, status: 200, json: async () => ({ result: 'answer', cu: 50, remainingCu: 1, mops: REFERENCE_MOPS }) }
      },
    })
    expect(sent!.url).toBe('http://192.168.1.20:7861/api/corona/v1/compute/run')
    expect(sent!.headers.Authorization).toBe('Bearer cl_abc')
    expect(JSON.parse(sent!.body).maxCu).toBe(5)
    expect(r.result).toBe('answer')
    expect(r.cu).toBe(5)
    expect(loadCompute(file).balance).toBe(0)
  })

  it('surfaces a peer refusal and charges nothing', async () => {
    setLending(true, file)
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 100 }, file)
    const c = clock()
    await runLeasedJob(token, { job: 'chat', prompt: 'x' }, { chat: async () => { c.advance(1000); return 'ok' } }, { file, now: c.now, mops: REFERENCE_MOPS })
    setCreditLimit(0, file)
    const p = addPeer({ name: 'Home', baseUrl: 'http://h:1', leaseToken: 'cl_abc' }, file)
    await expect(borrow(p.id, 'q', { file, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: 'This lease was revoked.' }) }) })).rejects.toThrow(/revoked/)
    expect(loadCompute(file).balance).toBe(1)
  })

  it('validates peers and never lists their token', () => {
    expect(() => addPeer({ name: 'A', baseUrl: 'ftp://x', leaseToken: 'cl_a' }, file)).toThrow(/http/)
    expect(() => addPeer({ name: 'A', baseUrl: 'http://u:p@x', leaseToken: 'cl_a' }, file)).toThrow(/password/)
    expect(() => addPeer({ name: 'A', baseUrl: 'http://x', leaseToken: 'nope' }, file)).toThrow(/lease token/)
    const p = addPeer({ name: 'A', baseUrl: 'http://x', leaseToken: 'cl_secret' }, file)
    expect(JSON.stringify(computeSummary(file))).not.toContain('cl_secret')
    expect(removePeer(p.id, file)).toBe(true)
  })
})
