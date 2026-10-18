/**
 * Standing orders for compute, and matching people up.
 *
 * Instead of one flat rate, you can say exactly what you are willing to trade:
 *
 *   sell   "I'll give up to 50 CU of my computer for 120 points"   (2.4 per CU)
 *   buy    "I'll give up to 80 points for 40 CU of someone's"      (2 per CU)
 *
 * An order has a quantity, a price (points per CU) and how much of it has been
 * filled so far. It stays open until it is filled or you cancel it.
 *
 * ── How people get matched ─────────────────────────────────────────────
 *
 * Every computer you know (a peer, compute-share.ts) publishes what it is
 * selling: its cheapest open sell order and how much is left at that price.
 * When you want compute, bestSeller() looks at all of them and picks the
 * cheapest one that is at or under your price and has room for what you need,
 * so you are matched with whoever sells for least. The reverse side is the same
 * thing seen from the lender: a borrower is matched to you when your price is
 * the lowest they can find.
 *
 * ── Standing orders and your plain rate ────────────────────────────────
 *
 * While you have open orders on a side, they are what you trade. When there are
 * none, you are back to the plain rate in Settings (points.ts: ask and bid).
 *
 * ── What this does NOT do (stated plainly) ─────────────────────────────
 *
 * - It matches you with computers you already know. There is no directory of
 *   strangers: to trade with someone you still need their lease (a peer).
 * - Orders are per-device, and so is the ledger; nothing stops a dishonest peer.
 *   The lease's CU cap is what bounds a lender's risk.
 *
 * State: ~/.neuroclaw/market.json (override CORONA_MARKET_FILE).
 */

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";
import { dataFile } from "./user-context.js";

import { MAX_RATE } from "./points.js";

export class MarketError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

export const MAX_OPEN_ORDERS = 20;
export const MAX_ORDER_CU = 100_000;
export const MAX_ORDER_POINTS = 1_000_000;

/** sell: you give compute and get points. buy: you give points and get compute. */
export type Side = "buy" | "sell";

export interface Order {
  id: string;
  side: Side;
  /** The most compute this order covers. */
  cu: number;
  /** The points that go with all of it, so the price is points / cu. */
  points: number;
  filledCu: number;
  createdAt: number;
  closedAt: number | null;
}

export interface MarketCtx {
  file?: string;
  now?: () => number;
}

export function marketFile(): string {
  return process.env.CORONA_MARKET_FILE ? path.resolve(process.env.CORONA_MARKET_FILE) : dataFile("market.json");
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;
const fileOf = (c: MarketCtx): string => c.file ?? marketFile();
const nowOf = (c: MarketCtx): number => (c.now ?? Date.now)();

export const priceOfOrder = (o: Pick<Order, "cu" | "points">): number => (o.cu > 0 ? round(o.points / o.cu) : 0);
export const remainingOf = (o: Order): number => round(Math.max(0, o.cu - o.filledCu));
const isOpen = (o: Order): boolean => o.closedAt === null && remainingOf(o) > 1e-6;

function cleanOrder(raw: unknown): Order | null {
  const o = raw as Partial<Order> | null;
  if (!o || typeof o !== "object" || typeof o.id !== "string" || !/^[a-f0-9]{12}$/.test(o.id)) return null;
  if (o.side !== "buy" && o.side !== "sell") return null;
  const pos = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? v : null);
  const cu = pos(o.cu, MAX_ORDER_CU);
  const points = pos(o.points, MAX_ORDER_POINTS);
  if (cu === null || points === null || points / cu > MAX_RATE) return null;
  const filled = typeof o.filledCu === "number" && Number.isFinite(o.filledCu) && o.filledCu >= 0 ? Math.min(o.filledCu, cu) : 0;
  return {
    id: o.id, side: o.side, cu, points, filledCu: filled,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : 0,
    closedAt: typeof o.closedAt === "number" ? o.closedAt : null,
  };
}

export function loadOrders(file = marketFile()): Order[] {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { orders?: unknown };
    return (Array.isArray(raw.orders) ? raw.orders : []).map(cleanOrder).filter((o): o is Order => o !== null);
  } catch {
    return [];
  }
}

function save(orders: Order[], file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  // Closed orders are history; keep the last few so the page can show what happened.
  const open = orders.filter(isOpen);
  const done = orders.filter(o => !isOpen(o)).slice(-30);
  writeJsonAtomic(file, { orders: [...done, ...open] });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Not every filesystem has modes.
  }
}

// ── Placing and cancelling ─────────────────────────────────────────────

