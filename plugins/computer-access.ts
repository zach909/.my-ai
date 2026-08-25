/**
 * Computer access — the plug-in the GNOME and terminal/file layers hang off.
 *
 * The two access modules (desktop-control.ts for the graphical half,
 * agent-workspace.ts for terminals and files) were real code with nothing
 * calling them: no plug-in, no route, no way for the agent to reach either.
 * This is that reachable surface, and it is deliberately one plug-in rather
 * than two, because both halves answer to the same switches and the same
 * grants and splitting them would mean two places to look when asking "what
 * may this thing do to my computer".
 *
 * Both halves go through the shared, persisted AccessManager, so the switches
 * someone set in the interface are the switches that apply here.
 *
 * One asymmetry is on purpose and is the important line in this file: the
 * agent may turn access OFF but not ON. Turning a switch off is a restriction
 * and safe for anyone to do; turning one on is an escalation, and an agent
 * that can restore its own access has no off switch at all -- only a pause
 * button it holds itself. Enabling happens through the interface, where a
 * person does it.
 */

import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import {
  ACCESS_SWITCHES,
  SWITCH_LABEL,
  type AccessSwitch,
} from "../models && skills/core/access-manager.js";
import { describeAccess, sharedAccessManager } from "../models && skills/core/access-settings.js";
import { AgentWorkspace } from "../models && skills/core/agent-workspace.js";
import { DesktopControl } from "../models && skills/core/desktop-control.js";

export class ComputerAccessPlugin extends BasePlugin {
  private workspaceInstance: AgentWorkspace | null = null;
  private desktopInstance: DesktopControl | null = null;

  constructor(definition: PluginDefinition) {
    super(definition);
  }

  /** The terminal and file half. */
  workspace(): AgentWorkspace {
    if (!this.workspaceInstance) this.workspaceInstance = new AgentWorkspace(sharedAccessManager(), process.cwd());
    return this.workspaceInstance;
  }

  /** The GNOME graphical half. */
  desktop(): DesktopControl {
    if (!this.desktopInstance) this.desktopInstance = new DesktopControl(sharedAccessManager());
    return this.desktopInstance;
  }

  /** What is on, what is granted, and what is in the way. */
  access() {
    return describeAccess(sharedAccessManager());
  }

  /**
   * Turn a layer off. Refuses to turn one on -- see the note at the top.
   */
  turnOff(name: AccessSwitch): { switch: AccessSwitch; on: boolean } {
    if (!(ACCESS_SWITCHES as readonly string[]).includes(name)) {
      throw new Error(`No switch called "${name}". Known switches: ${ACCESS_SWITCHES.join(", ")}.`);
    }
    sharedAccessManager().setSwitch(name, false);
    return { switch: name, on: false };
  }

  /** What this machine can actually do graphically, tools and session included. */
  probe() {
    return this.desktop().probe();
  }

  private summarise(): string {
    const { switches, capabilities } = this.access();
    const lines = switches.map(s => {
      const state = s.on ? (s.effective ? "on" : "on, but overridden by the master switch") : "off";
      return `${s.label}: ${state}`;
    });
    const live = capabilities.filter(c => c.effective).map(c => c.capability);
    lines.push(live.length ? `In effect: ${live.join(", ")}` : "In effect: nothing — the agent cannot touch this computer.");
    return lines.join("\n");
  }

  override async onMessage(message: unknown): Promise<unknown> {
    const input = (typeof message === "string" ? message : String(message ?? "")).trim();
    if (!input) return null;

    if (/^(computer )?access( status)?$|^what can you do to my computer\??$/i.test(input)) {
      return { tool: "computer-access", result: this.summarise() };
    }

    if (/^(desktop )?probe$|^can you control (the |my )?(desktop|screen)\??$/i.test(input)) {
      const probe = await this.probe();
      const missing = Object.entries(probe.tools).filter(([, present]) => !present).map(([t]) => t);
      return {
        tool: "computer-access",
        result: `${probe.summary}${missing.length ? `\nMissing tools: ${missing.join(", ")}.` : ""}`,
      };
    }

    // Turning things off, in the words someone actually reaches for when they
    // want it to stop.
    const off = input.match(
      /^(?:turn off|disable|stop|kill)\s+(?:the\s+)?(all|everything|computer|full|desktop|gnome|screen|terminal|files?|workspace)\s*(?:access)?$/i,
    );
    if (off) {
      const word = off[1].toLowerCase();
      const name: AccessSwitch = /desktop|gnome|screen/.test(word)
        ? "desktop"
        : /terminal|file|workspace/.test(word)
          ? "workspace"
          : "all";
      this.turnOff(name);
      return { tool: "computer-access", result: `${SWITCH_LABEL[name]} is now off.\n\n${this.summarise()}` };
    }

    if (/^(?:turn on|enable|allow|restore)\s+(?:the\s+)?\w+\s*(?:access)?$/i.test(input)) {
      // Refused in words, not silently: the person asking should know where
      // the switch actually is rather than assume it failed.
      return {
        tool: "computer-access",
        result:
          "I can turn computer access off, but not back on — that has to be done by a person, on the Access page in the interface.",
      };
    }

    return null;
  }

  async onHealthCheck(): Promise<boolean> {
    return this.active;
  }
}
