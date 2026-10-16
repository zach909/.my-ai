/**
 * Compute for points: the price tag on lending and borrowing.
 *
 * compute-share.ts measures work in Compute Units (CU) and, with nothing else
 * in play, settles in compute credit between friends. This puts a price in
 * points (points.ts) on top, using the exchange rate each person sets in
 * Settings:
 *
 *   lender    ask  points per CU it charges
 *   borrower  bid  most points per CU it will pay
 *
 * ── The protocol, so neither side can be surprised ─────────────────────
 *
 *   1. The borrower asks the lease endpoint what the lender charges
 *      (`pointsPerCu`, in the lease status).
 *   2. If that is above the borrower's bid, the borrower stops. Nothing is
 *      sent, nothing is spent.
 *   3. Otherwise the borrower sends the job with `maxPointsPerCu` = its bid and
 *      `maxCu` = the most its points can buy at that ask.
 *   4. The lender re-checks ask <= maxPointsPerCu (the ask may have changed
 *      since step 1) and refuses with 409 if not. A lender that charges
 *      points refuses a borrower that did not say what it will pay (402), so
 *      an older borrower cannot get a priced job for nothing.
 *   5. The lender runs the job and credits its own points for the CU it
 *      metered. The borrower pays the same, at the ask it was quoted.
 *
 * A lender whose ask is 0 settles the old way, in compute credit, and none of
 * this applies. That is the setting for lending to a friend for free.
 *
 * A job that used the machine and then failed is still paid for, on both
 * sides, exactly as compute-share.ts already does for credit.
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
  type PublicLease,
} from "./compute-share.js";
import { SELF_ID, canTrade, loadPoints, pointsFile, priceOf, recordBorrow, recordLend } from "./points.js";

const round = (n: number): number => Math.round(n * 1e6) / 1e6;
/** Round down, so a borrower is never told it can buy more than its points cover. */
const floor6 = (n: number): number => Math.floor(n * 1e6) / 1e6;

export type LeaseOffer = PublicLease & { remainingCu: number; problem: string | null; pointsPerCu: number };

/** What the lease endpoint tells a borrower: the lease, plus what this computer charges. */
export function leaseOffer(token: string | null, opts: { file?: string; pointsFile?: string; now?: number } = {}): LeaseOffer | null {
  const st = leaseStatus(token, opts.file ?? computeFile(), opts.now ?? Date.now());
  if (!st) return null;
  return { ...st, pointsPerCu: loadPoints(opts.pointsFile ?? pointsFile()).ask };
}

export interface PricedJobOptions {
  file?: string;
  pointsFile?: string;
  now?: () => number;
  mops?: number;
}

/**
 * Lender side: run one job for a guest, charging this computer's ask.
 * Identifies the guest before saying anything about the price, so a stranger
 * learns nothing about how this computer is set up.
 */
export async function runPricedJob(token: string | null, req: JobRequest, runner: JobRunner, opts: PricedJobOptions = {}): Promise<JobResult> {
  const file = opts.file ?? computeFile();
  const pf = opts.pointsFile ?? pointsFile();
  const lease = leaseStatus(token, file, (opts.now ?? Date.now)());
  if (!lease) throw new ComputeError("Unknown lease.", 401);
  const ask = loadPoints(pf).ask;

  if (ask > 0) {
    if (typeof req.maxPointsPerCu !== "number" || !Number.isFinite(req.maxPointsPerCu)) {
      throw new ComputeError(`This computer charges ${ask} points per CU. Say how many you will pay ("maxPointsPerCu"), or ask the owner to lend for compute credit.`, 402);
    }
    if (!canTrade(ask, req.maxPointsPerCu)) {
      throw new ComputeError(`This computer asks ${ask} points per CU and you offered up to ${req.maxPointsPerCu}.`, 409);
    }
  }

  const run = { file, now: opts.now, mops: opts.mops, settle: ask > 0 ? ("points" as const) : ("credit" as const) };
  let result: JobResult;
  try {
    result = await runLeasedJob(token, req, runner, run);
  } catch (err) {
    // The job used the machine before it failed: that is paid for too.
    if (ask > 0 && err instanceof ComputeError && typeof err.cu === "number" && err.cu > 0) recordLend(lease.label, priceOf(err.cu, ask), pf);
    throw err;
  }
  if (ask <= 0) return result;
  const points = priceOf(result.cu, ask);
  recordLend(lease.label, points, pf);
  return { ...result, points, pointsPerCu: ask };
}

export interface PricedBorrowOptions {
  file?: string;
  pointsFile?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

/** Borrower side: ask the peer its price, refuse if it is over our bid, otherwise run the job and pay. */
export async function borrowPriced(peerId: string, prompt: string, opts: PricedBorrowOptions = {}): Promise<JobResult & { peer: string }> {
  const file = opts.file ?? computeFile();
  const pf = opts.pointsFile ?? pointsFile();
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
  const peer = loadCompute(file).peers.find(p => p.id === peerId);
  if (!peer) throw new ComputeError("No such peer.", 404);

  let ask = 0;
  try {
    const res = await doFetch(`${peer.baseUrl}/api/corona/v1/compute/lease`, {
      method: "GET",
      headers: { Authorization: `Bearer ${peer.leaseToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { pointsPerCu?: unknown } | null;
    // A peer that does not say (an older version, or one that lends free) settles in credit.
    if (res.ok && typeof body?.pointsPerCu === "number" && Number.isFinite(body.pointsPerCu) && body.pointsPerCu > 0) ask = body.pointsPerCu;
  } catch {
    // Fall through: if the peer is really unreachable, borrow() says so with a proper message.
  }
  if (ask <= 0) return borrow(peerId, prompt, { file, fetchImpl: opts.fetchImpl, now: opts.now });

  const points = loadPoints(pf);
  const me = points.members.find(m => m.id === SELF_ID);
  if (!canTrade(ask, points.bid)) {
    throw new ComputeError(`${peer.name} asks ${ask} points per CU and your limit is ${points.bid}. Raise it in Settings on /commons, or choose another computer.`, 409);
  }
  const maxCu = floor6((me?.points ?? 0) / ask);
  if (maxCu <= 0) {
    throw new ComputeError(`${peer.name} asks ${ask} points per CU and you have ${round(me?.points ?? 0)}. Earn points on a project first.`, 402);
  }

  let result: JobResult & { peer: string };
  try {
    result = await borrow(peerId, prompt, {
      file, fetchImpl: opts.fetchImpl, now: opts.now,
      settle: "points", maxCu, send: { maxPointsPerCu: points.bid },
    });
  } catch (err) {
    if (err instanceof ComputeError && typeof err.cu === "number" && err.cu > 0) recordBorrow(peer.name, priceOf(err.cu, ask), pf);
    throw err;
  }
  const rate = result.pointsPerCu !== undefined && canTrade(result.pointsPerCu, points.bid) ? result.pointsPerCu : ask;
  const { paid } = recordBorrow(peer.name, priceOf(result.cu, rate), pf);
  return { ...result, points: paid, pointsPerCu: rate };
}
