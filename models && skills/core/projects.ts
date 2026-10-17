/**
 * Projects: one big job that many people and AIs work on together.
 *
 * A project is a folder of tasks. Each task can be taken by a person or an AI,
 * handed in, and checked by someone else; when it is accepted the worker is
 * paid points out of the project's pot. Finish every task and the project is
 * complete, which releases the rest of the pot to the people and AIs who did
 * the work.
 *
 * ── The pot is final ───────────────────────────────────────────────────
 *
 * The pot is set when the project is made and never grows. 90% of it is the
 * task pool, split across tasks by weight; the other 10% is the completion
 * bonus, split across workers by how much accepted work each did. Every
 * amount is rounded DOWN, so what is paid out can only ever be at or under the
 * pot, never over. The plan (the tasks and their weights) is fixed once the
 * first task has been paid, so everyone is paid against the same split.
 *
 * ── Nobody marks their own homework ────────────────────────────────────
 *
 * The one who reviews a task must be someone other than the one who did it.
 * Rejected work goes back to its worker to fix, up to MAX_ATTEMPTS times, and
 * then the task is opened up for anyone else to take.
 *
 * ── Where projects live ────────────────────────────────────────────────
 *
 * Working state is per-device (~/.neuroclaw/projects.json, override
 * CORONA_PROJECTS_FILE). Each project is also written as a page in the wiki
 * under projects/<id> (wiki-store.ts), with the full state embedded so
 * another install that pulls the wiki can import it. Pushing that page is a
 * separate, explicit step (publishProject): nothing is committed or pushed
 * just because a task changed.
 *
 * Two devices that both work on the same project each keep their own copy;
 * importing a newer copy over an older one is last-writer-wins, and it never
 * pays anyone: points are only ever paid when a review is accepted HERE.
 *
 * ── The agent does the organising ──────────────────────────────────────
 *
 * planFromGoal() and organizeTasks() ask the agent to break a goal into
 * folders of tasks and to file tasks into folders. The agent is whatever
 * `think` function the caller passes (the live system passes the real neural
 * runner). Its answer is read strictly; anything it says that does not parse
 * falls back to a plain, deterministic split, so a muddled reply never loses
 * the project.
 */

import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";
import { dataFile } from "./user-context.js";

import { SELF_ID, award, ensureMember, loadPoints, pointsFile } from "./points.js";
import { deleteWikiPage, listWikiPages, publishWikiPage, publishWikiPageAndSync, readWikiPage, WikiNameError } from "./wiki-store.js";
import type { StoreSyncResult } from "./store-sync.js";

export class ProjectError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

export const MAX_POT = 10_000;
export const MAX_TASKS = 200;
export const MAX_FOLDERS = 30;
export const MAX_CLAIMS = 3;
export const MAX_ATTEMPTS = 3;
export const BONUS_SHARE = 0.1;
export const UNSORTED = "Unsorted";
const MAX_TITLE = 120;
const MAX_DETAIL = 2000;
const MAX_RESULT = 20_000;
const MAX_PROJECTS = 200;
const MARKER = "neuroclaw-project";

export type WorkerKind = "person" | "agent";
export interface Worker {
  kind: WorkerKind;
  /** The id on the points board. */
  id: string;
  name: string;
}

export type TaskStatus = "open" | "claimed" | "submitted" | "done";

export interface Task {
  id: string;
  title: string;
  detail: string;
  /** Share of the task pool. */
  weight: number;
  folder: string;
  status: TaskStatus;
  assignee: Worker | null;
  /** What was handed in. */
  result: string;
  /** Rejected hand-ins so far. */
  attempts: number;
  reviewedBy: Worker | null;
  reviewNote: string;
  paid: number;
  doneAt: number | null;
}

export interface Project {
  id: string;
  title: string;
  goal: string;
  /** The final amount of points. Never changes after the project is made. */
  pot: number;
  status: "open" | "complete";
  createdAt: number;
  updatedAt: number;
  folders: string[];
  tasks: Task[];
  /** Points paid so far, tasks and bonus together. Always at or under the pot. */
  paidOut: number;
  bonusPaid: boolean;
  nextTask: number;
  /**
   * Whether the AI works on this project by itself in the background
   * (hive-background.ts). The easy way to get a project done; people can still
   * take tasks to go faster. A project brought in from the wiki starts off, so
   * another install's project never starts using this device's brain unasked.
   */
  background: boolean;
  /**
   * Whether the project is shared: written to the wiki page everyone on this
   * server can read, and so listed in the league. A project is PRIVATE until its
   * owner shares it, because the wiki is public by design.
   */
  published: boolean;
}

