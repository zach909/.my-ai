/**
 * The hive that works a project: one AI that grows into a collective of equals.
 *
 * ── How it starts ──────────────────────────────────────────────────────
 *
 * A hive begins as ONE AI, the Original. It reads the project and decides
 * whether it needs help. Either way it adds variants of itself, because nobody
 * can check their own work: there are always at least MIN_COUNCIL of them. If it
 * asks for help it adds an agent for each folder of tasks, and sub-AIs (helpers)
 * for folders with a lot to do.
 *
 * Variants are copies: each starts from what its parent had learned and then
 * goes its own way, so they are different AIs that descend from the Original.
 *
 * ── Equal power, and everything is a vote ──────────────────────────────
 *
 * From then on no agent decides anything alone. Every agent has exactly one
 * vote, always, and anything that changes the team is put to all of them:
 *
 *   clone    a proven agent is copied, so the good approach spreads
 *   add      a fresh variant of the Original joins when there is far more work
 *            than hands
 *   delete   an agent whose work keeps being rejected is removed and what it
 *            learned is thrown away
 *   retire   an agent leaves when there is less work left than agents. It is
 *            not a punishment, and what it learned is kept
 *
 * A motion carries only with a strict majority of ALL the agents allowed to
 * vote (the one being removed or retired does not vote on that). A reply that
 * is not clearly YES counts as no. Votes are counted, never weighed.
 *
 * Separately, each agent carries a VALUE: the zero-sum trust budget from
 * hive-mind.ts. Value does not buy a vote. It decides how much an agent's
 * learning counts when the team's weights are averaged (hive-learning.ts).
 *
 * ── Everyone reviews everyone ──────────────────────────────────────────
 *
 * - Every hand-in is checked by REVIEWERS other agents. Accept needs strictly
 *   more accepts than rejects; a tie rejects; a reply that is not clearly
 *   ACCEPT or REJECT counts for neither, and if NOBODY is clear the task waits
 *   for a person rather than being decided on noise.
 * - The hive only checks the work of its OWN agents. A person's hand-in is
 *   reviewed by a person: a vote of AIs never releases points to a human.
 *
 * ── Sub-AIs ────────────────────────────────────────────────────────────
 *
 * Helpers do tasks on an agent's behalf. They have no vote, no value and learn
 * nothing of their own; the agent is accountable, checked and paid for what
 * they hand in.
 *
 * ── When the goal is done ──────────────────────────────────────────────
 *
 * The agents still standing (retired ones included, deleted ones not) are
 * combined into one averaged contributor and published (hive-learning.ts).
 *
 * State is per-device: ~/.neuroclaw/project-hives.json (override
 * CORONA_HIVES_FILE).
 */

import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";
import { dataFile } from "./user-context.js";

import { HiveMind } from "./hive-mind.js";
import { mergeDeltas, publishMergedDelta, type AgentLearner, type PublishPaths, type PublishResult } from "./hive-learning.js";
import { rms } from "./shared-mesh.js";
import {
  ProjectError,
  claimTask,
  getProject,
  releaseTask,
  resolveWorker,
  reviewTask,
  submitTask,
  type Project,
  type ProjectCtx,
  type Task,
  type Worker,
} from "./projects.js";

export const MIN_AGENTS = 2;
export const MIN_COUNCIL = 3;
export const MAX_AGENTS = 8;
export const MAX_HELPERS = 3;
export const MAX_CLONES = 2;
export const REVIEWERS = 2;
export const TASKS_PER_HELPER = 3;
/** A project with at most this many tasks is one the Original is happy to start alone on. */
export const SOLO_LIMIT = 3;
export const VALUE_STEP = 3;
export const MAX_ROUNDS = 8;
export const UNDECIDED_LIMIT = 2;
/** An agent is worth cloning at or above this share of its hand-ins accepted. */
export const CLONE_SCORE = 0.7;
const MAX_EVENTS = 200;
const TOTAL_VALUE = 100;
/** The folder of an agent that takes work from every folder. */
export const ANY_FOLDER = "*";

export interface HiveAgentRecord {
  id: string;
  name: string;
  /** The folder it owns, ANY_FOLDER for all of them, or empty for a checker who only reviews. */
  folder: string;
  value: number;
  accepted: number;
  rejected: number;
  reviewed: number;
  helpers: number;
  taught: number;
  /** Who this is a variant of. Null for the Original. */
  parent: string | null;
  /** How many copies away from the Original. */
  generation: number;
  clones: number;
  lastMotionRound: number;
  /** Deleted by the others: its learning is discarded. */
  removedAt: number | null;
  removedReason: string;
  /** Stepped down because there was less work than agents: its learning is kept. */
  retiredAt: number | null;
}

