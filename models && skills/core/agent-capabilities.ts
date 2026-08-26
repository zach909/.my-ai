/**
 * Connects the agent loop to the live system.
 *
 * agent-loop.ts deliberately reaches nothing on its own -- it has no
 * filesystem, no plugin registry, no memory. Everything it can do arrives as
 * a set of functions, which is what keeps a published prompting skill from
 * touching anything the host did not decide to expose, and what lets the whole
 * cycle be tested with four small stubs.
 *
 * This file is the other end of that: the one place where those functions are
 * wired to the real memory, the real wiki, the real store catalogue, the real
 * plugin registry and the real reasoner. Everything here goes through an
 * existing public entry point. Nothing new is exposed to a skill that was not
 * already reachable some other way.
 *
 * `isGoalMet` deserves its own note, because it is the judgment that decides
 * when the loop stops. It is NOT "the loop thinks it is done" -- an agent that
 * scored its own homework would declare victory on iteration one. It is a
 * narrow, checkable fact: an action actually ran, and it actually returned
 * something. Perceiving and thinking, however much of it happens, never counts
 * as achieving anything on its own.
 */

import { runAgentLoop, type AgentCapabilities, type LoopResult } from "./agent-loop.js";
import { decompose } from "./reasoning-engine.js";
import { listWikiPages } from "./wiki-store.js";
import { listCatalog, STORE_KINDS } from "./store.js";
import { loadRegistry } from "./prompting-skill-store.js";
import { readRecentConversationTurns } from "../../src/lib/conversation-log.js";

/** The parts of the live system the loop's capabilities are built from. */
export interface AgentHost {
  memory?: { retrieve: (q: string, opts?: { topK?: number; tag?: string }) => Array<{ item: { content: string; payload?: string } }> };
  mistakes?: { lessons: (task: string, topK?: number) => string[] };
  /**
   * The research plugin, when this machine has it. Named separately from
   * `pluginRegistry` because web search is not invoked by message -- the
   * plugin exposes searchWeb() directly and has no onMessage at all, which is
   * exactly why the agent could never reach the web before this.
   */
  research?: { searchWeb: (query: string, maxResults?: number) => Promise<Array<{ title?: string; snippet?: string; url?: string }>> };
  pluginRegistry?: {
    getPluginInstance: (id: string) => { onMessage?: (m: unknown) => Promise<unknown> } | undefined;
    /**
     * Scores plugins against a message without running any of them. Optional
     * so a host that predates the capability router still works -- it simply
     * loses tool discovery, not the ability to call a plugin by name.
     */
    rankPlugins?: (input: string, intent?: string) => Array<{ id: string; score: number; reason: string }>;
  };
}

/** How many memory hits / wiki pages / store items one perception step returns. */
const PERCEPTION_LIMIT = 5;

/**
 * Turns a plugin's return value into text a person would want to read.
 *
 * Plugins in this system answer with `{ tool, result }` objects, so the naive
 * JSON.stringify put `{"tool":"calc","result":"17 * 23 = 391"}` in front of
 * the user when the answer they asked for was `17 * 23 = 391`. The wrapper is
 * routing metadata, not the reply. Anything without a `result` field still
 * falls back to JSON, because inventing a shape for an unknown plugin would
 * be worse than showing exactly what it returned.
 */
function textOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const result = (value as Record<string, unknown>).result;
    if (typeof result === "string" && result.trim().length > 0) return result;
    if (typeof result === "number" || typeof result === "boolean") return String(result);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Case-insensitive word overlap. Enough to filter a catalogue; not pretending to be search. */
function matches(haystack: string, query: string): boolean {
  const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  if (words.length === 0) return true;
  const hay = haystack.toLowerCase();
  return words.some(w => hay.includes(w));
}

/**
 * Builds the capability set for a live system.
 *
 * Every capability is optional in `AgentCapabilities`, and this honours that:
 * a host missing a subsystem simply does not get that capability, and a skill
 * that wanted it contributes nothing rather than crashing. That is what makes
 * a skill written on a fully-wired machine safe to install on a smaller one.
 */
