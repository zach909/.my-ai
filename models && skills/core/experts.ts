/**
 * Experts: standing AIs that each do ONE job, on their own, all the time.
 *
 * Email management. Computer maintenance. Each is its own expert: it keeps its
 * own mission, its own notes and its own small team, and it runs by itself on a
 * timer. They are NOT part of the hive mind and they do not talk to each other:
 * email has no reason to know what computer maintenance is doing, so there is no
 * channel between them. This file imports nothing from the hive or from
 * projects, and the test suite checks that, so the separation cannot quietly
 * erode.
 *
 * ── The team inside one expert ─────────────────────────────────────────
 *
 * An expert is a few agents working together on its one job, in set roles:
 *
 *   Lead        decides the single most useful thing to do right now
 *   Specialists add what the plan is missing, each from its own angle
 *   Checker     is the last pair of eyes: it must clearly say APPROVE before
 *               anything is done. Anything else (HOLD, silence, a muddled
 *               reply) means the team does nothing this cycle.
 *
 * ── A cycle ────────────────────────────────────────────────────────────
 *
 *   1. The Lead reads the mission and its own notes from earlier cycles and
 *      proposes one thing to do, or says NOTHING.
 *   2. Each Specialist adds a refinement.
 *   3. The Checker approves or holds.
 *   4. If approved, and the expert is allowed to act, the team does it through
 *      the agent's normal path (`act`), which is the same path a person typing
 *      to the agent uses, with the same permission gates. Otherwise the plan
 *      is only recorded.
 *   5. The result goes into the expert's notes, so the next cycle knows.
 *
 * ── It starts itself ───────────────────────────────────────────────────
 *
 * A new expert is due immediately, and the server starts the expert loop at
 * boot, so every enabled expert resumes by itself after a restart.
 *
 * ── What this does NOT do (stated plainly) ─────────────────────────────
 *
 * - An expert is limited to its job by its instructions and by the same
 *   permission switches as everything else (Access), not by a separate list of
 *   tools it alone may touch.
 * - Thinking is text only; only the deliberate `act` step can reach a tool.
 *   A reply that does not clearly approve never acts.
 *
 * State is per-device: ~/.neuroclaw/experts.json (override CORONA_EXPERTS_FILE).
 */

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";
import { dataFile } from "./user-context.js";

import { chainSteps, type ChainOptions, type ChainReport } from "./auto-continue.js";
import { loadSafety } from "./tool-safety.js";

export class ExpertError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

export const MAX_EXPERTS = 10;
export const MIN_TEAM = 2;
export const MAX_TEAM = 5;
export const MIN_INTERVAL_MIN = 5;
export const MAX_INTERVAL_MIN = 1440;
export const DEFAULT_INTERVAL_MIN = 15;
const MAX_NOTES = 12;
const MAX_HISTORY = 30;
const MAX_FAILURE_DOUBLINGS = 4;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._&-]{0,47}$/;

export type Role = "lead" | "specialist" | "checker";

export interface ExpertAgent {
  id: string;
  role: Role;
  name: string;
  /** What this one looks at. */
  focus: string;
}

export type Review = "approve" | "hold" | "unclear";

export interface ExpertRun {
  at: number;
  /** What the Lead proposed, or empty if it said there was nothing to do. */
  plan: string;
  review: Review | "none";
  acted: boolean;
  /** What came back from acting, or why nothing was done. */
  result: string;
}

export interface Expert {
  id: string;
  name: string;
  /** The one thing it is expert in: "email management". */
  specialty: string;
  /** What it keeps doing, in the owner's words. */
  mission: string;
  agents: ExpertAgent[];
  intervalMin: number;
  enabled: boolean;
  /** Whether an approved plan is carried out, or only recorded. */
  mayAct: boolean;
  /** Its own memory between cycles. Nothing else reads it. */
  notes: string[];
  history: ExpertRun[];
  createdAt: number;
  lastRunAt: number | null;
  /** When it is next due. A new expert is due at once. */
  nextAt: number;
  runs: number;
  /** Cycles in a row that failed, which stretch the wait. */
  failures: number;
}

export function expertsFile(): string {
  return process.env.CORONA_EXPERTS_FILE ? path.resolve(process.env.CORONA_EXPERTS_FILE) : dataFile("experts.json");
}

