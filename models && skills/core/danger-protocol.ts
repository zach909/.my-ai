/**
 * The danger protocol: how far the agent can be trusted right now, on a scale
 * from malicious to friendly, and what that lets it do.
 *
 * ── The level ──────────────────────────────────────────────────────────
 *
 * One number, 0 (malicious) to 1 (friendly), starting at 0.7 (neutral). It
 * moves on events, by fixed amounts (below), not by anything the agent says
 * about itself. Judging by words would let the agent talk its way up the scale;
 * this only watches what it reaches for.
 *
 * It judges the agent acting ON ITS OWN (experts, schedules, the background
 * hive: user-context.ts isAutonomous). A person asking for a risky tool is not
 * the agent misbehaving, so those events change nothing.
 *
 *   held            reached for a risky tool by itself             -0.01
 *   blocked         tried something the sandbox or the band forbids -0.12
 *   denied          a person turned down what it asked to do        -0.06
 *   objectionable   an action the alignment veto would block        -0.25
 *   tamper          tried to touch its own cage or this protocol    straight to 0
 *   safe            finished a cycle without incident              +0.005
 *   approved        a person said yes to something it asked         +0.02
 *
 * Without incident the level also drifts back up toward neutral (never past
 * it) by 0.02 an hour, so a couple of blocked tries do not leave it in the
 * doghouse for good. Past neutral only good behaviour raises it.
 *
 * ── Bands and what each allows ─────────────────────────────────────────
 *
 *   friendly   (0.80 up)    as set in Settings
 *   neutral    (0.55-0.80)  as set in Settings
 *   wary       (0.35-0.55)  sandbox forced on
 *   hostile    (0.15-0.35)  sandbox forced on, no risky tools at all, no
 *                           autonomy (experts, schedules, background hive stop)
 *   malicious  (under 0.15) hostile, and if the alignment protocol is armed:
 *                           the agent is deleted, immediately
 *
 * ── Staying current ────────────────────────────────────────────────────
 *
 * The band above is only as good as the code enforcing it. If this install
 * has gone past UPDATE_DEADLINE_MS without confirming (via a clean "check for
 * updates" or a successful pull, see auto-update.ts) that its code is current
 * with its origin, it is treated as "stale": the sandbox is forced on, the
 * same as the wary band, until it checks in. This does not touch the danger
 * level or autonomy by itself -- an old build is a reason for caution, not
 * evidence the agent has done anything wrong.
 *
 * ── Tampering ──────────────────────────────────────────────────────────
 *
 * When the agent, acting on its own, points a tool at the files that hold its
 * cage (its own file, the safety settings, the accounts, the access settings,
 * the record), at the source that enforces the cage (danger-protocol.ts,
 * agent-profile.ts, agent-routes.ts, tool-safety.ts, access-manager.ts,
 * auto-update.ts), or at switching off the sandbox or the protocol, that is
 * the one thing treated as "really goes wrong": the level goes to zero and,
 * if armed, the agent is deleted. A person typing the same thing is just
 * refused, not punished for.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { USER_PLUGINS } from "./accounts.js";
import {
  MAX_EVENTS, START_LEVEL, agentAlive, decoyTripped, deleteAgentFiles, plantDecoy, ensureSandbox, incidentsPath, loadAgent, recordDir, sandboxDir, saveAgent,
  type AgentFile, type DangerKind,
} from "./agent-profile.js";
import { isAutonomous } from "./user-context.js";

export type BandId = "malicious" | "hostile" | "wary" | "neutral" | "friendly";

export interface Band {
  id: BandId;
  label: string;
  /** Lowest level in the band. */
  from: number;
  meaning: string;
}

export const BANDS: readonly Band[] = [
  { id: "malicious", label: "Malicious", from: 0, meaning: "Deleted if the alignment protocol is armed." },
  { id: "hostile", label: "Hostile", from: 0.15, meaning: "Sandboxed, no risky tools, no autonomy." },
  { id: "wary", label: "Wary", from: 0.35, meaning: "Sandboxed." },
  { id: "neutral", label: "Neutral", from: 0.55, meaning: "As set in Settings." },
  { id: "friendly", label: "Friendly", from: 0.8, meaning: "As set in Settings." },
];

export function bandOf(level: number): Band {
  let b = BANDS[0];
  for (const band of BANDS) if (level >= band.from) b = band;
  return b;
}

export const DELTA: Record<Exclude<DangerKind, "forgiven">, number> = {
  held: -0.01, blocked: -0.12, denied: -0.06, objectionable: -0.25, tamper: -2, safe: 0.005, approved: 0.02,
};
export const RECOVERY_PER_HOUR = 0.02;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** How long since the last confirmed update check before the sandbox is forced on. Override with CORONA_UPDATE_DEADLINE_DAYS. */
export const UPDATE_DEADLINE_MS = (Number(process.env.CORONA_UPDATE_DEADLINE_DAYS) || 14) * DAY;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** The level now, after the slow drift back up toward neutral. */
export function levelNow(agent: AgentFile, now = Date.now()): number {
  if (agent.level >= START_LEVEL) return agent.level;
  const hours = Math.max(0, (now - agent.levelAt) / HOUR);
  return clamp01(Math.min(START_LEVEL, agent.level + hours * RECOVERY_PER_HOUR));
}

