/**
 * Compute sharing: lend this computer for a while, earn the right to use
 * someone else's.
 *
 * The situation this exists for: you are in a car with no power, your phone or
 * laptop cannot do much, and a computer you trust (your own at home, a friend's)
 * could. Lending is how you pay for that. Time you let someone use YOUR machine
 * earns credit; the credit is what you spend on THEIRS.
 *
 * ── The unit ───────────────────────────────────────────────────────────
 *
 * Credit is measured in Compute Units (CU), and a CU is work, not clock time.
 * An hour on a fast machine is worth more than an hour on a slow one, so each
 * machine times a short loop of integer arithmetic on itself (benchmarkMops)
 * and a job costs
 *
 *     CU = busy seconds x (this machine's Mops / REFERENCE_MOPS)
 *
 * "Busy" is the time a job actually ran on the lender, measured by the lender.
 * Idle time inside a lease costs nothing, because nothing was used.
 *
 * ── What a guest can do on your machine ────────────────────────────────
 *
 * Only the named jobs in JOB_KINDS, which the lender's own code implements.
 * A guest never sends code and never gets a shell, a file, or the desktop:
 * lending your computer means lending its thinking, not its keys. A lease is
 * also bounded three ways, whichever hits first: its hour limit, its CU cap,
 * and the owner revoking it.
 *
 * ── What this does NOT do (stated plainly) ─────────────────────────────
 *
 * The two ledgers are kept by two separate machines and nothing here makes a
 * dishonest guest pay. The lender's lease cap is the hard protection: it
 * bounds what any one lease can ever cost the lender. A guest who edits their
 * own ledger only cheats themselves of an honest record. Treat lending as you
 * would lending to a friend, not as a market.
 *
 * What the lender sees: the text of the jobs sent to it. A job is not private
 * from the machine that runs it. Say so wherever this is offered.
 *
 * State is per-device and never committed:
 *   ~/.neuroclaw/compute.json     (override: CORONA_COMPUTE_FILE)
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";

export class ComputeError extends Error {
  /** Set when the job used the machine before failing, so the borrower can be billed the same amount. */
  cu?: number;
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

/** Million integer operations per second that count as 1 CU per busy second. */
export const REFERENCE_MOPS = 1000;
/** What a guest may ask this machine to do. */
export const JOB_KINDS = ["chat"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

const MAX_LEASE_HOURS = 24;
const MAX_JOB_MS = 120_000;
const MAX_PROMPT_CHARS = 16_000;
const MAX_ENTRIES = 500;

export interface Lease {
  id: string;
  label: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  capCu: number;
  usedCu: number;
  revokedAt: number | null;
}
export type PublicLease = Omit<Lease, "tokenHash">;

/** A computer this device may borrow from. The lease token is a secret: it is the key to their machine. */
export interface Peer {
  id: string;
  name: string;
  baseUrl: string;
  leaseToken: string;
}
export type PublicPeer = Omit<Peer, "leaseToken">;

export interface LedgerEntry {
  at: number;
  /** "earned" lending, "spent" borrowing. */
  kind: "earned" | "spent";
  cu: number;
  who: string;
  note: string;
}

export interface ComputeState {
  /** This machine's measured Mops, or null before the first benchmark. */
  mops: number | null;
  balance: number;
  /**
   * How far below zero the balance may go. Two people who start at zero could
   * otherwise never borrow from each other: someone has to go first. This is
   * the same arrangement as a mutual-credit club -- a small overdraft that
   * lending pays back -- and 0 turns it off.
   */
  creditLimit: number;
  lending: { enabled: boolean };
  leases: Lease[];
  peers: Peer[];
  entries: LedgerEntry[];
}

export function computeFile(): string {
  return process.env.CORONA_COMPUTE_FILE
    ? path.resolve(process.env.CORONA_COMPUTE_FILE)
    : path.join(homedir(), ".neuroclaw", "compute.json");
}

const DEFAULT_CREDIT_LIMIT = 60;

const emptyState = (): ComputeState => ({ mops: null, balance: 0, creditLimit: DEFAULT_CREDIT_LIMIT, lending: { enabled: false }, leases: [], peers: [], entries: [] });

export function loadCompute(file = computeFile()): ComputeState {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<ComputeState>;
    const base = emptyState();
    return {
      mops: typeof raw.mops === "number" && raw.mops > 0 ? raw.mops : null,
      balance: typeof raw.balance === "number" && Number.isFinite(raw.balance) ? raw.balance : 0,
      creditLimit: typeof raw.creditLimit === "number" && raw.creditLimit >= 0 && raw.creditLimit <= 1000 ? raw.creditLimit : DEFAULT_CREDIT_LIMIT,
      // Lending defaults OFF and an unreadable file means off: a file we cannot
      // understand must never be the reason a stranger can use this machine.
      lending: { enabled: raw.lending?.enabled === true },
      leases: Array.isArray(raw.leases) ? raw.leases : base.leases,
      peers: Array.isArray(raw.peers) ? raw.peers : base.peers,
      entries: Array.isArray(raw.entries) ? raw.entries : base.entries,
    };
  } catch {
    return emptyState();
  }
}

