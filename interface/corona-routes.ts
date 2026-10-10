/**
 * HTTP routes for apps, compute sharing and the data donor.
 *
 * Two kinds of route live here, and the difference is who is allowed in:
 *
 *   /api/corona-apps, /api/compute, /api/donor
 *       Owner routes. They go through the server's normal gate (password or
 *       session when this instance is reachable from elsewhere), because they
 *       decide who else may use this machine and what it records.
 *
 *   /api/corona/v1/*
 *       The API apps and borrowers call. It skips the password gate -- an app
 *       has a token, not a login -- and checks a bearer token itself on every
 *       request: an app token with a scope, or a compute lease token. A request
 *       with neither gets 401 before anything else happens.
 */

import type http from "node:http";
import {
  AppError,
  AppRateLimiter,
  appAllows,
  authenticateApp,
  bearerToken,
  listApps,
  registerApp,
  requestedScopes,
  revokeApp,
  setAppScopes,
  APP_SCOPES,
  type AppScope,
  type PublicAppRecord,
} from "../models && skills/core/corona-apps.js";
import {
  ComputeError,
  addPeer,
  benchmarkMops,
  borrow,
  computeSummary,
  grantLease,
  leaseStatus,
  machineMops,
  removePeer,
  revokeLease,
  runLeasedJob,
  setCreditLimit,
  setLending,
  JOB_KINDS,
  type JobRunner,
} from "../models && skills/core/compute-share.js";
import {
  DONOR_SOURCES,
  DonorError,
  donorStatus,
  eraseAllDonations,
  ingestDonation,
  pauseDonor,
  updateDonorSettings,
  type DonorSource,
} from "../models && skills/core/data-donor.js";
import { StoreError, listCatalog, publishAndSync, readItemFile, STORE_KINDS, STORE_KIND_LABELS, type StoreFile } from "../models && skills/core/store.js";

/** Is this one of the token-checked routes the server's password gate should let through? */
export const isCoronaApiRoute = (pathname: string): boolean => pathname.startsWith("/api/corona/v1/");

export interface RouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  pathname: string;
  method: string;
  parseBody(req: http.IncomingMessage, maxBytes?: number): Promise<unknown>;
  sendJson(res: http.ServerResponse, data: unknown, status?: number): void;
  /** What the agent does with a chat message. */
  chat(message: string): Promise<string>;
  status(): unknown;
}

const limiter = new AppRateLimiter(120);
const MAX_DONATION_BODY = 12 * 1024 * 1024;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function statusOf(err: unknown): number {
  if (err instanceof ComputeError) return err.status;
  if (err instanceof AppError || err instanceof DonorError || err instanceof StoreError) return 400;
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : 500;
}

function fail(ctx: RouteContext, err: unknown): void {
  // A job that used the machine before failing carries what it cost (see compute-share.ts).
  const cu = err instanceof ComputeError && typeof err.cu === "number" ? { cu: err.cu } : {};
  ctx.sendJson(ctx.res, { error: err instanceof Error ? err.message : String(err), ...cu }, statusOf(err));
}

/** Returns true when the route was handled. */
export async function handleCoronaRoutes(ctx: RouteContext): Promise<boolean> {
  const { pathname, method } = ctx;
  try {
    if (isCoronaApiRoute(pathname)) return await handleApi(ctx);
    if (pathname === "/api/corona-apps" || pathname.startsWith("/api/corona-apps/")) return await handleApps(ctx);
    if (pathname === "/api/compute" || pathname.startsWith("/api/compute/")) return await handleCompute(ctx);
    if (pathname === "/api/donor" || pathname.startsWith("/api/donor/")) return await handleDonor(ctx);
  } catch (err) {
    fail(ctx, err);
    return true;
  }
  void method;
  return false;
}

// ── Owner: apps ─────────────────────────────────────────────────────────

