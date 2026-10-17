/**
 * Schedule: have the agent do something later, or over and over.
 *
 *   "in 30 minutes"            once, then it is done
 *   "every 2 hours"            repeating, from now
 *   "daily at 9am"             every day at that time
 *   "tomorrow at 14:30"        once
 *   "at 2026-10-17 09:00"      once
 *
 * What gets done is one of four things: a message to the agent (the same as
 * typing it in chat), a round of work on a project's hive, a pass of the agent
 * filing things into folders, or a cycle of one of your experts.
 *
 * ── It is not a way round the safety rules ─────────────────────────────
 *
 * A scheduled message goes to the agent by the same path as a typed one, so a
 * risky tool (terminal, email, files, ...) is held for approval (tool-safety.ts)
 * exactly as it would be if you had typed it. Nobody being there does not make
 * it go: the request waits in Settings until you decide, unless you have turned
 * on complete access.
 *
 * ── Gentle on purpose ──────────────────────────────────────────────────
 *
 *   - Nothing runs more often than every MIN_EVERY_MINUTES.
 *   - Due items run one after another, never at once, because they share the
 *     one brain.
 *   - A run that was missed while the server was off happens once when it comes
 *     back, never once per missed time.
 *   - After MAX_FAILURES failures in a row a schedule pauses itself.
 *
 * Times are the server's local time.
 *
 * State is per-device: ~/.neuroclaw/schedules.json (override CORONA_SCHEDULE_FILE).
 */

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";
import { dataFile } from "./user-context.js";


export class ScheduleError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

export const MIN_EVERY_MINUTES = 5;
export const MAX_EVERY_MINUTES = 30 * 24 * 60;
export const MAX_SCHEDULES = 30;
export const MAX_FAILURES = 5;
export const MAX_MESSAGE_CHARS = 500;
const MAX_HISTORY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export type When =
  | { type: "once"; at: number }
  | { type: "every"; minutes: number }
  | { type: "daily"; hour: number; minute: number };

export type Action =
  | { kind: "chat"; message: string }
  | { kind: "hive"; projectId: string }
  | { kind: "organize" }
  | { kind: "expert"; expertId: string };

export interface Run {
  at: number;
  ok: boolean;
  result: string;
}

export interface Schedule {
  id: string;
  name: string;
  action: Action;
  when: When;
  enabled: boolean;
  /** When it next runs, or null once a one-off has run. */
  nextAt: number | null;
  lastRunAt: number | null;
  runs: number;
  failures: number;
  createdAt: number;
  history: Run[];
}

export interface ScheduleCtx {
  file?: string;
  now?: () => number;
}

export function schedulesFile(): string {
  return process.env.CORONA_SCHEDULE_FILE ? path.resolve(process.env.CORONA_SCHEDULE_FILE) : dataFile("schedules.json");
}
const fileOf = (c: ScheduleCtx): string => c.file ?? schedulesFile();
const nowOf = (c: ScheduleCtx): number => (c.now ?? Date.now)();

// ── Reading a time ─────────────────────────────────────────────────────

/** "9", "9:30", "9am", "2:15 pm", "14:30" as an hour and minute. Null if it is not a time. */
export function parseClock(text: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const ap = m[3]?.toLowerCase();
  if (ap) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (ap === "pm" ? 12 : 0);
  }
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : null;
}

const UNIT_MIN: Record<string, number> = { minute: 1, minutes: 1, min: 1, mins: 1, hour: 60, hours: 60, hr: 60, hrs: 60, day: 1440, days: 1440 };

function atClock(base: number, c: { hour: number; minute: number }, plusDays = 0): number {
  const d = new Date(base);
  d.setHours(c.hour, c.minute, 0, 0);
  return d.getTime() + plusDays * DAY_MS;
}

/**
 * The next time `when` is due, strictly after `now`. For a one-off that is its
 * own time, or null if it is already past.
 */
export function nextAfter(when: When, now: number): number | null {
  if (when.type === "once") return when.at > now ? when.at : null;
  if (when.type === "every") return now + when.minutes * 60_000;
  let t = atClock(now, when);
  if (t <= now) {
    const d = new Date(t);
    d.setDate(d.getDate() + 1); // a calendar day, so a clock change does not shift the hour
    t = d.getTime();
  }
  return t;
}