function saveCompute(state: ComputeState, file = computeFile()): void {
  state.entries = state.entries.slice(-MAX_ENTRIES);
  mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, state);
  try {
    chmodSync(file, 0o600); // holds lease tokens for other people's machines
  } catch {
    // Not every filesystem has modes.
  }
}

const hash = (t: string): string => createHash("sha256").update(t).digest("hex");
const round = (n: number): number => Math.round(n * 1e6) / 1e6;
const pubLease = ({ tokenHash: _h, ...rest }: Lease): PublicLease => rest;
const pubPeer = ({ leaseToken: _t, ...rest }: Peer): PublicPeer => rest;

// ── Measuring this machine ─────────────────────────────────────────────

/**
 * Time a fixed integer loop on this machine. 32-bit multiply-xor-add is cheap
 * to run and hard for the engine to optimise away because each step depends on
 * the last. Returns million operations per second.
 */
export function benchmarkMops(durationMs = 150): number {
  const start = performance.now();
  let x = 0x9e3779b9 | 0;
  let ops = 0;
  while (performance.now() - start < durationMs) {
    for (let i = 0; i < 50_000; i++) x = (Math.imul(x, 1664525) + 1013904223) ^ (x >>> 7);
    ops += 50_000 * 3;
  }
  const seconds = (performance.now() - start) / 1000;
  // `x` is read so the loop has an observable result.
  return x === 0.5 ? 0 : Math.max(1, ops / seconds / 1e6);
}

/** The work in a stretch of busy time on a machine of the given speed. */
export const computeUnits = (busyMs: number, mops: number): number => round((Math.max(0, busyMs) / 1000) * (mops / REFERENCE_MOPS));

/** This machine's speed, measured once and remembered. */
export function machineMops(file = computeFile(), bench: () => number = benchmarkMops): number {
  const state = loadCompute(file);
  if (state.mops) return state.mops;
  state.mops = round(bench());
  saveCompute(state, file);
  return state.mops;
}

// ── Lending ────────────────────────────────────────────────────────────

export function setCreditLimit(limit: number, file = computeFile()): ComputeState {
  if (!Number.isFinite(limit) || limit < 0 || limit > 1000) throw new ComputeError("The credit limit is 0 to 1000 CU.");
  const state = loadCompute(file);
  state.creditLimit = round(limit);
  saveCompute(state, file);
  return state;
}

export function setLending(enabled: boolean, file = computeFile()): ComputeState {
  const state = loadCompute(file);
  state.lending.enabled = enabled;
  saveCompute(state, file);
  return state;
}

export interface GrantInput {
  label: string;
  hours: number;
  /** The most this lease can ever cost you, in CU. */
  capCu: number;
}

