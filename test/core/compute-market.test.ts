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
import { placeOrder, openOrders, remainingOf, currentOffer } from '../../models && skills/core/market.js'
import { borrowBest } from '../../models && skills/core/compute-market.js'

let dir: string
let cfile: string
let pfile: string
let mfile: string
const savedMarket = process.env.CORONA_MARKET_FILE
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'corona-market-'))
  cfile = path.join(dir, 'compute.json')
  pfile = path.join(dir, 'points.json')
  mfile = path.join(dir, 'market.json')
  process.env.CORONA_MARKET_FILE = mfile
})
afterEach(() => {
  if (savedMarket === undefined) delete process.env.CORONA_MARKET_FILE
  else process.env.CORONA_MARKET_FILE = savedMarket
  rmSync(dir, { recursive: true, force: true })
})

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

describe('standing orders', () => {
  it('a sell order sets the price and caps the job at what is left, then is filled', async () => {
    setLending(true, cfile)
    placeOrder({ side: 'sell', cu: 3, points: 9 }, { file: mfile }) // 3 CU at 3 points each
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 100 }, cfile)
    expect(leaseOffer(token, { file: cfile, pointsFile: pfile })).toMatchObject({ pointsPerCu: 3, forSaleCu: 3 })
    const c = clock()
    const runner: JobRunner = { chat: async () => { c.advance(2000); return 'ok' } }
    const r = await runPricedJob(token, { job: 'chat', prompt: 'hi', maxPointsPerCu: 3 }, runner, { file: cfile, pointsFile: pfile, now: c.now, mops: REFERENCE_MOPS })
    expect(r).toMatchObject({ cu: 2, points: 6, pointsPerCu: 3 })
    expect(myPoints()).toBe(6)
    expect(remainingOf(openOrders('sell', { file: mfile })[0])).toBe(1)
  })

  it('a job cannot use more than the order has left', async () => {
    setLending(true, cfile)
    placeOrder({ side: 'sell', cu: 1, points: 2 }, { file: mfile })
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 100 }, cfile)
    const runner: JobRunner = { chat: () => new Promise<string>(() => undefined) } // runs until it is cut off
    await expect(runPricedJob(token, { job: 'chat', prompt: 'hi', maxPointsPerCu: 5 }, runner, { file: cfile, pointsFile: pfile, mops: REFERENCE_MOPS }))
      .rejects.toMatchObject({ status: 408 })
    expect(myPoints()).toBeGreaterThan(0)
    expect(myPoints()).toBeLessThanOrEqual(2 + 1e-9) // at most the 1 CU it offered, at 2 points
  })

  it('when the orders are all used up the plain rate in Settings applies again', async () => {
    setLending(true, cfile)
    setRates({ ask: 0 }, pfile)
    placeOrder({ side: 'sell', cu: 2, points: 4 }, { file: mfile })
    const { token } = grantLease({ label: 'Sam', hours: 1, capCu: 100 }, cfile)
    const c = clock()
    const runner: JobRunner = { chat: async () => { c.advance(2000); return 'ok' } }
    await runPricedJob(token, { job: 'chat', prompt: 'hi', maxPointsPerCu: 2 }, runner, { file: cfile, pointsFile: pfile, now: c.now, mops: REFERENCE_MOPS })
    expect(currentOffer({ file: mfile })).toBeNull()
    expect(leaseOffer(token, { file: cfile, pointsFile: pfile })).toMatchObject({ pointsPerCu: 0, forSaleCu: null })
  })

  it('a buy order limits what is spent and is filled by the trade', async () => {
    const peer = addPeer({ name: 'Sam laptop', baseUrl: 'http://10.0.0.5:7861', leaseToken: 'cl_abc' }, cfile)
    award(SELF_ID, 1000, 'task', 'x', pfile)
    placeOrder({ side: 'buy', cu: 10, points: 40 }, { file: mfile }) // up to 10 CU at 4 each
    const sent: Array<Record<string, unknown>> = []
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.endsWith('/compute/lease')) return { ok: true, status: 200, json: async () => ({ remainingCu: 100, pointsPerCu: 3, forSaleCu: 8 }) }
      sent.push(JSON.parse(init.body ?? '{}'))
      return { ok: true, status: 200, json: async () => ({ result: 'answer', cu: 2, remainingCu: 90, mops: 1000, pointsPerCu: 3 }) }
    }
    const r = await borrowPriced(peer.id, 'hello', { file: cfile, pointsFile: pfile, market: { file: mfile }, fetchImpl })
    expect(r).toMatchObject({ points: 6, pointsPerCu: 3 })
    // Capped by the seller's room (8), not by 1000 points or the order's 10.
    expect(sent[0].maxCu).toBe(8)
    expect(sent[0].maxPointsPerCu).toBe(4) // the buy order's price is the ceiling
    expect(remainingOf(openOrders('buy', { file: mfile })[0])).toBe(8)
  })

  it('refuses a seller above the buy order limit even if the plain bid would allow it', async () => {
    const peer = addPeer({ name: 'Sam laptop', baseUrl: 'http://10.0.0.5:7861', leaseToken: 'cl_abc' }, cfile)
    award(SELF_ID, 100, 'task', 'x', pfile)
    setRates({ bid: 50 }, pfile)
    placeOrder({ side: 'buy', cu: 10, points: 10 }, { file: mfile }) // limit 1
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ remainingCu: 100, pointsPerCu: 3 }) })
    await expect(borrowPriced(peer.id, 'hello', { file: cfile, pointsFile: pfile, market: { file: mfile }, fetchImpl })).rejects.toMatchObject({ status: 409 })
  })
})

