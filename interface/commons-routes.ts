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
 *   GET  /api/commons/folders                  folders, with items shown in every place they sit
 *   POST /api/commons/folders/organize         {limit?, only?}   the agent files what is not filed yet
 *   POST /api/commons/folders/place            {kind, ref, places:[{path, weight 0-100}]}
 *   GET  /api/commons/projects
 *   POST /api/commons/projects                 {title, goal?, pot, agentPlan?}
 *   GET  /api/commons/projects/:id
 *   POST /api/commons/projects/:id/tasks       {title, detail?, weight?, folder?}
 *   POST /api/commons/projects/:id/organize    the agent files unsorted tasks
 *   POST /api/commons/projects/:id/publish     push the wiki page
 *   POST /api/commons/projects/:id/share       {on}              share it in the league (wiki), or make it private again
 *   POST /api/commons/projects/:id/background  {on}              the AI works on it by itself
 *   GET  /api/commons/league                   the board, and every project in the wiki
 *   GET  /api/commons/market                   standing orders
 *   POST /api/commons/market/orders            {side, cu, points}
 *   POST /api/commons/market/orders/:id/cancel
 *   POST /api/commons/market/borrow            {prompt}          the cheapest computer you know
 *   GET/POST /api/commons/experts              standing AIs, one job each, running by themselves
 *   POST /api/commons/experts/:id              {enabled?, mayAct?, intervalMin?, mission?}
 *   POST /api/commons/experts/:id/(run|delete)
 *   GET/POST /api/commons/schedules            do things later or on repeat
 *   POST /api/commons/schedules/:id            {enabled}
 *   POST /api/commons/schedules/:id/(run|delete)
 *   POST /api/commons/projects/:id/tasks/:t/(claim|release|submit|review)
 *   GET  /api/commons/projects/:id/hive
 *   POST /api/commons/projects/:id/hive/(run|merge)
 */

import {
  PointsError,
  addMember,
  hire,
  payWage,
  letGo,
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
  listWikiProjects,
  loadProjects,
  organizeTasks,
  publishProject,
  releaseTask,
  resolveWorker,
  reviewTask,
  rewardOf,
  selfWorker,
  setBackground,
  setPublished,
  submitTask,
  summarize,
  type Think,
  type Worker,
} from "../models && skills/core/projects.js";
import { hiveView, mergeHive, runHive, startHiveRun, type HiveDeps } from "../models && skills/core/project-hive.js";
import { gatherItems, organizeItems, pruneGone, type OrganizeReport } from "../models && skills/core/folder-organizer.js";
import { TreeError, parsePath, placeItem, viewTree, type PlaceSpec } from "../models && skills/core/folder-tree.js";
import type { ChatHistoryStore } from "../models && skills/core/chat-history-store.js";
import type { AgentLearner } from "../models && skills/core/hive-learning.js";
import { borrowBest } from "../models && skills/core/compute-market.js";
import { MarketError, allOrders, cancelOrder, currentBid, currentOffer, placeOrder } from "../models && skills/core/market.js";
import { leaderboard } from "../models && skills/core/points.js";
import { ExpertError, createExpert, deleteExpert, isExpertRunning, loadExperts, runExpertChain, updateExpert, expertsFile, type ExpertDeps } from "../models && skills/core/experts.js";
import {
  ScheduleError, createSchedule, deleteSchedule, loadSchedules, runSchedule, updateSchedule, schedulesFile, describeAction, describeWhen, type SchedulerDeps,
} from "../models && skills/core/scheduler.js";
import { WikiNameError } from "../models && skills/core/wiki-store.js";
import type { RouteContext } from "./corona-routes.js";

export interface CommonsContext extends RouteContext {
  /** How agents learn on the live brain, or null where there is no brain to learn on. */
  learner(): Promise<AgentLearner | null>;
  /** The chats to organise, if this server keeps any. */
  chats?: ChatHistoryStore | null;
  /** Where each filing is passed on for the mesh to learn from (NeuroclawSystem.learnFrom). */
  learn?: (text: string) => void;
  /** The agent's normal path WITH its tools, for an expert's approved actions. `chat` above is text only. */
  act?: (message: string) => Promise<string>;
}

/**
 * How scheduled actions are carried out. A scheduled message goes by the agent's
 * normal path (`act`, with its tools), so risky tools still wait for approval.
 * Everything the agent only thinks about goes by `chat`, which is text only.
 */