/** Let someone use this machine. The token is returned once; only its hash is kept. */
export function grantLease(input: GrantInput, file = computeFile(), now = Date.now()): { lease: PublicLease; token: string } {
  const state = loadCompute(file);
  if (!state.lending.enabled) throw new ComputeError("Lending is off. Turn it on before granting a lease.", 403);
  if (typeof input.label !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(input.label)) {
    throw new ComputeError("A lease label is letters, digits, spaces, '.', '-' and '_', up to 64 characters.");
  }
  if (!Number.isFinite(input.hours) || input.hours <= 0 || input.hours > MAX_LEASE_HOURS) {
    throw new ComputeError(`A lease runs more than 0 and at most ${MAX_LEASE_HOURS} hours.`);
  }
  if (!Number.isFinite(input.capCu) || input.capCu <= 0) {
    throw new ComputeError("A lease needs a CU cap above 0, so it has a limit on what it can use.");
  }
  const token = `cl_${randomBytes(32).toString("base64url")}`;
  const lease: Lease = {
    id: randomBytes(8).toString("hex"),
    label: input.label,
    tokenHash: hash(token),
    createdAt: now,
    expiresAt: now + input.hours * 3_600_000,
    capCu: round(input.capCu),
    usedCu: 0,
    revokedAt: null,
  };
  state.leases.push(lease);
  saveCompute(state, file);
  return { lease: pubLease(lease), token };
}

export function revokeLease(id: string, file = computeFile(), now = Date.now()): boolean {
  const state = loadCompute(file);
  const lease = state.leases.find(l => l.id === id && !l.revokedAt);
  if (!lease) return false;
  lease.revokedAt = now;
  saveCompute(state, file);
  return true;
}

/** Why a lease cannot be used right now, or null when it can. */
export function leaseProblem(lease: Lease, now = Date.now()): string | null {
  if (lease.revokedAt) return "This lease was revoked.";
  if (now >= lease.expiresAt) return "This lease has run out of time.";
  if (lease.usedCu >= lease.capCu) return "This lease has used all of its compute.";
  return null;
}

/** Find the lease a token belongs to, comparing every hash so position does not leak. */
function findLease(state: ComputeState, token: string | null): Lease | null {
  if (!token || token.length > 256) return null;
  const want = Buffer.from(hash(token), "hex");
  let found: Lease | null = null;
  for (const l of state.leases) {
    const have = Buffer.from(l.tokenHash, "hex");
    if (have.length === want.length && timingSafeEqual(have, want)) found = l;
  }
  return found;
}

export function leaseStatus(token: string | null, file = computeFile(), now = Date.now()): (PublicLease & { remainingCu: number; problem: string | null }) | null {
  const state = loadCompute(file);
  const lease = findLease(state, token);
  if (!lease) return null;
  return { ...pubLease(lease), remainingCu: round(Math.max(0, lease.capCu - lease.usedCu)), problem: leaseProblem(lease, now) };
}

/** What a job is allowed to do on the lender. Injected so tests (and a different brain) can stand in. */
export interface JobRunner {
  chat(prompt: string): Promise<string>;
}

export interface JobRequest {
  job: JobKind;
  prompt: string;
  /** The guest's own limit, so a guest can say "no more than my balance". */
  maxCu?: number;
}

export interface JobResult {
  result: string;
  cu: number;
  remainingCu: number;
  mops: number;
}

let hostBusy = false;

/**
 * Run one metered job for a guest.
 *
 * One job at a time on this machine: a lease is for sharing a computer, not
 * for turning it into a queue that starves its owner. The job is abandoned
 * (not killed -- JavaScript cannot) when it outlives the time its remaining
 * CU buys, and whatever time it did use is still charged.
 */
