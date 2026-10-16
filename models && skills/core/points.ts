/**
 * Points: what people and AIs earn for working together, and spend on
 * compute.
 *
 * ── Where points come from (and why there is a ceiling) ────────────────
 *
 * Points are only ever created in three bounded ways, so the pile cannot
 * grow without limit:
 *
 *   1. A project's pot (projects.ts). Fixed when the project is made and never
 *      increased; tasks are paid out of it and the remainder is never minted
 *      later. This is the "final amount of points" for a project.
 *   2. A referral bonus: a fixed number of points, paid once per person you
 *      added, and only after that person has done real work (see award()) --
 *      adding a name alone pays nothing -- and at most `referralCap` times.
 *   3. Nothing else. Trading compute MOVES points from the borrower to the
 *      lender (recordBorrow / recordLend); it never makes new ones.
 *
 * ── The exchange rate ──────────────────────────────────────────────────
 *
 * Two numbers, both set in Settings on /commons and both in points per
 * Compute Unit (CU, see compute-share.ts):
 *
 *   ask  what THIS computer charges for each CU it lends   ("I'll lend 1 CU
 *        for 2 points"). 0, the default, lends for compute credit instead, so
 *        a friend with no points can still borrow.
 *   bid  the most this device will pay for each CU it borrows
 *
 * A trade happens only when the lender's ask is at or under the borrower's
 * bid. The borrower pays the ask, not the bid, so a high bid is a ceiling,
 * not an offer.
 *
 * ── What this does NOT do (stated plainly) ─────────────────────────────
 *
 * Like compute-share.ts, this is a ledger kept on one device. Two devices
 * each keep their own copy of a trade and nothing here makes a dishonest one
 * pay. The leaderboard ranks the people and AIs THIS device has dealt with.
 * It is a club scoreboard, not a bank.
 *
 * State is per-device and never committed:
 *   ~/.neuroclaw/points.json     (override: CORONA_POINTS_FILE)
 */

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";

export class PointsError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

/** 0 = lend for compute credit, as before. A lender opts in to charging points by setting a price in Settings. */
export const DEFAULT_ASK = 0;
export const DEFAULT_BID = 2;
export const MAX_RATE = 1000;
export const REFERRAL_BONUS = 25;
export const REFERRAL_CAP = 20;
export const SELF_ID = "me";
const MAX_MEMBERS = 500;
const MAX_ENTRIES = 500;

export type MemberKind = "person" | "agent" | "peer";

export interface Member {
  id: string;
  name: string;
  kind: MemberKind;
  /** Spendable balance. */
  points: number;
  /** Lifetime points earned from work. The leaderboard ranks on this, so spending does not cost you your place. */
  earned: number;
  joinedAt: number;
  /** Who added this member, if anyone did. */
  referredBy: string | null;
  /** Whether the referrer has been paid for adding this member. */
  referralPaid: boolean;
}

export type EntryKind = "task" | "project" | "referral" | "lend" | "borrow";

export interface PointsEntry {
  at: number;
  member: string;
  /** Positive when points came in, negative when they went out. */
  delta: number;
  kind: EntryKind;
  note: string;
}

export interface PointsState {
  members: Member[];
  /** Points per CU this device charges when lending. */
  ask: number;
  /** Most points per CU this device pays when borrowing. */
  bid: number;
  entries: PointsEntry[];
}

export function pointsFile(): string {
  return process.env.CORONA_POINTS_FILE
    ? path.resolve(process.env.CORONA_POINTS_FILE)
    : path.join(homedir(), ".neuroclaw", "points.json");
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;

const freshSelf = (now = Date.now()): Member => ({
  id: SELF_ID, name: "You", kind: "person", points: 0, earned: 0, joinedAt: now, referredBy: null, referralPaid: true,
});

const emptyState = (): PointsState => ({ members: [freshSelf()], ask: DEFAULT_ASK, bid: DEFAULT_BID, entries: [] });

function cleanMember(raw: unknown): Member | null {
  const m = raw as Partial<Member> | null;
  if (!m || typeof m !== "object" || typeof m.id !== "string" || !ID_RE.test(m.id)) return null;
  if (typeof m.name !== "string" || !m.name || m.name.length > 64) return null;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  return {
    id: m.id,
    name: m.name,
    kind: m.kind === "agent" || m.kind === "peer" ? m.kind : "person",
    points: num(m.points),
    earned: num(m.earned),
    joinedAt: typeof m.joinedAt === "number" ? m.joinedAt : 0,
    referredBy: typeof m.referredBy === "string" ? m.referredBy : null,
    referralPaid: m.referralPaid === true,
  };
}

export function loadPoints(file = pointsFile()): PointsState {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<PointsState>;
    const members = (Array.isArray(raw.members) ? raw.members : []).map(cleanMember).filter((m): m is Member => m !== null);
    if (!members.some(m => m.id === SELF_ID)) members.unshift(freshSelf());
    const rate = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_RATE ? v : d);
    return {
      members,
      ask: rate(raw.ask, DEFAULT_ASK),
      bid: rate(raw.bid, DEFAULT_BID),
      entries: Array.isArray(raw.entries) ? raw.entries.slice(-MAX_ENTRIES) : [],
    };
  } catch {
    return emptyState();
  }
}