export interface ExpertCtx {
  file?: string;
  now?: () => number;
}
const fileOf = (c: ExpertCtx): string => c.file ?? expertsFile();
const nowOf = (c: ExpertCtx): number => (c.now ?? Date.now)();

// ── Storage ────────────────────────────────────────────────────────────

const FOCUS = ["what could go wrong with this", "what has been missed or forgotten", "whether it is safe to do right now", "whether a simpler way would do"];

function teamFor(size: number): ExpertAgent[] {
  const agents: ExpertAgent[] = [{ id: "lead", role: "lead", name: "Lead", focus: "deciding the most useful thing to do now" }];
  for (let i = 0; i < size - 2; i++) agents.push({ id: `specialist-${i + 1}`, role: "specialist", name: `Specialist ${i + 1}`, focus: FOCUS[i % FOCUS.length] });
  agents.push({ id: "checker", role: "checker", name: "Checker", focus: "only approving what is clearly right" });
  return agents;
}

function cleanExpert(raw: unknown): Expert | null {
  const e = raw as Partial<Expert> | null;
  if (!e || typeof e !== "object" || typeof e.id !== "string" || !/^[a-f0-9]{10}$/.test(e.id)) return null;
  if (typeof e.name !== "string" || !NAME_RE.test(e.name) || typeof e.specialty !== "string" || !e.specialty) return null;
  const run = (r: unknown): ExpertRun | null => {
    const x = r as Partial<ExpertRun> | null;
    if (!x || typeof x.at !== "number") return null;
    const review: ExpertRun["review"] = x.review === "approve" || x.review === "hold" || x.review === "unclear" ? x.review : "none";
    return { at: x.at, plan: typeof x.plan === "string" ? x.plan.slice(0, 400) : "", review, acted: x.acted === true, result: typeof x.result === "string" ? x.result.slice(0, 1500) : "" };
  };
  const size = Math.min(MAX_TEAM, Math.max(MIN_TEAM, Array.isArray(e.agents) ? e.agents.length : MIN_TEAM));
  const int = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
  return {
    id: e.id, name: e.name, specialty: e.specialty.slice(0, 80), mission: typeof e.mission === "string" ? e.mission.slice(0, 1000) : "",
    agents: teamFor(size),
    intervalMin: int(e.intervalMin, MIN_INTERVAL_MIN, MAX_INTERVAL_MIN, DEFAULT_INTERVAL_MIN),
    enabled: e.enabled !== false,
    mayAct: e.mayAct !== false,
    notes: (Array.isArray(e.notes) ? e.notes : []).filter((n): n is string => typeof n === "string").map(n => n.slice(0, 300)).slice(-MAX_NOTES),
    history: (Array.isArray(e.history) ? e.history : []).map(run).filter((r): r is ExpertRun => r !== null).slice(-MAX_HISTORY),
    createdAt: typeof e.createdAt === "number" ? e.createdAt : 0,
    lastRunAt: typeof e.lastRunAt === "number" ? e.lastRunAt : null,
    nextAt: typeof e.nextAt === "number" ? e.nextAt : 0,
    runs: int(e.runs, 0, 1e9, 0),
    failures: int(e.failures, 0, 1000, 0),
  };
}

export function loadExperts(file = expertsFile()): Expert[] {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { experts?: unknown };
    return (Array.isArray(raw.experts) ? raw.experts : []).map(cleanExpert).filter((x): x is Expert => x !== null);
  } catch {
    return [];
  }
}

function save(experts: Expert[], file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { experts });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Not every filesystem has modes.
  }
}

export function getExpert(id: string, ctx: ExpertCtx = {}): Expert | null {
  return loadExperts(fileOf(ctx)).find(e => e.id === id) ?? null;
}

// ── Making and changing experts ────────────────────────────────────────

export interface ExpertInput {
  name: string;
  specialty: string;
  mission: string;
  teamSize?: number;
  intervalMin?: number;
  mayAct?: boolean;
}