export async function runLeasedJob(
  token: string | null,
  req: JobRequest,
  runner: JobRunner,
  opts: { file?: string; now?: () => number; mops?: number } = {},
): Promise<JobResult> {
  const file = opts.file ?? computeFile();
  const now = opts.now ?? Date.now;
  const state = loadCompute(file);
  // Identify the caller before saying anything about this machine's state, so
  // a stranger learns nothing -- not even whether lending is on.
  const lease = findLease(state, token);
  if (!lease) throw new ComputeError("Unknown lease.", 401);
  if (!state.lending.enabled) throw new ComputeError("This computer is not lending right now.", 403);
  const problem = leaseProblem(lease, now());
  if (problem) throw new ComputeError(problem, 403);
  if (!(JOB_KINDS as readonly string[]).includes(req.job)) {
    throw new ComputeError(`Unknown job. This computer runs: ${JOB_KINDS.join(", ")}.`);
  }
  if (typeof req.prompt !== "string" || !req.prompt.trim() || req.prompt.length > MAX_PROMPT_CHARS) {
    throw new ComputeError(`A job needs a "prompt" of 1 to ${MAX_PROMPT_CHARS} characters.`);
  }
  if (hostBusy) throw new ComputeError("This computer is busy with another job. Try again shortly.", 429);

  const mops = opts.mops ?? machineMops(file);
  const guestLimit = typeof req.maxCu === "number" && req.maxCu > 0 ? req.maxCu : Infinity;
  const affordableCu = Math.min(lease.capCu - lease.usedCu, guestLimit);
  // How long that many CU buys on this machine, bounded so a job cannot sit forever.
  const budgetMs = Math.min(MAX_JOB_MS, (affordableCu / (mops / REFERENCE_MOPS)) * 1000);
  if (budgetMs < 50) throw new ComputeError("Not enough compute left for a job.", 403);

  hostBusy = true;
  const started = now();
  let result = "";
  let failure: unknown = null;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ComputeError("The job ran past the compute it was allowed.", 408)), budgetMs);
    });
    try {
      result = await Promise.race([runner.chat(req.prompt), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err) {
    failure = err;
  } finally {
    hostBusy = false;
  }

  // Charged whether the job finished, failed or timed out: it used the machine.
  // Re-read the state, since it may have changed while the job ran (revoked, another save).
  const busyMs = Math.min(now() - started, budgetMs);
  const fresh = loadCompute(file);
  const live = fresh.leases.find(l => l.id === lease.id);
  let charge = 0;
  if (live) {
    charge = Math.min(computeUnits(busyMs, mops), Math.max(0, live.capCu - live.usedCu));
    if (charge > 0) {
      live.usedCu = round(live.usedCu + charge);
      fresh.balance = round(fresh.balance + charge);
      fresh.entries.push({ at: now(), kind: "earned", cu: charge, who: live.label, note: `lent ${(busyMs / 1000).toFixed(1)}s of compute` });
      saveCompute(fresh, file);
    }
  }
  if (failure) {
    // Tell the borrower what it cost, so both ledgers agree even when the job did not finish.
    if (failure instanceof ComputeError) failure.cu = round(charge);
    throw failure;
  }
  return { result, cu: round(charge), remainingCu: round(live ? Math.max(0, live.capCu - live.usedCu) : 0), mops };
}

// ── Borrowing ──────────────────────────────────────────────────────────

export function addPeer(input: { name: string; baseUrl: string; leaseToken: string }, file = computeFile()): PublicPeer {
  if (typeof input.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(input.name)) {
    throw new ComputeError("A peer name is letters, digits, spaces, '.', '-' and '_', up to 64 characters.");
  }
  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    throw new ComputeError("\"baseUrl\" must be a full URL such as http://192.168.1.20:7861.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ComputeError("\"baseUrl\" must be http or https.");
  if (url.username || url.password) throw new ComputeError("Do not put a password in the URL; the lease token is sent as a header.");
  if (typeof input.leaseToken !== "string" || !input.leaseToken.startsWith("cl_") || input.leaseToken.length > 256) {
    throw new ComputeError("That does not look like a lease token (they start with cl_).");
  }
  const state = loadCompute(file);
  if (state.peers.some(p => p.name.toLowerCase() === input.name.toLowerCase())) {
    throw new ComputeError(`A peer called "${input.name}" already exists.`);
  }
  const peer: Peer = { id: randomBytes(8).toString("hex"), name: input.name, baseUrl: url.origin, leaseToken: input.leaseToken };
  state.peers.push(peer);
  saveCompute(state, file);
  return pubPeer(peer);
}

export function removePeer(id: string, file = computeFile()): boolean {
  const state = loadCompute(file);
  const before = state.peers.length;
  state.peers = state.peers.filter(p => p.id !== id);
  if (state.peers.length === before) return false;
  saveCompute(state, file);
  return true;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * Send a job to a peer's computer and pay for it.
 *
 * Spends what this device has earned plus its credit limit. The peer is told
 * that total as the most this job may cost, so even a peer that over-meters
 * cannot take more, and the debit is clamped to it besides.
 */
export async function borrow(
  peerId: string,
  prompt: string,
  opts: { file?: string; fetchImpl?: FetchLike; now?: () => number } = {},
): Promise<JobResult & { peer: string }> {
  const file = opts.file ?? computeFile();
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
  const state = loadCompute(file);
  const peer = state.peers.find(p => p.id === peerId);
  if (!peer) throw new ComputeError("No such peer.", 404);
  const spendable = round(state.balance + state.creditLimit);
  if (spendable <= 0) {
    throw new ComputeError("No compute credit to spend. Lend this computer to earn some first.", 402);
  }
  let res;
  try {
    res = await doFetch(`${peer.baseUrl}/api/corona/v1/compute/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${peer.leaseToken}` },
      body: JSON.stringify({ job: "chat", prompt, maxCu: spendable }),
      signal: AbortSignal.timeout(MAX_JOB_MS + 15_000),
    });
  } catch (err) {
    throw new ComputeError(`Could not reach ${peer.name}: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
  const body = (await res.json().catch(() => null)) as Partial<JobResult> & { error?: string } | null;
  if (!res.ok || !body || typeof body.result !== "string") {
    // A peer that ran the job and then failed it still used its machine. Pay for that.
    const owed = round(Math.max(0, Number(body?.cu) || 0));
    if (owed > 0) {
      const after = loadCompute(file);
      const paid = round(Math.min(owed, Math.max(0, after.balance + after.creditLimit)));
      after.balance = round(after.balance - paid);
      after.entries.push({ at: (opts.now ?? Date.now)(), kind: "spent", cu: paid, who: peer.name, note: "borrowed compute (job did not finish)" });
      saveCompute(after, file);
    }
    throw new ComputeError(body?.error ?? `${peer.name} answered ${res.status}.`, res.status === 401 || res.status === 403 || res.status === 429 ? res.status : 502);
  }
  const fresh = loadCompute(file);
  const charged = round(Math.min(Math.max(0, Number(body.cu) || 0), Math.max(0, fresh.balance + fresh.creditLimit)));
  fresh.balance = round(fresh.balance - charged);
  if (charged > 0) {
    fresh.entries.push({ at: (opts.now ?? Date.now)(), kind: "spent", cu: charged, who: peer.name, note: "borrowed compute" });
  }
  saveCompute(fresh, file);
  return { result: body.result, cu: charged, remainingCu: Number(body.remainingCu) || 0, mops: Number(body.mops) || 0, peer: peer.name };
}

// ── For the UI ─────────────────────────────────────────────────────────

export interface ComputeSummary {
  mops: number | null;
  balance: number;
  creditLimit: number;
  lending: boolean;
  leases: Array<PublicLease & { remainingCu: number; problem: string | null }>;
  peers: PublicPeer[];
  entries: LedgerEntry[];
}

export function computeSummary(file = computeFile(), now = Date.now()): ComputeSummary {
  const s = loadCompute(file);
  return {
    mops: s.mops,
    balance: round(s.balance),
    creditLimit: s.creditLimit,
    lending: s.lending.enabled,
    leases: s.leases.map(l => ({ ...pubLease(l), remainingCu: round(Math.max(0, l.capCu - l.usedCu)), problem: leaseProblem(l, now) })),
    peers: s.peers.map(pubPeer),
    entries: s.entries.slice(-50).reverse(),
  };
}