/** Turns "in 30 minutes", "daily at 9am" and friends into a When. Null if it is not one of those. */
export function parseWhen(text: string, now: number): When | null {
  const t = String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  let m: RegExpExecArray | null;

  if ((m = /^in (\d+(?:\.\d+)?) ?(minutes?|mins?|hours?|hrs?|days?)$/.exec(t))) {
    return { type: "once", at: now + Math.round(Number(m[1]) * UNIT_MIN[m[2]] * 60_000) };
  }
  if ((m = /^every (\d+(?:\.\d+)?) ?(minutes?|mins?|hours?|hrs?|days?)$/.exec(t))) {
    return { type: "every", minutes: Math.round(Number(m[1]) * UNIT_MIN[m[2]]) };
  }
  if ((m = /^every (minute|hour|day)$/.exec(t))) return { type: "every", minutes: UNIT_MIN[m[1]] };
  if ((m = /^(?:daily|every day|each day|every morning|every night)(?: at (.+))?$/.exec(t))) {
    const c = m[1] ? parseClock(m[1]) : t.endsWith("night") ? { hour: 21, minute: 0 } : { hour: 9, minute: 0 };
    return c ? { type: "daily", ...c } : null;
  }
  if ((m = /^tomorrow(?: at (.+))?$/.exec(t))) {
    const c = m[1] ? parseClock(m[1]) : { hour: 9, minute: 0 };
    return c ? { type: "once", at: atClock(now, c, 1) } : null;
  }
  if ((m = /^(?:at )?(\d{4})-(\d{2})-(\d{2})(?: (?:at )?(.+))?$/.exec(t))) {
    const c = m[4] ? parseClock(m[4]) : { hour: 9, minute: 0 };
    if (!c) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), c.hour, c.minute, 0, 0);
    return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 ? null : { type: "once", at: d.getTime() };
  }
  if ((m = /^at (.+)$/.exec(t))) {
    const c = parseClock(m[1]);
    if (!c) return null;
    const today = atClock(now, c);
    return { type: "once", at: today > now ? today : atClock(now, c, 1) };
  }
  return null;
}

export const WHEN_HELP = 'Say when like "in 30 minutes", "every 2 hours", "daily at 9am", "tomorrow at 14:30" or "at 2026-10-17 09:00".';

function checkWhen(when: When, now: number): void {
  if (when.type === "once") {
    if (!Number.isFinite(when.at) || when.at <= now) throw new ScheduleError("That time has already passed.");
    if (when.at > now + 366 * DAY_MS) throw new ScheduleError("That is more than a year away.");
  } else if (when.type === "every") {
    if (!Number.isFinite(when.minutes) || when.minutes < MIN_EVERY_MINUTES) throw new ScheduleError(`It cannot run more often than every ${MIN_EVERY_MINUTES} minutes.`);
    if (when.minutes > MAX_EVERY_MINUTES) throw new ScheduleError("Every 30 days is the longest wait.");
  } else if (!(Number.isInteger(when.hour) && when.hour >= 0 && when.hour <= 23 && Number.isInteger(when.minute) && when.minute >= 0 && when.minute <= 59)) {
    throw new ScheduleError("That is not a time of day.");
  }
}

// ── Reading an action ──────────────────────────────────────────────────

/** "hive weather", "organize", "expert 1a2b3c4d5e", or anything else as a message to the agent. */
export function parseAction(text: string): Action {
  const t = String(text ?? "").trim();
  if (!t) throw new ScheduleError("Say what to do.");
  let m: RegExpExecArray | null;
  if ((m = /^hive\s+([a-z0-9][a-z0-9-]{0,47})$/i.exec(t))) return { kind: "hive", projectId: m[1].toLowerCase() };
  if (/^(?:organi[sz]e|file everything|tidy folders)$/i.test(t)) return { kind: "organize" };
  if ((m = /^expert\s+([a-f0-9]{10})$/i.exec(t))) return { kind: "expert", expertId: m[1].toLowerCase() };
  if (t.length > MAX_MESSAGE_CHARS) throw new ScheduleError(`A message is at most ${MAX_MESSAGE_CHARS} characters.`);
  // A schedule that makes schedules is a loop nobody asked for.
  if (/^schedule\b/i.test(t)) throw new ScheduleError("A scheduled action cannot itself schedule things.");
  return { kind: "chat", message: t };
}

