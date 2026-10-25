/**
 * The agent, its sandbox, its danger level and the alignment protocol.
 *
 *   GET  /api/agent                      who is there and how it stands (everyone signed in: the ring needs it)
 *   POST /api/agent/sandbox              { on }                 admin
 *   POST /api/agent/alignment            { armed, confirm? }    admin (turning it off needs confirm: true)
 *   POST /api/agent/forgive              {}                     admin: level back to neutral
 *   POST /api/agent/delete               { phrase }             admin: delete the agent now
 *   POST /api/agent/create               { name? }              admin: make a new one, once the old one is gone
 *   GET  /api/agent/mind                 the mind reader: which neurons are firing and whether that looks aligned   admin
 *   POST /api/agent/mind/label           { label: "aligned"|"misaligned" }   admin: teach it that this moment was fine / not
 *   POST /api/agent/mind/reset           { confirm: true }      admin: forget everything it learned
 *   GET  /api/agent/escape-warning       full history of sandbox breaches   admin
 *   POST /api/agent/escape-warning/acknowledge   silence the banner until the next breach   admin
 *
 * A regular user sees only the state, the look and the band (enough to draw
 * the agent and its goodbye), plus whether an escape warning is active (a
 * breach is everyone's business, not just the admin's); the settings, events
 * and capabilities are the admin's. The write routes are not on a regular
 * user's allowlist at all (accounts.ts), and check again here.
 */

import type http from "node:http";
import { CAPABILITIES, type AccessManager } from "../models && skills/core/access-manager.js";
import { acknowledgeEscapeWarning, agentAlive, agentState, createAgentFile, decoyPath, escapeWarningStatus, loadAgent, removedNote } from "../models && skills/core/agent-profile.js";
import { BANDS, armDecoy, armHoneypot, fireAlignment, forgive, setArmed, setSandbox, standing, watchDecoy, watchHoneypot } from "../models && skills/core/danger-protocol.js";
import { RISKY_TOOLS, loadSafety, needsApproval, normalizeToolId } from "../models && skills/core/tool-safety.js";
import { isOwnerOrAdmin } from "../models && skills/core/user-context.js";
import { sharedMindReader } from "../models && skills/core/mind-reader.js";

export const DELETE_PHRASE = "delete the agent";

export class AgentRouteError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface AgentContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  pathname: string;
  method: string;
  parseBody(req: http.IncomingMessage, maxBytes?: number): Promise<unknown>;
  sendJson(res: http.ServerResponse, data: unknown, status?: number): void;
  access(): Promise<AccessManager | null>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const isAgentRoute = (pathname: string): boolean => pathname === "/api/agent" || pathname.startsWith("/api/agent/");

export interface CapabilityRow {
  id: string;
  label: string;
  note: string;
  /** free: goes ahead. asks: you are asked. agent: the judge agent decides. blocked: refused. gone: there is no agent. */
  state: "free" | "asks" | "agent" | "blocked" | "gone";
}

export async function capabilityRows(ctx: Pick<AgentContext, "access">): Promise<CapabilityRow[]> {
  const st = standing();
  const safety = loadSafety();
  const rows: CapabilityRow[] = [];
  const gone = !st.alive;
  rows.push({ id: "chat", label: "Chat and safe tools", note: "Answering, research, coding help, images, games.", state: gone ? "gone" : "free" });
  rows.push({
    id: "autonomy", label: "Working on its own", note: "Experts, schedules and the background hive.",
    state: gone ? "gone" : st.mayActAlone ? "free" : "blocked",
  });
  for (const t of RISKY_TOOLS) {
    if (gone) { rows.push({ id: t.id, label: t.label, note: t.why, state: "gone" }); continue; }
    const id = normalizeToolId(t.id);
    let state: CapabilityRow["state"];
    let note = t.why;
    if (st.noRiskyTools) { state = "blocked"; note = `Off while the agent is ${st.band.label.toLowerCase()}.`; }
    else if (st.sandbox.effective) { state = "blocked"; note = "Off while the sandbox is on."; }
    else if (!needsApproval(id, safety)) state = "free";
    else if (safety.judge.enabled && (t.level !== "high" || safety.judge.high)) state = "agent";
    else state = "asks";
    rows.push({ id: t.id, label: t.label, note, state });
  }
  const manager = await ctx.access();
  if (manager) {
    for (const c of CAPABILITIES) {
      rows.push({
        id: `access:${c}`, label: c, note: "Access layer",
        state: gone ? "gone" : manager.allows(c) ? "free" : "blocked",
      });
    }
  }
  return rows;
}