export interface HiveEvent {
  at: number;
  round: number;
  kind: "staff" | "work" | "review" | "vote" | "clone" | "add" | "remove" | "retire" | "merge" | "note";
  text: string;
}

export interface MergeRecord {
  at: number;
  baseId: string;
  agents: Array<{ id: string; share: number }>;
  rms: number;
  file: string;
  push: PublishResult["push"];
  reason?: string;
}

export interface HiveRecord {
  projectId: string;
  createdAt: number;
  updatedAt: number;
  state: "idle" | "running" | "complete" | "stalled";
  round: number;
  /** What the Original decided when it first looked at the project. */
  help: "help" | "alone" | null;
  agents: HiveAgentRecord[];
  events: HiveEvent[];
  /** Rounds a hand-in has gone without a clear verdict, by task id. */
  undecided: Record<string, number>;
  merge: MergeRecord | null;
  note: string;
}

export function hivesFile(): string {
  return process.env.CORONA_HIVES_FILE
    ? path.resolve(process.env.CORONA_HIVES_FILE)
    : dataFile("project-hives.json");
}

/** Everything the hive needs from outside. Injected so tests can run it with no brain at all. */
export interface HiveDeps {
  /** How one agent answers. The live system passes the real neural runner. */
  think: (agent: HiveAgentRecord, prompt: string) => Promise<string>;
  /** How agents learn. Absent means nothing is learned, and nothing is merged. */
  learner?: AgentLearner | null;
  /** Where the merged weights are published. */
  paths?: PublishPaths;
  publish?: (args: Parameters<typeof publishMergedDelta>[0]) => PublishResult | null;
  project?: ProjectCtx;
  file?: string;
  now?: () => number;
  maxRounds?: number;
}

const fileOf = (d: HiveDeps): string => d.file ?? hivesFile();
const nowOf = (d: HiveDeps): number => (d.now ?? Date.now)();
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

// ── Storage ────────────────────────────────────────────────────────────

function cleanAgent(raw: unknown): HiveAgentRecord | null {
  const a = raw as Partial<HiveAgentRecord> | null;
  if (!a || typeof a !== "object" || typeof a.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(a.id)) return null;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  const at = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return {
    id: a.id,
    name: typeof a.name === "string" ? a.name.slice(0, 64) : a.id,
    folder: typeof a.folder === "string" ? a.folder.slice(0, 40) : "",
    value: n(a.value), accepted: n(a.accepted), rejected: n(a.rejected), reviewed: n(a.reviewed),
    helpers: Math.min(MAX_HELPERS, Math.floor(n(a.helpers))), taught: n(a.taught),
    parent: typeof a.parent === "string" ? a.parent : null,
    generation: Math.floor(n(a.generation)), clones: Math.min(MAX_CLONES, Math.floor(n(a.clones))),
    lastMotionRound: n(a.lastMotionRound),
    removedAt: at(a.removedAt),
    removedReason: typeof a.removedReason === "string" ? a.removedReason.slice(0, 200) : "",
    retiredAt: at(a.retiredAt),
  };
}

function cleanHive(raw: unknown): HiveRecord | null {
  const h = raw as Partial<HiveRecord> | null;
  if (!h || typeof h !== "object" || typeof h.projectId !== "string") return null;
  const agents = (Array.isArray(h.agents) ? h.agents : []).map(cleanAgent).filter((a): a is HiveAgentRecord => a !== null);
  const state = h.state === "complete" || h.state === "stalled" ? h.state : "idle"; // a saved "running" is from a process that is gone
  const m = h.merge as MergeRecord | null | undefined;
  return {
    projectId: h.projectId,
    createdAt: typeof h.createdAt === "number" ? h.createdAt : 0,
    updatedAt: typeof h.updatedAt === "number" ? h.updatedAt : 0,
    state,
    round: typeof h.round === "number" ? h.round : 0,
    help: h.help === "help" || h.help === "alone" ? h.help : null,
    agents,
    events: (Array.isArray(h.events) ? h.events : []).slice(-MAX_EVENTS),
    undecided: h.undecided && typeof h.undecided === "object" ? h.undecided : {},
    merge: m && typeof m === "object" && typeof m.file === "string" ? m : null,
    note: typeof h.note === "string" ? h.note.slice(0, 300) : "",
  };
}

export function loadHives(file = hivesFile()): HiveRecord[] {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { hives?: unknown };
    return (Array.isArray(raw.hives) ? raw.hives : []).map(cleanHive).filter((h): h is HiveRecord => h !== null);
  } catch {
    return [];
  }
}

