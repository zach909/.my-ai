/**
 * Compute for points: the lender's ask against the borrower's bid, with the
 * points moving from one to the other and nowhere else.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  setLending, grantLease, loadCompute, addPeer, ComputeError, REFERENCE_MOPS, type JobRunner, type FetchLike,
} from '../../models && skills/core/compute-share.js'
import { runPricedJob, borrowPriced, leaseOffer } from '../../models && skills/core/compute-market.js'
import { setRates, award, loadPoints, SELF_ID } from '../../models && skills/core/points.js'

let dir: string
let cfile: string
let pfile: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'corona-market-'))
  cfile = path.join(dir, 'compute.json')
  pfile = path.join(dir, 'points.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function clock() {
  let t = Date.now()
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

const myPoints = () => loadPoints(pfile).members.find(m => m.id === SELF_ID)!.points

describe('lender side', () => {
  it('with an ask of 0 it settles in compute credit exactly as before', async () => {
    setLending(true, cfile)
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 100 }, cfile)
    const c = clock()
    const runner: JobRunner = { chat: async () => { c.advance(1000); return 'ok' } }
    const r = await runPricedJob(token, { job: 'chat', prompt: 'hi' }, runner, { file: cfile, pointsFile: pfile, now: c.now, mops: REFERENCE_MOPS })
    expect(r.cu).toBe(1)
    expect(r.points).toBeUndefined()
    expect(loadCompute(cfile).balance).toBe(1)
    expect(myPoints()).toBe(0)
  })

  it('with an ask above 0 it is paid in points and the CU balance does not move', async () => {
    setLending(true, cfile)
    setRates({ ask: 3 }, pfile)
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 100 }, cfile)
    const c = clock()
    const runner: JobRunner = { chat: async () => { c.advance(2000); return 'ok' } }
    const r = await runPricedJob(token, { job: 'chat', prompt: 'hi', maxPointsPerCu: 5 }, runner, { file: cfile, pointsFile: pfile, now: c.now, mops: REFERENCE_MOPS })
    expect(r.cu).toBe(2)
    expect(r).toMatchObject({ points: 6, pointsPerCu: 3 })
    expect(myPoints()).toBe(6)
    expect(loadCompute(cfile).balance).toBe(0)
    // The lease still counts the work, so its cap still bounds what it can cost.
    expect(loadCompute(cfile).leases[0].usedCu).toBe(2)
    expect(loadCompute(cfile).entries[0].paid).toBe('points')
  })

  it('refuses a guest whose bid is under the ask, and runs nothing', async () => {
    setLending(true, cfile)
    setRates({ ask: 3 }, pfile)
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 100 }, cfile)
    let ran = false
    const runner: JobRunner = { chat: async () => { ran = true; return 'x' } }
    await expect(runPricedJob(token, { job: 'chat', prompt: 'hi', maxPointsPerCu: 2 }, runner, { file: cfile, pointsFile: pfile }))
      .rejects.toMatchObject({ status: 409 })
    expect(ran).toBe(false)
    expect(myPoints()).toBe(0)
  })

  it('refuses a guest that does not say what it will pay when the ask is above 0', async () => {
    setLending(true, cfile)
    setRates({ ask: 1 }, pfile)
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 100 }, cfile)
    await expect(runPricedJob(token, { job: 'chat', prompt: 'hi' }, { chat: async () => 'x' }, { file: cfile, pointsFile: pfile }))
      .rejects.toMatchObject({ status: 402 })
  })

  it('tells a stranger nothing about the price', async () => {
    setLending(true, cfile)
    setRates({ ask: 7 }, pfile)
    const err = await runPricedJob('cl_nope', { job: 'chat', prompt: 'hi' }, { chat: async () => 'x' }, { file: cfile, pointsFile: pfile }).catch(e => e)
    expect(err).toBeInstanceOf(ComputeError)
    expect(err.status).toBe(401)
    expect(String(err.message)).not.toMatch(/7/)
    expect(leaseOffer('cl_nope', { file: cfile, pointsFile: pfile })).toBeNull()
  })

  it('a job that ran past its allowance used the machine and is still paid for', async () => {
    setLending(true, cfile)
    setRates({ ask: 2 }, pfile)
    // 0.1 CU on a reference machine buys about 100 ms, so the job below is cut off by the lease's own limit.
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 0.1 }, cfile)
    const runner: JobRunner = { chat: () => new Promise<string>(() => undefined) }
    await expect(runPricedJob(token, { job: 'chat', prompt: 'hi', maxPointsPerCu: 2 }, runner, { file: cfile, pointsFile: pfile, mops: REFERENCE_MOPS }))
      .rejects.toMatchObject({ status: 408 })
    expect(myPoints()).toBeGreaterThan(0)
    expect(myPoints()).toBeLessThanOrEqual(0.2 + 1e-9) // never more than the lease cap allows: 0.1 CU x 2 points
    expect(loadCompute(cfile).balance).toBe(0)
  })

  it('a job that fails before using any measurable time costs nothing', async () => {
    setLending(true, cfile)
    setRates({ ask: 2 }, pfile)
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 100 }, cfile)
    const runner: JobRunner = { chat: async () => { throw new Error('boom') } }
    await expect(runPricedJob(token, { job: 'chat', prompt: 'hi', maxPointsPerCu: 2 }, runner, { file: cfile, pointsFile: pfile, mops: REFERENCE_MOPS }))
      .rejects.toThrow('boom')
    expect(myPoints()).toBe(0)
  })

  it('offers the price on the lease status', () => {
    setLending(true, cfile)
    setRates({ ask: 4 }, pfile)
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 100 }, cfile)
    expect(leaseOffer(token, { file: cfile, pointsFile: pfile })?.pointsPerCu).toBe(4)
  })
})

describe('borrower side', () => {
  function peerFetch(opts: { ask?: number; cu?: number; failWith?: { status: number; cu: number } }): { fetchImpl: FetchLike; sent: Array<Record<string, unknown>> } {
    const sent: Array<Record<string, unknown>> = []
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.endsWith('/compute/lease')) {
        return { ok: true, status: 200, json: async () => (opts.ask === undefined ? { remainingCu: 100 } : { remainingCu: 100, pointsPerCu: opts.ask }) }
      }
      sent.push(JSON.parse(init.body ?? '{}'))
      if (opts.failWith) return { ok: false, status: opts.failWith.status, json: async () => ({ error: 'broke', cu: opts.failWith!.cu }) }
      return { ok: true, status: 200, json: async () => ({ result: 'answer', cu: opts.cu ?? 2, remainingCu: 90, mops: 1000, pointsPerCu: opts.ask }) }
    }
    return { fetchImpl, sent }
  }
  const setup = () => addPeer({ name: 'Sam laptop', baseUrl: 'http://10.0.0.5:7861', leaseToken: 'cl_abc' }, cfile)

  it('pays the lender its ask and sends its own bid as the ceiling', async () => {
    const peer = setup()
    award(SELF_ID, 100, 'task', 'x', pfile)
    setRates({ bid: 4 }, pfile)
    const { fetchImpl, sent } = peerFetch({ ask: 3, cu: 2 })
    const r = await borrowPriced(peer.id, 'hello', { file: cfile, pointsFile: pfile, fetchImpl })
    expect(r).toMatchObject({ result: 'answer', cu: 2, points: 6, pointsPerCu: 3 })
    expect(myPoints()).toBe(94)
    expect(sent[0]).toMatchObject({ maxPointsPerCu: 4, job: 'chat' })
    // Only what the points could buy at the ask is requested: 100 / 3.
    expect(sent[0].maxCu).toBeCloseTo(33.333333, 5)
    // The credit balance is left alone: the job was paid for in points.
    expect(loadCompute(cfile).balance).toBe(0)
    expect(loadPoints(pfile).members.find(m => m.name === 'Sam laptop')?.points).toBe(6)
  })

  it('stops before sending anything when the ask is over the bid', async () => {
    const peer = setup()
    award(SELF_ID, 100, 'task', 'x', pfile)
    setRates({ bid: 2 }, pfile)
    const { fetchImpl, sent } = peerFetch({ ask: 3 })
    await expect(borrowPriced(peer.id, 'hello', { file: cfile, pointsFile: pfile, fetchImpl })).rejects.toMatchObject({ status: 409 })
    expect(sent).toHaveLength(0)
    expect(myPoints()).toBe(100)
  })

  it('stops when there are no points to pay with', async () => {
    const peer = setup()
    const { fetchImpl, sent } = peerFetch({ ask: 1 })
    await expect(borrowPriced(peer.id, 'hello', { file: cfile, pointsFile: pfile, fetchImpl })).rejects.toMatchObject({ status: 402 })
    expect(sent).toHaveLength(0)
  })

  it('never pays more than the balance even if the lender over-meters', async () => {
    const peer = setup()
    award(SELF_ID, 10, 'task', 'x', pfile)
    const { fetchImpl } = peerFetch({ ask: 2, cu: 9999 })
    const r = await borrowPriced(peer.id, 'hello', { file: cfile, pointsFile: pfile, fetchImpl })
    expect(r.cu).toBe(5) // clamped to the 10 / 2 CU it asked for
    expect(myPoints()).toBe(0)
  })

  it('pays for a job that used the lender\'s machine and then failed', async () => {
    const peer = setup()
    award(SELF_ID, 100, 'task', 'x', pfile)
    const { fetchImpl } = peerFetch({ ask: 2, failWith: { status: 408, cu: 3 } })
    await expect(borrowPriced(peer.id, 'hello', { file: cfile, pointsFile: pfile, fetchImpl })).rejects.toThrow()
    expect(myPoints()).toBe(94)
  })

  it('a peer that charges nothing (or is an older version) settles in credit as before', async () => {
    const peer = setup()
    const { fetchImpl } = peerFetch({ cu: 2 })
    const r = await borrowPriced(peer.id, 'hello', { file: cfile, pointsFile: pfile, fetchImpl })
    expect(r.cu).toBe(2)
    expect(r.points).toBeUndefined()
    expect(loadCompute(cfile).balance).toBe(-2)
    expect(myPoints()).toBe(0)
  })
})