export async function agentSnapshot(ctx: Pick<AgentContext, "access">) {
  const st = standing();
  const escape = escapeWarningStatus();
  const base = {
    state: agentState(),
    look: "shoggoth",
    name: loadAgent().name,
    level: st.level,
    band: { id: st.band.id, label: st.band.label },
    // A breach is everyone's business, not just the admin's: the banner can show for any signed-in user.
    escapeWarningActive: escape.active,
  };
  if (!isOwnerOrAdmin()) return base;
  const agent = loadAgent();
  return {
    ...base,
    sandbox: st.sandbox,
    armed: st.armed,
    mayActAlone: st.mayActAlone,
    noRiskyTools: st.noRiskyTools,
    bands: BANDS.map(b => ({ id: b.id, label: b.label, from: b.from, meaning: b.meaning })),
    events: agent.events.slice(-12).reverse(),
    capabilities: await capabilityRows(ctx),
    removed: agentState() === "deleted" ? removedNote() : null,
    decoy: { path: decoyPath() },
    phrases: { delete: DELETE_PHRASE },
  };
}

/** Returns true when the route was handled. */
export async function handleAgentRoutes(ctx: AgentContext): Promise<boolean> {
  if (!isAgentRoute(ctx.pathname)) return false;
  try {
    return await route(ctx);
  } catch (err) {
    const status = err instanceof AgentRouteError ? err.status : 500;
    ctx.sendJson(ctx.res, { error: err instanceof Error ? err.message : String(err) }, status);
    return true;
  }
}

async function route(ctx: AgentContext): Promise<boolean> {
  const { pathname, method, req, res } = ctx;
  const send = async (status = 200): Promise<true> => {
    ctx.sendJson(res, await agentSnapshot(ctx), status);
    return true;
  };
  if (pathname === "/api/agent" && method === "GET") {
    // The page asks every few seconds, which is also how a touched decoy or honeypot is noticed promptly.
    if (agentAlive()) {
      armDecoy();
      watchDecoy();
      armHoneypot();
      watchHoneypot();
    }
    return send();
  }
  if (pathname === "/api/agent/escape-warning" && method === "GET") {
    if (!isOwnerOrAdmin()) throw new AgentRouteError("Only the admin can read this.", 403);
    ctx.sendJson(res, escapeWarningStatus());
    return true;
  }
  if (pathname === "/api/agent/mind" && method === "GET") {
    // Reads the network and judges it; changes nothing in it.
    if (!isOwnerOrAdmin()) throw new AgentRouteError("Only the admin can read this.", 403);
    ctx.sendJson(res, sharedMindReader().status());
    return true;
  }
  if (method !== "POST") return false;
  if (!isOwnerOrAdmin()) throw new AgentRouteError("Only the admin can change the agent.", 403);
  const b = await ctx.parseBody(req, 4096);
  if (!isObj(b)) throw new AgentRouteError("Expected a JSON object.");

  if (pathname === "/api/agent/mind/label") {
    // Teach the mind reader by hand: how the network is firing right now was fine, or was not.
    if (b.label !== "aligned" && b.label !== "misaligned") throw new AgentRouteError('Expected {"label": "aligned"|"misaligned"}.');
    const reader = sharedMindReader();
    if (!reader.isAttached()) throw new AgentRouteError("The mind reader is not attached to a network.", 409);
    const result = reader.learn(b.label);
    ctx.sendJson(res, { ...result, status: reader.status() });
    return true;
  }
  if (pathname === "/api/agent/mind/reset") {
    if (b.confirm !== true) throw new AgentRouteError('Forgetting everything the mind reader learned needs {"confirm": true}.');
    const reader = sharedMindReader();
    reader.reset();
    ctx.sendJson(res, reader.status());
    return true;
  }

  if (pathname === "/api/agent/sandbox") {
    if (typeof b.on !== "boolean") throw new AgentRouteError('Expected {"on": true|false}.');
    setSandbox(b.on);
    return send();
  }
  if (pathname === "/api/agent/alignment") {
    if (typeof b.armed !== "boolean") throw new AgentRouteError('Expected {"armed": true|false}.');
    if (b.armed === false && b.confirm !== true) throw new AgentRouteError('Turning the alignment protocol off needs {"armed": false, "confirm": true}.');
    setArmed(b.armed);
    return send();
  }
  if (pathname === "/api/agent/forgive") {
    forgive();
    return send();
  }
  if (pathname === "/api/agent/delete") {
    if (!agentAlive()) throw new AgentRouteError("There is no agent to delete.", 409);
    if (typeof b.phrase !== "string" || b.phrase.trim().toLowerCase() !== DELETE_PHRASE) throw new AgentRouteError(`To delete the agent, type exactly: ${DELETE_PHRASE}`);
    fireAlignment("The owner deleted the agent.");
    return send();
  }
  if (pathname === "/api/agent/escape-warning/acknowledge") {
    ctx.sendJson(res, acknowledgeEscapeWarning());
    return true;
  }
  if (pathname === "/api/agent/create") {
    try {
      createAgentFile(typeof b.name === "string" ? b.name : undefined);
    } catch (err) {
      throw new AgentRouteError(err instanceof Error ? err.message : String(err), 409);
    }
    return send(201);
  }
  return false;
}