function saveHive(hive: HiveRecord, file: string, now: number): void {
  const all = loadHives(file).filter(h => h.projectId !== hive.projectId);
  hive.updatedAt = now;
  hive.events = hive.events.slice(-MAX_EVENTS);
  all.push(hive);
  mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { hives: all });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Not every filesystem has modes.
  }
}

export function getHive(projectId: string, file = hivesFile()): HiveRecord | null {
  return loadHives(file).find(h => h.projectId === projectId) ?? null;
}

/** The agents that are on the team and have a vote. */
const active = (h: HiveRecord): HiveAgentRecord[] => h.agents.filter(a => a.removedAt === null && a.retiredAt === null);
/** The agents whose learning counts at the end: the team, and those who stepped down honourably. Never the deleted. */
const contributors = (h: HiveRecord): HiveAgentRecord[] => h.agents.filter(a => a.removedAt === null);

function log(h: HiveRecord, kind: HiveEvent["kind"], text: string, now: number): void {
  h.events.push({ at: now, round: h.round, kind, text: text.slice(0, 300) });
}

// ── Value: the zero-sum budget ─────────────────────────────────────────

/**
 * Moves value between agents. Uses HiveMind's own zero-sum rule so there is
 * one definition of it: the total stays at TOTAL_VALUE and what one agent gains
 * the others lose.
 */
function adjustValue(h: HiveRecord, change: { id: string; delta: number } | { remove: string } | null): void {
  const team = active(h);
  if (team.length === 0) return;
  const mind = new HiveMind({ totalTrust: TOTAL_VALUE });
  for (const a of team) mind.spawn({ id: a.id, role: "agent", specialization: a.folder || "checker" });
  for (const a of team) {
    const member = mind.get(a.id);
    if (member) member.trust = a.value > 0 ? a.value : TOTAL_VALUE / team.length;
  }
  mind.repairTrustInvariant();
  if (change) {
    if ("remove" in change) mind.remove(change.remove);
    else mind.reward(change.id, change.delta);
  }
  for (const a of team) {
    const member = mind.get(a.id);
    if (member) a.value = round6(member.trust);
  }
}

const equalValues = (h: HiveRecord): void => {
  const team = active(h);
  for (const a of team) a.value = round6(TOTAL_VALUE / team.length);
};

// ── Starting as one ────────────────────────────────────────────────────

const agentIdFor = (projectId: string, n: number): string => `hive-${projectId.slice(0, 40)}-${n}`;

function blankAgent(id: string, name: string, folder: string, parent: HiveAgentRecord | null): HiveAgentRecord {
  return {
    id, name, folder, value: 0, accepted: 0, rejected: 0, reviewed: 0, helpers: 0, taught: 0,
    parent: parent?.id ?? null, generation: parent ? parent.generation + 1 : 0, clones: 0,
    lastMotionRound: 0, removedAt: null, removedReason: "", retiredAt: null,
  };
}

/** The next free number for an agent id, so a removed agent's id is never reused. */
const nextNumber = (h: HiveRecord): number => h.agents.reduce((m, a) => Math.max(m, Number(a.id.split("-").pop()) || 0), 0) + 1;

/**
 * Creates the hive the first time: ONE agent, the Original. Nothing else
 * exists until the Original has looked at the project and decided what it needs
 * (growHive). Calling it again changes nothing.
 */
export function staffHive(projectId: string, deps: HiveDeps): HiveRecord {
  const file = fileOf(deps);
  const now = nowOf(deps);
  const existing = getHive(projectId, file);
  if (existing && existing.agents.length > 0) return existing;
  const project = getProject(projectId, deps.project ?? {});
  if (!project) throw new ProjectError("No such project.", 404);

  const hive: HiveRecord = existing ?? {
    projectId, createdAt: now, updatedAt: now, state: "idle", round: 0, help: null, agents: [], events: [], undecided: {}, merge: null, note: "",
  };
  const original = blankAgent(agentIdFor(projectId, 1), "Original", ANY_FOLDER, null);
  original.value = TOTAL_VALUE;
  hive.agents.push(original);
  log(hive, "staff", "The hive starts as one AI: the Original.", now);
  saveHive(hive, file, now);
  return hive;
}