describe('matching across the computers you know', () => {
  function network(table: Record<string, { ask?: number; room?: number; remaining?: number; fail?: number; cu?: number }>) {
    const called: string[] = []
    const fetchImpl: FetchLike = async (url, init) => {
      const host = new URL(url).hostname
      const spec = table[host]
      if (!spec) throw new Error('unreachable')
      if (url.endsWith('/compute/lease')) return { ok: true, status: 200, json: async () => ({ remainingCu: spec.remaining ?? 100, ...(spec.ask === undefined ? {} : { pointsPerCu: spec.ask }), ...(spec.room === undefined ? {} : { forSaleCu: spec.room }) }) }
      called.push(host)
      if (spec.fail) return { ok: false, status: spec.fail, json: async () => ({ error: 'no' }) }
      return { ok: true, status: 200, json: async () => ({ result: `from ${host}`, cu: spec.cu ?? 1, remainingCu: 9, mops: 1000, pointsPerCu: spec.ask }) }
    }
    return { fetchImpl, called }
  }
  const add = (name: string, host: string) => addPeer({ name, baseUrl: `http://${host}:7861`, leaseToken: 'cl_abc' }, cfile)

  it('goes to the cheapest computer it can afford', async () => {
    add('Ann', '10.0.0.1'); add('Bo', '10.0.0.2'); add('Cy', '10.0.0.3')
    award(SELF_ID, 100, 'task', 'x', pfile)
    setRates({ bid: 4 }, pfile)
    const { fetchImpl, called } = network({ '10.0.0.1': { ask: 3 }, '10.0.0.2': { ask: 1.5 }, '10.0.0.3': { ask: 9 } })
    const r = await borrowBest('hello', { file: cfile, pointsFile: pfile, fetchImpl })
    expect(r.result).toBe('from 10.0.0.2')
    expect(r.matched).toMatchObject({ peer: 'Bo', pointsPerCu: 1.5 })
    expect(r.matched.considered.map(c => c.peer).sort()).toEqual(['Ann', 'Bo', 'Cy'])
    expect(called).toEqual(['10.0.0.2'])
    expect(myPoints()).toBe(98.5)
  })

  it('a computer that lends for credit counts as free, so it is the cheapest of all', async () => {
    add('Ann', '10.0.0.1'); add('Friend', '10.0.0.2')
    award(SELF_ID, 100, 'task', 'x', pfile)
    const { fetchImpl } = network({ '10.0.0.1': { ask: 1 }, '10.0.0.2': {} })
    const r = await borrowBest('hello', { file: cfile, pointsFile: pfile, fetchImpl })
    expect(r.matched.peer).toBe('Friend')
    expect(myPoints()).toBe(100)
  })

  it('falls through to the next cheapest when the first turns the job down', async () => {
    add('Ann', '10.0.0.1'); add('Bo', '10.0.0.2')
    award(SELF_ID, 100, 'task', 'x', pfile)
    const { fetchImpl, called } = network({ '10.0.0.1': { ask: 1, fail: 429 }, '10.0.0.2': { ask: 2 } })
    const r = await borrowBest('hello', { file: cfile, pointsFile: pfile, fetchImpl })
    expect(r.matched.peer).toBe('Bo')
    expect(called).toEqual(['10.0.0.1', '10.0.0.2'])
  })

  it('skips computers that cannot be reached or have nothing left', async () => {
    add('Gone', '10.0.0.9'); add('Empty', '10.0.0.1'); add('Ok', '10.0.0.2')
    award(SELF_ID, 100, 'task', 'x', pfile)
    const { fetchImpl } = network({ '10.0.0.1': { ask: 1, remaining: 0 }, '10.0.0.2': { ask: 2 } })
    expect((await borrowBest('hello', { file: cfile, pointsFile: pfile, fetchImpl })).matched.peer).toBe('Ok')
  })

  it('says what the cheapest price was when nobody is within your limit, and when you know nobody', async () => {
    await expect(borrowBest('hi', { file: cfile, pointsFile: pfile })).rejects.toMatchObject({ status: 404 })
    add('Ann', '10.0.0.1')
    award(SELF_ID, 100, 'task', 'x', pfile)
    setRates({ bid: 1 }, pfile)
    const { fetchImpl } = network({ '10.0.0.1': { ask: 5 } })
    const err = await borrowBest('hi', { file: cfile, pointsFile: pfile, fetchImpl }).catch(e => e)
    expect(err.status).toBe(409)
    expect(err.message).toMatch(/asks 5 points per CU and your limit is 1/)
  })
})
