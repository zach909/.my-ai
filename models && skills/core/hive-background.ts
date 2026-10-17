/**
 * The AI works on projects by itself, in the background.
 *
 * The easy way to get a project done is to leave it alone: every so often the AI
 * picks a project that has "AI works in the background" on and gives its hive one
 * round of work. If you want it done faster you take tasks yourself, alongside it,
 * and the points are yours.
 *
 * It is gentle on purpose, because everything it does goes through the same mesh
 * your chats use:
 *   - one project at a time, and one round each time
 *   - the project that has waited longest goes first
 *   - a hive that stalled is left alone until something about its project changes
 *     (someone took or handed in a task), instead of being asked again to do
 *     what it just could not
 *   - off completely with NEUROCLAW_HIVE_BACKGROUND=0
 */

import { loadProjects, type ProjectCtx } from "./projects.js";
import { getHive, isHiveRunning, runHive, type HiveDeps } from "./project-hive.js";
import { chainSteps, type ChainOptions } from "./auto-continue.js";
import { loadSafety } from "./tool-safety.js";

export const DEFAULT_BACKGROUND_INTERVAL_MS = 10 * 60 * 1000;

export interface BackgroundOptions {
  /** Builds what a hive run needs. Called fresh each time, so the live brain can be looked up late. */
  deps: () => Promise<HiveDeps>;
  intervalMs?: number;
  project?: ProjectCtx;
  hivesFile?: string;
  /** Whether the AI may choose to do more rounds straight away. Settings by default. */
  autoContinue?: ChainOptions;
  /** Runs a pass once per person, so each person's projects stay in their own folder. */
  each?: (run: () => Promise<void>) => Promise<void>;
}

/** Which project the AI should work on next, or null if there is nothing worth doing. */
export function nextBackgroundProject(opts: Pick<BackgroundOptions, "project" | "hivesFile">): string | null {
  const candidates = loadProjects(opts.project?.file)
    .filter(p => p.background && p.status === "open" && p.tasks.length > 0 && !isHiveRunning(p.id, opts.hivesFile))
    .map(p => ({ p, hive: getHive(p.id, opts.hivesFile) }))
    // Nothing has changed since it last gave up, so there is no point trying again.
    .filter(({ p, hive }) => !(hive && hive.state === "stalled" && p.updatedAt <= hive.updatedAt));
  candidates.sort((a, b) => (a.hive?.updatedAt ?? 0) - (b.hive?.updatedAt ?? 0));
  return candidates[0]?.p.id ?? null;
}

/** One pass: give the next project one round. Never throws. */
export async function backgroundTick(opts: BackgroundOptions): Promise<{ ran: string | null }> {
  const id = nextBackgroundProject(opts);
  if (!id) return { ran: null };
  try {
    const deps = await opts.deps();
    const run = { ...deps, project: opts.project ?? deps.project, file: opts.hivesFile ?? deps.file, maxRounds: 1 };
    const doneCount = (): number => (loadProjects(run.project?.file).find(p => p.id === id)?.tasks.filter(t => t.status === "done").length ?? 0);
    // One round; then, if it got somewhere and the AI says there is more worth doing now, another (auto-continue.ts).
    await chainSteps(
      async () => {
        const before = doneCount();
        const h = await runHive(id, run);
        const stillOpen = loadProjects(run.project?.file).find(p => p.id === id)?.status === "open";
        return { progressed: stillOpen && h.state !== "stalled" && h.state !== "complete" && (doneCount() > before || h.events.length > 0) };
      },
      async () => {
        const original = getHive(id, run.file)?.agents[0];
        return original ? run.think(original, `The team just finished a round on this project. Is there more worth doing right now? Start your reply with CONTINUE or STOP.`) : "STOP";
      },
      opts.autoContinue ?? loadSafety().autoContinue,
    );
  } catch {
    // The hive records why it stopped. A background pass must never take anything down.
  }
  return { ran: id };
}

/** Starts the background worker. Returns a function that stops it. */
export function startBackgroundHives(opts: BackgroundOptions): () => void {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    const each = opts.each ?? (run => run());
    void each(async () => { await backgroundTick(opts); }).catch(() => undefined).finally(() => { busy = false; });
  }, opts.intervalMs ?? DEFAULT_BACKGROUND_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
