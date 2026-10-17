/**
 * Schedule plugin: the chat front door to the scheduler
 * (models && skills/core/scheduler.ts), so the agent, or you, can schedule an
 * action from any chat.
 *
 *   schedule <when>: <action>     e.g. "schedule daily at 9am: check my email"
 *   schedule list
 *   schedule cancel <id>
 *
 * This only records the schedule. When it comes due the action is sent to the
 * agent by its normal path, so risky tools still wait for approval.
 *
 * Dispatch is strict, matching the other chat plugins: onMessage() returns null
 * unless the text actually names a schedule command, so a message that merely
 * mentions the word falls through to the next candidate.
 */

import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import {
  ScheduleError,
  WHEN_HELP,
  createSchedule,
  deleteSchedule,
  describeAction,
  describeWhen,
  loadSchedules,
} from "../models && skills/core/scheduler.js";

const USAGE =
  "Schedule commands:\n" +
  "  schedule <when>: <action> — e.g. \"schedule daily at 9am: check my email\"\n" +
  "  schedule list — what is scheduled\n" +
  "  schedule cancel <id> — stop one\n" +
  `${WHEN_HELP}\n` +
  "The action can be a message to the agent, \"hive <project>\", \"organize\", or \"expert <id>\".";

export class SchedulePlugin extends BasePlugin {
  constructor(definition: PluginDefinition) {
    super(definition);
  }

  describeCapabilities() {
    return {
      commands: ["schedule", "schedule list", "schedule cancel <id>", "schedule <when>: <action>"],
      verbs: ["schedule"],
      nouns: ["schedule", "schedules"],
    };
  }

  override async onMessage(message: unknown): Promise<unknown> {
    const input = (typeof message === "string" ? message : String(message ?? "")).trim();
    if (!/^schedule\b/i.test(input)) return null;

    if (/^schedule$|^schedule\s+help$/i.test(input)) return { tool: "schedule", result: USAGE };

    if (/^schedule\s+list$/i.test(input)) {
      const all = loadSchedules();
      if (all.length === 0) return { tool: "schedule", result: "Nothing is scheduled." };
      const lines = all.map(s => `${s.id}  ${describeWhen(s.when)}${s.enabled ? "" : " (paused)"}${s.nextAt ? `, next ${new Date(s.nextAt).toLocaleString()}` : ""}: ${describeAction(s.action).slice(0, 80)}`);
      return { tool: "schedule", result: `Scheduled:\n${lines.join("\n")}` };
    }

    const cancel = /^schedule\s+cancel\s+([a-f0-9]{8})$/i.exec(input);
    if (cancel) {
      return { tool: "schedule", result: deleteSchedule(cancel[1].toLowerCase()) ? `Cancelled ${cancel[1].toLowerCase()}.` : `There is no schedule ${cancel[1]}.` };
    }

    // The colon that ends the time is the first one followed by a space, so "at 9:30: ..." reads right.
    const make = /^schedule\s+(.+?):\s+([\s\S]+)$/i.exec(input);
    if (make) {
      try {
        const s = createSchedule({ when: make[1], action: make[2] });
        return { tool: "schedule", result: `Scheduled ${s.id}: "${describeAction(s.action).slice(0, 80)}", ${describeWhen(s.when)}${s.nextAt ? `. Next: ${new Date(s.nextAt).toLocaleString()}` : ""}.` };
      } catch (err) {
        if (err instanceof ScheduleError) return { tool: "schedule", result: err.message };
        throw err;
      }
    }
    return { tool: "schedule", result: USAGE };
  }
}