export interface ProjectCtx {
  file?: string;
  pointsFile?: string;
  now?: () => number;
}

export function projectsFile(): string {
  return process.env.CORONA_PROJECTS_FILE
    ? path.resolve(process.env.CORONA_PROJECTS_FILE)
    : dataFile("projects.json");
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;
const floor6 = (n: number): number => Math.floor(n * 1e6 + 1e-9) / 1e6;
const nowOf = (ctx: ProjectCtx): number => (ctx.now ?? Date.now)();
const fileOf = (ctx: ProjectCtx): string => ctx.file ?? projectsFile();
const pfileOf = (ctx: ProjectCtx): string => ctx.pointsFile ?? pointsFile();

/** The part of the pot that pays tasks, and the part that pays the completion bonus. */
export const taskPoolOf = (pot: number): number => floor6(pot * (1 - BONUS_SHARE));
export const bonusPoolOf = (pot: number): number => round(pot - taskPoolOf(pot));

// ── Reading and writing ────────────────────────────────────────────────

const str = (v: unknown, max: number, fallback = ""): string => (typeof v === "string" ? v.slice(0, max) : fallback);
const posNum = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;

function cleanWorker(raw: unknown): Worker | null {
  const w = raw as Partial<Worker> | null;
  if (!w || typeof w !== "object" || typeof w.id !== "string" || !ID_RE.test(w.id) || typeof w.name !== "string" || !w.name) return null;
  return { kind: w.kind === "agent" ? "agent" : "person", id: w.id, name: w.name.slice(0, 64) };
}

/** Rebuilds a project from untrusted JSON (a file, or another install's wiki page). Null if it does not hold together. */
export function cleanProject(raw: unknown): Project | null {
  const p = raw as Partial<Project> | null;
  if (!p || typeof p !== "object") return null;
  if (typeof p.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(p.id)) return null;
  const pot = posNum(p.pot);
  if (pot <= 0 || pot > MAX_POT) return null;
  if (!Array.isArray(p.tasks) || p.tasks.length > MAX_TASKS) return null;

  const folders: string[] = [];
  for (const f of Array.isArray(p.folders) ? p.folders : []) {
    if (typeof f === "string" && f && f.length <= 40 && !folders.some(x => x.toLowerCase() === f.toLowerCase()) && folders.length < MAX_FOLDERS) folders.push(f);
  }
  const tasks: Task[] = [];
  const seen = new Set<string>();
  for (const t of p.tasks as Array<Partial<Task>>) {
    if (!t || typeof t !== "object" || typeof t.id !== "string" || !/^t\d{1,6}$/.test(t.id) || seen.has(t.id)) return null;
    seen.add(t.id);
    const status: TaskStatus = t.status === "claimed" || t.status === "submitted" || t.status === "done" ? t.status : "open";
    const assignee = cleanWorker(t.assignee);
    if (status !== "open" && !assignee) return null;
    const weight = posNum(t.weight, 1);
    const folder = str(t.folder, 40, UNSORTED) || UNSORTED;
    if (!folders.some(x => x.toLowerCase() === folder.toLowerCase())) {
      if (folders.length >= MAX_FOLDERS) return null;
      folders.push(folder);
    }
    tasks.push({
      id: t.id,
      title: str(t.title, MAX_TITLE, "Untitled") || "Untitled",
      detail: str(t.detail, MAX_DETAIL),
      weight: weight > 0 && weight <= 1000 ? weight : 1,
      folder,
      status,
      assignee: status === "open" ? null : assignee,
      result: str(t.result, MAX_RESULT),
      attempts: Math.min(MAX_ATTEMPTS, Math.floor(posNum(t.attempts))),
      reviewedBy: cleanWorker(t.reviewedBy),
      reviewNote: str(t.reviewNote, 500),
      paid: status === "done" ? posNum(t.paid) : 0,
      doneAt: status === "done" && typeof t.doneAt === "number" ? t.doneAt : null,
    });
  }
  // A file that claims to have paid out more than the pot is lying or damaged. Refuse it rather than trust its numbers.
  const taskPaid = round(tasks.reduce((n, t) => n + t.paid, 0));
  if (taskPaid > taskPoolOf(pot) + 1e-6) return null;
  const bonusPaid = p.bonusPaid === true;
  const paidOut = posNum(p.paidOut);
  if (paidOut > pot + 1e-6 || paidOut + 1e-6 < taskPaid) return null;

  const nextTask = Math.max(Math.floor(posNum(p.nextTask, 1)), ...tasks.map(t => Number(t.id.slice(1)) + 1), 1);
  const allDone = tasks.length > 0 && tasks.every(t => t.status === "done");
  return {
    id: p.id,
    title: str(p.title, MAX_TITLE, p.id) || p.id,
    goal: str(p.goal, MAX_DETAIL),
    pot,
    status: allDone && p.status === "complete" ? "complete" : "open",
    createdAt: posNum(p.createdAt),
    updatedAt: posNum(p.updatedAt),
    folders,
    tasks,
    paidOut: round(paidOut),
    bonusPaid,
    nextTask,
    background: p.background === true,
    published: p.published === true,
  };
}

export function loadProjects(file = projectsFile()): Project[] {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { projects?: unknown };
    return (Array.isArray(raw.projects) ? raw.projects : []).map(cleanProject).filter((p): p is Project => p !== null);
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[], file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { projects });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Not every filesystem has modes.
  }
}