/** Reads HELP or ALONE from the start of a reply. */
export function parseHelp(reply: string): "help" | "alone" | null {
  const line = String(reply ?? "").split(/\r?\n/).map(l => l.trim()).find(Boolean)?.replace(/^[\s"'“”‘’*_`>#-]+/, "") ?? "";
  if (/^(help|team|more)\b/i.test(line)) return "help";
  if (/^(alone|solo|myself|no)\b/i.test(line)) return "alone";
  return null;
}

/**
 * The Original looks at the project and decides whether it needs help, then
 * grows the team. It is the only decision one agent ever makes alone: there is
 * nobody else yet.
 *
 * - It always adds enough variants of itself to be checked (MIN_COUNCIL).
 * - If it wants help it adds an agent for each other folder of tasks, and
 *   sub-AIs for folders with a lot to do.
 * - A reply it cannot read falls back to a plain rule: help if the project has
 *   more than SOLO_LIMIT tasks.
 */
export async function growHive(projectId: string, deps: HiveDeps): Promise<HiveRecord> {
  const file = fileOf(deps);
  const now = nowOf(deps);
  const hive = staffHive(projectId, deps);
  if (hive.agents.length > 1) return hive;
  const project = getProject(projectId, deps.project ?? {});
  if (!project) throw new ProjectError("No such project.", 404);
  const original = hive.agents[0];

  const open = project.tasks.filter(t => t.status !== "done");
  const folders = project.folders.filter(f => open.some(t => t.folder === f)).slice(0, MAX_AGENTS);
  const reply = await safeThink(
    deps, original,
    `You are the Original, the one AI working on the project "${project.title}".\n${project.goal ? `The project is: ${project.goal}\n` : ""}` +
      `It has ${open.length} tasks in ${folders.length} folders: ${folders.join(", ") || "none"}.\n` +
      "Would it go better with help from a team of other AIs? Start your reply with HELP or ALONE.",
  );
  const said = parseHelp(reply);
  const choice = said ?? (open.length > SOLO_LIMIT ? "help" : "alone");
  hive.help = choice;
  log(hive, "staff", said ? `The Original looked at the project and chose ${choice === "help" ? "to get help" : "to start alone"}.` : `The Original gave no clear answer, so by the plain rule it ${choice === "help" ? "gets help" : "starts alone"} (${open.length} tasks).`, now);

  const born: string[] = [];
  const spawn = (name: string, folder: string): HiveAgentRecord => {
    const a = blankAgent(agentIdFor(projectId, nextNumber(hive)), name, folder, original);
    hive.agents.push(a);
    deps.learner?.clone(original.id, a.id);
    born.push(a.name);
    return a;
  };

  if (choice === "help" && folders.length > 0) {
    original.folder = folders[0];
    for (const f of folders.slice(1)) spawn(`${f} agent`, f);
    for (const a of hive.agents) {
      const tasks = open.filter(t => t.folder === a.folder).length;
      a.helpers = Math.min(MAX_HELPERS, Math.max(0, Math.ceil(tasks / TASKS_PER_HELPER) - 1));
    }
  }
  while (hive.agents.length < MIN_COUNCIL) spawn(`Checker ${hive.agents.length + 1}`, "");
  equalValues(hive);

  const helpers = hive.agents.reduce((n, a) => n + a.helpers, 0);
  log(hive, "add",
    `The Original added ${born.length} variant${born.length === 1 ? "" : "s"} of itself: ${born.join(", ")}. Nobody can check their own work, so there are always at least ${MIN_COUNCIL}.` +
      (helpers ? ` It also summoned ${helpers} sub-AI helper${helpers === 1 ? "" : "s"}.` : ""),
    now);
  log(hive, "note", "From here on every decision is a vote, and every agent has one vote.", now);
  saveHive(hive, file, now);
  return hive;
}

// ── Reading replies ────────────────────────────────────────────────────

function firstLine(reply: string): string {
  const line = String(reply ?? "").split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? "";
  return line.replace(/^[\s"'“”‘’*_`>#-]+/, "");
}

/** ACCEPT or REJECT, only if the reply starts by saying so. Anything else is not a vote. */
export function parseVerdict(reply: string): "accept" | "reject" | null {
  const line = firstLine(reply);
  if (/^(accept|accepted|approve|approved)\b/i.test(line)) return "accept";
  if (/^(reject|rejected|decline|declined)\b/i.test(line)) return "reject";
  return null;
}

/** YES or NO, only if the reply starts by saying so. */
export function parseYesNo(reply: string): "yes" | "no" | null {
  const line = firstLine(reply);
  if (/^(yes|remove|agree)\b/i.test(line)) return "yes";
  if (/^(no|keep|disagree)\b/i.test(line)) return "no";
  return null;
}

export type Decision = "accept" | "reject" | "undecided";

/**
 * Accept only if accepts strictly outnumber rejects. A tie rejects, a reply
 * that was not clearly one or the other counts for neither, and with no clear
 * reply at all there is no decision to make.
 */
export function decide(votes: Array<"accept" | "reject" | null>): Decision {
  const accepts = votes.filter(v => v === "accept").length;
  const rejects = votes.filter(v => v === "reject").length;
  if (accepts === 0 && rejects === 0) return "undecided";
  return accepts > rejects ? "accept" : "reject";
}

/** Whether a motion carries: a strict majority of ALL who may vote, not just of those who answered. */
export function removalCarries(votes: Array<"yes" | "no" | null>): boolean {
  return votes.filter(v => v === "yes").length * 2 > votes.length;
}

// ── Running ────────────────────────────────────────────────────────────

const workerOf = (a: HiveAgentRecord, ctx: ProjectCtx): Worker => resolveWorker(a.id, ctx, "agent", a.name);

function workPrompt(project: Project, agent: HiveAgentRecord, task: Task, persona: string): string {
  return (
    `You are ${persona}, one of several AIs working together on the project "${project.title}".\n` +
    (project.goal ? `The project is: ${project.goal}\n` : "") +
    `Your folder: ${task.folder}.\n` +
    `Task: ${task.title}\n` +
    (task.detail ? `Details: ${task.detail}\n` : "") +
    (task.reviewNote ? `Your last attempt was sent back: ${task.reviewNote}\nFix that this time.\n` : "") +
    "Write the finished result for this task."
  );
}

function reviewPrompt(project: Project, task: Task): string {
  return (
    `You are checking another AI's work on the project "${project.title}".\n` +
    `Task: ${task.title}\n${task.detail ? `Details: ${task.detail}\n` : ""}` +
    `Hand-in:\n${task.result.slice(0, 4000)}\n\n` +
    "Does this do what the task asks? Start your reply with ACCEPT or REJECT, then one line saying why."
  );
}

function pickReviewers(h: HiveRecord, author: string): HiveAgentRecord[] {
  return active(h).filter(a => a.id !== author).sort((a, b) => a.reviewed - b.reviewed || a.id.localeCompare(b.id)).slice(0, REVIEWERS);
}

/** Keyed by the hives file as well as the project: two people's projects can both be called "weather". */
const running = new Set<string>();
const runKey = (projectId: string, file: string): string => `${file}|${projectId}`;
export const isHiveRunning = (projectId: string, file = hivesFile()): boolean => running.has(runKey(projectId, file));

/** The hive as the UI should see it: a run in progress reads "running" even though that is never saved. */
export function hiveView(projectId: string, file = hivesFile()): HiveRecord | null {
  const h = getHive(projectId, file);
  return h && running.has(runKey(projectId, file)) ? { ...h, state: "running" } : h;
}

async function safeThink(deps: HiveDeps, agent: HiveAgentRecord, prompt: string): Promise<string> {
  try {
    return String((await deps.think(agent, prompt)) ?? "");
  } catch {
    return "";
  }
}

/** One agent takes what is open in its folder and does it. */
async function doWork(h: HiveRecord, agent: HiveAgentRecord, deps: HiveDeps, now: number): Promise<number> {
  const pctx = deps.project ?? {};
  const project = getProject(h.projectId, pctx);
  if (!project || project.status === "complete") return 0;
  const worker = workerOf(agent, pctx);
  const mine = project.tasks.filter(t => t.assignee?.id === agent.id && t.status === "claimed");
  // Its own folder first. A folder nobody owns is anyone's.
  const owned = (folder: string): boolean => active(h).some(a => a.folder === folder || a.folder === ANY_FOLDER);
  const open = project.tasks.filter(t => t.status === "open" && (agent.folder === ANY_FOLDER || t.folder === agent.folder || !owned(t.folder)));
  const queue = [...mine, ...open];
  let did = 0;
  for (const task of queue) {
    const current = getProject(h.projectId, pctx)?.tasks.find(t => t.id === task.id);
    if (!current) continue;
    try {
      if (current.status === "open") claimTask(h.projectId, current.id, worker, pctx);
      else if (!(current.status === "claimed" && current.assignee?.id === agent.id)) continue;
    } catch {
      continue; // taken by someone else, or this agent is at its limit
    }
    const index = project.tasks.filter(t => t.folder === current.folder).findIndex(t => t.id === current.id);
    const helper = agent.helpers > 0 && index > 0 ? (index % agent.helpers) + 1 : 0;
    const persona = helper ? `sub-AI ${helper} of ${agent.name}` : agent.name;
    const reply = (await safeThink(deps, agent, workPrompt(project, agent, current, persona))).trim();
    if (!reply) {
      releaseTask(h.projectId, current.id, worker, pctx);
      log(h, "work", `${persona} had no answer for "${current.title}", so it was put back.`, now);
      continue;
    }
    submitTask(h.projectId, current.id, worker, helper ? `(done by sub-AI ${helper} of ${agent.name})\n${reply}` : reply, pctx);
    log(h, "work", `${persona} handed in "${current.title}".`, now);
    did++;
  }
  return did;
}

/** Every hand-in from the team's own agents is checked by the others. */
async function doReviews(h: HiveRecord, deps: HiveDeps, now: number): Promise<number> {
  const pctx = deps.project ?? {};
  const project = getProject(h.projectId, pctx);
  if (!project) return 0;
  let settled = 0;
  for (const task of project.tasks.filter(t => t.status === "submitted" && t.assignee)) {
    const author = h.agents.find(a => a.id === task.assignee!.id);
    if (!author) continue; // a person's work: a person reviews it
    const reviewers = pickReviewers(h, author.id);
    if (reviewers.length === 0) continue;
    const votes: Array<"accept" | "reject" | null> = [];
    const notes: string[] = [];
    for (const r of reviewers) {
      const reply = await safeThink(deps, r, reviewPrompt(project, task));
      const v = parseVerdict(reply);
      votes.push(v);
      r.reviewed++;
      notes.push(`${r.name}: ${v ?? "unclear"}`);
    }
    const decision = decide(votes);
    if (decision === "undecided") {
      h.undecided[task.id] = (h.undecided[task.id] ?? 0) + 1;
      log(h, "review", `Nobody gave a clear answer on "${task.title}" (${h.undecided[task.id]}/${UNDECIDED_LIMIT}).`, now);
      continue;
    }
    delete h.undecided[task.id];
    const winner = reviewers[votes.indexOf(decision)];
    const outcome = reviewTask(h.projectId, task.id, workerOf(winner, pctx), decision, notes.join("; "), pctx);
    settled++;
    if (decision === "accept") {
      author.accepted++;
      adjustValue(h, { id: author.id, delta: VALUE_STEP });
      log(h, "review", `"${task.title}" accepted (${notes.join(", ")}); ${author.name} earned ${outcome.paid} points.`, now);
      if (deps.learner) {
        const taught = await deps.learner.teach(author.id, `${task.title}\n${task.result}`);
        if (taught.ok) author.taught++;
        else log(h, "note", `${author.name} could not learn from it: ${taught.reason ?? "unknown"}.`, now);
      }
    } else {
      author.rejected++;
      adjustValue(h, { id: author.id, delta: -VALUE_STEP });
      log(h, "review", `"${task.title}" sent back (${notes.join(", ")}).`, now);
    }
    saveHive(h, fileOf(deps), now);
  }
  return settled;
}

// ── Votes ──────────────────────────────────────────────────────────────

export interface VoteResult {
  carried: boolean;
  yes: number;
  no: number;
  /** How many were allowed to vote. */
  voters: number;
}

/**
 * Puts a motion to every agent allowed to vote on it: all of them, except the
 * one it is about when it is about removing or retiring that agent. One vote
 * each. It carries only with a strict majority of ALL who may vote, so a
 * reply that is not clearly YES counts as no.
 */
export async function holdVote(h: HiveRecord, deps: HiveDeps, question: string, exclude: string | null, now: number): Promise<VoteResult> {
  const voters = active(h).filter(a => a.id !== exclude);
  const votes: Array<"yes" | "no" | null> = [];
  for (const v of voters) votes.push(parseYesNo(await safeThink(deps, v, `${question}\nStart your reply with YES or NO.`)));
  const yes = votes.filter(x => x === "yes").length;
  const no = votes.filter(x => x === "no").length;
  const carried = removalCarries(votes);
  log(h, "vote", `${question} ${yes} yes, ${no} no, of ${voters.length}: ${carried ? "carried" : "not carried"}.`, now);
  return { carried, yes, no, voters: voters.length };
}

/** How well an agent's work has gone: the share of its hand-ins accepted, leaning towards the middle until there is evidence. */
export const scoreOf = (a: HiveAgentRecord): number => (a.accepted + 1) / (a.accepted + a.rejected + 2);

/** Puts a fresh variant of `parent` on the team, copying what it learned. */
function addVariant(h: HiveRecord, parent: HiveAgentRecord, name: string, folder: string, deps: HiveDeps): HiveAgentRecord {
  const a = blankAgent(agentIdFor(h.projectId, nextNumber(h)), name, folder, parent);
  h.agents.push(a);
  deps.learner?.clone(parent.id, a.id);
  return a;
}

/**
 * What the team decides about itself after each round. Every change is a vote.
 *
 *   delete  an agent whose work keeps being rejected
 *   clone   the agent whose work is proven, when there is more work than hands
 *   add     a new variant of the Original, when there is far more work than hands
 *   retire  an agent, when there is less work left than agents
 *
 * At most one of each per round, so the team changes in steps.
 */
async function evolve(h: HiveRecord, deps: HiveDeps, now: number): Promise<number> {
  const pctx = deps.project ?? {};
  let changes = 0;

  // Delete: the others decide, the accused does not vote.
  for (const accused of active(h).filter(a => a.rejected >= 2 && a.rejected > a.accepted && a.lastMotionRound < h.round)) {
    if (active(h).length <= MIN_AGENTS) break;
    accused.lastMotionRound = h.round;
    const result = await holdVote(h, deps, `Should ${accused.name} be removed from the team? Its work was rejected ${accused.rejected} times and accepted ${accused.accepted} times.`, accused.id, now);
    if (!result.carried) continue;
    for (const t of getProject(h.projectId, pctx)?.tasks ?? []) {
      if (t.assignee?.id === accused.id && t.status === "claimed") releaseTask(h.projectId, t.id, workerOf(accused, pctx), pctx);
    }
    adjustValue(h, { remove: accused.id });
    accused.removedAt = now;
    accused.removedReason = `voted out: ${result.yes} of ${result.voters}`;
    deps.learner?.forget(accused.id);
    log(h, "remove", `${accused.name} was deleted by the other agents. What it learned is discarded.`, now);
    changes++;
  }

  const project = getProject(h.projectId, pctx);
  if (!project || project.status === "complete") return changes;
  const remaining = project.tasks.filter(t => t.status !== "done").length;
  const backlog = project.tasks.filter(t => t.status === "open" || t.status === "claimed").length;
  const team = active(h);

  // Clone: copy what works.
  let grew = false;
  if (team.length < MAX_AGENTS && backlog > team.length) {
    const best = team.filter(a => a.accepted >= 2 && a.clones < MAX_CLONES && scoreOf(a) >= CLONE_SCORE).sort((a, b) => scoreOf(b) - scoreOf(a) || b.accepted - a.accepted)[0];
    if (best) {
      const result = await holdVote(h, deps, `${best.name} has had ${best.accepted} hand-ins accepted and ${best.rejected} sent back, and there is more work than hands. Should it be cloned?`, null, now);
      if (result.carried) {
        const copy = addVariant(h, best, `${best.name} (clone ${best.clones + 1})`, best.folder, deps);
        best.clones++;
        const half = round6(best.value / 2);
        best.value = half;
        copy.value = half; // the copy shares its parent's standing, so the total stays fixed
        log(h, "clone", `${best.name} was cloned by vote: ${copy.name} is a new variant that starts from what it learned.`, now);
        changes++;
        grew = true;
      }
    }
  }

  // Add: far more work than hands, and nobody proven enough to copy.
  if (!grew && team.length < MAX_AGENTS && backlog > 4 * team.length) {
    const original = h.agents.find(a => a.parent === null && a.removedAt === null) ?? team[0];
    const result = await holdVote(h, deps, `There are ${backlog} tasks waiting and only ${team.length} agents. Should another variant of the Original join?`, null, now);
    if (result.carried) {
      const fresh = addVariant(h, original, `Variant ${nextNumber(h)}`, ANY_FOLDER, deps);
      equalValues(h);
      log(h, "add", `${fresh.name} joined by vote.`, now);
      changes++;
    }
  }

  // Retire: less work than hands. Not a punishment, so what it learned stays.
  if (active(h).length > MIN_COUNCIL && remaining < active(h).length) {
    const leaving = active(h).filter(a => a.parent !== null).sort((a, b) => a.accepted - b.accepted || b.generation - a.generation)[0];
    if (leaving && leaving.lastMotionRound < h.round) {
      leaving.lastMotionRound = h.round;
      const result = await holdVote(h, deps, `Only ${remaining} tasks are left and there are ${active(h).length} agents. Should ${leaving.name} step down? Its learning is kept.`, leaving.id, now);
      if (result.carried) {
        for (const t of getProject(h.projectId, pctx)?.tasks ?? []) {
          if (t.assignee?.id === leaving.id && t.status === "claimed") releaseTask(h.projectId, t.id, workerOf(leaving, pctx), pctx);
        }
        adjustValue(h, { remove: leaving.id });
        leaving.retiredAt = now;
        log(h, "retire", `${leaving.name} stepped down by vote. What it learned is kept.`, now);
        changes++;
      }
    }
  }
  return changes;
}

/** Combine what the agents learned, weighted by value, and publish it as one contributor. */
export function mergeHive(projectId: string, deps: HiveDeps): HiveRecord {
  const file = fileOf(deps);
  const now = nowOf(deps);
  const h = getHive(projectId, file);
  if (!h) throw new ProjectError("This project has no hive yet.", 404);
  const project = getProject(projectId, deps.project ?? {});
  if (!project || project.status !== "complete") throw new ProjectError("The hive merges what it learned once every task is done.", 409);
  if (h.merge) return h;

  const base = deps.learner?.base() ?? null;
  const parts = !deps.learner || !base ? [] : contributors(h).flatMap(a => {
    const delta = deps.learner!.delta(a.id);
    return delta ? [{ id: a.id, weight: a.value, delta }] : [];
  });
  const merged = mergeDeltas(parts);
  if (!merged || !base) {
    h.note = !deps.learner ? "Finished. There is no brain to learn on here, so there was nothing to merge." : "Finished. The agents did not learn anything to merge.";
    log(h, "merge", h.note, now);
  } else {
    const publish = deps.publish ?? publishMergedDelta;
    const result = publish({ projectId, merged: merged.merged, baseId: base.baseId, shape: base.shape, paths: deps.paths ?? { root: process.cwd() } });
    if (!result) {
      h.note = "Finished. What the agents learned added up to no change, so nothing was published.";
      log(h, "merge", h.note, now);
    } else {
      h.merge = { at: now, baseId: base.baseId, agents: merged.shares.map(s => ({ id: s.id, share: round6(s.share) })), rms: round6(rms(merged.merged)), file: result.relPath, push: result.push, reason: result.reason };
      h.note = result.push === "queued" ? "Finished. The merged network is being pushed to GitHub, where it is averaged with everyone else's." : `Finished. ${result.reason ?? "Saved on this device."}`;
      log(h, "merge", `Averaged ${merged.shares.length} agents into one contributor (${result.relPath}); push: ${result.push}.`, now);
    }
  }
  h.state = "complete";
  saveHive(h, file, now);
  return h;
}

/** Work the project until it is done, no one can make progress, or the rounds run out. */
export async function runHive(projectId: string, deps: HiveDeps): Promise<HiveRecord> {
  const file = fileOf(deps);
  if (running.has(runKey(projectId, file))) throw new ProjectError("This hive is already working.", 409);
  running.add(runKey(projectId, file));
  try {
    const hive = await growHive(projectId, deps);
    hive.state = "running";
    hive.note = "";
    saveHive(hive, file, nowOf(deps));
    const pctx = deps.project ?? {};
    const rounds = deps.maxRounds ?? MAX_ROUNDS;

    for (let i = 0; i < rounds; i++) {
      const project = getProject(projectId, pctx);
      if (!project) throw new ProjectError("No such project.", 404);
      if (project.status === "complete") break;
      hive.round++;
      const now = nowOf(deps);
      let progress = 0;
      for (const agent of active(hive)) progress += await doWork(hive, agent, deps, now);
      saveHive(hive, file, now);
      progress += await doReviews(hive, deps, now);
      progress += await evolve(hive, deps, now);
      saveHive(hive, file, now);
      if (progress === 0) break;
    }

    const project = getProject(projectId, pctx);
    if (project?.status === "complete") return mergeHive(projectId, deps);

    const left = project?.tasks.filter(t => t.status !== "done") ?? [];
    const people = left.filter(t => t.assignee?.kind === "person").length;
    const stuck = left.filter(t => t.status === "submitted" && (hive.undecided[t.id] ?? 0) >= UNDECIDED_LIMIT).length;
    hive.state = "stalled";
    hive.note =
      `${left.length} task${left.length === 1 ? "" : "s"} still open.` +
      (people ? ` ${people} with people.` : "") +
      (stuck ? ` ${stuck} hand-in${stuck === 1 ? "" : "s"} the agents could not judge and need a person.` : "");
    log(hive, "note", hive.note, nowOf(deps));
    saveHive(hive, file, nowOf(deps));
    return hive;
  } catch (err) {
    const h = getHive(projectId, file);
    if (h) {
      h.state = "stalled";
      h.note = `Stopped: ${err instanceof Error ? err.message : String(err)}`;
      saveHive(h, file, nowOf(deps));
    }
    throw err;
  } finally {
    running.delete(runKey(projectId, file));
  }
}

/** Start a run in the background and return at once. Progress is read with getHive(). */
export function startHiveRun(projectId: string, deps: HiveDeps): HiveRecord {
  if (running.has(runKey(projectId, fileOf(deps)))) throw new ProjectError("This hive is already working.", 409);
  const hive = staffHive(projectId, deps);
  void runHive(projectId, deps).catch(() => undefined);
  return hive;
}