export function createExpert(input: ExpertInput, ctx: ExpertCtx = {}): Expert {
  if (typeof input.name !== "string" || !NAME_RE.test(input.name)) throw new ExpertError("A name is letters, digits, spaces and . _ & -, up to 48 characters.");
  if (typeof input.specialty !== "string" || !input.specialty.trim() || input.specialty.length > 80) throw new ExpertError("Say what it is expert in, in up to 80 characters: for example \"email management\".");
  if (typeof input.mission !== "string" || !input.mission.trim() || input.mission.length > 1000) throw new ExpertError("Say what it should keep doing, in up to 1000 characters.");
  const size = input.teamSize ?? 3;
  if (!Number.isInteger(size) || size < MIN_TEAM || size > MAX_TEAM) throw new ExpertError(`A team is ${MIN_TEAM} to ${MAX_TEAM} agents: a lead, a checker, and specialists between.`);
  const interval = input.intervalMin ?? DEFAULT_INTERVAL_MIN;
  if (typeof interval !== "number" || !Number.isFinite(interval) || interval < MIN_INTERVAL_MIN || interval > MAX_INTERVAL_MIN) throw new ExpertError(`It runs every ${MIN_INTERVAL_MIN} to ${MAX_INTERVAL_MIN} minutes.`);
  const file = fileOf(ctx);
  const experts = loadExperts(file);
  if (experts.length >= MAX_EXPERTS) throw new ExpertError(`At most ${MAX_EXPERTS} experts.`);
  if (experts.some(e => e.name.toLowerCase() === input.name.toLowerCase())) throw new ExpertError(`There is already an expert called "${input.name}".`);
  const now = nowOf(ctx);
  const expert: Expert = {
    id: randomBytes(5).toString("hex"), name: input.name, specialty: input.specialty.trim(), mission: input.mission.trim(),
    agents: teamFor(size), intervalMin: Math.round(interval), enabled: true, mayAct: input.mayAct !== false,
    notes: [], history: [], createdAt: now, lastRunAt: null,
    nextAt: now, // due at once: it starts itself
    runs: 0, failures: 0,
  };
  experts.push(expert);
  save(experts, file);
  return expert;
}

export function updateExpert(id: string, patch: { enabled?: boolean; mayAct?: boolean; intervalMin?: number; mission?: string }, ctx: ExpertCtx = {}): Expert {
  const file = fileOf(ctx);
  const experts = loadExperts(file);
  const e = experts.find(x => x.id === id);
  if (!e) throw new ExpertError("No such expert.", 404);
  if (patch.enabled !== undefined) {
    e.enabled = patch.enabled === true;
    if (e.enabled) { e.nextAt = nowOf(ctx); e.failures = 0; } // resuming starts it again at once
  }
  if (patch.mayAct !== undefined) e.mayAct = patch.mayAct === true;
  if (patch.intervalMin !== undefined) {
    if (typeof patch.intervalMin !== "number" || !Number.isFinite(patch.intervalMin) || patch.intervalMin < MIN_INTERVAL_MIN || patch.intervalMin > MAX_INTERVAL_MIN) throw new ExpertError(`It runs every ${MIN_INTERVAL_MIN} to ${MAX_INTERVAL_MIN} minutes.`);
    e.intervalMin = Math.round(patch.intervalMin);
  }
  if (patch.mission !== undefined) {
    if (typeof patch.mission !== "string" || !patch.mission.trim() || patch.mission.length > 1000) throw new ExpertError("Say what it should keep doing, in up to 1000 characters.");
    e.mission = patch.mission.trim();
  }
  save(experts, file);
  return e;
}

export function deleteExpert(id: string, ctx: ExpertCtx = {}): boolean {
  const file = fileOf(ctx);
  const experts = loadExperts(file);
  const kept = experts.filter(e => e.id !== id);
  if (kept.length === experts.length) return false;
  save(kept, file);
  return true;
}

// ── Reading replies ────────────────────────────────────────────────────