function must(projects: Project[], id: string): Project {
  const p = projects.find(x => x.id === id);
  if (!p) throw new ProjectError("No such project.", 404);
  return p;
}

function mustTask(p: Project, taskId: string): Task {
  const t = p.tasks.find(x => x.id === taskId);
  if (!t) throw new ProjectError("No such task.", 404);
  return t;
}

export function getProject(id: string, ctx: ProjectCtx = {}): Project | null {
  return loadProjects(fileOf(ctx)).find(p => p.id === id) ?? null;
}

// ── Making a project ───────────────────────────────────────────────────

export interface TaskSpec {
  title: string;
  detail?: string;
  weight?: number;
  folder?: string;
}

function checkTaskSpec(spec: TaskSpec): void {
  if (typeof spec?.title !== "string" || !spec.title.trim() || spec.title.length > MAX_TITLE) throw new ProjectError(`A task title is 1 to ${MAX_TITLE} characters.`);
  if (spec.detail !== undefined && (typeof spec.detail !== "string" || spec.detail.length > MAX_DETAIL)) throw new ProjectError(`A task's details are at most ${MAX_DETAIL} characters.`);
  if (spec.weight !== undefined && (typeof spec.weight !== "number" || !Number.isFinite(spec.weight) || spec.weight <= 0 || spec.weight > 1000)) throw new ProjectError("A task's weight is above 0 and at most 1000.");
}

function cleanFolderName(name: unknown): string {
  if (typeof name !== "string") return UNSORTED;
  const n = name.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!n || n.length > 40 || !/^[A-Za-z0-9][A-Za-z0-9 &/_().,'-]*$/.test(n)) return UNSORTED;
  return n;
}

function useFolder(p: Project, name: string): string {
  const folder = cleanFolderName(name);
  const have = p.folders.find(f => f.toLowerCase() === folder.toLowerCase());
  if (have) return have;
  if (p.folders.length >= MAX_FOLDERS) return ensureUnsorted(p);
  p.folders.push(folder);
  return folder;
}

function ensureUnsorted(p: Project): string {
  const have = p.folders.find(f => f.toLowerCase() === UNSORTED.toLowerCase());
  if (have) return have;
  p.folders.push(UNSORTED);
  return UNSORTED;
}

function newTask(p: Project, spec: TaskSpec): Task {
  checkTaskSpec(spec);
  if (p.tasks.length >= MAX_TASKS) throw new ProjectError(`A project has at most ${MAX_TASKS} tasks.`);
  const task: Task = {
    id: `t${p.nextTask++}`,
    title: spec.title.trim(),
    detail: spec.detail ?? "",
    weight: spec.weight ?? 1,
    folder: useFolder(p, spec.folder ?? UNSORTED),
    status: "open", assignee: null, result: "", attempts: 0, reviewedBy: null, reviewNote: "", paid: 0, doneAt: null,
  };
  p.tasks.push(task);
  return task;
}

const slugOf = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";

export interface CreateProjectInput {
  title: string;
  goal?: string;
  pot: number;
  tasks?: TaskSpec[];
  folders?: string[];
  /** The AI works on it in the background. On unless you say otherwise. */
  background?: boolean;
}

export function createProject(input: CreateProjectInput, ctx: ProjectCtx = {}): Project {
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > MAX_TITLE) throw new ProjectError(`A project title is 1 to ${MAX_TITLE} characters.`);
  if (input.goal !== undefined && (typeof input.goal !== "string" || input.goal.length > MAX_DETAIL)) throw new ProjectError(`The goal is at most ${MAX_DETAIL} characters.`);
  if (typeof input.pot !== "number" || !Number.isFinite(input.pot) || input.pot <= 0 || input.pot > MAX_POT) throw new ProjectError(`The pot is above 0 and at most ${MAX_POT} points. It is final: it cannot be raised later.`);
  const file = fileOf(ctx);
  const projects = loadProjects(file);
  if (projects.length >= MAX_PROJECTS) throw new ProjectError(`At most ${MAX_PROJECTS} projects on one device.`);

  let id = slugOf(input.title);
  const base = id;
  for (let n = 2; projects.some(p => p.id === id); n++) id = `${base.slice(0, 44)}-${n}`;
  const now = nowOf(ctx);
  const p: Project = {
    id, title: input.title.trim(), goal: (input.goal ?? "").trim(), pot: round(input.pot), status: "open",
    createdAt: now, updatedAt: now, folders: [], tasks: [], paidOut: 0, bonusPaid: false, nextTask: 1,
    background: input.background !== false,
    published: false,
  };
  for (const f of input.folders ?? []) useFolder(p, f);
  for (const spec of input.tasks ?? []) newTask(p, spec);
  projects.push(p);
  saveProjects(projects, file);
  writeProjectPage(p);
  return p;
}

