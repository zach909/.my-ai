/**
 * Points are earned by work, moved by trades, and never made up: a referral
 * pays only after the person added has done real work, and only so many times.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  loadPoints, setRates, addMember, ensureMember, award, spend, recordLend, recordBorrow, leaderboard, pointsSummary,
  canTrade, priceOf, setSelfName, PointsError, SELF_ID, REFERRAL_BONUS, REFERRAL_CAP, DEFAULT_ASK,
  JOIN_GRAB, hire, payWage, letGo,
} from '../../models && skills/core/points.js'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'corona-points-'))
  file = path.join(dir, 'points.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const me = () => loadPoints(file).members.find(m => m.id === SELF_ID)!

describe('the exchange rate', () => {
  it('starts as lending for credit (ask 0), so a friend with no points can still borrow', () => {
    expect(DEFAULT_ASK).toBe(0)
    expect(loadPoints(file).ask).toBe(0)
  })

  it('saves ask and bid, and keeps one when only the other is given', () => {
    setRates({ ask: 3, bid: 5 }, file)
    setRates({ bid: 4 }, file)
    const s = loadPoints(file)
    expect(s.ask).toBe(3)
    expect(s.bid).toBe(4)
  })

  it('refuses a rate that is negative, huge, or not a number', () => {
    expect(() => setRates({ ask: -1 }, file)).toThrow(PointsError)
    expect(() => setRates({ bid: 1e9 }, file)).toThrow(PointsError)
    expect(() => setRates({ ask: Number.NaN }, file)).toThrow(PointsError)
  })

  it('a trade happens only when the ask is at or under the bid, and the lender is paid its ask', () => {
    expect(canTrade(2, 3)).toBe(true)
    expect(canTrade(3, 3)).toBe(true)
    expect(canTrade(4, 3)).toBe(false)
    expect(priceOf(10, 2)).toBe(20)
    expect(priceOf(-5, 2)).toBe(0)
  })
})

describe('earning', () => {
  it('pays work into the balance and into lifetime earnings', () => {
    award(SELF_ID, 10, 'task', 'wrote tests', file)
    expect(me().points).toBe(10)
    expect(me().earned).toBe(10)
  })

  it('refuses to award nothing, a negative, or a non-number', () => {
    expect(() => award(SELF_ID, 0, 'task', 'x', file)).toThrow(PointsError)
    expect(() => award(SELF_ID, -3, 'task', 'x', file)).toThrow(PointsError)
    expect(() => award(SELF_ID, Number.POSITIVE_INFINITY, 'task', 'x', file)).toThrow(PointsError)
  })

  it('spending never takes a balance below zero', () => {
    award(SELF_ID, 5, 'task', 'x', file)
    expect(() => spend(SELF_ID, 6, 'borrow', 'too much', file)).toThrow(/Not enough points/)
    expect(me().points).toBe(5)
  })

  it('spending does not cost a place on the leaderboard, which ranks lifetime earnings', () => {
    const bob = addMember('Bob', { referredBy: null }, file)
    award(SELF_ID, 50, 'task', 'x', file)
    award(bob.id, 20, 'task', 'x', file)
    spend(SELF_ID, 45, 'borrow', 'bought compute', file)
    const board = leaderboard(file)
    expect(board[0].id).toBe(SELF_ID)
    expect(board[0].rank).toBe(1)
    expect(board[0].points).toBe(5)
    expect(board[1].rank).toBe(2)
  })

  it('ties share a rank and are ordered by name so the board is stable', () => {
    const a = addMember('Ann', { referredBy: null }, file)
    const z = addMember('Zed', { referredBy: null }, file)
    award(z.id, 10, 'task', 'x', file)
    award(a.id, 10, 'task', 'x', file)
    const board = leaderboard(file)
    expect(board.map(b => b.name)).toEqual(['Ann', 'Zed', 'You'])
    expect(board.map(b => b.rank)).toEqual([1, 1, 3])
  })
})

describe('adding people', () => {
  it('adding a name alone pays nothing', () => {
    addMember('Sam', {}, file)
    expect(me().points).toBe(0)
  })

  it('pays the referrer once, when the person added first does paid work', () => {
    const sam = addMember('Sam', {}, file)
    award(sam.id, 10, 'task', 'first job', file)
    expect(me().points).toBe(REFERRAL_BONUS)
    award(sam.id, 10, 'task', 'second job', file)
    expect(me().points).toBe(REFERRAL_BONUS) // not paid again
    expect(pointsSummary(file).referral).toMatchObject({ paid: 1, waiting: 0 })
  })

  it('stops paying after the cap, so adding made-up names cannot print points', () => {
    for (let i = 0; i < REFERRAL_CAP + 5; i++) {
      const m = addMember(`Friend ${i}`, {}, file)
      award(m.id, 1, 'task', 'work', file)
    }
    const s = loadPoints(file)
    const paid = s.entries.filter(e => e.member === SELF_ID && e.kind === 'referral').length
    expect(paid).toBe(REFERRAL_CAP)
    expect(paid * REFERRAL_BONUS).toBe(REFERRAL_CAP * REFERRAL_BONUS)
  })

  it('agents and peers refer no one and never trigger a bonus', () => {
    const bot = ensureMember('agent-1', 'Coder', 'agent', file)
    award(bot.id, 5, 'task', 'work', file)
    expect(me().points).toBe(0)
  })

  it('refuses a duplicate name (any case) and an unusable one', () => {
    addMember('Sam', {}, file)
    expect(() => addMember('sam', {}, file)).toThrow(/already/)
    expect(() => addMember('<b>x</b>', {}, file)).toThrow(PointsError)
    expect(() => addMember('', {}, file)).toThrow(PointsError)
  })

  it('refuses a referrer who is not on the board', () => {
    expect(() => addMember('Sam', { referredBy: 'nobody' }, file)).toThrow(/No such member/)
  })

  it('lets the owner name themselves, but not take someone else\'s name', () => {
    addMember('Sam', {}, file)
    expect(() => setSelfName('sam', file)).toThrow(/taken/)
    setSelfName('Zach', file)
    expect(me().name).toBe('Zach')
  })
})

describe('trading compute moves points, it does not create them', () => {
  it('borrowing debits the borrower and credits the lender, by the same amount', () => {
    award(SELF_ID, 100, 'task', 'x', file)
    const before = loadPoints(file).members.reduce((n, m) => n + m.points, 0)
    expect(recordBorrow('Sam laptop', 30, file)).toEqual({ paid: 30 })
    const s = loadPoints(file)
    expect(s.members.reduce((n, m) => n + m.points, 0)).toBe(before)
    expect(s.members.find(m => m.name === 'Sam laptop')?.points).toBe(30)
    expect(s.members.find(m => m.id === SELF_ID)?.points).toBe(70)
  })

  it('never charges more than the balance', () => {
    award(SELF_ID, 10, 'task', 'x', file)
    expect(recordBorrow('Sam laptop', 999, file).paid).toBe(10)
    expect(me().points).toBe(0)
  })

  it('a zero or negative amount does nothing', () => {
    expect(recordBorrow('Sam laptop', 0, file).paid).toBe(0)
    recordLend('Sam', -5, file)
    expect(me().points).toBe(0)
  })

  it('lending credits the owner', () => {
    recordLend('Sam', 12, file)
    expect(me()).toMatchObject({ points: 12, earned: 12 })
  })

  it('reuses the same peer on the board for repeat dealings', () => {
    award(SELF_ID, 100, 'task', 'x', file)
    recordBorrow('Sam laptop', 10, file)
    recordBorrow('Sam laptop', 10, file)
    expect(loadPoints(file).members.filter(m => m.name === 'Sam laptop')).toHaveLength(1)
  })
})

describe('the file', () => {
  it('survives a damaged file by starting clean rather than crashing', () => {
    writeFileSync(file, '{ not json')
    expect(loadPoints(file).members).toHaveLength(1)
  })

  it('drops malformed members and out-of-range rates when reading', () => {
    writeFileSync(file, JSON.stringify({
      members: [{ id: 'me', name: 'You', points: 'lots' }, { id: '../x', name: 'Bad' }, { id: 'ok1', name: 'Ok', points: -4 }],
      ask: 1e12, bid: 'x',
    }))
    const s = loadPoints(file)
    expect(s.members.map(m => m.id).sort()).toEqual(['me', 'ok1'])
    expect(s.members.find(m => m.id === 'ok1')?.points).toBe(0)
    expect(s.ask).toBe(DEFAULT_ASK)
  })
})

const total = () => loadPoints(file).members.reduce((n, m) => n + m.points, 0)
const pts = (id: string) => loadPoints(file).members.find(m => m.id === id)!.points

describe('adding a person takes from everyone else', () => {
  it('moves JOIN_GRAB points from the others to whoever added the person, and prints none', () => {
    const a = addMember('Ann', { referredBy: null }, file)
    const b = addMember('Bob', { referredBy: null }, file)
    award(a.id, 40, 'task', 'w', file)
    award(b.id, 40, 'task', 'w', file)
    const before = total()
    addMember('Cy', {}, file) // added by you
    expect(me().points).toBe(JOIN_GRAB)
    expect(pts(a.id)).toBe(35)
    expect(pts(b.id)).toBe(35)
    expect(total()).toBe(before)
    expect(me().earned).toBe(0) // a transfer is not work
  })

  it('takes less from someone who has less, and the rest from the others, so the total still reaches 10', () => {
    const a = addMember('Ann', { referredBy: null }, file)
    const b = addMember('Bob', { referredBy: null }, file)
    award(a.id, 2, 'task', 'w', file)
    award(b.id, 50, 'task', 'w', file)
    addMember('Cy', {}, file)
    expect(pts(a.id)).toBe(0)
    expect(pts(b.id)).toBe(42)
    expect(me().points).toBe(10)
  })

  it('takes only what exists when the others hold less than 10, and never goes below zero', () => {
    const a = addMember('Ann', { referredBy: null }, file)
    award(a.id, 3, 'task', 'w', file)
    addMember('Cy', {}, file)
    expect(pts(a.id)).toBe(0)
    expect(me().points).toBe(3)
  })

  it('takes nothing from AIs or computers, or from the person just added', () => {
    const bot = ensureMember('agent-1', 'Coder', 'agent', file)
    award(bot.id, 30, 'task', 'w', file)
    addMember('Cy', {}, file)
    expect(pts(bot.id)).toBe(30)
    expect(me().points).toBe(0)
  })

  it('stops after REFERRAL_CAP adds, so made-up names cannot drain the board', () => {
    const a = addMember('Ann', { referredBy: null }, file)
    award(a.id, 1000, 'task', 'w', file)
    for (let i = 0; i < REFERRAL_CAP + 10; i++) addMember(`Friend ${i}`, {}, file)
    expect(me().points).toBe(REFERRAL_CAP * JOIN_GRAB)
    expect(pts(a.id)).toBe(1000 - REFERRAL_CAP * JOIN_GRAB)
  })

  it('does not take from a person who adds someone themselves', () => {
    const a = addMember('Ann', { referredBy: null }, file)
    award(a.id, 20, 'task', 'w', file)
    award(SELF_ID, 20, 'task', 'w', file)
    addMember('Dee', { referredBy: a.id }, file)
    expect(pts(a.id)).toBe(30) // Ann gained 10 from you
    expect(me().points).toBe(10)
  })
})

describe('hiring', () => {
  const setup = () => {
    const sam = addMember('Sam', { referredBy: null }, file)
    award(SELF_ID, 100, 'task', 'w', file)
    return sam
  }

  it('puts someone under you and pays the wage out of your own balance', () => {
    const sam = setup()
    const before = total()
    hire(SELF_ID, sam.id, 30, file)
    expect(me().points).toBe(70)
    expect(pts(sam.id)).toBe(30)
    expect(loadPoints(file).members.find(m => m.id === sam.id)!.hiredBy).toBe(SELF_ID)
    expect(total()).toBe(before)
    expect(loadPoints(file).members.find(m => m.id === sam.id)!.earned).toBe(0)
  })

  it('refuses a hire you cannot afford, or for nothing, and changes nothing', () => {
    const sam = setup()
    expect(() => hire(SELF_ID, sam.id, 101, file)).toThrow(/Not enough/)
    expect(() => hire(SELF_ID, sam.id, 0, file)).toThrow(PointsError)
    expect(loadPoints(file).members.find(m => m.id === sam.id)!.hiredBy).toBeNull()
    expect(me().points).toBe(100)
  })

  it('lets only one employer hold someone, and not yourself, a computer or someone above you', () => {
    const sam = setup()
    const ann = addMember('Ann', { referredBy: null }, file)
    award(sam.id, 50, 'task', 'w', file)
    hire(SELF_ID, sam.id, 10, file)
    expect(() => hire(ann.id, sam.id, 1, file)).toThrow(/already works/)
    expect(() => hire(SELF_ID, SELF_ID, 1, file)).toThrow(/yourself/)
    expect(() => hire(sam.id, SELF_ID, 1, file)).toThrow(/above you/)
    recordBorrow('far-pc', 1, file)
    const peer = loadPoints(file).members.find(m => m.kind === 'peer')
    if (peer) expect(() => hire(SELF_ID, peer.id, 1, file)).toThrow(PointsError)
  })

  it('pays more wage only to someone you hired', () => {
    const sam = setup()
    const ann = addMember('Ann', { referredBy: null }, file)
    expect(() => payWage(SELF_ID, sam.id, 5, file)).toThrow(/does not work/)
    hire(SELF_ID, sam.id, 10, file)
    payWage(SELF_ID, sam.id, 5, file)
    expect(pts(sam.id)).toBe(15)
    expect(() => payWage(SELF_ID, ann.id, 5, file)).toThrow(/does not work/)
  })

  it('lets them go, and what was paid stays paid', () => {
    const sam = setup()
    hire(SELF_ID, sam.id, 10, file)
    letGo(SELF_ID, sam.id, file)
    expect(loadPoints(file).members.find(m => m.id === sam.id)!.hiredBy).toBeNull()
    expect(pts(sam.id)).toBe(10)
    expect(() => payWage(SELF_ID, sam.id, 1, file)).toThrow(/does not work/)
  })
})

describe('names that belong to someone else\'s account', async () => {
  const { setNameGuard } = await import('../../models && skills/core/points.js')
  afterEach(() => setNameGuard(() => false))

  it('cannot be added to the board, taken as your own name, or used by a computer that turns up', () => {
    setNameGuard(n => n.toLowerCase() === 'sam')
    expect(() => addMember('Sam', {}, file)).toThrow(/someone else's account/)
    expect(() => addMember('SAM', {}, file)).toThrow(PointsError)
    expect(() => setSelfName('sam', file)).toThrow(/someone else's account/)
    addMember('Pat', {}, file) // a free name still works
    award(SELF_ID, 5, 'task', 'w', file)
    recordBorrow('Sam', 1, file) // a machine calling itself Sam is shown as a computer, not as the person
    const peer = loadPoints(file).members.find(m => m.kind === 'peer')!
    expect(peer.name).toBe('Sam (peer)')
  })

  it('treats a guard that throws as a no, and lets AIs through (they are not people)', () => {
    setNameGuard(() => { throw new Error('boom') })
    expect(() => addMember('Anyone', {}, file)).toThrow(PointsError)
    setNameGuard(n => n === 'Coder')
    expect(ensureMember('agent-1', 'Coder', 'agent', file).kind).toBe('agent')
  })
})
