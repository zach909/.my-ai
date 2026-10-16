/**
 * Compute for points: the price tag on lending and borrowing.
 *
 * compute-share.ts measures work in Compute Units (CU) and, with nothing else
 * in play, settles in compute credit between friends. This puts a price in
 * points (points.ts) on top.
 *
 * The price comes from one of two places on each side:
 *
 *   lender    its cheapest open SELL order (market.ts) -- a price and how much it
 *             will sell at it -- or, with none open, the plain `ask` in Settings
 *   borrower  its open BUY orders -- the most it will pay and how much it wants --
 *             or, with none open, the plain `bid` in Settings
 *
 * ── The protocol, so neither side can be surprised ─────────────────────
 *
 *   1. The borrower asks the lease endpoint what the lender charges
 *      (`pointsPerCu`) and how much it will sell at that price (`forSaleCu`).
 *   2. If that is above the borrower's limit, the borrower stops. Nothing is
 *      sent, nothing is spent.
 *   3. Otherwise the borrower sends the job with `maxPointsPerCu` = its limit and
 *      `maxCu` = the most its points (and its buy orders) can cover at that price.
 *   4. The lender re-checks ask <= maxPointsPerCu (the price may have changed
 *      since step 1) and refuses with 409 if not. A lender that charges points
 *      refuses a borrower that did not say what it will pay (402), so an older
 *      borrower cannot get a priced job for nothing. The job is also capped at
 *      what the lender's order has left.
 *   5. The lender runs the job, credits its own points for the CU it metered,
 *      and fills its sell order. The borrower pays the same, at the price it was
 *      quoted, and fills its buy order.
 *
 * A lender whose price is 0 settles the old way, in compute credit, and none of
 * this applies. That is the setting for lending to a friend for free.
 *
 * A job that used the machine and then failed is still paid for, on both sides.
 *
 * borrowBest() does the matching: it asks every computer you know what it
 * charges, ranks the ones at or under your limit cheapest first, and tries them
 * in turn.
 *
 * As in compute-share.ts the two ledgers are separate and nothing makes a
 * dishonest borrower pay. The cap is what protects the lender: no lease can
 * ever cost more than its CU cap.
 */

import {
  ComputeError,
  borrow,
  leaseStatus,
  loadCompute,
  runLeasedJob,
  computeFile,
  type FetchLike,
  type JobRequest,
  type JobResult,
  type JobRunner,
  type Peer,
  type PublicLease,
} from "./compute-share.js";
import { currentBid, currentOffer, fill, rankSellers, type MarketCtx, type SellerOffer } from "./market.js";
import { SELF_ID, canTrade, loadPoints, pointsFile, priceOf, recordBorrow, recordLend } from "./points.js";

const round = (n: number): number => Math.round(n * 1e6) / 1e6;
/** Round down, so a borrower is never told it can buy more than its points cover. */
const floor6 = (n: number): number => Math.floor(n * 1e6) / 1e6;

export type LeaseOffer = PublicLease & { remainingCu: number; problem: string | null; pointsPerCu: number; forSaleCu: number | null };

export interface MarketOptions {
  file?: string;
  pointsFile?: string;
  market?: MarketCtx;
}

/** What this computer charges right now, and how much it will sell at that price (null when it is not limited by an order). */
function myPrice(opts: MarketOptions): { ask: number; forSaleCu: number | null } {
  const offer = currentOffer(opts.market);
  return offer ? { ask: offer.pointsPerCu, forSaleCu: offer.cu } : { ask: loadPoints(opts.pointsFile ?? pointsFile()).ask, forSaleCu: null };
}

/** What this device will pay per CU and how much it wants at most. */
function myLimit(opts: MarketOptions): { bid: number; wantCu: number | null } {
  const bid = currentBid(opts.market);
  return bid ? { bid: bid.pointsPerCu, wantCu: bid.cu } : { bid: loadPoints(opts.pointsFile ?? pointsFile()).bid, wantCu: null };
}

/** What the lease endpoint tells a borrower: the lease, plus what this computer charges and how much it will sell. */
export function leaseOffer(token: string | null, opts: MarketOptions & { now?: number } = {}): LeaseOffer | null {
  const st = leaseStatus(token, opts.file ?? computeFile(), opts.now ?? Date.now());
  if (!st) return null;
  const price = myPrice(opts);
  return { ...st, pointsPerCu: price.ask, forSaleCu: price.forSaleCu };
}

