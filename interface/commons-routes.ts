/**
 * HTTP routes for the Commons: points, the leaderboard, the exchange rate,
 * projects and the hive that works them.
 *
 * Every route here is an OWNER route, behind the server's normal gate (the
 * password or session when this instance is reachable from elsewhere). The
 * owner runs this device's ledger, so they may act as themselves or on behalf
 * of anyone they have added to the board; nothing here is reachable with a
 * lease or app token. Every POST reads a JSON body, even an empty one, because
 * parseBody() is what insists on a JSON content type, and that is the server's
 * guard against a page in another tab posting here.
 *
 *   GET  /api/commons                          the board, rates, projects
 *   POST /api/commons/rates                    {ask?, bid?}      the exchange rate
 *   POST /api/commons/name                     {name}            rename yourself
 *   POST /api/commons/members                  {name}            add a person
 *   POST /api/commons/import                   {name}            bring in a wiki project
 *   GET  /api/commons/projects
 *   POST /api/commons/projects                 {title, goal?, pot, agentPlan?}
 *   GET  /api/commons/projects/:id
 *   POST /api/commons/projects/:id/tasks       {title, detail?, weight?, folder?}
 *   POST /api/commons/projects/:id/organize    the agent files unsorted tasks
 *   POST /api/commons/projects/:id/publish     push the wiki page
 *   POST /api/commons/projects/:id/tasks/:t/(claim|release|submit|review)
 *   GET  /api/commons/projects/:id/hive
 *   POST /api/commons/projects/:id/hive/(run|merge)
 */

import {
  PointsError,
  addMember,
  pointsSummary,
  setRates,
  setSelfName,
  SELF_ID,
} from "../models && skills/core/points.js";
import {
  ProjectError,
  addTask,
  claimTask,
  createProject,
  createProjectFromGoal,
  getProject,
  importProject,
  loadProjects,
  organizeTasks,
  publishProject,
  releaseTask,
  resolveWorker,
  reviewTask,
  rewardOf,
  selfWorker,
  submitTask,
  summarize,
  type Think,
  type Worker,
} from "../models && skills/core/projects.js";
import { hiveView, mergeHive, startHiveRun, type HiveDeps } from "../models && skills/core/project-hive.js";
import type { AgentLearner } from "../models && skills/core/hive-learning.js";
import { WikiNameError } from "../models && skills/core/wiki-store.js";
import type { RouteContext } from "./corona-routes.js";

export interface CommonsContext extends RouteContext {
  /** How agents learn on the live brain, or null where there is no brain to learn on. */
  learner(): Promise<AgentLearner | null>;
}

/** The longest the agent gets to answer one question before the plain fallback is used. */
export const THINK_TIMEOUT_MS = 180_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Gives the agent a time limit. A slow mesh must not hold a web request, or a whole hive, forever. */
export function withTimeout(promise: Promise<string>, ms = THINK_TIMEOUT_MS): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("the agent took too long to answer")), ms);
    timer.unref?.();
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

function statusOf(err: unknown): number {
  if (err instanceof ProjectError || err instanceof PointsError) return err.status;
  if (err instanceof WikiNameError) return 400;
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : 500;
}

/** Returns true when the route was handled. */
export async function handleCommonsRoutes(ctx: CommonsContext): Promise<boolean> {
  try {
    return await route(ctx);
  } catch (err) {
    ctx.sendJson(ctx.res, { error: err instanceof Error ? err.message : String(err) }, statusOf(err));
    return true;
  }
}

/** Who is acting: the owner, or someone the owner added to the board. */
function actor(body: unknown, key: string): Worker {
  const id = isObj(body) && typeof body[key] === "string" ? (body[key] as string) : SELF_ID;
  return id === SELF_ID ? selfWorker() : resolveWorker(id);
}