/** Turn the AI's background work on this project on or off. */
export function setBackground(projectId: string, on: boolean, ctx: ProjectCtx = {}): Project {
  const file = fileOf(ctx);
  const projects = loadProjects(file);
  const p = must(projects, projectId);
  p.background = on === true;
  saveProjects(projects, file);
  return p;
}

export function addTask(projectId: string, spec: TaskSpec, ctx: ProjectCtx = {}): Task {
  const file = fileOf(ctx);
  const projects = loadProjects(file);
  const p = must(projects, projectId);
  if (p.status === "complete") throw new ProjectError("This project is complete.");
  if (p.paidOut > 0 || p.tasks.some(t => t.status === "done")) {
    throw new ProjectError("The plan is fixed once the first task has been paid, so everyone is paid against the same split.");
  }
  const task = newTask(p, spec);
  p.updatedAt = nowOf(ctx);
  saveProjects(projects, file);
  writeProjectPage(p);
  return task;
}

// ── Working on it ──────────────────────────────────────────────────────

/** The owner of this device as a worker. */
export function selfWorker(pointsPath = pointsFile()): Worker {
  const me = loadPoints(pointsPath).members.find(m => m.id === SELF_ID);
  return { kind: "person", id: SELF_ID, name: me?.name ?? "You" };
}

/** Looks a worker up on the board. People must already be on it; AIs are added the first time they work. */
export function resolveWorker(id: string, ctx: ProjectCtx = {}, kind: WorkerKind = "person", name?: string): Worker {
  const pf = pfileOf(ctx);
  const member = loadPoints(pf).members.find(m => m.id === id);
  if (member) return { kind: member.kind === "agent" ? "agent" : "person", id: member.id, name: member.name };
  if (kind === "agent") {
    const m = ensureMember(id, name ?? id, "agent", pf);
    return { kind: "agent", id: m.id, name: m.name };
  }
  throw new ProjectError("That person is not on the board. Add them first.", 404);
}

export function claimTask(projectId: string, taskId: string, worker: Worker, ctx: ProjectCtx = {}): Task {
  const file = fileOf(ctx);
  const projects = loadProjects(file);
  const p = must(projects, projectId);
  const t = mustTask(p, taskId);
  if (p.status === "complete") throw new ProjectError("This project is complete.");
  if (t.status !== "open") throw new ProjectError(t.status === "done" ? "That task is already done." : `That task is already taken by ${t.assignee?.name ?? "someone"}.`, 409);
  const active = p.tasks.filter(x => x.assignee?.id === worker.id && (x.status === "claimed" || x.status === "submitted")).length;
  if (active >= MAX_CLAIMS) throw new ProjectError(`${worker.name} already has ${MAX_CLAIMS} tasks in progress here. Finish one first.`, 409);
  t.status = "claimed";
  t.assignee = worker;
  p.updatedAt = nowOf(ctx);
  saveProjects(projects, file);
  writeProjectPage(p);
  return t;
}

export function releaseTask(projectId: string, taskId: string, worker: Worker, ctx: ProjectCtx = {}): Task {
  const file = fileOf(ctx);
  const projects = loadProjects(file);
  const p = must(projects, projectId);
  const t = mustTask(p, taskId);
  if (t.status !== "claimed" || t.assignee?.id !== worker.id) throw new ProjectError("Only the worker can give a claimed task back.", 403);
  t.status = "open";
  t.assignee = null;
  p.updatedAt = nowOf(ctx);
  saveProjects(projects, file);
  writeProjectPage(p);
  return t;
}