function savePoints(state: PointsState, file: string): void {
  state.entries = state.entries.slice(-MAX_ENTRIES);
  mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, state);
  try {
    chmodSync(file, 0o600);
  } catch {
    // Not every filesystem has modes.
  }
}

const find = (state: PointsState, id: string): Member | undefined => state.members.find(m => m.id === id);

function need(state: PointsState, id: string): Member {
  const m = find(state, id);
  if (!m) throw new PointsError("No such member.", 404);
  return m;
}

function positive(n: number, what = "points"): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) throw new PointsError(`The number of ${what} must be above 0.`);
  return round(n);
}

// ── Settings ───────────────────────────────────────────────────────────

/** The exchange rate. Either number may be left out to keep it; 0 for ask means "I lend for credit, not points". */
export function setRates(input: { ask?: number; bid?: number }, file = pointsFile()): PointsState {
  const state = loadPoints(file);
  for (const [key, value] of [["ask", input.ask], ["bid", input.bid]] as const) {
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_RATE) {
      throw new PointsError(`The ${key} is 0 to ${MAX_RATE} points per CU.`);
    }
    state[key] = round(value);
  }
  savePoints(state, file);
  return state;
}

export function setSelfName(name: string, file = pointsFile()): PointsState {
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new PointsError("A name is letters, digits, spaces, '.', '-' and '_', up to 64 characters.");
  const state = loadPoints(file);
  if (state.members.some(m => m.id !== SELF_ID && m.name.toLowerCase() === name.toLowerCase())) throw new PointsError(`"${name}" is already taken.`);
  need(state, SELF_ID).name = name;
  savePoints(state, file);
  return state;
}

/** Whether a lender asking `ask` and a borrower willing to pay up to `bid` can trade. */
export const canTrade = (ask: number, bid: number): boolean => ask <= bid;

/** What a job of `cu` costs at `ask` points per CU. */
export const priceOf = (cu: number, ask: number): number => round(Math.max(0, cu) * Math.max(0, ask));

// ── People and AIs ─────────────────────────────────────────────────────

export interface AddMemberOptions {
  kind?: MemberKind;
  /** Who gets the referral bonus. Defaults to this device's owner for a person; agents and peers refer no one. */
  referredBy?: string | null;
  /** A fixed id, for AIs whose identity comes from somewhere else (a hive agent's id). */
  id?: string;
}

export function addMember(name: string, opts: AddMemberOptions = {}, file = pointsFile(), now = Date.now()): Member {
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new PointsError("A name is letters, digits, spaces, '.', '-' and '_', up to 64 characters.");
  const state = loadPoints(file);
  if (state.members.length >= MAX_MEMBERS) throw new PointsError(`This device tracks at most ${MAX_MEMBERS} members.`);
  if (state.members.some(m => m.name.toLowerCase() === name.toLowerCase())) throw new PointsError(`"${name}" is already on the board.`);
  const kind = opts.kind ?? "person";
  const id = opts.id ?? randomBytes(6).toString("hex");
  if (!ID_RE.test(id) || find(state, id)) throw new PointsError("That id is invalid or already used.");
  let referredBy: string | null = null;
  if (kind === "person") {
    referredBy = opts.referredBy === undefined ? SELF_ID : opts.referredBy;
    if (referredBy !== null) need(state, referredBy);
  }
  const member: Member = { id, name, kind, points: 0, earned: 0, joinedAt: now, referredBy, referralPaid: referredBy === null };
  state.members.push(member);
  savePoints(state, file);
  return member;
}

/** The member with this id, creating it if it is new. For AIs and peers whose identity is not typed in by a person. */
export function ensureMember(id: string, name: string, kind: MemberKind, file = pointsFile()): Member {
  const state = loadPoints(file);
  const have = find(state, id);
  if (have) return have;
  let unique = name.replace(/[^A-Za-z0-9 ._-]/g, "").trim().slice(0, 60) || kind;
  if (!/^[A-Za-z0-9]/.test(unique)) unique = `x${unique}`.slice(0, 64);
  let candidate = unique;
  for (let n = 2; state.members.some(m => m.name.toLowerCase() === candidate.toLowerCase()); n++) candidate = `${unique} ${n}`;
  return addMember(candidate, { kind, id, referredBy: null }, file);
}

// ── Moving points ──────────────────────────────────────────────────────

function log(state: PointsState, member: string, delta: number, kind: EntryKind, note: string, now: number): void {
  state.entries.push({ at: now, member, delta: round(delta), kind, note: note.slice(0, 200) });
}

/**
 * Pay a member for work. This is the one place points are earned, and it is
 * where the referral bonus is released: the first time someone you added does
 * paid work, you are paid once for adding them.
 */