async function handleApps(ctx: RouteContext): Promise<boolean> {
  const { pathname, method, req, res } = ctx;

  if (pathname === "/api/corona-apps" && method === "GET") {
    ctx.sendJson(res, { scopes: APP_SCOPES, apps: listApps() });
    return true;
  }

  if (pathname === "/api/corona-apps" && method === "POST") {
    const body = await ctx.parseBody(req, 64 * 1024);
    if (!isObj(body)) throw new AppError("Expected a JSON object.");
    const source = body.source === "store" ? "store" : "program";
    let requested: AppScope[] | undefined;
    let storeItem: string | undefined;
    if (source === "store") {
      // What a store app may be granted is what its own app.json asked for.
      if (typeof body.storeItem !== "string") throw new AppError("A store app needs \"storeItem\", the name of its apps/ item.");
      storeItem = body.storeItem;
      requested = requestedScopes(readItemFile("apps", storeItem, "app.json")?.toString("utf8"));
    }
    const { app, token } = registerApp({ name: String(body.name ?? ""), source, storeItem, scopes: body.scopes ?? [], requested });
    // The token is in this response and nowhere else, ever.
    ctx.sendJson(res, { app, token, note: "Keep this token now; it cannot be shown again." }, 201);
    return true;
  }

  const m = /^\/api\/corona-apps\/([0-9a-f]{16})\/(revoke|scopes)$/.exec(pathname);
  if (m && method === "POST") {
    if (m[2] === "revoke") {
      ctx.sendJson(res, { revoked: revokeApp(m[1]) });
      return true;
    }
    const body = await ctx.parseBody(req, 64 * 1024);
    if (!isObj(body)) throw new AppError("Expected a JSON object.");
    const app = listApps().find(a => a.id === m[1]);
    let requested: AppScope[] | undefined;
    if (app?.source === "store" && app.storeItem) {
      requested = requestedScopes(readItemFile("apps", app.storeItem, "app.json")?.toString("utf8"));
    }
    ctx.sendJson(res, setAppScopes(m[1], body.scopes, requested));
    return true;
  }
  return false;
}

// ── Owner: compute ──────────────────────────────────────────────────────

async function handleCompute(ctx: RouteContext): Promise<boolean> {
  const { pathname, method, req, res } = ctx;

  if (pathname === "/api/compute" && method === "GET") {
    ctx.sendJson(res, computeSummary());
    return true;
  }
  if (pathname === "/api/compute/benchmark" && method === "POST") {
    // Re-measure rather than reuse: the point of asking is that something changed.
    ctx.sendJson(res, { mops: Math.round(benchmarkMops() * 100) / 100, remembered: machineMops() });
    return true;
  }
  if (pathname === "/api/compute/lending" && method === "POST") {
    const body = await ctx.parseBody(req, 4096);
    if (!isObj(body) || typeof body.enabled !== "boolean") throw new ComputeError("Expected {\"enabled\": true|false}.");
    if (body.enabled) machineMops(); // measure before anything is lent, so the first job is priced
    setLending(body.enabled);
    ctx.sendJson(res, computeSummary());
    return true;
  }
  if (pathname === "/api/compute/credit-limit" && method === "POST") {
    const body = await ctx.parseBody(req, 1024);
    setCreditLimit(isObj(body) ? Number(body.limit) : NaN);
    ctx.sendJson(res, computeSummary());
    return true;
  }
  if (pathname === "/api/compute/leases" && method === "POST") {
    const body = await ctx.parseBody(req, 4096);
    if (!isObj(body)) throw new ComputeError("Expected a JSON object.");
    const { lease, token } = grantLease({ label: String(body.label ?? ""), hours: Number(body.hours), capCu: Number(body.capCu) });
    ctx.sendJson(res, { lease, token, note: "Give this token to the person. It cannot be shown again." }, 201);
    return true;
  }
  let m = /^\/api\/compute\/leases\/([0-9a-f]{16})\/revoke$/.exec(pathname);
  if (m && method === "POST") {
    ctx.sendJson(res, { revoked: revokeLease(m[1]) });
    return true;
  }
  if (pathname === "/api/compute/peers" && method === "POST") {
    const body = await ctx.parseBody(req, 8192);
    if (!isObj(body)) throw new ComputeError("Expected a JSON object.");
    ctx.sendJson(res, addPeer({ name: String(body.name ?? ""), baseUrl: String(body.baseUrl ?? ""), leaseToken: String(body.leaseToken ?? "") }), 201);
    return true;
  }
  m = /^\/api\/compute\/peers\/([0-9a-f]{16})$/.exec(pathname);
  if (m && method === "DELETE") {
    ctx.sendJson(res, { removed: removePeer(m[1]) });
    return true;
  }
  if (pathname === "/api/compute/borrow" && method === "POST") {
    const body = await ctx.parseBody(req, 32 * 1024);
    if (!isObj(body)) throw new ComputeError("Expected a JSON object.");
    ctx.sendJson(res, await borrow(String(body.peerId ?? ""), String(body.prompt ?? "")));
    return true;
  }
  return false;
}