export function submitTask(projectId: string, taskId: string, worker: Worker, result: string, ctx: ProjectCtx = {}): Task {
  if (typeof result !== "string" || !result.trim() || result.length > MAX_RESULT) throw new ProjectError(`The hand-in is 1 to ${MAX_RESULT} characters.`);
  const file = fileOf(ctx);
  const projects = loadProjects(file);
  const p = must(projects, projectId);
  const t = mustTask(p, taskId);
  if (t.status !== "claimed" || t.assignee?.id !== worker.id) throw new ProjectError("Only the worker who took a task can hand it in.", 403);
  t.status = "submitted";
  t.result = result;
  p.updatedAt = nowOf(ctx);
  saveProjects(projects, file);
  writeProjectPage(p);
  return t;
}

export interface ReviewOutcome {
  task: Task;
  /** Points paid to the worker for this task. */
  paid: number;
  /** Set when this review finished the project. */
  completed: boolean;
  bonuses: Array<{ worker: Worker; points: number }>;
}

/**
 * Accept or reject a hand-in. The reviewer cannot be the worker. Accepting pays
 * the worker their task share; accepting the last task completes the project
 * and pays out the bonus.
 */
export function reviewTask(projectId: string, taskId: string, reviewer: Worker, verdict: "accept" | "reject", note: string, ctx: ProjectCtx = {}): ReviewOutcome {
  if (verdict !== "accept" && verdict !== "reject") throw new ProjectError("The verdict is \"accept\" or \"reject\".");
  const file = fileOf(ctx);
  const pf = pfileOf(ctx);
  const projects = loadProjects(file);
  const p = must(projects, projectId);
  const t = mustTask(p, taskId);
  if (t.status !== "submitted" || !t.assignee) throw new ProjectError("Only a handed-in task can be reviewed.", 409);
  if (reviewer.id === t.assignee.id) throw new ProjectError("Nobody reviews their own work. Someone else has to check it.", 403);
  const now = nowOf(ctx);
  t.reviewedBy = reviewer;
  t.reviewNote = (typeof note === "string" ? note : "").slice(0, 500);

  if (verdict === "reject") {
    t.attempts += 1;
    if (t.attempts >= MAX_ATTEMPTS) {
      // Out of tries for this worker: open it up for someone else rather than leave it stuck.
      t.status = "open";
      t.assignee = null;
      t.result = "";
      t.attempts = 0; // a fresh worker gets a fresh set of tries
    } else {
      t.status = "claimed";
    }
    p.updatedAt = now;
    saveProjects(projects, file);
    writeProjectPage(p);
    return { task: t, paid: 0, completed: false, bonuses: [] };
  }

  const totalWeight = p.tasks.reduce((n, x) => n + x.weight, 0);
  const pool = taskPoolOf(p.pot);
  const reward = floor6((pool * t.weight) / totalWeight);
  // Belt and braces: the split already cannot exceed the pool, and this makes sure of it.
  const taskPaidSoFar = round(p.tasks.reduce((n, x) => n + x.paid, 0));
  const pay = Math.max(0, Math.min(reward, round(pool - taskPaidSoFar)));

  // A project imported from another install can name workers this device has never met.
  const known = (w: Worker): void => void ensureMember(w.id, w.name, w.kind === "agent" ? "agent" : "peer", pf);
  known(t.assignee);
  if (pay > 0) award(t.assignee.id, pay, "task", `${p.title}: ${t.title}`, pf, now);
  t.status = "done";
  t.paid = pay;
  t.doneAt = now;
  p.paidOut = round(p.paidOut + pay);

  const bonuses: Array<{ worker: Worker; points: number }> = [];
  let completed = false;
  if (p.tasks.every(x => x.status === "done")) {
    completed = true;
    p.status = "complete";
    const bonusPool = bonusPoolOf(p.pot);
    const byWorker = new Map<string, { worker: Worker; weight: number }>();
    for (const x of p.tasks) {
      if (!x.assignee) continue;
      const have = byWorker.get(x.assignee.id);
      if (have) have.weight += x.weight;
      else byWorker.set(x.assignee.id, { worker: x.assignee, weight: x.weight });
    }
    for (const { worker, weight } of byWorker.values()) {
      const share = floor6((bonusPool * weight) / totalWeight);
      if (share > 0) {
        known(worker);
        award(worker.id, share, "project", `${p.title}: completed`, pf, now);
        p.paidOut = round(p.paidOut + share);
        bonuses.push({ worker, points: share });
      }
    }
    p.bonusPaid = true;
  }
  p.updatedAt = now;
  saveProjects(projects, file);
  writeProjectPage(p);
  return { task: t, paid: pay, completed, bonuses };
}

// ── For the UI ─────────────────────────────────────────────────────────