export function placeOrder(input: { side: Side; cu: number; points: number }, ctx: MarketCtx = {}): Order {
  if (input.side !== "buy" && input.side !== "sell") throw new MarketError('An order is to "buy" or "sell" compute.');
  if (typeof input.cu !== "number" || !Number.isFinite(input.cu) || input.cu <= 0 || input.cu > MAX_ORDER_CU) throw new MarketError(`The compute in an order is above 0 and at most ${MAX_ORDER_CU} CU.`);
  if (typeof input.points !== "number" || !Number.isFinite(input.points) || input.points <= 0 || input.points > MAX_ORDER_POINTS) throw new MarketError(`The points in an order are above 0 and at most ${MAX_ORDER_POINTS}.`);
  if (input.points / input.cu > MAX_RATE) throw new MarketError(`That works out above ${MAX_RATE} points per CU.`);
  const file = fileOf(ctx);
  const orders = loadOrders(file);
  if (orders.filter(isOpen).length >= MAX_OPEN_ORDERS) throw new MarketError(`At most ${MAX_OPEN_ORDERS} open orders at once. Cancel one first.`);
  const order: Order = { id: randomBytes(6).toString("hex"), side: input.side, cu: round(input.cu), points: round(input.points), filledCu: 0, createdAt: nowOf(ctx), closedAt: null };
  orders.push(order);
  save(orders, file);
  return order;
}

export function cancelOrder(id: string, ctx: MarketCtx = {}): boolean {
  const file = fileOf(ctx);
  const orders = loadOrders(file);
  const o = orders.find(x => x.id === id && isOpen(x));
  if (!o) return false;
  o.closedAt = nowOf(ctx);
  save(orders, file);
  return true;
}

export function openOrders(side: Side, ctx: MarketCtx = {}): Order[] {
  return loadOrders(fileOf(ctx)).filter(o => o.side === side && isOpen(o));
}

export function allOrders(ctx: MarketCtx = {}): Order[] {
  return loadOrders(fileOf(ctx)).slice().reverse();
}

// ── What this computer offers, and what it will pay ────────────────────

export interface Offer {
  pointsPerCu: number;
  /** How much is left at this price. */
  cu: number;
}

/** The cheapest thing this computer is selling right now, or null if it has no open sell orders. */
export function currentOffer(ctx: MarketCtx = {}): Offer | null {
  const cheapest = openOrders("sell", ctx).sort((a, b) => priceOfOrder(a) - priceOfOrder(b) || a.createdAt - b.createdAt)[0];
  return cheapest ? { pointsPerCu: priceOfOrder(cheapest), cu: remainingOf(cheapest) } : null;
}

/** The most this computer will pay per CU, and the most it wants, across its open buy orders. Null if it has none. */
export function currentBid(ctx: MarketCtx = {}): { pointsPerCu: number; cu: number } | null {
  const buys = openOrders("buy", ctx);
  if (buys.length === 0) return null;
  return { pointsPerCu: Math.max(...buys.map(priceOfOrder)), cu: round(buys.reduce((n, o) => n + remainingOf(o), 0)) };
}

/**
 * Take `cu` of compute out of the open orders on one side after a trade, and
 * close any that are filled. Sell orders are used cheapest first (the one that
 * set the price). Buy orders are used from the lowest limit that still covers
 * what was paid, so the generous ones stay open the longest.
 */
export function fill(side: Side, cu: number, ctx: MarketCtx = {}, pricePerCu?: number): number {
  if (!(cu > 0)) return 0;
  const file = fileOf(ctx);
  const orders = loadOrders(file);
  const eligible = orders
    .filter(o => o.side === side && isOpen(o) && (side === "sell" || pricePerCu === undefined || priceOfOrder(o) + 1e-9 >= pricePerCu))
    .sort((a, b) => priceOfOrder(a) - priceOfOrder(b) || a.createdAt - b.createdAt);
  let left = cu;
  let used = 0;
  const now = nowOf(ctx);
  for (const o of eligible) {
    if (left <= 1e-9) break;
    const take = Math.min(left, remainingOf(o));
    o.filledCu = round(o.filledCu + take);
    if (remainingOf(o) <= 1e-6) o.closedAt = now;
    left -= take;
    used += take;
  }
  if (used > 0) save(orders, file);
  return round(used);
}

// ── Matching ───────────────────────────────────────────────────────────

export interface SellerOffer {
  /** Whose computer this is, whatever the caller calls it. */
  id: string;
  name: string;
  pointsPerCu: number;
  /** How much it can sell at that price right now. */
  cu: number;
}

/**
 * Match a buyer with the cheapest seller it can afford: at or under `limit`
 * points per CU, with at least `need` CU to sell. Among equal prices the one
 * with more room wins. Every one that fits is returned, cheapest first, so a
 * trade that falls through can try the next.
 */
export function rankSellers(offers: SellerOffer[], limit: number, need: number): SellerOffer[] {
  return offers
    .filter(o => Number.isFinite(o.pointsPerCu) && o.pointsPerCu >= 0 && o.pointsPerCu <= limit + 1e-9 && o.cu + 1e-9 >= need)
    .sort((a, b) => a.pointsPerCu - b.pointsPerCu || b.cu - a.cu || a.name.localeCompare(b.name));
}

/** The cheapest seller that fits, or null if nobody does. */
export function bestSeller(offers: SellerOffer[], limit: number, need: number): SellerOffer | null {
  return rankSellers(offers, limit, need)[0] ?? null;
}