export function schedulerDepsFor(opts: {
  chat: (m: string) => Promise<string>;
  act?: (m: string) => Promise<string>;
  chats?: ChatHistoryStore | null;
  learn?: (text: string) => void;
  learner?: () => Promise<AgentLearner | null>;
}): SchedulerDeps {
  return {
    chat: async m => (opts.act ? await withTimeout(opts.act(m)) : await withTimeout(opts.chat(m))),
    hive: async projectId => {
      const deps: HiveDeps = { think: (_a, p) => withTimeout(opts.chat(p)), learner: opts.learner ? await opts.learner() : null, maxRounds: 1 };
      const h = await runHive(projectId, deps);
      return `${h.state}: ${h.note || `round ${h.round}`}`;
    },
    organize: async () => {
      const r = await runFolderSweep({ chats: opts.chats, think: p => withTimeout(opts.chat(p)), learn: opts.learn, limit: 3 });
      return `asked ${r.asked}, filed ${r.placed}, left ${r.left}`;
    },
    expert: async expertId => {
      const r = await runExpertChain(expertId, expertDepsFor(opts.chat, opts.act));
      const last = r.steps[r.steps.length - 1]?.expert.history.slice(-1)[0];
      return last ? `${last.plan || "nothing to do"}: ${last.result}`.slice(0, 300) : "no result";
    },
  };
}

/** What an expert needs, from this server's agent: text-only thinking, and a gated way to act. */
export function expertDepsFor(chat: (m: string) => Promise<string>, act?: (m: string) => Promise<string>): ExpertDeps {
  return {
    think: (_agent, prompt) => withTimeout(chat(prompt)),
    act: instruction => (act ? withTimeout(act(instruction)) : Promise.reject(new Error("This server cannot act on its own."))),
  };
}

/**
 * One pass of the agent filing whatever is not filed yet. Shared by the button
 * and the background sweep, so both do exactly the same thing.
 */