export function award(memberId: string, amount: number, kind: Exclude<EntryKind, "borrow" | "referral">, note: string, file = pointsFile(), now = Date.now()): Member {
  const pts = positive(amount);
  const state = loadPoints(file);
  const member = need(state, memberId);
  member.points = round(member.points + pts);
  member.earned = round(member.earned + pts);
  log(state, member.id, pts, kind, note, now);

  if (member.referredBy && !member.referralPaid) {
    member.referralPaid = true; // settled either way, so a full referrer is not re-checked forever
    const referrer = find(state, member.referredBy);
    if (referrer) {
      const paidSoFar = state.members.filter(m => m.referredBy === referrer.id && m.referralPaid && m.id !== member.id).length;
      if (paidSoFar < REFERRAL_CAP) {
        referrer.points = round(referrer.points + REFERRAL_BONUS);
        referrer.earned = round(referrer.earned + REFERRAL_BONUS);
        log(state, referrer.id, REFERRAL_BONUS, "referral", `${member.name} did their first paid work`, now);
      }
    }
  }
  savePoints(state, file);
  return member;
}

/** Take points out of a balance. Never below zero. */
export function spend(memberId: string, amount: number, kind: "borrow", note: string, file = pointsFile(), now = Date.now()): Member {
  const pts = positive(amount);
  const state = loadPoints(file);
  const member = need(state, memberId);
  if (member.points + 1e-9 < pts) throw new PointsError(`Not enough points: ${round(member.points)} available, ${pts} needed.`, 402);
  member.points = round(Math.max(0, member.points - pts));
  log(state, member.id, -pts, kind, note, now);
  savePoints(state, file);
  return member;
}

/**
 * This device lent compute and was paid `points` for it. Credits the owner and
 * notes who borrowed. Zero is a no-op: a lender who asks nothing is paid in
 * compute credit instead (compute-share.ts).
 */
export function recordLend(guest: string, points: number, file = pointsFile(), now = Date.now()): void {
  if (!(points > 0)) return;
  const state = loadPoints(file);
  const me = need(state, SELF_ID);
  const pts = round(points);
  me.points = round(me.points + pts);
  me.earned = round(me.earned + pts);
  log(state, SELF_ID, pts, "lend", `lent compute to ${guest}`, now);
  savePoints(state, file);
}

/**
 * This device borrowed compute and owes `points`. The points move to the
 * lender, who is added to the board as a peer if this is the first dealing, so
 * the board shows who you have been trading with. Never takes more than the
 * balance: the caller bounds the job by what it can afford before running it.
 */
export function recordBorrow(peerName: string, points: number, file = pointsFile(), now = Date.now()): { paid: number } {
  if (!(points > 0)) return { paid: 0 };
  const state = loadPoints(file);
  const me = need(state, SELF_ID);
  const pts = round(Math.min(points, me.points));
  if (pts <= 0) return { paid: 0 };
  me.points = round(me.points - pts);
  log(state, SELF_ID, -pts, "borrow", `borrowed compute from ${peerName}`, now);
  let peer = state.members.find(m => m.kind === "peer" && m.name === peerName);
  if (!peer) {
    const name = peerName.slice(0, 64);
    peer = {
      id: `peer-${randomBytes(5).toString("hex")}`,
      name: state.members.some(m => m.name.toLowerCase() === name.toLowerCase()) ? `${name.slice(0, 58)} (peer)` : name,
      kind: "peer", points: 0, earned: 0, joinedAt: now, referredBy: null, referralPaid: true,
    };
    state.members.push(peer);
  }
  peer.points = round(peer.points + pts);
  peer.earned = round(peer.earned + pts);
  log(state, peer.id, pts, "lend", `lent compute to you`, now);
  savePoints(state, file);
  return { paid: pts };
}

// ── For the UI ─────────────────────────────────────────────────────────

export interface Standing extends Member {
  rank: number;
  isYou: boolean;
}

/** Everyone, most earned first. Ties share the lower rank number and are ordered by name so the order is stable. */
export function leaderboard(file = pointsFile(), limit = 50): Standing[] {
  const state = loadPoints(file);
  const sorted = state.members.slice().sort((a, b) => b.earned - a.earned || a.name.localeCompare(b.name));
  let rank = 0;
  let last = Number.NaN;
  return sorted.slice(0, limit).map((m, i) => {
    if (m.earned !== last) rank = i + 1;
    last = m.earned;
    return { ...m, rank, isYou: m.id === SELF_ID };
  });
}

export interface PointsSummary {
  you: Member;
  ask: number;
  bid: number;
  referral: { bonus: number; cap: number; paid: number; waiting: number };
  board: Standing[];
  entries: PointsEntry[];
}

export function pointsSummary(file = pointsFile()): PointsSummary {
  const state = loadPoints(file);
  const mine = state.members.filter(m => m.referredBy === SELF_ID);
  return {
    you: need(state, SELF_ID),
    ask: state.ask,
    bid: state.bid,
    referral: { bonus: REFERRAL_BONUS, cap: REFERRAL_CAP, paid: mine.filter(m => m.referralPaid).length, waiting: mine.filter(m => !m.referralPaid).length },
    board: leaderboard(file),
    entries: state.entries.slice(-50).reverse(),
  };
}