export interface PricedJobOptions extends MarketOptions {
  now?: () => number;
  mops?: number;
}

/**
 * Lender side: run one job for a guest, charging this computer's price.
 * Identifies the guest before saying anything about the price, so a stranger
 * learns nothing about how this computer is set up.
 */
export async function runPricedJob(token: string | null, req: JobRequest, runner: JobRunner, opts: PricedJobOptions = {}): Promise<JobResult> {
  const file = opts.file ?? computeFile();
  const pf = opts.pointsFile ?? pointsFile();
  const lease = leaseStatus(token, file, (opts.now ?? Date.now)());
  if (!lease) throw new ComputeError("Unknown lease.", 401);
  const { ask, forSaleCu } = myPrice(opts);

  if (ask > 0) {
    if (typeof req.maxPointsPerCu !== "number" || !Number.isFinite(req.maxPointsPerCu)) {
      throw new ComputeError(`This computer charges ${ask} points per CU. Say how many you will pay ("maxPointsPerCu"), or ask the owner to lend for compute credit.`, 402);
    }
    if (!canTrade(ask, req.maxPointsPerCu)) {
      throw new ComputeError(`This computer asks ${ask} points per CU and you offered up to ${req.maxPointsPerCu}.`, 409);
    }
  }
  // What an open sell order has left is as much as this job may use.
  const capped: JobRequest = forSaleCu === null ? req : { ...req, maxCu: Math.min(forSaleCu, typeof req.maxCu === "number" && req.maxCu > 0 ? req.maxCu : Infinity) };

  const run = { file, now: opts.now, mops: opts.mops, settle: ask > 0 ? ("points" as const) : ("credit" as const) };
  let result: JobResult;
  try {
    result = await runLeasedJob(token, capped, runner, run);
  } catch (err) {
    // The job used the machine before it failed: that is paid for too.
    if (ask > 0 && err instanceof ComputeError && typeof err.cu === "number" && err.cu > 0) {
      recordLend(lease.label, priceOf(err.cu, ask), pf);
      if (forSaleCu !== null) fill("sell", err.cu, opts.market);
    }
    throw err;
  }
  if (ask <= 0) return result;
  const points = priceOf(result.cu, ask);
  recordLend(lease.label, points, pf);
  if (forSaleCu !== null) fill("sell", result.cu, opts.market);
  return { ...result, points, pointsPerCu: ask };
}

export interface PricedBorrowOptions extends MarketOptions {
  fetchImpl?: FetchLike;
  now?: () => number;
}

interface PeerOffer {
  /** Settled in points at this price. 0 means credit. */
  ask: number;
  /** CU this peer will sell at that price right now, or null if it did not say. */
  forSaleCu: number | null;
  remainingCu: number | null;
  reachable: boolean;
}

