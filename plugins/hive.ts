/**
 * Hive plugin — the chat-reachable front door to the Hive Mind
 * (models && skills/core/hive-mind.ts).
 *
 * "you see the hive team, make it so in any chat a ai can summon a hive
 * teammate or a sub ai or sub team." NeuroclawSystem already ran a fixed
 * eight-role default team (planner/coder/reviewer/mathematician/scientist/
 * creative/researcher/verifier — spawn()'s zero-sum trust split puts each
 * one at exactly 12.5 with all eight present) through collaborate() (the
 * whole team discusses and votes) and solve()/autonomousTask() (automatic,
 * best-match delegation) — but nothing let a plain chat message address one
 * specific teammate directly, or create a brand-new agent or sub-team on
 * demand. This plugin is that direct line, routed the same way every other
 * chat command in this app is (plugin_manager/capability-router.ts scores
 * describeCapabilities() against the message and calls the winner's
 * onMessage()) — reachable from any chat, not a separate page.
 *
 * Three commands, each a thin wrapper over a NeuroclawSystem method that
 * already does the real work (hive delegation/summon, AlignmentVeto gating,
 * trust reward, blackboard sharing, long-term memory):
 *   hive team                                    — the current roster
 *   hive ask <role>: <task>                       — one existing teammate
 *   hive summon <role> <specialization>: <task>   — a brand-new teammate
 *   hive summon team <name>: <task>                — a brand-new sub-team
 *
 * Summoning grants the new agent real admin privileges (HiveAgent.isAdmin,
 * set by HiveMind.summon()/summonSubHive() themselves) — that bypass is
 * this hive's own existing design, not something this plugin adds; this
 * plugin only makes the already-real summon() reachable from chat text.
 *
 * Dispatch is strict, matching store.ts's own convention: onMessage()
 * returns null unless the text actually names a hive command, so messages
 * routed here that this plugin cannot handle fall through to the next
 * candidate.
 */

import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";

const HIVE_USAGE =
  "Hive Mind commands:\n" +
  "  hive team — list the current roster and each agent's trust\n" +
  "  hive ask <role>: <task> — ask one existing teammate directly (e.g. \"hive ask coder: write a fibonacci function\")\n" +
  "  hive summon <role> <specialization>: <task> — create a brand-new teammate and give it a task\n" +
  "  hive summon team <name>: <task> — create a brand-new sub-team (with its own coordinator) and give it a task";

/** Matches this plugin's `<word>[-_word]*` convention for a role/specialization/name token. */
const TOKEN = "[A-Za-z][A-Za-z0-9_-]*";

export class HivePlugin extends BasePlugin {
  constructor(definition: PluginDefinition) {
    super(definition);
  }

  describeCapabilities() {
    return {
      commands: [
        "hive", "hive help", "hive team", "hive roster",
        "hive ask <role>: <task>",
        "hive summon <role> <specialization>: <task>",
        "hive summon team <name>: <task>",
      ],
      verbs: ["summon", "delegate", "ask", "consult"],
      nouns: [
        "hive", "team", "teammate", "agent", "subteam", "sub-team",
        "planner", "coder", "reviewer", "mathematician", "scientist", "creative", "researcher", "verifier",
      ],
    };
  }

  override async onMessage(message: unknown): Promise<unknown> {
    const input = (typeof message === "string" ? message : String(message ?? "")).trim();
    if (!input) return null;

    if (/^hive$|^hive\s+help$/i.test(input)) {
      return { tool: "hive", result: HIVE_USAGE };
    }

    if (/^hive\s+(?:team|roster)$/i.test(input)) {
      const system = await this.getSystem();
      if (!system) return { tool: "hive", result: "Hive mind unavailable in fallback mode." };
      const team = system.hiveTeamSnapshot();
      const lines = team.map(a => `${a.id} (${a.role}/${a.specialization}) — trust ${a.trust.toFixed(1)}`);
      return { tool: "hive", result: `Hive team:\n${lines.join("\n")}` };
    }

    // Checked before the generic "hive summon <role> <specialization>:"
    // pattern below, so "hive summon team X: ..." isn't parsed as role="team".
    const summonTeam = input.match(new RegExp(`^hive\\s+summon\\s+team\\s+(${TOKEN})\\s*:\\s*([\\s\\S]+)$`, "i"));
    if (summonTeam) {
      const [, name, task] = summonTeam;
      const system = await this.getSystem();
      if (!system) return { tool: "hive", result: "Hive mind unavailable in fallback mode." };
      const result = await system.summonHiveSubTeam(name, task.trim());
      if ("error" in result) return { tool: "hive", result: result.error };
      return { tool: "hive", result: `New sub-team "${name}" (coordinator ${result.coordinator}): ${result.output}` };
    }

    const summon = input.match(new RegExp(`^hive\\s+summon\\s+(${TOKEN})\\s+(${TOKEN})\\s*:\\s*([\\s\\S]+)$`, "i"));
    if (summon) {
      const [, role, specialization, task] = summon;
      const system = await this.getSystem();
      if (!system) return { tool: "hive", result: "Hive mind unavailable in fallback mode." };
      const result = await system.summonHiveAgent(role, specialization, task.trim());
      if ("error" in result) return { tool: "hive", result: result.error };
      return { tool: "hive", result: `Summoned ${result.role} (${result.agent}): ${result.output}` };
    }

    const ask = input.match(new RegExp(`^hive\\s+ask\\s+(${TOKEN})\\s*:\\s*([\\s\\S]+)$`, "i"));
    if (ask) {
      const [, role, task] = ask;
      const system = await this.getSystem();
      if (!system) return { tool: "hive", result: "Hive mind unavailable in fallback mode." };
      const result = await system.askHiveAgent(role, task.trim());
      if ("error" in result) return { tool: "hive", result: result.error };
      return { tool: "hive", result: `${result.role} (${result.agent}): ${result.output}` };
    }

    return null;
  }

  /**
   * The live NeuroclawSystem, if this process was built with one (getBot()
   * returns null in fallback mode — see the identical check in
   * interface/web-server.ts's /api/chat-groups/* handlers). Deferred import,
   * matching every other plugin (research.ts) that needs live-system access.
   */
  private async getSystem() {
    const { getBot } = await import("../src/server/bot-service.js");
    const { getNeuroclawSystem } = await import("../src/index.js");
    const bot = await getBot(await getNeuroclawSystem());
    return bot.getSystem();
  }
}