export function describeAction(a: Action): string {
  switch (a.kind) {
    case "chat": return a.message;
    case "hive": return `Work on the project "${a.projectId}" with its hive`;
    case "organize": return "File chats, wiki pages and projects into folders";
    case "expert": return `Run expert ${a.expertId}`;
  }
}

export function describeWhen(w: When): string {
  if (w.type === "once") return `once, ${new Date(w.at).toLocaleString()}`;
  if (w.type === "every") return w.minutes % 1440 === 0 ? `every ${w.minutes / 1440} day${w.minutes === 1440 ? "" : "s"}` : w.minutes % 60 === 0 ? `every ${w.minutes / 60} hour${w.minutes === 60 ? "" : "s"}` : `every ${w.minutes} minutes`;
  return `daily at ${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
}

// ── Storage ────────────────────────────────────────────────────────────

function cleanSchedule(raw: unknown): Schedule | null {
  const s = raw as Partial<Schedule> | null;
  if (!s || typeof s !== "object" || typeof s.id !== "string" || !/^[a-f0-9]{8}$/.test(s.id)) return null;
  let action: Action;
  try {
    const a = s.action as Partial<Action> & Record<string, unknown>;
    action = a.kind === "chat" ? parseAction(String(a.message)) : a.kind === "hive" ? parseAction(`hive ${a.projectId}`) : a.kind === "organize" ? { kind: "organize" } : a.kind === "expert" ? parseAction(`expert ${a.expertId}`) : (() => { throw new Error("bad"); })();
  } catch {
    return null;
  }
  const w = s.when as Partial<When> & Record<string, unknown>;
  const when: When | null =
    w?.type === "once" && typeof w.at === "number" ? { type: "once", at: w.at }
    : w?.type === "every" && typeof w.minutes === "number" ? { type: "every", minutes: w.minutes }
    : w?.type === "daily" && typeof w.hour === "number" && typeof w.minute === "number" ? { type: "daily", hour: w.hour, minute: w.minute }
    : null;
  if (!when) return null;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  return {
    id: s.id, name: typeof s.name === "string" ? s.name.slice(0, 80) : "Scheduled", action, when,
    enabled: s.enabled !== false,
    nextAt: typeof s.nextAt === "number" ? s.nextAt : null,
    lastRunAt: typeof s.lastRunAt === "number" ? s.lastRunAt : null,
    runs: num(s.runs), failures: num(s.failures), createdAt: num(s.createdAt),
    history: (Array.isArray(s.history) ? s.history : [])
      .filter((r): r is Run => !!r && typeof r.at === "number")
      .map(r => ({ at: r.at, ok: r.ok === true, result: String(r.result ?? "").slice(0, 500) }))
      .slice(-MAX_HISTORY),
  };
}

export function loadSchedules(file = schedulesFile()): Schedule[] {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { schedules?: unknown };
    return (Array.isArray(raw.schedules) ? raw.schedules : []).map(cleanSchedule).filter((s): s is Schedule => s !== null);
  } catch {
    return [];
  }
}

function save(all: Schedule[], file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { schedules: all });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Not every filesystem has modes.
  }
}

// ── Making and changing ────────────────────────────────────────────────

export function createSchedule(input: { when: string | When; action: string | Action; name?: string }, ctx: ScheduleCtx = {}): Schedule {
  const now = nowOf(ctx);
  const when = typeof input.when === "string" ? parseWhen(input.when, now) : input.when;
  if (!when) throw new ScheduleError(`I could not read "${String(input.when)}" as a time. ${WHEN_HELP}`);
  checkWhen(when, now);
  const action = typeof input.action === "string" ? parseAction(input.action) : input.action;
  const file = fileOf(ctx);
  const all = loadSchedules(file);
  if (all.length >= MAX_SCHEDULES) throw new ScheduleError(`At most ${MAX_SCHEDULES} schedules. Cancel one first.`);
  const s: Schedule = {
    id: randomBytes(4).toString("hex"),
    name: (input.name ?? describeAction(action)).slice(0, 80),
    action, when, enabled: true, nextAt: nextAfter(when, now), lastRunAt: null, runs: 0, failures: 0, createdAt: now, history: [],
  };
  all.push(s);
  save(all, file);
  return s;
}

export function updateSchedule(id: string, patch: { enabled?: boolean }, ctx: ScheduleCtx = {}): Schedule {
  const file = fileOf(ctx);
  const all = loadSchedules(file);
  const s = all.find(x => x.id === id);
  if (!s) throw new ScheduleError("No such schedule.", 404);
  if (patch.enabled !== undefined) {
    s.enabled = patch.enabled === true;
    if (s.enabled) {
      s.failures = 0;
      s.nextAt = nextAfter(s.when, nowOf(ctx));
      if (s.nextAt === null) throw new ScheduleError("That one-off time has already passed, so there is nothing left to resume.");
    }
  }
  save(all, file);
  return s;
}

export function deleteSchedule(id: string, ctx: ScheduleCtx = {}): boolean {
  const file = fileOf(ctx);
  const all = loadSchedules(file);
  const kept = all.filter(s => s.id !== id);
  if (kept.length === all.length) return false;
  save(kept, file);
  return true;
}

// ── Running ────────────────────────────────────────────────────────────

/** How each kind of action is carried out. The live system supplies these; tests supply stubs. */
export interface SchedulerDeps {
  /** A message to the agent by its normal path, so risky tools still ask first. */
  chat(message: string): Promise<string>;
  hive(projectId: string): Promise<string>;
  organize(): Promise<string>;
  expert(expertId: string): Promise<string>;
}

const running = new Set<string>();

async function perform(a: Action, deps: SchedulerDeps): Promise<string> {
  switch (a.kind) {
    case "chat": return deps.chat(a.message);
    case "hive": return deps.hive(a.projectId);
    case "organize": return deps.organize();
    case "expert": return deps.expert(a.expertId);
  }
}

/** Run one schedule now (it is not moved if it is not yet due; running it early does not skip the next time). Never throws for what the action does. */
export async function runSchedule(id: string, deps: SchedulerDeps, ctx: ScheduleCtx = {}): Promise<Schedule> {
  const file = fileOf(ctx);
  const key = `${file}|${id}`;
  if (running.has(key)) throw new ScheduleError("That is already running.", 409);
  const start = loadSchedules(file).find(s => s.id === id);
  if (!start) throw new ScheduleError("No such schedule.", 404);
  running.add(key);
  const now = nowOf(ctx);
  let run: Run;
  try {
    const out = await perform(start.action, deps);
    run = { at: now, ok: true, result: String(out ?? "").slice(0, 500) || "Done." };
  } catch (err) {
    run = { at: now, ok: false, result: `Failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500) };
  } finally {
    running.delete(key);
  }
  // Re-read: it may have been paused or deleted while it ran.
  const all = loadSchedules(file);
  const s = all.find(x => x.id === id);
  if (!s) return start;
  s.runs += 1;
  s.lastRunAt = now;
  s.failures = run.ok ? 0 : s.failures + 1;
  s.history = [...s.history, run].slice(-MAX_HISTORY);
  s.nextAt = nextAfter(s.when, now);
  if (s.when.type === "once") s.enabled = false;
  if (s.failures >= MAX_FAILURES) s.enabled = false; // it keeps failing: stop, do not hammer
  save(all, file);
  return s;
}

