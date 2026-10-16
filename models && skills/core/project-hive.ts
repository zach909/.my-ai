/**
 * The hive that works a project: AIs with equal say who check each other.
 *
 * Given a project, the hive creates a team of agents (one per folder of tasks,
 * and always enough that there are at least MIN_COUNCIL), lets each take and
 * do tasks, has the others check every hand-in, and when every task is done
 * merges what the agents learned into the shared network.
 *
 * ── Equal authority ────────────────────────────────────────────────────
 *
 * Every agent has exactly one vote, always. Review and removal are decided by
 * counting votes, never by weighing them, so no agent can outrank another.
 *
 * Separately, each agent carries a VALUE: the zero-sum trust budget from
 * hive-mind.ts (a fixed total that moves between agents as their work is
 * accepted or rejected). Value does not buy a vote. It decides how much an
 * agent's learning counts when the team's weights are averaged
 * (hive-learning.ts), so an agent whose work kept being rejected pulls the
 * result less.
 *
 * ── Checking each other ────────────────────────────────────────────────
 *
 * - Every hand-in is checked by REVIEWERS other agents. Each answers ACCEPT or
 *   REJECT; the work is accepted only if accepts strictly outnumber rejects.
 *   A tie rejects. A reply that is not clearly one or the other counts for
 *   neither, and if NOBODY is clear the task is left for a person rather than
 *   decided on noise.
 * - An agent whose work keeps getting rejected can be voted out. Every OTHER
 *   agent votes; it takes a strict majority of all of them (a muddled reply
 *   counts as "keep"), the team never drops below MIN_AGENTS, and the removed
 *   agent's learning is thrown away. It keeps the points it already earned.
 * - The hive only checks the work of its OWN agents. A person's hand-in is
 *   reviewed by a person: a vote of AIs never releases points to a human.
 *
 * ── Sub-AIs ────────────────────────────────────────────────────────────
 *
 * An agent with a lot of tasks summons sub-AIs (up to MAX_HELPERS) that do
 * tasks on its behalf. They have no vote, no value and learn nothing of their
 * own; the agent is the one accountable, checked and paid for what they hand
 * in.
 *
 * State is per-device: ~/.neuroclaw/project-hives.json (override
 * CORONA_HIVES_FILE).
 */

import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";
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
export const REVIEWERS = 2;
export const TASKS_PER_HELPER = 3;
export const VALUE_STEP = 3;
export const MAX_ROUNDS = 8;
export const UNDECIDED_LIMIT = 2;
const MAX_EVENTS = 200;
const TOTAL_VALUE = 100;

export interface HiveAgentRecord {
  id: string;
  name: string;
  /** The folder it owns. Empty for a checker, who only reviews. */
  folder: string;
  value: number;
  accepted: number;
  rejected: number;
  reviewed: number;
  helpers: number;
  taught: number;
  lastMotionRound: number;
  removedAt: number | null;
  removedReason: string;
}