async function route(ctx: CommonsContext): Promise<boolean> {
  const { pathname, method, req, res } = ctx;
  if (pathname !== "/api/commons" && !pathname.startsWith("/api/commons/")) return false;
  const think: Think = prompt => withTimeout(ctx.chat(prompt));
  const json = (data: unknown, status = 200): true => {
    ctx.sendJson(res, data, status);
    return true;
  };
  // Always read the body of a POST, so a non-JSON content type is refused before anything runs.
  const bodyOf = async (max = 64 * 1024): Promise<Record<string, unknown>> => {
    const b = await ctx.parseBody(req, max);
    if (!isObj(b)) throw new ProjectError("Expected a JSON object.");
    return b;
  };

  if (pathname === "/api/commons" && method === "GET") {
    return json({ points: pointsSummary(), projects: loadProjects().map(summarize) });
  }
  if (pathname === "/api/commons/rates" && method === "POST") {
    const b = await bodyOf(1024);
    setRates({ ask: b.ask === undefined ? undefined : Number(b.ask), bid: b.bid === undefined ? undefined : Number(b.bid) });
    return json(pointsSummary());
  }
  if (pathname === "/api/commons/name" && method === "POST") {
    const b = await bodyOf(1024);
    setSelfName(String(b.name ?? ""));
    return json(pointsSummary());
  }
  if (pathname === "/api/commons/members" && method === "POST") {
    const b = await bodyOf(1024);
    return json({ member: addMember(String(b.name ?? "")), points: pointsSummary() }, 201);
  }
  if (pathname === "/api/commons/import" && method === "POST") {
    const b = await bodyOf(1024);
    const { project, replaced } = importProject(String(b.name ?? ""));
    return json({ project: summarize(project), replaced }, 201);
  }

  if (pathname === "/api/commons/projects" && method === "GET") {
    return json({ projects: loadProjects().map(summarize) });
  }
  if (pathname === "/api/commons/projects" && method === "POST") {
    const b = await bodyOf(32 * 1024);
    const base = { title: String(b.title ?? ""), goal: typeof b.goal === "string" ? b.goal : "", pot: Number(b.pot) };
    if (b.agentPlan === true && base.goal.trim()) {
      const { project, source } = await createProjectFromGoal(base, think);
      return json({ project: summarize(project), plannedBy: source }, 201);
    }
    return json({ project: summarize(createProject(base)), plannedBy: "you" }, 201);
  }

  const m = /^\/api\/commons\/projects\/([a-z0-9][a-z0-9-]{0,47})(?:\/(.*))?$/.exec(pathname);
  if (!m) return false;
  const [, id, rest = ""] = m;

  if (rest === "" && method === "GET") {
    const project = getProject(id);
    if (!project) throw new ProjectError("No such project.", 404);
    return json({ project, rewards: Object.fromEntries(project.tasks.map(t => [t.id, rewardOf(project, t)])), hive: hiveView(id) });
  }
  if (rest === "tasks" && method === "POST") {
    const b = await bodyOf(16 * 1024);
    return json(addTask(id, {
      title: String(b.title ?? ""),
      detail: typeof b.detail === "string" ? b.detail : undefined,
      weight: b.weight === undefined ? undefined : Number(b.weight),
      folder: typeof b.folder === "string" ? b.folder : undefined,
    }), 201);
  }
  if (rest === "organize" && method === "POST") {
    await bodyOf(1024);
    return json(await organizeTasks(id, think));
  }
  if (rest === "publish" && method === "POST") {
    await bodyOf(1024);
    return json(await publishProject(id));
  }

  const t = /^tasks\/(t\d{1,6})\/(claim|release|submit|review)$/.exec(rest);
  if (t && method === "POST") {
    const [, taskId, action] = t;
    const b = await bodyOf(64 * 1024);
    if (action === "claim") return json(claimTask(id, taskId, actor(b, "as")));
    if (action === "release") return json(releaseTask(id, taskId, actor(b, "as")));
    if (action === "submit") return json(submitTask(id, taskId, actor(b, "as"), String(b.result ?? "")));
    const verdict = b.verdict === "accept" || b.verdict === "reject" ? b.verdict : null;
    if (!verdict) throw new ProjectError("The verdict is \"accept\" or \"reject\".");
    return json(reviewTask(id, taskId, actor(b, "as"), verdict, typeof b.note === "string" ? b.note : ""));
  }

  if (rest === "hive" && method === "GET") {
    return json({ hive: hiveView(id) });
  }
  if ((rest === "hive/run" || rest === "hive/merge") && method === "POST") {
    await bodyOf(1024);
    const deps: HiveDeps = {
      // The agent's name and role are already in the prompt; every agent answers through the one live brain.
      think: (_agent, prompt) => think(prompt),
      learner: await ctx.learner(),
    };
    if (rest === "hive/merge") return json({ hive: mergeHive(id, deps) });
    return json({ hive: startHiveRun(id, deps) }, 202);
  }
  return false;
}