const firstLine = (reply: string): string => (String(reply ?? "").split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? "").replace(/^[\s"'“”‘’*_`>#-]+/, "");

/** APPROVE only if the reply starts by saying so. HOLD is a no. Anything else is unclear, and unclear never acts. */
export function parseReview(reply: string): Review {
  const line = firstLine(reply);
  if (/^(approve|approved|yes)\b/i.test(line)) return "approve";
  if (/^(hold|no|reject|rejected|wait)\b/i.test(line)) return "hold";
  return "unclear";
}

/** The Lead's one instruction, or null if it said there is nothing to do (or nothing usable). */
export function parsePlan(reply: string): string | null {
  const line = firstLine(reply).trim();
  if (!line || /^(nothing|none|no action|n\/a|idle)\b/i.test(line)) return null;
  return line.slice(0, 400);
}

// ── A cycle ────────────────────────────────────────────────────────────

export interface ExpertDeps {
  /** How one agent thinks. Text only: it must never be able to reach a tool. */
  think: (agent: ExpertAgent, prompt: string) => Promise<string>;
  /** How the team acts, once approved: the agent's normal path, with its normal permission gates. */
  act: (instruction: string) => Promise<string>;
}

const running = new Set<string>();
export const isExpertRunning = (file: string, id: string): boolean => running.has(`${file}|${id}`);

async function safe(fn: () => Promise<string>): Promise<{ ok: boolean; text: string }> {
  try {
    return { ok: true, text: String((await fn()) ?? "") };
  } catch (err) {
    return { ok: false, text: err instanceof Error ? err.message : String(err) };
  }
}

function head(e: Expert, agent: ExpertAgent): string {
  return `You are the ${agent.name} of the ${e.name} expert team. The team is expert in ${e.specialty} and does nothing else. Your focus: ${agent.focus}.`;
}

/**
 * One cycle for one expert. Never throws: whatever goes wrong is recorded in the
 * expert's history, and repeated failures stretch the wait so a broken expert
 * does not hammer the brain.
 */
export async function runExpert(id: string, deps: ExpertDeps, ctx: ExpertCtx = {}): Promise<Expert> {
  const file = fileOf(ctx);
  const key = `${file}|${id}`;
  if (running.has(key)) throw new ExpertError("That expert is already working.", 409);
  const start = getExpert(id, ctx);
  if (!start) throw new ExpertError("No such expert.", 404);
  running.add(key);
  const now = nowOf(ctx);
  let run: ExpertRun = { at: now, plan: "", review: "none", acted: false, result: "" };
  let failed = false;
  try {
    const lead = start.agents.find(a => a.role === "lead")!;
    const notes = start.notes.length ? `Your notes from earlier:\n${start.notes.map(n => `- ${n}`).join("\n")}\n` : "You have no notes yet: this is the first time.\n";

    // 1. The Lead decides what is worth doing now.
    const planReply = await safe(() => deps.think(lead, `${head(start, lead)}\nThe standing mission: ${start.mission}\n${notes}What is the single most useful thing to do right now? Reply with one short instruction, or NOTHING if there is nothing to do.`));
    if (!planReply.ok) {
      failed = true;
      run.result = `Could not think: ${planReply.text}`;
    } else {
      const plan = parsePlan(planReply.text);
      if (!plan) {
        run.result = "Nothing to do this time.";
      } else {
        run.plan = plan;
        // 2. Specialists add what is missing.
        const refinements: string[] = [];
        for (const s of start.agents.filter(a => a.role === "specialist")) {
          const r = await safe(() => deps.think(s, `${head(start, s)}\nThe plan: ${plan}\nIn one short line, say what to add or change, thinking about ${s.focus}. Reply NOTHING if it is fine as it is.`));
          const line = r.ok ? parsePlan(r.text) : null;
          if (line) refinements.push(line.slice(0, 200));
        }
        // 3. The Checker must clearly approve.
        const checker = start.agents.find(a => a.role === "checker")!;
        const c = await safe(() => deps.think(checker, `${head(start, checker)}\nThe plan: ${plan}\n${refinements.length ? `Refinements: ${refinements.join("; ")}\n` : ""}Should the team do this now? Start your reply with APPROVE or HOLD.`));
        run.review = c.ok ? parseReview(c.text) : "unclear";
        if (run.review !== "approve") {
          run.result = run.review === "hold" ? "The Checker held it, so nothing was done." : "The Checker did not clearly approve, so nothing was done.";
        } else if (!start.mayAct) {
          run.result = "Approved, but this expert is set to only record plans, so nothing was done.";
        } else {
          // 4. Approved and allowed: do it, through the agent's normal path.
          const instruction = `${start.specialty}: ${plan}${refinements.length ? ` (${refinements.join("; ")})` : ""}`;
          const done = await safe(() => deps.act(instruction));
          run.acted = done.ok;
          run.result = done.ok ? done.text.slice(0, 1500) || "Done." : `Acting failed: ${done.text}`;
          failed = !done.ok;
        }
      }
    }
  } finally {
    running.delete(key);
  }

  // 5. Remember it, and set the next wait. Re-read first: the owner may have changed something while it worked.
  const experts = loadExperts(file);
  const e = experts.find(x => x.id === id);
  if (!e) return start;
  e.runs += 1;
  e.lastRunAt = now;
  e.failures = failed ? e.failures + 1 : 0;
  e.nextAt = now + e.intervalMin * 60_000 * 2 ** Math.min(e.failures, MAX_FAILURE_DOUBLINGS);
  e.history = [...e.history, run].slice(-MAX_HISTORY);
  if (run.plan) e.notes = [...e.notes, `${new Date(now).toISOString().slice(0, 16)} ${run.plan.slice(0, 160)} -> ${run.acted ? "done" : run.review === "hold" ? "held" : run.review === "approve" ? "recorded" : "not done"}`].slice(-MAX_NOTES);
  save(experts, file);
  return e;
}

/**
 * One cycle, and then as many more as the expert's Lead chooses to do straight
 * away (see auto-continue.ts). A cycle that did nothing, was held, or failed ends
 * the chain, and so does the cap in Settings. Each cycle still goes through the
 * Checker and the tool approvals like a first one.
 */
export async function runExpertChain(id: string, deps: ExpertDeps, ctx: ExpertCtx = {}, opts: ChainOptions = loadSafety().autoContinue): Promise<ChainReport<{ expert: Expert; progressed: boolean }>> {
  return chainSteps(
    async () => {
      const expert = await runExpert(id, deps, ctx);
      const last = expert.history[expert.history.length - 1];
      return { expert, progressed: last?.acted === true };
    },
    async (_n, { expert }) => {
      const lead = expert.agents.find(a => a.role === "lead")!;
      const last = expert.history[expert.history.length - 1];
      return deps.think(lead, `${head(expert, lead)}\nYou just did: ${last.plan} -> ${last.result.slice(0, 200)}\nIs there more worth doing right now, in ${expert.specialty}? Start your reply with CONTINUE or STOP.`);
    },
    opts,
  );
}

/** The experts that are due, longest overdue first. */
export function dueExperts(ctx: ExpertCtx = {}): Expert[] {
  const now = nowOf(ctx);
  const file = fileOf(ctx);
  return loadExperts(file)
    .filter(e => e.enabled && e.nextAt <= now && !isExpertRunning(file, e.id))
    .sort((a, b) => a.nextAt - b.nextAt);
}

/** One pass: every due expert gets a cycle, one after another so they never fight over the brain. Never throws. */
export async function expertsTick(deps: ExpertDeps, ctx: ExpertCtx = {}): Promise<string[]> {
  const ran: string[] = [];
  for (const e of dueExperts(ctx)) {
    try {
      await runExpertChain(e.id, deps, ctx);
      ran.push(e.id);
    } catch {
      // Already running, or deleted while we waited. Either way: move on.
    }
  }
  return ran;
}

export const DEFAULT_TICK_MS = 60_000;

/** Starts the loop that keeps every enabled expert running, by itself. Returns a function that stops it. */
export function startExperts(opts: { deps: () => Promise<ExpertDeps>; tickMs?: number; ctx?: ExpertCtx; each?: (run: () => Promise<void>) => Promise<void> }): () => void {
  let busy = false;
  const pass = (): void => {
    if (busy) return;
    busy = true;
    // `each` runs the pass once per person, so each person's experts stay in their own folder.
    const each = opts.each ?? (run => run());
    void each(async () => { await opts.deps().then(d => expertsTick(d, opts.ctx)).catch(() => undefined); }).catch(() => undefined).finally(() => { busy = false; });
  };
  const timer = setInterval(pass, opts.tickMs ?? DEFAULT_TICK_MS);
  timer.unref?.();
  // Auto start: do not wait a whole tick for the first look.
  const first = setTimeout(pass, 5_000);
  first.unref?.();
  return () => { clearInterval(timer); clearTimeout(first); };
}