export function dueSchedules(ctx: ScheduleCtx = {}): Schedule[] {
  const now = nowOf(ctx);
  const file = fileOf(ctx);
  return loadSchedules(file)
    .filter(s => s.enabled && s.nextAt !== null && s.nextAt <= now && !running.has(`${file}|${s.id}`))
    .sort((a, b) => (a.nextAt ?? 0) - (b.nextAt ?? 0));
}

/** One pass: run everything that is due, one after another. Never throws. */
export async function schedulerTick(deps: SchedulerDeps, ctx: ScheduleCtx = {}): Promise<string[]> {
  const ran: string[] = [];
  for (const s of dueSchedules(ctx)) {
    try {
      await runSchedule(s.id, deps, ctx);
      ran.push(s.id);
    } catch {
      // Deleted, or already running: move on.
    }
  }
  return ran;
}

export const DEFAULT_SCHEDULER_TICK_MS = 30_000;

/** Starts the clock. Returns a function that stops it. */
export function startScheduler(opts: { deps: () => Promise<SchedulerDeps>; tickMs?: number; ctx?: ScheduleCtx; each?: (run: () => Promise<void>) => Promise<void> }): () => void {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    const each = opts.each ?? (run => run());
    void each(async () => { await opts.deps().then(d => schedulerTick(d, opts.ctx)).catch(() => undefined); }).catch(() => undefined).finally(() => { busy = false; });
  }, opts.tickMs ?? DEFAULT_SCHEDULER_TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
