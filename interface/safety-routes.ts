/**
 * HTTP routes for risky tools, approvals, complete access and auto-continue.
 *
 * Owner routes, behind the server's normal gate. They decide what the agent may
 * do on this computer, so every POST reads a JSON body (parseBody insists on a
 * JSON content type, which is the server's guard against another tab posting
 * here), and turning complete access on needs a typed phrase on top of that.
 *
 *   GET  /api/safety                      settings, the risky tools, approvals
 *   POST /api/safety/tools                {id, ask}            ask first, or not, for one tool
 *   POST /api/safety/complete-access      {on, phrase?}        everything on, no questions; or back to defaults
 *   POST /api/safety/auto-continue        {enabled?, maxSteps?}
 *   POST /api/safety/approvals/:id/(approve|deny)
 */

import type http from "node:http";
import {
  COMPLETE_ACCESS_PHRASE,
  MAX_CONTINUE_STEPS,
  SafetyError,
  describeTools,
  disableCompleteAccess,
  enableCompleteAccess,
  loadSafety,
  setAsk,
  setAutoContinue,
  setJudge,
  type ToolGate,
} from "../models && skills/core/tool-safety.js";
import type { AccessManager } from "../models && skills/core/access-manager.js";

export interface SafetyContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  pathname: string;
  method: string;
  parseBody(req: http.IncomingMessage, maxBytes?: number): Promise<unknown>;
  sendJson(res: http.ServerResponse, data: unknown, status?: number): void;
  gate: ToolGate;
  /** The live access manager, or null where there is none. */
  access(): Promise<AccessManager | null>;
  /** Runs one approved call through the live plugin registry. */
  runApproved(toolId: string, request: string): Promise<string | null>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const isSafetyRoute = (pathname: string): boolean => pathname === "/api/safety" || pathname.startsWith("/api/safety/");

function snapshot(ctx: SafetyContext) {
  const s = loadSafety();
  return {
    fullAccess: s.fullAccess,
    completeAccessPhrase: COMPLETE_ACCESS_PHRASE,
    autoContinue: { ...s.autoContinue, max: MAX_CONTINUE_STEPS },
    judge: s.judge,
    tools: describeTools(s),
    approvals: ctx.gate.list().slice(0, 30),
  };
}

/** Returns true when the route was handled. */
export async function handleSafetyRoutes(ctx: SafetyContext): Promise<boolean> {
  if (!isSafetyRoute(ctx.pathname)) return false;
  try {
    return await route(ctx);
  } catch (err) {
    const status = err instanceof SafetyError ? err.status : typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 500;
    ctx.sendJson(ctx.res, { error: err instanceof Error ? err.message : String(err) }, status);
    return true;
  }
}

async function route(ctx: SafetyContext): Promise<boolean> {
  const { pathname, method, req, res } = ctx;
  const send = (data: unknown, status = 200): true => {
    ctx.sendJson(res, data, status);
    return true;
  };
  const body = async (): Promise<Record<string, unknown>> => {
    const b = await ctx.parseBody(req, 4096);
    if (!isObj(b)) throw new SafetyError("Expected a JSON object.");
    return b;
  };

  if (pathname === "/api/safety" && method === "GET") return send(snapshot(ctx));

  if (pathname === "/api/safety/tools" && method === "POST") {
    const b = await body();
    if (typeof b.ask !== "boolean") throw new SafetyError('Expected {"id": "...", "ask": true|false}.');
    setAsk(String(b.id ?? ""), b.ask);
    return send(snapshot(ctx));
  }

  if (pathname === "/api/safety/auto-continue" && method === "POST") {
    const b = await body();
    setAutoContinue({ enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, maxSteps: b.maxSteps === undefined ? undefined : Number(b.maxSteps) });
    return send(snapshot(ctx));
  }

  if (pathname === "/api/safety/judge" && method === "POST") {
    const b = await body();
    setJudge({ enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, high: typeof b.high === "boolean" ? b.high : undefined });
    return send(snapshot(ctx));
  }

  if (pathname === "/api/safety/complete-access" && method === "POST") {
    const b = await body();
    const manager = await ctx.access();
    if (!manager) throw new SafetyError("The access layer is not available here.", 503);
    if (b.on === true) enableCompleteAccess(manager, b.phrase);
    else if (b.on === false) disableCompleteAccess(manager);
    else throw new SafetyError('Expected {"on": true|false}.');
    return send(snapshot(ctx));
  }

  const decision = /^\/api\/safety\/approvals\/([a-f0-9]{10})\/(approve|deny)$/.exec(pathname);
  if (decision && method === "POST") {
    await body();
    const approval = await ctx.gate.decide(decision[1], decision[2] === "approve", (tool, request) => ctx.runApproved(tool, request));
    return send({ approval, ...snapshot(ctx) });
  }

  return false;
}