export interface HiveEvent {
  at: number;
  round: number;
  kind: "staff" | "work" | "review" | "vote" | "remove" | "merge" | "note";
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
    : path.join(homedir(), ".neuroclaw", "project-hives.json");
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
  return {
    id: a.id,
    name: typeof a.name === "string" ? a.name.slice(0, 64) : a.id,
    folder: typeof a.folder === "string" ? a.folder.slice(0, 40) : "",
    value: n(a.value), accepted: n(a.accepted), rejected: n(a.rejected), reviewed: n(a.reviewed),
    helpers: Math.min(MAX_HELPERS, Math.floor(n(a.helpers))), taught: n(a.taught), lastMotionRound: n(a.lastMotionRound),
    removedAt: typeof a.removedAt === "number" ? a.removedAt : null,
    removedReason: typeof a.removedReason === "string" ? a.removedReason.slice(0, 200) : "",
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

const active = (h: HiveRecord): HiveAgentRecord[] => h.agents.filter(a => a.removedAt === null);

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

// ── Staffing ───────────────────────────────────────────────────────────

const agentIdFor = (projectId: string, n: number): string => `hive-${projectId.slice(0, 40)}-${n}`;

/**
 * Creates the team the first time, from the project's folders. One agent per
 * folder that has work, then checkers until there are enough to check each
 * other. Staffing again changes nothing.
 */
export function staffHive(projectId: string, deps: HiveDeps): HiveRecord {
  const file = fileOf(deps);
  const now = nowOf(deps);
  const existing = getHive(projectId, file);
  if (existing && existing.agents.length > 0) return existing;
  const project = getProject(projectId, deps.project ?? {});
  if (!project) throw new ProjectError("No such project.", 404);

  const hive: HiveRecord = existing ?? {
    projectId, createdAt: now, updatedAt: now, state: "idle", round: 0, agents: [], events: [], undecided: {}, merge: null, note: "",
  };
  const folders = project.folders.filter(f => project.tasks.some(t => t.folder === f && t.status !== "done")).slice(0, MAX_AGENTS);
  folders.forEach((folder, i) => {
    const tasks = project.tasks.filter(t => t.folder === folder && t.status !== "done").length;
    hive.agents.push({
      id: agentIdFor(projectId, i + 1), name: `${folder} agent`, folder, value: 0, accepted: 0, rejected: 0, reviewed: 0,
      helpers: Math.min(MAX_HELPERS, Math.max(0, Math.ceil(tasks / TASKS_PER_HELPER) - 1)),
      taught: 0, lastMotionRound: 0, removedAt: null, removedReason: "",
    });
  });
  while (hive.agents.length < MIN_COUNCIL) {
    const n = hive.agents.length + 1;
    hive.agents.push({
      id: agentIdFor(projectId, n), name: `Checker ${n}`, folder: "", value: 0, accepted: 0, rejected: 0, reviewed: 0,
      helpers: 0, taught: 0, lastMotionRound: 0, removedAt: null, removedReason: "",
    });
  }
  // Equal shares to start: everyone has the same standing until their work says otherwise.
  for (const a of hive.agents) a.value = round6(TOTAL_VALUE / hive.agents.length);
  const helpers = hive.agents.reduce((n, a) => n + a.helpers, 0);
  log(hive, "staff", `Made ${hive.agents.length} agents with equal say${helpers ? ` and ${helpers} sub-AI helper${helpers === 1 ? "" : "s"}` : ""}: ${hive.agents.map(a => a.name).join(", ")}.`, now);
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

/** YES or NO to "should it be removed", only if the reply starts by saying so. */
export function parseYesNo(reply: string): "yes" | "no" | null {
  const line = firstLine(reply);
  if (/^(yes|remove)\b/i.test(line)) return "yes";
  if (/^(no|keep)\b/i.test(line)) return "no";
  return null;
}

export type Decision = "accept" | "reject" | "undecided";

/**
 * Accept only if accepts strictly outnumber rejects. A tie rejects, a reply
 * that was not clear counts for neither, and with no clear reply at all there
 * is no decision to make.
 */
export function decide(votes: Array<"accept" | "reject" | null>): Decision {
  const accepts = votes.filter(v => v === "accept").length;
  const rejects = votes.filter(v => v === "reject").length;
  if (accepts === 0 && rejects === 0) return "undecided";
  return accepts > rejects ? "accept" : "reject";
}

/** Whether a removal carries: a strict majority of ALL the other agents, not just those who answered. */
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

const running = new Set<string>();
export const isHiveRunning = (projectId: string): boolean => running.has(projectId);

/** The hive as the UI should see it: a run in progress reads "running" even though that is never saved. */
export function hiveView(projectId: string, file = hivesFile()): HiveRecord | null {
  const h = getHive(projectId, file);
  return h && running.has(projectId) ? { ...h, state: "running" } : h;
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
  // Its own folder first; whatever is left open anywhere else only once the folder's own agent is gone.
  const owned = new Set(active(h).filter(a => a.folder).map(a => a.folder));
  const open = project.tasks.filter(t => t.status === "open" && (t.folder === agent.folder || !owned.has(t.folder)));
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

/** An agent whose work keeps being rejected can be voted out by the rest. */
async function doRemovals(h: HiveRecord, deps: HiveDeps, now: number): Promise<number> {
  let removed = 0;
  for (const accused of active(h).filter(a => a.rejected >= 2 && a.rejected > a.accepted && a.lastMotionRound < h.round)) {
    const team = active(h);
    if (team.length <= MIN_AGENTS) break;
    const voters = team.filter(a => a.id !== accused.id);
    accused.lastMotionRound = h.round;
    const votes: Array<"yes" | "no" | null> = [];
    for (const v of voters) {
      const reply = await safeThink(
        deps, v,
        `Should ${accused.name} be removed from the team? Its work was rejected ${accused.rejected} times and accepted ${accused.accepted} times.\nStart your reply with YES or NO.`,
      );
      votes.push(parseYesNo(reply));
    }
    const yes = votes.filter(x => x === "yes").length;
    log(h, "vote", `Vote on removing ${accused.name}: ${yes} yes, ${votes.filter(x => x === "no").length} no, out of ${voters.length}.`, now);
    if (!removalCarries(votes)) continue;

    const pctx = deps.project ?? {};
    for (const t of getProject(h.projectId, pctx)?.tasks ?? []) {
      if (t.assignee?.id === accused.id && t.status === "claimed") releaseTask(h.projectId, t.id, workerOf(accused, pctx), pctx);
    }
    adjustValue(h, { remove: accused.id });
    accused.removedAt = now;
    accused.removedReason = `voted out: ${yes} of ${voters.length}`;
    deps.learner?.forget(accused.id);
    log(h, "remove", `${accused.name} was removed by the other agents. What it learned is discarded.`, now);
    removed++;
  }
  return removed;
}

/** Combine what the surviving agents learned, weighted by value, and publish it as one contributor. */
export function mergeHive(projectId: string, deps: HiveDeps): HiveRecord {
  const file = fileOf(deps);
  const now = nowOf(deps);
  const h = getHive(projectId, file);
  if (!h) throw new ProjectError("This project has no hive yet.", 404);
  const project = getProject(projectId, deps.project ?? {});
  if (!project || project.status !== "complete") throw new ProjectError("The hive merges what it learned once every task is done.", 409);
  if (h.merge) return h;

  const base = deps.learner?.base() ?? null;
  const parts = !deps.learner || !base ? [] : active(h).flatMap(a => {
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
  if (running.has(projectId)) throw new ProjectError("This hive is already working.", 409);
  running.add(projectId);
  const file = fileOf(deps);
  try {
    const hive = staffHive(projectId, deps);
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
      progress += await doRemovals(hive, deps, now);
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
    running.delete(projectId);
  }
}

/** Start a run in the background and return at once. Progress is read with getHive(). */
export function startHiveRun(projectId: string, deps: HiveDeps): HiveRecord {
  if (running.has(projectId)) throw new ProjectError("This hive is already working.", 409);
  const hive = staffHive(projectId, deps);
  void runHive(projectId, deps).catch(() => undefined);
  return hive;
}
