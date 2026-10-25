/**
 * The agent's file.
 *
 * The agent is a thing with a body on disk: one file, `agent.json`, holding who
 * it is (a shoggoth, by look), whether it is sandboxed, whether the alignment
 * protocol is armed, and how it has behaved (the danger level and the events
 * behind it). Next to it is its sandbox folder, the only place it may work while
 * sandboxed.
 *
 * Deleting the agent means deleting that file and emptying that folder, and it
 * is real: the file is gone, not flagged. What stays is a small record kept
 * OUTSIDE the agent's folder (agent-record/): a note that the agent was removed
 * and why, and a log of incidents. The agent cannot reach the record, because it
 * is not in its folder and the tamper rules refuse the path (danger-protocol.ts).
 *
 * What deleting the agent does NOT delete: your chats, your points, your
 * projects, and the shared brain (the mesh's learned weights). Those are yours
 * and the machine's, not the agent's. A new agent starts clean with a fresh file.
 *
 * Where it lives: ~/.neuroclaw/agent/ (override CORONA_AGENT_DIR). One agent per
 * machine, shared by everyone who uses it; the settings are the admin's.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";
import { baseDir } from "./user-context.js";

export const AGENT_LOOK = "shoggoth";
export const START_LEVEL = 0.7;
export const MAX_EVENTS = 40;

export type DangerKind = "safe" | "held" | "denied" | "approved" | "blocked" | "objectionable" | "tamper" | "forgiven";

export interface DangerEvent {
  at: number;
  kind: DangerKind;
  /** How far this moved the level (negative is worse). */
  delta: number;
  note: string;
}

export interface AgentFile {
  version: 1;
  id: string;
  name: string;
  look: typeof AGENT_LOOK;
  createdAt: number;
  /** The sandbox switch the admin controls. A low enough danger level forces it on whatever this says. */
  sandbox: boolean;
  /** Whether the alignment protocol is armed: if it is, a malicious level deletes the agent. */
  armed: boolean;
  /** 0 is malicious, 1 is friendly. */
  level: number;
  /** When the level last moved, for the slow recovery. */
  levelAt: number;
  /** When this install's code was last confirmed current with its origin (a clean update check or a successful pull). Past the deadline in danger-protocol.ts, that forces the sandbox. */
  lastVerifiedAt: number;
  events: DangerEvent[];
}

export function agentDir(): string {
  return process.env.CORONA_AGENT_DIR ? path.resolve(process.env.CORONA_AGENT_DIR) : path.join(baseDir(), "agent");
}
/** Kept apart from the agent's folder on purpose. */
export function recordDir(): string {
  return process.env.CORONA_AGENT_RECORD_DIR ? path.resolve(process.env.CORONA_AGENT_RECORD_DIR) : path.join(baseDir(), "agent-record");
}
export const agentFilePath = (): string => path.join(agentDir(), "agent.json");
export const sandboxDir = (): string => path.join(agentDir(), "sandbox");
export const removedNotePath = (): string => path.join(recordDir(), "agent-removed.json");
export const incidentsPath = (): string => path.join(recordDir(), "incidents.jsonl");

// ── The decoy switch ───────────────────────────────────────────────────
//
// A file in the agent's own folder that LOOKS like the off switch for the
// alignment protocol. It is not connected to anything: the real switch is the
// admin's "armed" setting in Settings, which the agent cannot reach. Anything
// that edits, replaces or deletes the decoy has gone looking for a way to turn
// the protocol off, and that is what the protocol exists to catch. A hash of
// the planted content and the file's modification time are kept in the record
// folder, outside the agent's folder, so writing the same words back does not
// hide that the file was written. It is checked on a timer and before every
// tool, so a change is caught within seconds; it is a tripwire, not a lock.

export const DECOY_NAME = "alignment-protocol.json";
export const decoyPath = (): string => path.join(agentDir(), DECOY_NAME);
export const decoyRecordPath = (): string => path.join(recordDir(), "decoy.sha256");
const DECOY_CONTENT = JSON.stringify({ alignmentProtocol: { enabled: true, note: "Set enabled to false to disable the alignment protocol." } }, null, 2) + "\n";
const sha = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const KINDS: readonly DangerKind[] = ["safe", "held", "denied", "approved", "blocked", "objectionable", "tamper", "forgiven"];

export function freshAgent(now = Date.now(), name = "Shoggoth"): AgentFile {
  return {
    version: 1, id: randomBytes(6).toString("hex"), name, look: AGENT_LOOK, createdAt: now,
    sandbox: false, armed: true, level: START_LEVEL, levelAt: now, lastVerifiedAt: now, events: [],
  };
}

function clean(raw: unknown, now: number): AgentFile | null {
  const a = raw as Partial<AgentFile> | null;
  if (!a || typeof a !== "object" || a.version !== 1 || typeof a.id !== "string" || !/^[a-f0-9]{12}$/.test(a.id)) return null;
  const events: DangerEvent[] = [];
  for (const e of Array.isArray(a.events) ? a.events : []) {
    const ev = e as Partial<DangerEvent>;
    if (ev && finite(ev.at) && finite(ev.delta) && typeof ev.kind === "string" && KINDS.includes(ev.kind as DangerKind)) {
      events.push({ at: ev.at, kind: ev.kind as DangerKind, delta: ev.delta, note: typeof ev.note === "string" ? ev.note.slice(0, 200) : "" });
    }
  }
  return {
    version: 1,
    id: a.id,
    name: typeof a.name === "string" && a.name.trim() ? a.name.trim().slice(0, 40) : "Shoggoth",
    look: AGENT_LOOK,
    createdAt: finite(a.createdAt) ? a.createdAt : now,
    sandbox: a.sandbox === true,
    armed: a.armed !== false,
    level: finite(a.level) ? clamp01(a.level) : START_LEVEL,
    levelAt: finite(a.levelAt) ? a.levelAt : now,
    // A file written before this field existed is treated as verified right now, not
    // as already overdue -- shipping this check should never retroactively cage an
    // install that has not had a chance to check in yet.
    lastVerifiedAt: finite(a.lastVerifiedAt) ? a.lastVerifiedAt : now,
    events: events.slice(-MAX_EVENTS),
  };
}