// ── Owner: donor ────────────────────────────────────────────────────────

async function handleDonor(ctx: RouteContext): Promise<boolean> {
  const { pathname, method, req, res } = ctx;

  if (pathname === "/api/donor" && method === "GET") {
    ctx.sendJson(res, donorStatus());
    return true;
  }
  if (pathname === "/api/donor" && method === "POST") {
    const body = await ctx.parseBody(req, 8192);
    if (!isObj(body)) throw new DonorError("Expected a JSON object.");
    updateDonorSettings({
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      sources: isObj(body.sources) ? (body.sources as Partial<Record<DonorSource, boolean>>) : undefined,
      quietHours: body.quietHours === null ? null : isObj(body.quietHours) ? (body.quietHours as { from: string; to: string }) : undefined,
      maxSpoolMb: typeof body.maxSpoolMb === "number" ? body.maxSpoolMb : undefined,
      screenIntervalSec: typeof body.screenIntervalSec === "number" ? body.screenIntervalSec : undefined,
      acknowledge: body.acknowledge === true,
    });
    ctx.sendJson(res, donorStatus());
    return true;
  }
  if (pathname === "/api/donor/pause" && method === "POST") {
    const body = await ctx.parseBody(req, 1024);
    pauseDonor(isObj(body) ? Number(body.minutes) : NaN);
    ctx.sendJson(res, donorStatus());
    return true;
  }
  // A client with a microphone (the phone app, the browser) sends what it heard here.
  // JSON with base64, like every other body this server accepts.
  if (pathname === "/api/donor/ingest" && method === "POST") {
    const body = await ctx.parseBody(req, MAX_DONATION_BODY);
    if (!isObj(body) || typeof body.source !== "string" || typeof body.data !== "string") {
      throw new DonorError("Expected {\"source\": \"screen\"|\"audio\", \"data\": <base64>}.");
    }
    if (!(DONOR_SOURCES as readonly string[]).includes(body.source)) throw new DonorError(`"source" must be one of: ${DONOR_SOURCES.join(", ")}.`);
    const result = ingestDonation(body.source as DonorSource, Buffer.from(body.data, "base64"));
    ctx.sendJson(res, result, result.accepted ? 202 : 409);
    return true;
  }
  if (pathname === "/api/donor/data" && method === "DELETE") {
    ctx.sendJson(res, { erased: eraseAllDonations() });
    return true;
  }
  return false;
}

// ── Apps and borrowers: the Corona API ──────────────────────────────────

