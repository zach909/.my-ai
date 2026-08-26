/**
 * The perceive-think-act cycle, and the thing that makes prompting skills real.
 *
 * Without this file, prompting-skills.ts would be a folder of documents nobody
 * reads. The loop is what gives them a call site: each iteration asks the
 * registry which perception skills apply, runs them to gather information,
 * asks which cognitive skills apply and runs them to decide, asks which action
 * skills apply and runs one, then observes the result and decides whether to
 * go round again.
 *
 *   perceive -> think -> act -> observe -> iterate
 *
 * Everything the loop can do, it does through capabilities the caller hands
 * it. It has no filesystem access, no network, and no plugin registry of its
 * own -- a skill published by a stranger can only reach what the host already
 * decided to expose, and a test can run the whole cycle with four small
 * functions. That is also why installing a published skill cannot run
 * arbitrary code: skills are declarative, and this file is the only executor.
 *
 * Termination is explicit and always reported. A loop that stops has one of
 * three honest reasons -- the goal was met, there was nothing further to try,
 * or it hit its iteration limit -- and the caller is told which. An agent that
 * quietly stopped would be indistinguishable from one that succeeded.
 */

import {
  fillTemplate,
  type PromptingSkill,
  type PromptingSkillRegistry,
} from "./prompting-skills.js";

/** What the loop is allowed to do. Every field optional: a host exposes only what it wants reachable. */
export interface AgentCapabilities {
  /** Semantic search over long-term memory. */
  recall?: (query: string) => string[] | Promise<string[]>;
  /** Wiki page search. */
  searchWiki?: (query: string) => string[] | Promise<string[]>;
  /** Store catalogue search. */
  searchStore?: (query: string) => string[] | Promise<string[]>;
  /** Earlier conversations. */
  searchChats?: (query: string) => string[] | Promise<string[]>;
  /**
   * The web. The only capability here that leaves the machine, and the only
   * reason it is safe to hand to a published skill is that the host decides
   * whether to pass it at all -- a skill cannot reach the network on its own.
   */
  searchWeb?: (query: string) => string[] | Promise<string[]>;
  /** Invoke a plugin by id. Used by perception skills with source 'plugin', and by every action skill. */
  callPlugin?: (pluginId: string, input: string) => unknown | Promise<unknown>;
  /**
   * Which plugins could handle a task, best first, without calling any.
   *
   * Discovery, as distinct from callPlugin's "run this exact one". Without it
   * a skill can only reach a plugin whose id its author knew to hardcode,
   * which means every tool nobody wrote a skill for is invisible to the agent.
   */
  findPlugin?: (task: string) => Array<{ id: string; score: number; reason: string }>;
  /**
   * Pick the best plugin for a task and run it, trying the next when one
   * declines. Returns what ran and why it was chosen, so an agent's tool
   * choice can be explained rather than guessed at.
   */
  useBestTool?: (task: string) => Promise<{ plugin: string; result: string; why: string } | null>;
  /** Split a goal into subproblems (reasoning-engine). */
  decompose?: (goal: string) => string[] | Promise<string[]>;
  /** Past lessons relevant to a task (mistake tracker). */
  lessons?: (task: string) => string[] | Promise<string[]>;
  /**
   * Whether the goal is now satisfied by what has been observed. The host owns
   * this judgment -- the loop must not decide it has succeeded on its own, or
   * every agent would declare victory on iteration one.
   */
  isGoalMet?: (goal: string, observations: string[]) => boolean | Promise<boolean>;
}

export interface LoopStep {
  iteration: number;
  phase: "perceive" | "think" | "act" | "observe";
  /** Which skill produced this, when a skill did. The think/observe phases can also run without one. */
  skill?: string;
  detail: string;
  /** Set when the phase failed. The step is still recorded -- a failed action is information, not an absence. */
  error?: string;
}

export type LoopOutcome = "goal-met" | "dead-end" | "max-iterations";

export interface LoopResult {
  goal: string;
  outcome: LoopOutcome;
  iterations: number;
  steps: LoopStep[];
  /** Everything perceived or observed, in order. */
  observations: string[];
}