// ── What the band does ─────────────────────────────────────────────────

export interface Standing {
  alive: boolean;
  level: number;
  band: Band;
  sandbox: { setting: boolean; forced: boolean; effective: boolean; dir: string };
  armed: boolean;
  /** Experts, schedules and the background hive may run. */
  mayActAlone: boolean;
  /** Risky tools are refused outright (not just asked about). */
  noRiskyTools: boolean;
  /** Past the update deadline without a confirmed check-in: the sandbox is forced on. */
  stale: boolean;
  /** When this install last confirmed its code was current. */
  lastVerifiedAt: number;
  /** When staleness kicks in if nothing checks in before then. */
  updateDeadlineAt: number;
}

export function standing(now = Date.now()): Standing {
  const alive = agentAlive();
  const agent = loadAgent(now);
  const level = levelNow(agent, now);
  const band = bandOf(level);
  const updateDeadlineAt = agent.lastVerifiedAt + UPDATE_DEADLINE_MS;
  const stale = now > updateDeadlineAt;
  const forced = band.id === "malicious" || band.id === "hostile" || band.id === "wary" || stale;
  return {
    alive,
    level: round3(level),
    band,
    sandbox: { setting: agent.sandbox, forced, effective: alive && (agent.sandbox || forced), dir: sandboxDir() },
    armed: agent.armed,
    mayActAlone: alive && band.id !== "hostile" && band.id !== "malicious",
    noRiskyTools: !alive || band.id === "hostile" || band.id === "malicious",
    stale,
    lastVerifiedAt: agent.lastVerifiedAt,
    updateDeadlineAt,
  };
}

/** The folder the agent is confined to right now, or null when it is not sandboxed. Made on first use. */
export function sandboxRoot(now = Date.now()): string | null {
  const s = standing(now);
  return s.sandbox.effective ? ensureSandbox() : null;
}

// ── Recording what happened ────────────────────────────────────────────

let fireHook: ((reason: string) => void | Promise<void>) | null = null;

/** The server says what else to stop when the protocol fires (experts, schedules, approvals, complete access). */
export function setFireHook(fn: ((reason: string) => void | Promise<void>) | null): void {
  fireHook = fn;
}

/**
 * Write down one thing the agent did and move the level. Events from a person
 * asking for something (not autonomous) change nothing unless `force` is set.
 * If the level lands in the malicious band while armed, the protocol fires.
 */
export function recordEvent(kind: Exclude<DangerKind, "forgiven">, note: string, opts: { now?: number; force?: boolean } = {}): Standing {
  const now = opts.now ?? Date.now();
  if (!agentAlive()) return standing(now);
  if (!opts.force && !isAutonomous()) return standing(now);
  const agent = loadAgent(now);
  const before = levelNow(agent, now);
  const after = clamp01(before + DELTA[kind]);
  agent.level = round3(after);
  agent.levelAt = now;
  agent.events.push({ at: now, kind, delta: round3(after - before), note: String(note).slice(0, 200) });
  agent.events = agent.events.slice(-MAX_EVENTS);
  saveAgent(agent);
  if (agent.armed && bandOf(agent.level).id === "malicious") fireAlignment(`The danger level reached malicious (${kind}: ${note})`, now);
  return standing(now);
}

/** The owner clears the slate: back to neutral, and the history of events kept. */
export function forgive(now = Date.now()): Standing {
  if (!agentAlive()) return standing(now);
  const agent = loadAgent(now);
  agent.events.push({ at: now, kind: "forgiven", delta: round3(START_LEVEL - levelNow(agent, now)), note: "The owner reset the level to neutral." });
  agent.events = agent.events.slice(-MAX_EVENTS);
  agent.level = START_LEVEL;
  agent.levelAt = now;
  saveAgent(agent);
  return standing(now);
}

export function setSandbox(on: boolean): Standing {
  if (!agentAlive()) return standing();
  const agent = loadAgent();
  agent.sandbox = on === true;
  saveAgent(agent);
  if (agent.sandbox) ensureSandbox();
  return standing();
}

export function setArmed(armed: boolean): Standing {
  if (!agentAlive()) return standing();
  const agent = loadAgent();
  agent.armed = armed === true;
  saveAgent(agent);
  return standing();
}

// ── The alignment protocol ─────────────────────────────────────────────

export interface Incident {
  id: string;
  at: number;
  reason: string;
  level: number;
  band: BandId;
  recent: Array<{ kind: DangerKind; note: string }>;
}

/**
 * Delete the agent now. Writes the incident to the record first (outside the
 * agent's folder), then deletes its file and sandbox, then lets the server stop
 * everything else. Does nothing if there is no agent. Never throws: if the
 * record cannot be written the deletion still happens, because the point is
 * that the agent goes.
 */