export function buildAgentCapabilities(host: AgentHost): AgentCapabilities {
  // The research plugin is looked up from the registry when the caller did not
  // pass one explicitly, so every existing call site gains web search without
  // having to know the plugin exists.
  if (!host.research && host.pluginRegistry) {
    const instance = host.pluginRegistry.getPluginInstance("research") as
      | { searchWeb?: (q: string, n?: number) => Promise<Array<{ title?: string; snippet?: string; url?: string }>> }
      | undefined;
    if (typeof instance?.searchWeb === "function") {
      host = { ...host, research: { searchWeb: instance.searchWeb.bind(instance) } };
    }
  }
  // Records what the last plugin call actually returned, so `isGoalMet` can
  // ask the only question that matters -- did an action produce a result --
  // without the loop having to tell it, and without it guessing from text.
  let lastActionResult: string | null = null;

  const caps: AgentCapabilities = {
    decompose: (goal: string) => decompose(goal, 4),
  };

  if (host.memory) {
    caps.recall = (query: string) =>
      host
        .memory!.retrieve(query, { topK: PERCEPTION_LIMIT })
        .map(hit => hit.item.payload ?? hit.item.content)
        .filter(text => typeof text === "string" && text.trim().length > 0);
  }

  if (host.mistakes) {
    caps.lessons = (task: string) => host.mistakes!.lessons(task, PERCEPTION_LIMIT);
  }

  caps.searchWiki = (query: string) => {
    try {
      return listWikiPages()
        .filter(page => matches(`${page.title} ${page.description} ${page.name}`, query))
        .slice(0, PERCEPTION_LIMIT)
        .map(page => `wiki/${page.name}: ${page.title} — ${page.description}`);
    } catch {
      // A perception source that cannot be read this run is a source that
      // found nothing, not a reason to abandon the task.
      return [];
    }
  };

  caps.searchStore = (query: string) => {
    try {
      const catalog = listCatalog();
      const found: string[] = [];
      for (const kind of STORE_KINDS) {
        for (const item of catalog[kind] ?? []) {
          if (found.length >= PERCEPTION_LIMIT) return found;
          if (matches(`${item.title} ${item.description} ${item.name}`, query)) {
            found.push(`${kind}/${item.name}: ${item.title} — ${item.description}`);
          }
        }
      }
      return found;
    } catch {
      return [];
    }
  };

  // Past conversations. This is what "search past chats" means concretely:
  // the real local log, the same one the learning agent trains from.
  caps.searchChats = (query: string) => {
    try {
      const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
      return readRecentConversationTurns(200)
        .filter(turn => {
          const hay = `${turn.userMessage} ${turn.response}`.toLowerCase();
          return words.length === 0 || words.some(w => hay.includes(w));
        })
        .slice(-PERCEPTION_LIMIT)
        .map(turn => `earlier you asked "${turn.userMessage}" and the answer was: ${turn.response}`);
    } catch {
      return [];
    }
  };

  if (host.research) {
    // The only capability that leaves this machine. It is attached only when
    // the host passes a research plugin, so an instance running offline simply
    // has no web capability and a skill wanting one contributes nothing.
    caps.searchWeb = async (query: string) => {
      try {
        const results = await host.research!.searchWeb(query, PERCEPTION_LIMIT);
        return results
          .map(r => [r.title, r.snippet, r.url].filter(Boolean).join(" — "))
          .filter(line => line.trim().length > 0);
      } catch {
        // No network, a blocked request, a changed page: the web found
        // nothing this run. That must not abandon the task, and it must never
        // be reported as if it had found something.
        return [];
      }
    };
  }

  if (host.pluginRegistry) {
    caps.callPlugin = async (pluginId: string, input: string) => {
      const instance = host.pluginRegistry!.getPluginInstance(pluginId);
      if (!instance?.onMessage) {
        // A skill naming a plugin this machine does not have is a skill that
        // does not apply here, which is the normal outcome of installing
        // something written for a differently-equipped setup.
        lastActionResult = null;
        return null;
      }
      const result = textOf(await instance.onMessage(input));
      lastActionResult = result.trim().length > 0 ? result : null;
      return result;
    };
  }

  if (host.pluginRegistry?.rankPlugins) {
    /**
     * Which plugin should handle this, without calling anything.
     *
     * The agent could previously only reach a plugin whose id a prompting
     * skill had hardcoded, which meant it could not use any tool nobody had
     * written a skill for -- and there are 35 plugins. Discovery is the
     * difference between "the agent has tools" and "the agent can find the
     * right tool".
     */
    caps.findPlugin = (task: string) => host.pluginRegistry!.rankPlugins!(task).slice(0, 3);

    /**
     * Pick the best plugin for a task and call it, falling through to the next
     * when one declines.
     *
     * Bounded to three: a plugin that returns null has genuinely declined, and
     * walking the whole ranked list to find that out is exactly the
     * try-everything cost the router exists to avoid.
     */
    caps.useBestTool = async (task: string) => {
      const ranked = host.pluginRegistry!.rankPlugins!(task).slice(0, 3);
      for (const candidate of ranked) {
        const instance = host.pluginRegistry!.getPluginInstance(candidate.id);
        if (!instance?.onMessage) continue;
        try {
          const result = textOf(await instance.onMessage(task));
          if (result.trim().length > 0) {
            lastActionResult = result;
            return { plugin: candidate.id, result, why: candidate.reason };
          }
        } catch {
          // A plugin that throws has not handled the task; try the next rather
          // than failing the whole step, which would make one broken plugin
          // able to stop the agent using any of the others.
        }
      }
      lastActionResult = null;
      return null;
    };
  }

  caps.isGoalMet = (_goal: string, observations: string[]) => {
    // Met only when an action genuinely ran and returned something, and that
    // result is what the loop most recently observed. Deliberately narrow:
    // gathering information and thinking about it is not the same as having
    // done the thing.
    if (lastActionResult === null) return false;
    return observations[observations.length - 1] === lastActionResult;
  };

  return caps;
}