async function peerOffer(peer: Peer, doFetch: FetchLike): Promise<PeerOffer> {
  try {
    const res = await doFetch(`${peer.baseUrl}/api/corona/v1/compute/lease`, {
      method: "GET",
      headers: { Authorization: `Bearer ${peer.leaseToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { pointsPerCu?: unknown; forSaleCu?: unknown; remainingCu?: unknown } | null;
    if (!res.ok || !body) return { ask: 0, forSaleCu: null, remainingCu: null, reachable: false };
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
    // A peer that does not say (an older version, or one that lends free) settles in credit.
    return { ask: num(body.pointsPerCu) ?? 0, forSaleCu: num(body.forSaleCu), remainingCu: num(body.remainingCu), reachable: true };
  } catch {
    return { ask: 0, forSaleCu: null, remainingCu: null, reachable: false };
  }
}

/** Borrower side: ask the peer its price, refuse if it is over our limit, otherwise run the job and pay. */
export async function borrowPriced(peerId: string, prompt: string, opts: PricedBorrowOptions = {}): Promise<JobResult & { peer: string }> {
  const file = opts.file ?? computeFile();
  const pf = opts.pointsFile ?? pointsFile();
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
  const peer = loadCompute(file).peers.find(p => p.id === peerId);
  if (!peer) throw new ComputeError("No such peer.", 404);

  const offer = await peerOffer(peer, doFetch);
  const ask = offer.ask;
  if (ask <= 0) return borrow(peerId, prompt, { file, fetchImpl: opts.fetchImpl, now: opts.now });

  const points = loadPoints(pf);
  const me = points.members.find(m => m.id === SELF_ID);
  const { bid, wantCu } = myLimit(opts);
  if (!canTrade(ask, bid)) {
    throw new ComputeError(`${peer.name} asks ${ask} points per CU and your limit is ${bid}. Raise it in Settings on /commons, or choose another computer.`, 409);
  }
  const affordable = floor6((me?.points ?? 0) / ask);
  const maxCu = Math.min(affordable, wantCu ?? Infinity, offer.forSaleCu ?? Infinity);
  if (maxCu <= 0) {
    throw new ComputeError(
      affordable <= 0 ? `${peer.name} asks ${ask} points per CU and you have ${round(me?.points ?? 0)}. Earn points on a project first.` : `${peer.name} has nothing left for sale at that price, or your buy orders are used up.`,
      402,
    );
  }

  let result: JobResult & { peer: string };
  try {
    result = await borrow(peerId, prompt, {
      file, fetchImpl: opts.fetchImpl, now: opts.now,
      settle: "points", maxCu, send: { maxPointsPerCu: bid },
    });
  } catch (err) {
    if (err instanceof ComputeError && typeof err.cu === "number" && err.cu > 0) {
      recordBorrow(peer.name, priceOf(err.cu, ask), pf);
      if (wantCu !== null) fill("buy", err.cu, opts.market, ask);
    }
    throw err;
  }
  const rate = result.pointsPerCu !== undefined && canTrade(result.pointsPerCu, bid) ? result.pointsPerCu : ask;
  const { paid } = recordBorrow(peer.name, priceOf(result.cu, rate), pf);
  if (wantCu !== null) fill("buy", result.cu, opts.market, rate);
  return { ...result, points: paid, pointsPerCu: rate };
}

export interface MatchedBorrow extends JobResult {
  peer: string;
  /** Who it was matched with, at what price, and who else was in the running. */
  matched: { peer: string; pointsPerCu: number; considered: Array<{ peer: string; pointsPerCu: number; cu: number | null }> };
}

/**
 * Matching: ask every computer you know what it charges, rank those at or
 * under your limit cheapest first, and try them in turn until one takes the job.
 * A computer that lends for credit counts as price 0, so a free friend is the
 * cheapest there is.
 */
export async function borrowBest(prompt: string, opts: PricedBorrowOptions = {}): Promise<MatchedBorrow> {
  const file = opts.file ?? computeFile();
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
  const peers = loadCompute(file).peers;
  if (peers.length === 0) throw new ComputeError("You do not know any computers to borrow from yet. Add one on the Sharing page.", 404);

  const { bid } = myLimit(opts);
  const seen = await Promise.all(peers.map(async p => ({ peer: p, offer: await peerOffer(p, doFetch) })));
  const live = seen.filter(s => s.offer.reachable && (s.offer.remainingCu === null || s.offer.remainingCu > 0));
  const asList: SellerOffer[] = live.map(s => ({
    id: s.peer.id, name: s.peer.name, pointsPerCu: s.offer.ask,
    cu: Math.min(s.offer.forSaleCu ?? Infinity, s.offer.remainingCu ?? Infinity),
  }));
  const ranked = rankSellers(asList, bid, 0.001);
  if (ranked.length === 0) {
    const cheapest = asList.slice().sort((a, b) => a.pointsPerCu - b.pointsPerCu)[0];
    throw new ComputeError(
      cheapest ? `The cheapest computer you know asks ${cheapest.pointsPerCu} points per CU and your limit is ${bid}. Raise it in Settings, or wait for a better price.` : "None of the computers you know can be reached right now.",
      409,
    );
  }
  const considered = asList.map(o => ({ peer: o.name, pointsPerCu: o.pointsPerCu, cu: Number.isFinite(o.cu) ? o.cu : null }));

  let lastError: unknown = null;
  for (const choice of ranked.slice(0, 3)) {
    try {
      const result = await borrowPriced(choice.id, prompt, opts);
      return { ...result, matched: { peer: choice.name, pointsPerCu: choice.pointsPerCu, considered } };
    } catch (err) {
      lastError = err;
      // A seller that turned us down (no room, price moved, busy, unreachable) is not the end: try the next cheapest.
      if (err instanceof ComputeError && [402, 403, 409, 429, 502].includes(err.status)) continue;
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new ComputeError("No computer took the job.", 502);
}
