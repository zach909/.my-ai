/**
 * Standing orders for compute: sell some at a price, buy some at a limit, and
 * get matched with whoever sells for least.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  placeOrder, cancelOrder, openOrders, allOrders, currentOffer, currentBid, fill, bestSeller, rankSellers, loadOrders,
  priceOfOrder, remainingOf, MarketError, MAX_OPEN_ORDERS, type MarketCtx,
} from '../../models && skills/core/market.js'

let dir: string
let ctx: MarketCtx
let t = 1000
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'market-'))
  t = 1000
  ctx = { file: path.join(dir, 'market.json'), now: () => t++ }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('orders', () => {
  it('a sell order is compute for points, and its price is points per CU', () => {
    const o = placeOrder({ side: 'sell', cu: 50, points: 120 }, ctx)
    expect(o).toMatchObject({ side: 'sell', cu: 50, points: 120, filledCu: 0, closedAt: null })
    expect(priceOfOrder(o)).toBe(2.4)
    expect(remainingOf(o)).toBe(50)
  })

  it('refuses nonsense: no compute, no points, too much, or an absurd price', () => {
    expect(() => placeOrder({ side: 'sell', cu: 0, points: 5 }, ctx)).toThrow(MarketError)
    expect(() => placeOrder({ side: 'buy', cu: 5, points: -1 }, ctx)).toThrow(MarketError)
    expect(() => placeOrder({ side: 'buy', cu: 1e9, points: 5 }, ctx)).toThrow(MarketError)
    expect(() => placeOrder({ side: 'sell', cu: 1, points: 5000 }, ctx)).toThrow(/above 1000/)
    expect(() => placeOrder({ side: 'swap' as never, cu: 1, points: 1 }, ctx)).toThrow(MarketError)
    expect(() => placeOrder({ side: 'buy', cu: Number.NaN, points: 1 }, ctx)).toThrow(MarketError)
  })

  it('limits how many are open at once, and cancelling frees a slot', () => {
    const ids = Array.from({ length: MAX_OPEN_ORDERS }, () => placeOrder({ side: 'sell', cu: 1, points: 1 }, ctx).id)
    expect(() => placeOrder({ side: 'sell', cu: 1, points: 1 }, ctx)).toThrow(/At most/)
    expect(cancelOrder(ids[0], ctx)).toBe(true)
    expect(cancelOrder(ids[0], ctx)).toBe(false)
    expect(() => placeOrder({ side: 'sell', cu: 1, points: 1 }, ctx)).not.toThrow()
  })

  it('keeps sides apart', () => {
    placeOrder({ side: 'sell', cu: 10, points: 20 }, ctx)
    placeOrder({ side: 'buy', cu: 10, points: 10 }, ctx)
    expect(openOrders('sell', ctx)).toHaveLength(1)
    expect(openOrders('buy', ctx)).toHaveLength(1)
  })
})

describe('what this computer offers and will pay', () => {
  it('offers its cheapest sell order, with what is left at that price', () => {
    placeOrder({ side: 'sell', cu: 100, points: 300 }, ctx) // 3 per CU
    placeOrder({ side: 'sell', cu: 40, points: 80 }, ctx) // 2 per CU
    expect(currentOffer(ctx)).toEqual({ pointsPerCu: 2, cu: 40 })
  })

  it('has no offer with no open sell orders, and no bid with no buy orders', () => {
    expect(currentOffer(ctx)).toBeNull()
    expect(currentBid(ctx)).toBeNull()
  })

  it('bids the most it will pay across its buy orders, and how much it wants in all', () => {
    placeOrder({ side: 'buy', cu: 10, points: 20 }, ctx) // 2
    placeOrder({ side: 'buy', cu: 30, points: 120 }, ctx) // 4
    expect(currentBid(ctx)).toEqual({ pointsPerCu: 4, cu: 40 })
  })
})

describe('filling', () => {
  it('sells the cheapest tier first, and moves on to the next when it runs out', () => {
    placeOrder({ side: 'sell', cu: 10, points: 20 }, ctx) // 2
    placeOrder({ side: 'sell', cu: 100, points: 300 }, ctx) // 3
    expect(fill('sell', 4, ctx)).toBe(4)
    expect(currentOffer(ctx)).toEqual({ pointsPerCu: 2, cu: 6 })
    expect(fill('sell', 8, ctx)).toBe(8) // 6 from the cheap one, 2 from the next
    expect(currentOffer(ctx)).toEqual({ pointsPerCu: 3, cu: 98 })
  })

  it('closes an order once it is used up, and never fills more than there was', () => {
    placeOrder({ side: 'sell', cu: 5, points: 10 }, ctx)
    expect(fill('sell', 99, ctx)).toBe(5)
    expect(openOrders('sell', ctx)).toEqual([])
    expect(allOrders(ctx)[0]).toMatchObject({ filledCu: 5 })
    expect(allOrders(ctx)[0].closedAt).not.toBeNull()
    expect(fill('sell', 1, ctx)).toBe(0)
    expect(fill('sell', -3, ctx)).toBe(0)
  })

  it('uses a buy order only if its limit covers the price that was paid, lowest limit first', () => {
    placeOrder({ side: 'buy', cu: 10, points: 10 }, ctx) // limit 1
    placeOrder({ side: 'buy', cu: 10, points: 30 }, ctx) // limit 3
    placeOrder({ side: 'buy', cu: 10, points: 50 }, ctx) // limit 5
    expect(fill('buy', 6, ctx, 2)).toBe(6) // the limit-1 order cannot cover 2, so it comes out of the limit-3 one
    const left = Object.fromEntries(openOrders('buy', ctx).map(o => [priceOfOrder(o), remainingOf(o)]))
    expect(left).toEqual({ 1: 10, 3: 4, 5: 10 })
  })
})

describe('matching people up', () => {
  const offers = [
    { id: 'a', name: 'Ann', pointsPerCu: 3, cu: 100 },
    { id: 'b', name: 'Bo', pointsPerCu: 2, cu: 5 },
    { id: 'c', name: 'Cy', pointsPerCu: 2, cu: 50 },
    { id: 'd', name: 'Di', pointsPerCu: 0.5, cu: 1 },
  ]

  it('picks the cheapest seller at or under your limit', () => {
    expect(bestSeller(offers, 2, 1)?.id).toBe('d')
  })

  it('skips a seller without room for what you need, and takes the one with more room at the same price', () => {
    expect(bestSeller(offers, 2, 2)?.id).toBe('c') // Di has 1, Bo and Cy tie at 2 and Cy has more room
    expect(bestSeller(offers, 2.9, 200)).toBeNull()
  })

  it('nobody under the limit means no match', () => {
    expect(bestSeller(offers, 0.4, 0)).toBeNull()
  })

  it('ranks everyone who fits, cheapest first, so a failed trade can try the next', () => {
    expect(rankSellers(offers, 3, 0).map(o => o.id)).toEqual(['d', 'c', 'b', 'a'])
    expect(rankSellers([{ id: 'x', name: 'X', pointsPerCu: Number.NaN, cu: 1 }], 9, 0)).toEqual([])
  })
})

describe('the file', () => {
  it('drops damaged orders and survives a damaged file', () => {
    writeFileSync(ctx.file!, JSON.stringify({ orders: [
      { id: 'aaaaaaaaaaaa', side: 'sell', cu: 5, points: 10, filledCu: 99 },
      { id: 'bad', side: 'sell', cu: 5, points: 10 },
      { id: 'bbbbbbbbbbbb', side: 'buy', cu: -1, points: 10 },
      { id: 'cccccccccccc', side: 'sell', cu: 1, points: 99999 },
    ] }))
    const orders = loadOrders(ctx.file)
    expect(orders.map(o => o.id)).toEqual(['aaaaaaaaaaaa'])
    expect(orders[0].filledCu).toBe(5) // clamped to the order's size
    writeFileSync(ctx.file!, '{ no')
    expect(loadOrders(ctx.file)).toEqual([])
  })
})