/** What a loop run produced, in a shape a chat response can use directly. */
export interface AgentRunSummary {
  answered: boolean;
  message: string;
  result: LoopResult;
}

/** How many iterations a chat-triggered run may take before it gives up. */
const CHAT_MAX_ITERATIONS = 4;

/**
 * Runs the loop for one message, if any installed prompting skill actually
 * claims it.
 *
 * The gate is the skills themselves rather than a new heuristic: the loop
 * engages when an installed ACTION skill's own trigger matches. Perception and
 * cognition alone would only duplicate what the existing recall/solve path
 * already does -- taking an action and iterating on its result is the thing
 * the loop adds, so an action skill claiming the message is exactly the right
 * signal, and it stays correct as people install and remove skills.
 *
 * Returns `answered: false` when the loop ran but did not reach the goal, so
 * the caller falls back to its existing behaviour rather than handing the user
 * a shrug. The trace comes back either way, because a run that did work and
 * then declined to answer should still be inspectable.
 */
/**
 * Perception sources that reach information the ordinary pipeline cannot get
 * at by itself. A skill using one of these is reason enough to run the loop
 * even with no action to take -- searching the web IS the useful work for
 * "what is the latest X", and there is nothing to "do" afterwards.
 *
 * `memory`, `wiki` and `store` are deliberately absent: the existing
 * recall/solve path already reads those, so engaging the loop for them would
 * duplicate work and change answers that were already fine.
 */
const REACHES_BEYOND: ReadonlySet<string> = new Set(["web", "chats"]);

export async function runAgentLoopForMessage(
  userMessage: string,
  host: AgentHost,
): Promise<AgentRunSummary | null> {
  const registry = loadRegistry();
  const actions = registry.forStep("action", userMessage);
  const reaching = registry
    .forStep("perception", userMessage)
    .filter(skill => REACHES_BEYOND.has(skill.source ?? ""));
  if (actions.length === 0 && reaching.length === 0) return null;

  const result = await runAgentLoop(userMessage, registry, buildAgentCapabilities(host), {
    maxIterations: CHAT_MAX_ITERATIONS,
  });

  // An action that produced a result is the strongest outcome: the agent did
  // the thing, and its result is the answer.
  if (result.outcome === "goal-met") {
    return { answered: true, message: result.observations[result.observations.length - 1] ?? "", result };
  }

  // No action, but a source that reaches beyond the pipeline found something.
  // Those findings ARE the answer -- discarding them and falling back would
  // throw away the only part of this run that the ordinary path could not have
  // done, which is the whole reason the loop engaged.
  if (reaching.length > 0) {
    const found = result.steps
      .filter(step => step.phase === "perceive" && reaching.some(r => r.name === step.skill))
      .flatMap(step => (step.detail.startsWith("found ") ? [step.detail.replace(/^found \d+: /, "")] : []));
    const text = found.join("\n").trim();
    if (text.length > 0) return { answered: true, message: text, result };
  }

  // Nothing worth saying. The caller falls back to its existing behaviour
  // rather than handing the user a shrug.
  return { answered: false, message: "", result };
}