export async function runFolderSweep(opts: {
  chats?: ChatHistoryStore | null;
  /** Limit the pass to some kinds of thing. Everything when left out. */
  only?: Array<"chat" | "wiki" | "project">;
  think: (prompt: string) => Promise<string>;
  learn?: (text: string) => void;
  limit?: number;
}): Promise<OrganizeReport> {
  const want = (k: "chat" | "wiki" | "project"): boolean => !opts.only || opts.only.includes(k);
  const items = gatherItems({ chats: want("chat") ? opts.chats ?? null : null, wiki: want("wiki"), projects: want("project") });
  pruneGone(items, { chats: want("chat") && !!opts.chats, wiki: want("wiki"), projects: want("project") });
  return organizeItems(items, opts.think, { learn: opts.learn, limit: opts.limit });
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
  if (err instanceof TreeError || err instanceof MarketError || err instanceof ExpertError || err instanceof ScheduleError) return err.status;
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
  // Hiring is you (the owner of this ledger) hiring someone on it: the wage comes out of your own balance.
  const staff = /^\/api\/commons\/members\/([A-Za-z0-9][A-Za-z0-9._:-]{0,95})\/(hire|pay|let-go)$/.exec(pathname);
  if (staff && method === "POST") {
    const b = await bodyOf(1024);
    const id = staff[1];
    if (staff[2] === "hire") hire(SELF_ID, id, Number(b.amount));
    else if (staff[2] === "pay") payWage(SELF_ID, id, Number(b.amount));
    else letGo(SELF_ID, id);
    return json(pointsSummary());
  }
  if (pathname === "/api/commons/league" && method === "GET") {
    return json({ board: leaderboard(), projects: listWikiProjects() });
  }
  if (pathname === "/api/commons/market" && method === "GET") {
    return json({ orders: allOrders(), offer: currentOffer(), bid: currentBid() });
  }
  if (pathname === "/api/commons/market/orders" && method === "POST") {
    const b = await bodyOf(1024);
    placeOrder({ side: b.side as "buy" | "sell", cu: Number(b.cu), points: Number(b.points) });
    return json({ orders: allOrders(), offer: currentOffer(), bid: currentBid() }, 201);
  }
  const cancel = /^\/api\/commons\/market\/orders\/([a-f0-9]{12})\/cancel$/.exec(pathname);
  if (cancel && method === "POST") {
    await bodyOf(1024);
    return json({ cancelled: cancelOrder(cancel[1]), orders: allOrders() });
  }
  if (pathname === "/api/commons/market/borrow" && method === "POST") {
    const b = await bodyOf(32 * 1024);
    return json(await borrowBest(String(b.prompt ?? "")));
  }
  if (pathname === "/api/commons/folders" && method === "GET") {
    return json(viewTree());
  }
  if (pathname === "/api/commons/folders/organize" && method === "POST") {
    const b = await bodyOf(1024);
    const limit = typeof b.limit === "number" && b.limit >= 1 && b.limit <= 10 ? Math.floor(b.limit) : 3;
    const only = Array.isArray(b.only) ? b.only.filter((k): k is "chat" | "wiki" | "project" => k === "chat" || k === "wiki" || k === "project") : undefined;
    const report = await runFolderSweep({ chats: ctx.chats, only, think, learn: ctx.learn, limit });
    return json({ report, view: viewTree() });
  }
  if (pathname === "/api/commons/folders/place" && method === "POST") {
    const b = await bodyOf(8 * 1024);
    const kind = b.kind === "chat" || b.kind === "wiki" || b.kind === "project" ? b.kind : null;
    if (!kind || typeof b.ref !== "string" || !b.ref) throw new TreeError("Say what to place: a kind (chat, wiki or project) and its ref.");
    const specs: PlaceSpec[] = (Array.isArray(b.places) ? b.places : []).map((p: unknown) => {
      const place = isObj(p) ? p : {};
      const path = parsePath(place.path);
      if (!path) throw new TreeError("A place is a path of folder names, like Science/Physics.");
      return { path, weight: Number(place.weight) / 100 };
    });
    placeItem({ kind, ref: b.ref, title: typeof b.title === "string" && b.title ? b.title : b.ref }, specs);
    return json(viewTree());
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
    const base = { title: String(b.title ?? ""), goal: typeof b.goal === "string" ? b.goal : "", pot: Number(b.pot), background: b.background !== false };
    if (b.agentPlan === true && base.goal.trim()) {
      const { project, source } = await createProjectFromGoal(base, think);
      return json({ project: summarize(project), plannedBy: source }, 201);
    }
    return json({ project: summarize(createProject(base)), plannedBy: "you" }, 201);
  }

  if (pathname === "/api/commons/experts" && method === "GET") {
    const file = expertsFile();
    return json({ experts: loadExperts().map(e => ({ ...e, working: isExpertRunning(file, e.id) })) });
  }
  if (pathname === "/api/commons/experts" && method === "POST") {
    const b = await bodyOf(8 * 1024);
    const expert = createExpert({
      name: String(b.name ?? ""), specialty: String(b.specialty ?? ""), mission: String(b.mission ?? ""),
      teamSize: b.teamSize === undefined ? undefined : Number(b.teamSize),
      intervalMin: b.intervalMin === undefined ? undefined : Number(b.intervalMin),
      mayAct: b.mayAct !== false,
    });
    // It starts by itself: do not wait for the next look.
    void runExpertChain(expert.id, expertDepsFor(ctx.chat, ctx.act)).catch(() => undefined);
    return json({ expert }, 201);
  }
  if (pathname === "/api/commons/schedules" && method === "GET") {
    return json({ schedules: loadSchedules().map(s => ({ ...s, actionText: describeAction(s.action), whenText: describeWhen(s.when) })) });
  }
  if (pathname === "/api/commons/schedules" && method === "POST") {
    const b = await bodyOf(4 * 1024);
    const s = createSchedule({ when: String(b.when ?? ""), action: String(b.action ?? ""), name: typeof b.name === "string" && b.name ? b.name : undefined });
    return json({ schedule: { ...s, actionText: describeAction(s.action), whenText: describeWhen(s.when) } }, 201);
  }
  const sc = /^\/api\/commons\/schedules\/([a-f0-9]{8})(?:\/(run|delete))?$/.exec(pathname);
  if (sc && method === "POST") {
    const b = await bodyOf(1024);
    if (sc[2] === "delete") return json({ deleted: deleteSchedule(sc[1]) });
    if (sc[2] === "run") {
      void runSchedule(sc[1], schedulerDepsFor({ chat: ctx.chat, act: ctx.act, chats: ctx.chats, learn: ctx.learn, learner: ctx.learner })).catch(() => undefined);
      return json({ started: true }, 202);
    }
    return json({ schedule: updateSchedule(sc[1], { enabled: typeof b.enabled === "boolean" ? b.enabled : undefined }) });
  }

  const ex = /^\/api\/commons\/experts\/([a-f0-9]{10})(?:\/(run|delete))?$/.exec(pathname);
  if (ex && method === "POST") {
    const b = await bodyOf(8 * 1024);
    if (ex[2] === "delete") return json({ deleted: deleteExpert(ex[1]) });
    if (ex[2] === "run") {
      void runExpertChain(ex[1], expertDepsFor(ctx.chat, ctx.act)).catch(() => undefined);
      return json({ started: true }, 202);
    }
    return json({ expert: updateExpert(ex[1], {
      enabled: typeof b.enabled === "boolean" ? b.enabled : undefined,
      mayAct: typeof b.mayAct === "boolean" ? b.mayAct : undefined,
      intervalMin: b.intervalMin === undefined ? undefined : Number(b.intervalMin),
      mission: typeof b.mission === "string" ? b.mission : undefined,
    }) });
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
  if (rest === "share" && method === "POST") {
    const b = await bodyOf(1024);
    return json(summarize(setPublished(id, b.on === true)));
  }
  if (rest === "background" && method === "POST") {
    const b = await bodyOf(1024);
    return json(summarize(setBackground(id, b.on === true)));
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