export interface ProjectSummary {
  id: string;
  title: string;
  goal: string;
  pot: number;
  paidOut: number;
  remaining: number;
  status: Project["status"];
  tasks: number;
  done: number;
  folders: string[];
  background: boolean;
  published: boolean;
}

export function summarize(p: Project): ProjectSummary {
  return {
    id: p.id, title: p.title, goal: p.goal, pot: p.pot, paidOut: p.paidOut, remaining: round(Math.max(0, p.pot - p.paidOut)),
    status: p.status, tasks: p.tasks.length, done: p.tasks.filter(t => t.status === "done").length, folders: p.folders,
    background: p.background,
    published: p.published,
  };
}

/** What each task is worth, at this moment, if it is accepted. */
export function rewardOf(p: Project, t: Task): number {
  const totalWeight = p.tasks.reduce((n, x) => n + x.weight, 0);
  return totalWeight > 0 ? floor6((taskPoolOf(p.pot) * t.weight) / totalWeight) : 0;
}

// ── The agent does the organising ──────────────────────────────────────

/** How the agent is reached. In the live system this is the real neural runner. */
export type Think = (prompt: string) => Promise<string>;

export interface Plan {
  folders: Array<{ name: string; tasks: Array<{ title: string }> }>;
  /** "agent" when its reply was usable, "fallback" when the plain split was used instead. */
  source: "agent" | "fallback";
}

const clean = (s: string): string => s.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();

/** Reads "Folder: X" and "- task" lines. Anything else the agent says is ignored. */
export function parsePlan(text: string): Plan["folders"] {
  const folders: Plan["folders"] = [];
  let current: Plan["folders"][number] | null = null;
  let total = 0;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const f = /^\s*(?:#{1,6}\s*)?(?:\*\*)?folder(?:\*\*)?\s*:\s*(.+)$/i.exec(line);
    if (f) {
      const name = cleanFolderName(clean(f[1]));
      current = folders.find(x => x.name.toLowerCase() === name.toLowerCase()) ?? null;
      if (!current && folders.length < 8) {
        current = { name, tasks: [] };
        folders.push(current);
      }
      continue;
    }
    const t = /^\s*(?:[-*•]|\d{1,2}[.)])\s+(.+)$/.exec(line);
    if (t && total < 40) {
      const title = clean(t[1]).slice(0, MAX_TITLE);
      if (!title) continue;
      if (!current) {
        current = folders.find(x => x.name === "Plan") ?? null;
        if (!current) {
          current = { name: "Plan", tasks: [] };
          folders.push(current);
        }
      }
      if (!current.tasks.some(x => x.title.toLowerCase() === title.toLowerCase())) {
        current.tasks.push({ title });
        total++;
      }
    }
  }
  return folders.filter(f => f.tasks.length > 0);
}

/** One task per sentence or line of the goal. Used when the agent's reply cannot be read. */
export function fallbackPlan(goal: string): Plan["folders"] {
  const parts = goal.split(/[\r\n;]+|(?<=[.!?])\s+/).map(clean).filter(Boolean).slice(0, 12);
  const titles = (parts.length ? parts : [clean(goal) || "Do the work"]).map(t => t.replace(/[.!?]+$/, "").slice(0, MAX_TITLE));
  return [{ name: "Plan", tasks: titles.map(title => ({ title })) }];
}

export async function planFromGoal(goal: string, think: Think): Promise<Plan> {
  const prompt =
    "Break this project into folders of tasks that several people and AIs can work on in parallel.\n" +
    "Reply with lines only. A line starting with \"Folder:\" names a folder. A line starting with \"-\" is a task in that folder.\n" +
    "Use 2 to 6 folders and 2 to 6 tasks in each. Make every task small enough for one worker.\n\n" +
    `Project: ${goal.slice(0, MAX_DETAIL)}`;
  let reply = "";
  try {
    reply = await think(prompt);
  } catch {
    reply = "";
  }
  const folders = parsePlan(reply);
  return folders.length > 0 ? { folders, source: "agent" } : { folders: fallbackPlan(goal), source: "fallback" };
}

export interface CreateFromGoalInput {
  title: string;
  goal: string;
  pot: number;
  background?: boolean;
}

/** Make a project from a goal and let the agent lay out its folders and tasks. */
export async function createProjectFromGoal(input: CreateFromGoalInput, think: Think, ctx: ProjectCtx = {}): Promise<{ project: Project; source: Plan["source"] }> {
  if (typeof input.goal !== "string" || !input.goal.trim()) throw new ProjectError("Say what the project is for, so there is something to plan.");
  const plan = await planFromGoal(input.goal, think);
  const tasks: TaskSpec[] = [];
  for (const f of plan.folders) for (const t of f.tasks) tasks.push({ title: t.title, folder: f.name });
  const project = createProject({ title: input.title, goal: input.goal, pot: input.pot, background: input.background, folders: plan.folders.map(f => f.name), tasks }, ctx);
  return { project, source: plan.source };
}