async function handleApi(ctx: RouteContext): Promise<boolean> {
  const { pathname, method, req, res } = ctx;
  const token = bearerToken(req.headers.authorization);
  const sub = pathname.slice("/api/corona/v1".length);

  // A borrower's lease token reaches the compute routes and nothing else.
  if (sub === "/compute/lease" && method === "GET") {
    const st = leaseStatus(token);
    if (!st) return unauthorized(ctx);
    ctx.sendJson(res, st);
    return true;
  }
  if (sub === "/compute/run" && method === "POST") {
    const body = await ctx.parseBody(req, 64 * 1024);
    if (!isObj(body)) throw new ComputeError("Expected a JSON object.");
    const runner: JobRunner = { chat: p => ctx.chat(p) };
    if (!(JOB_KINDS as readonly string[]).includes(String(body.job))) {
      throw new ComputeError(`Unknown job. This computer runs: ${JOB_KINDS.join(", ")}.`);
    }
    const result = await runLeasedJob(token, { job: "chat", prompt: String(body.prompt ?? ""), maxCu: typeof body.maxCu === "number" ? body.maxCu : undefined }, runner);
    ctx.sendJson(res, result);
    return true;
  }

  // Everything else is an app, with a scope.
  const app = authenticateApp(token);
  if (!app) return unauthorized(ctx);
  if (!limiter.allow(app.id)) {
    ctx.sendJson(res, { error: "Too many requests. Slow down." }, 429);
    return true;
  }
  const need = (scope: AppScope): boolean => {
    if (appAllows(app, scope)) return true;
    ctx.sendJson(res, { error: `This app was not granted "${scope}".` }, 403);
    return false;
  };

  if (sub === "/status" && method === "GET") {
    if (!need("status")) return true;
    ctx.sendJson(res, { app: pickApp(app), status: ctx.status() });
    return true;
  }
  if (sub === "/chat" && method === "POST") {
    if (!need("chat")) return true;
    const body = await ctx.parseBody(req, 64 * 1024);
    const message = isObj(body) && typeof body.message === "string" ? body.message.trim() : "";
    if (!message) throw new AppError("Expected a \"message\" string.");
    ctx.sendJson(res, { response: await ctx.chat(message) });
    return true;
  }
  if (sub === "/store" && method === "GET") {
    if (!need("store.read")) return true;
    ctx.sendJson(res, { kinds: STORE_KINDS, labels: STORE_KIND_LABELS, catalog: listCatalog() });
    return true;
  }
  if (sub === "/store" && method === "POST") {
    if (!need("store.publish")) return true;
    const body = await ctx.parseBody(req);
    if (!isObj(body) || typeof body.kind !== "string" || typeof body.name !== "string") throw new StoreError("Expected \"kind\" and \"name\" strings.");
    const { item, sync } = await publishAndSync({
      kind: body.kind,
      name: body.name,
      title: typeof body.title === "string" ? body.title : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      // The author label is the app's, not whatever the app claims.
      author: `app:${app.name}`,
      files: Array.isArray(body.files) ? (body.files as StoreFile[]) : [],
    });
    ctx.sendJson(res, { ...item, sync }, 201);
    return true;
  }
  if (sub === "/compute/borrow" && method === "POST") {
    if (!need("compute.borrow")) return true;
    const body = await ctx.parseBody(req, 32 * 1024);
    if (!isObj(body)) throw new ComputeError("Expected a JSON object.");
    ctx.sendJson(res, await borrow(String(body.peerId ?? ""), String(body.prompt ?? "")));
    return true;
  }
  if (sub === "/donor" && method === "GET") {
    if (!need("donor.status")) return true;
    // Whether capture is on and how much is queued. Never the captured data.
    const s = donorStatus();
    ctx.sendJson(res, { enabled: s.settings.enabled, recording: s.recording, anyRecording: s.anyRecording, queued: s.spool.chunks });
    return true;
  }

  ctx.sendJson(res, { error: "No such route." }, 404);
  return true;
}

const pickApp = (a: PublicAppRecord): Pick<PublicAppRecord, "id" | "name" | "scopes"> => ({ id: a.id, name: a.name, scopes: a.scopes });

function unauthorized(ctx: RouteContext): true {
  ctx.res.setHeader("WWW-Authenticate", "Bearer");
  ctx.sendJson(ctx.res, { error: "A valid token is required." }, 401);
  return true;
}