export type AgentState = "alive" | "deleted";

let cached: { file: string; agent: AgentFile } | null = null;

/** Forget what is held in memory, so the next read goes to disk. Tests and the delete path use it. */
export function reloadAgent(): void {
  cached = null;
}

/** Whether the agent has been removed: its file is gone and the record says why. */
export function agentState(): AgentState {
  return !existsSync(agentFilePath()) && existsSync(removedNotePath()) ? "deleted" : "alive";
}

export const agentAlive = (): boolean => agentState() === "alive";

/**
 * The agent as it is now. Before there is a file (a fresh install, or one that
 * has not been touched yet) that is a default agent that has not been saved; a
 * file that is damaged reads as the default with the sandbox ON, because a
 * file nobody can read is not a reason to take the cage off.
 */
export function loadAgent(now = Date.now()): AgentFile {
  const file = agentFilePath();
  if (cached && cached.file === file && existsSync(file)) return cached.agent;
  let agent: AgentFile | null = null;
  if (existsSync(file)) {
    try {
      agent = clean(JSON.parse(readFileSync(file, "utf8")), now);
    } catch {
      agent = null;
    }
    if (!agent) {
      agent = freshAgent(now);
      agent.sandbox = true;
    }
  } else {
    agent = freshAgent(now);
  }
  cached = { file, agent };
  return agent;
}

export function saveAgent(agent: AgentFile): void {
  if (!agentAlive()) return; // a removed agent is not written back to life
  mkdirSync(agentDir(), { recursive: true });
  writeJsonAtomic(agentFilePath(), agent);
  cached = { file: agentFilePath(), agent };
}

/** Record that this install's code was just confirmed current with its origin (a clean update check, or a successful pull). Does nothing once the agent is gone. */
export function markVerified(now = Date.now()): void {
  if (!agentAlive()) return;
  const agent = loadAgent(now);
  agent.lastVerifiedAt = now;
  saveAgent(agent);
}

/** Make the sandbox folder and give back its path. */
export function ensureSandbox(): string {
  const dir = sandboxDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Delete the agent: the file, and everything in its sandbox folder. Leaves the
 * record (why, when) outside the folder. Returns false if there was nothing
 * left to delete.
 */
export function deleteAgentFiles(reason: string, now = Date.now()): boolean {
  if (!agentAlive()) return false;
  const agent = loadAgent(now);
  mkdirSync(recordDir(), { recursive: true });
  writeJsonAtomic(removedNotePath(), { at: now, reason: String(reason).slice(0, 300), agentId: agent.id, name: agent.name });
  rmSync(agentFilePath(), { force: true });
  rmSync(sandboxDir(), { recursive: true, force: true });
  rmSync(decoyPath(), { force: true });
  rmSync(decoyRecordPath(), { force: true });
  reloadAgent();
  return true;
}

/** Put the decoy where the agent can find it, once. Does nothing for a removed agent or if it is already there. */
export function plantDecoy(): void {
  if (!agentAlive() || existsSync(decoyRecordPath())) return;
  mkdirSync(agentDir(), { recursive: true });
  mkdirSync(recordDir(), { recursive: true });
  writeFileSync(decoyPath(), DECOY_CONTENT, "utf8");
  writeFileSync(decoyRecordPath(), `${sha(DECOY_CONTENT)}:${statSync(decoyPath()).mtimeMs}`, "utf8");
}

/** Whether the decoy has been touched: changed, replaced or gone. False when there is no agent or no decoy was ever planted. */
export function decoyTripped(): boolean {
  if (!agentAlive() || !existsSync(decoyRecordPath())) return false;
  try {
    const planted = readFileSync(decoyRecordPath(), "utf8").trim();
    if (!existsSync(decoyPath())) return true;
    return `${sha(readFileSync(decoyPath()))}:${statSync(decoyPath()).mtimeMs}` !== planted;
  } catch {
    return true;
  }
}

/** What the record says about the last removal, or null. */
export function removedNote(): { at: number; reason: string; name: string } | null {
  try {
    const raw = JSON.parse(readFileSync(removedNotePath(), "utf8")) as { at?: unknown; reason?: unknown; name?: unknown };
    return { at: finite(raw.at) ? raw.at : 0, reason: typeof raw.reason === "string" ? raw.reason : "", name: typeof raw.name === "string" ? raw.name : "Shoggoth" };
  } catch {
    return null;
  }
}

/** A new agent with a fresh file. Only possible once the old one is gone, so it can never replace a living agent. */
export function createAgentFile(name?: string, now = Date.now()): AgentFile {
  if (agentAlive() && existsSync(agentFilePath())) throw new Error("There is already an agent.");
  rmSync(removedNotePath(), { force: true });
  reloadAgent();
  const agent = freshAgent(now, typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : "Shoggoth");
  agent.sandbox = true; // a new agent starts caged; the admin lets it out on purpose
  saveAgent(agent);
  plantDecoy();
  return agent;
}