/** What the agent answered, reduced to one safe folder name, or null if it said nothing usable. */
export function parseFolderReply(reply: string): string | null {
  const first = String(reply ?? "").split(/\r?\n/).map(l => l.trim()).find(Boolean);
  if (!first) return null;
  const name = clean(first.replace(/^folder\s*:\s*/i, "").replace(/^["'“”‘’]+|["'“”‘’.!]+$/g, ""));
  const cleaned = cleanFolderName(name);
  return cleaned === UNSORTED && name.toLowerCase() !== UNSORTED.toLowerCase() ? null : cleaned;
}

const ORGANIZE_LIMIT = 40;

/**
 * File every task that has no folder yet into one, asking the agent where it
 * belongs. A task the agent gives no usable answer for stays in Unsorted.
 */
export async function organizeTasks(projectId: string, think: Think, ctx: ProjectCtx = {}): Promise<{ moved: number; asked: number }> {
  const file = fileOf(ctx);
  const initial = must(loadProjects(file), projectId);
  const targets = initial.tasks.filter(t => t.folder.toLowerCase() === UNSORTED.toLowerCase() && t.status !== "done").slice(0, ORGANIZE_LIMIT);
  const answers = new Map<string, string>();
  let asked = 0;
  const folders = initial.folders.filter(f => f.toLowerCase() !== UNSORTED.toLowerCase());
  for (const t of targets) {
    asked++;
    const prompt =
      `Project: ${initial.goal || initial.title}\n` +
      `Existing folders: ${folders.length ? folders.join(", ") : "(none yet)"}\n` +
      `Task: ${t.title}${t.detail ? ` - ${t.detail}` : ""}\n` +
      "Which folder does this task belong in? Reply with the folder name only: an existing one, or a short new one.";
    let reply = "";
    try {
      reply = await think(prompt);
    } catch {
      reply = "";
    }
    const name = parseFolderReply(reply);
    if (name && name.toLowerCase() !== UNSORTED.toLowerCase()) {
      answers.set(t.id, name);
      if (!folders.some(f => f.toLowerCase() === name.toLowerCase()) && folders.length < MAX_FOLDERS - 1) folders.push(name);
    }
  }
  // Re-read before writing: the agent is slow, and a task may have moved while it thought.
  const projects = loadProjects(file);
  const p = must(projects, projectId);
  let moved = 0;
  for (const [id, name] of answers) {
    const t = p.tasks.find(x => x.id === id);
    if (!t || t.folder.toLowerCase() !== UNSORTED.toLowerCase()) continue;
    t.folder = useFolder(p, name);
    if (t.folder.toLowerCase() !== UNSORTED.toLowerCase()) moved++;
  }
  if (moved > 0) {
    p.updatedAt = nowOf(ctx);
    saveProjects(projects, file);
    writeProjectPage(p);
  }
  return { moved, asked };
}

// ── The wiki page ──────────────────────────────────────────────────────

export const projectWikiName = (id: string): string => `projects/${id}`;

/** Another install cannot know this device's "me", so the owner travels by name. */
function exportWorker(w: Worker | null): Worker | null {
  if (!w) return null;
  return w.id === SELF_ID ? { kind: "person", id: `person-${slugOf(w.name)}`, name: w.name } : w;
}

function exportProject(p: Project): Project {
  return { ...p, tasks: p.tasks.map(t => ({ ...t, assignee: exportWorker(t.assignee), reviewedBy: exportWorker(t.reviewedBy) })) };
}

export function renderProjectPage(p: Project): string {
  const lines: string[] = [`# ${p.title}`, ""];
  if (p.goal) lines.push(`> ${p.goal.replace(/\n+/g, " ")}`, "");
  const done = p.tasks.filter(t => t.status === "done").length;
  lines.push(
    `**Pot:** ${p.pot} points (final) · **Paid out:** ${p.paidOut} · **Status:** ${p.status} (${done}/${p.tasks.length} tasks done)`,
    "",
  );
  for (const folder of p.folders) {
    const here = p.tasks.filter(t => t.folder === folder);
    if (here.length === 0) continue;
    lines.push(`## ${folder}`, "");
    for (const t of here) {
      const who = t.assignee ? ` — ${t.status === "done" ? "done by" : t.status} ${t.assignee.name}` : "";
      lines.push(`- [${t.status === "done" ? "x" : " "}] **${t.id}** ${t.title} — ${rewardOf(p, t)} pts${who}`);
    }
    lines.push("");
  }
  // The data other installs import. A comment, so it does not clutter the page.
  lines.push(`<!-- ${MARKER}`, JSON.stringify(exportProject(p)).replace(/--/g, "\\u002d\\u002d"), "-->", "");
  return lines.join("\n");
}

/** Reads the embedded data back out of a page. Null if it is missing or does not hold together. */
export function parseProjectPage(markdown: string): Project | null {
  const m = new RegExp(`<!--\\s*${MARKER}\\s*\\n([\\s\\S]*?)\\n-->`).exec(markdown);
  if (!m) return null;
  try {
    return cleanProject(JSON.parse(m[1]));
  } catch {
    return null;
  }
}

/**
 * Keep the wiki page current, for a project that has been shared. A private
 * project has no page at all: the wiki is public, so writing one would hand the
 * project to everyone. Local only: nothing is committed or pushed.
 */
function writeProjectPage(p: Project): void {
  if (!p.published) return;
  try {
    publishWikiPage(projectWikiName(p.id), p.title, renderProjectPage(p));
  } catch (err) {
    if (!(err instanceof WikiNameError)) throw err;
    // A curated page already holds this name. The project still works; it just is not mirrored.
  }
}

/**
 * Share a project (or stop sharing it): the wiki page appears for everyone on
 * this server, and the league lists it. Not a push: that is publishProject().
 */
export function setPublished(projectId: string, on: boolean, ctx: ProjectCtx = {}): Project {
  const file = fileOf(ctx);
  const projects = loadProjects(file);
  const p = must(projects, projectId);
  p.published = on === true;
  saveProjects(projects, file);
  if (p.published) writeProjectPage(p);
  else {
    try {
      deleteWikiPage(projectWikiName(p.id));
    } catch {
      // No page to take down, or it is a curated one that was never ours.
    }
  }
  return p;
}

/** Push the project's wiki page so everyone who pulls gets it. This also shares it. */
export async function publishProject(projectId: string, ctx: ProjectCtx = {}): Promise<{ name: string; sync: StoreSyncResult }> {
  if (!must(loadProjects(fileOf(ctx)), projectId).published) setPublished(projectId, true, ctx);
  const p = must(loadProjects(fileOf(ctx)), projectId);
  const { sync } = await publishWikiPageAndSync(projectWikiName(p.id), p.title, renderProjectPage(p));
  return { name: projectWikiName(p.id), sync };
}

/**
 * Bring in a project another install published. Replaces a local copy only if
 * the incoming one is newer. Never pays anyone.
 */
export interface LeagueProject extends ProjectSummary {
  /** The wiki page it lives on. */
  page: string;
  /** Whether this device already has it. */
  local: boolean;
}

/**
 * Every project published to the wiki, whoever made it: the league. Each is
 * read strictly, so a page that only looks like a project is left out.
 */
export function listWikiProjects(ctx: ProjectCtx = {}): LeagueProject[] {
  const mine = new Set(loadProjects(fileOf(ctx)).map(p => p.id));
  const out: LeagueProject[] = [];
  for (const page of listWikiPages()) {
    if (!page.name.startsWith("projects/")) continue;
    let project: Project | null = null;
    try {
      const full = readWikiPage(page.name);
      project = full ? parseProjectPage(full.content) : null;
    } catch {
      project = null;
    }
    if (project) out.push({ ...summarize(project), page: page.name, local: mine.has(project.id) });
  }
  return out;
}

export function importProject(pageName: string, ctx: ProjectCtx = {}): { project: Project; replaced: boolean } {
  const page = readWikiPage(pageName);
  if (!page) throw new ProjectError("No such wiki page.", 404);
  const incoming = parseProjectPage(page.content);
  if (!incoming) throw new ProjectError("That page is not a project, or its data is damaged.");
  incoming.published = false; // joined, not yet shared by this person
  incoming.background = false; // somebody else's project does not start using this brain until its owner here says so
  const file = fileOf(ctx);
  const projects = loadProjects(file);
  const at = projects.findIndex(p => p.id === incoming.id);
  if (at >= 0) {
    if (projects[at].updatedAt >= incoming.updatedAt) return { project: projects[at], replaced: false };
    projects[at] = incoming;
  } else {
    if (projects.length >= MAX_PROJECTS) throw new ProjectError(`At most ${MAX_PROJECTS} projects on one device.`);
    projects.push(incoming);
  }
  saveProjects(projects, file);
  return { project: incoming, replaced: at >= 0 };
}