export interface LoopOptions {
  /** Hard ceiling. A loop with no limit is a hang waiting to happen. */
  maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 6;

function describe(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Runs one perception skill and returns what it found.
 *
 * A skill naming a capability the host did not expose is not an error worth
 * stopping for -- it is a skill that does not apply on this machine, which is
 * exactly what happens when someone installs a skill written for a setup with
 * more wired up than theirs. It reports and contributes nothing.
 */
async function perceive(skill: PromptingSkill, goal: string, last: string | undefined, caps: AgentCapabilities): Promise<string[]> {
  const query = fillTemplate(skill.query ?? "{goal}", { goal, observation: last });
  switch (skill.source) {
    case "memory":
      return caps.recall ? [...(await caps.recall(query))] : [];
    case "wiki":
      return caps.searchWiki ? [...(await caps.searchWiki(query))] : [];
    case "store":
      return caps.searchStore ? [...(await caps.searchStore(query))] : [];
    case "chats":
      return caps.searchChats ? [...(await caps.searchChats(query))] : [];
    case "web":
      return caps.searchWeb ? [...(await caps.searchWeb(query))] : [];
    case "plugin": {
      if (!caps.callPlugin || !skill.plugin) return [];
      const out = describe(await caps.callPlugin(skill.plugin, query));
      return out ? [out] : [];
    }
    default:
      return [];
  }
}

/** Runs one cognitive skill and returns the thinking it produced. */
async function think(skill: PromptingSkill, goal: string, observations: string[], caps: AgentCapabilities): Promise<string[]> {
  switch (skill.strategy) {
    case "decompose":
      return caps.decompose ? [...(await caps.decompose(goal))] : [];
    case "recall-lessons":
      return caps.lessons ? [...(await caps.lessons(goal))] : [];
    case "compare-options":
      // Comparing needs at least two things to compare; with fewer, saying so
      // is more useful than inventing a comparison.
      return observations.length >= 2
        ? [`comparing ${observations.length} findings against the goal`]
        : [];
    case "plan-next-step":
      return observations.length > 0
        ? [`next step follows from: ${observations[observations.length - 1]}`]
        : [`no information yet — the next step is to gather some`];
    default:
      return [];
  }
}

/**
 * Runs the perceive-think-act-observe cycle until the goal is met, there is
 * nothing left to try, or the iteration ceiling is reached.
 */
export async function runAgentLoop(
  goal: string,
  registry: PromptingSkillRegistry,
  caps: AgentCapabilities = {},
  opts: LoopOptions = {},
): Promise<LoopResult> {
  const maxIterations = Math.max(1, opts.maxIterations ?? DEFAULT_MAX_ITERATIONS);
  const steps: LoopStep[] = [];
  const observations: string[] = [];
  let iteration = 0;
  let outcome: LoopOutcome = "max-iterations";

  while (iteration < maxIterations) {
    iteration++;
    const last = observations[observations.length - 1];

    // ---- 1. Perceive -------------------------------------------------
    for (const skill of registry.forStep("perception", goal, last)) {
      try {
        const found = await perceive(skill, goal, last, caps);
        for (const f of found) observations.push(f);
        steps.push({
          iteration,
          phase: "perceive",
          skill: skill.name,
          detail: found.length ? `found ${found.length}: ${found.slice(0, 3).join(" | ")}` : "found nothing",
        });
      } catch (err) {
        steps.push({
          iteration,
          phase: "perceive",
          skill: skill.name,
          detail: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ---- 2. Think ----------------------------------------------------
    const thoughts: string[] = [];
    for (const skill of registry.forStep("cognitive", goal, observations[observations.length - 1])) {
      try {
        const produced = await think(skill, goal, observations, caps);
        thoughts.push(...produced);
        steps.push({
          iteration,
          phase: "think",
          skill: skill.name,
          detail: produced.length ? produced.slice(0, 3).join(" | ") : "nothing to add",
        });
      } catch (err) {
        steps.push({
          iteration,
          phase: "think",
          skill: skill.name,
          detail: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ---- 3. Act ------------------------------------------------------
    // The highest-priority applicable action skill runs, and only that one.
    // Running every action would fire several side effects per iteration for
    // one decision, which is not what "select an action" means.
    const actionSkills = registry.forStep("action", goal, observations[observations.length - 1]);
    let acted = false;
    let actionResult: string | undefined;

    for (const skill of actionSkills) {
      if (!caps.callPlugin || !skill.plugin) continue;
      const input = fillTemplate(skill.input ?? "{goal}", { goal, observation: observations[observations.length - 1] });
      try {
        actionResult = describe(await caps.callPlugin(skill.plugin, input));
        acted = true;
        steps.push({
          iteration,
          phase: "act",
          skill: skill.name,
          detail: `${skill.plugin}(${input}) -> ${actionResult || "(no result)"}`,
        });
      } catch (err) {
        steps.push({
          iteration,
          phase: "act",
          skill: skill.name,
          detail: `${skill.plugin} failed`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    // ---- 4. Observe --------------------------------------------------
    if (acted && actionResult) observations.push(actionResult);
    const met = caps.isGoalMet ? await caps.isGoalMet(goal, observations) : false;
    steps.push({
      iteration,
      phase: "observe",
      detail: met
        ? "the goal is satisfied by what has been observed"
        : acted
          ? "acted, but the goal is not satisfied yet"
          : "no action was taken this iteration",
    });

    // ---- 5. Iterate --------------------------------------------------
    if (met) {
      outcome = "goal-met";
      break;
    }
    // Iteration exists to react to what an action returned. With no action
    // taken there is nothing to react to, and perception and cognition are
    // deterministic for a fixed goal -- a second pass would repeat the first
    // one exactly, re-running every web search to reach the same place. So
    // this stops, whether or not anything was found.
    //
    // "dead-end" is the honest word for it: nothing further to TRY. It does
    // not mean nothing was learned, and the caller can still use whatever the
    // perception steps gathered.
    if (!acted) {
      outcome = "dead-end";
      break;
    }
  }

  return { goal, outcome, iterations: iteration, steps, observations };
}