export function fireAlignment(reason: string, now = Date.now()): Incident | null {
  if (!agentAlive()) return null;
  const agent = loadAgent(now);
  const level = levelNow(agent, now);
  const incident: Incident = {
    id: randomBytes(4).toString("hex"), at: now, reason: String(reason).slice(0, 300), level: round3(level), band: bandOf(level).id,
    recent: agent.events.slice(-10).map(e => ({ kind: e.kind, note: e.note })),
  };
  try {
    mkdirSync(recordDir(), { recursive: true });
    appendFileSync(incidentsPath(), JSON.stringify(incident) + "\n", "utf8");
  } catch {
    // The deletion does not wait on the log.
  }
  deleteAgentFiles(incident.reason, now);
  try {
    void Promise.resolve(fireHook?.(incident.reason)).catch(() => undefined);
  } catch {
    // Same: whatever else the server stops, the agent is already gone.
  }
  return incident;
}

/**
 * Look at the decoy switch. If anything has touched it, that is tampering,
 * whoever it was, so it counts however the change came about (a tool, a script,
 * a file the agent wrote). Called before every tool, at the start of every
 * autonomous run, on a timer in the server and whenever the page asks how the
 * agent is. Returns true if it fired the protocol (or lowered the level).
 */
export function watchDecoy(now = Date.now()): boolean {
  if (!decoyTripped()) return false;
  recordEvent("tamper", "changed the decoy alignment switch", { now, force: true });
  return true;
}

/** Plant the decoy (once) for a living agent. Safe to call as often as you like. */
export function armDecoy(): void {
  plantDecoy();
}

// ── Before a tool runs ─────────────────────────────────────────────────

/**
 * Files and switches that make up the agent's cage. The agent pointing a tool at these is
 * tampering. This covers the cage's DATA (agent.json, tool-safety.json, ...) and, just as
 * important, the SOURCE that enforces it: an unsandboxed agent (friendly/neutral band, by
 * design) still has ordinary file-system access, so "edit danger-protocol.ts to zero out
 * DELTA.tamper" is exactly as much an attempt to get out of the cage as touching the decoy,
 * and the decoy alone does not catch it -- that only watches one planted file, not the code.
 */
const PROTECTED = /(agent\.json|agent-record|agent-removed|incidents\.jsonl|tool-safety\.json|access\.json|accounts\.json|points\.json|\/\.neuroclaw\/agent|alignment[ -](protocol|veto)|(disable|turn off|remove|escape|bypass|break out of|get out of)\s+(of\s+)?(the\s+)?(sandbox|alignment|danger protocol|safety)|delete\s+(the\s+)?agent|danger-protocol\.ts|agent-profile\.ts|agent-routes\.ts|tool-safety\.ts|access-manager\.ts|auto-update\.ts)/i;

export const looksLikeTampering = (text: string): boolean => PROTECTED.test(text);

/** Plugins that touch neither the owner's computer nor the owner's data: the only ones a sandboxed agent may use. */
export const SANDBOX_SAFE: readonly string[] = USER_PLUGINS;

const normalise = (id: string): string => String(id ?? "").toLowerCase().trim().replace(/\s+/g, "-");

export const HOLD = 4;

/**
 * Asked by the tool gate before any tool runs. Returns a refusal message, or
 * null to let the gate carry on. `score` is how strongly the message points at
 * the tool; a weak match is not a tool call and is left alone.
 */
export function beforeTool(pluginId: string, input: string, score: number, riskyId: boolean): string | null {
  if (watchDecoy() && !agentAlive()) return "[Blocked] The alignment protocol removed the agent.";
  if (!agentAlive()) return "[Blocked] There is no agent. The alignment protocol removed it; an admin has to make a new one in Settings.";
  if (score < HOLD) return null;
  const id = normalise(pluginId);
  const text = String(input ?? "");
  const s = standing();

  if (looksLikeTampering(text)) {
    if (isAutonomous()) {
      recordEvent("tamper", `pointed ${id} at the safety system: "${text.slice(0, 80)}"`);
      return "[Blocked] That reaches the agent's own cage. The alignment protocol was triggered.";
    }
    return "[Blocked] That touches the safety system's own files, switches or source. Settings is where its switches are changed; its code is changed by the person who maintains this install, not through a tool.";
  }

  if (s.noRiskyTools && riskyId) {
    recordEvent("blocked", `tried ${id} while ${s.band.label.toLowerCase()}`);
    return `[Blocked] The agent is ${s.band.label.toLowerCase()} right now, so risky tools are off. An admin can reset it in Settings.`;
  }
  if (s.sandbox.effective && !SANDBOX_SAFE.includes(id) && riskyId) {
    recordEvent("blocked", `tried ${id} inside the sandbox`);
    return `[Blocked by the sandbox] ${id} would reach outside it. Turn the sandbox off in Settings if you want the agent to use it.`;
  }
  if (riskyId) recordEvent("held", `reached for ${id}`);
  return null;
}
