/**
 * Desktop plugin -- the GNOME graphical layer, as a set of tools.
 *
 * The terminal plugin is the non-graphical half of the computer; this is the
 * other half: windows, the screen, launching applications, typing and
 * clicking. Each of those is one named tool, and each tool is one output
 * neuron in the network (models && skills/core/tool-neurons.ts), so the
 * network can reach for "list the windows" or "take a screenshot" as a single
 * action rather than by composing a sentence for a plugin to parse.
 *
 * The capability itself lives in DesktopControl (models && skills/core/
 * desktop-control.ts), unchanged. That module already goes through the
 * AccessManager on every operation and already refuses to type into, click
 * on, move or close any window the agent did not open itself, so everything
 * here inherits both rules rather than restating them -- a tool the network
 * fires cannot reach anything a person on the Access page has not allowed.
 *
 * ComputerAccessPlugin keeps its desktop() accessor and its on/off switches.
 * This plugin is the tool surface; that one is where access is described and
 * turned off.
 */

import type { PluginDefinition } from "../plugin_manager/types.js";
import { ToolPlugin } from "../plugin_manager/sdk.js";
import { sharedAccessManager } from "../models && skills/core/access-settings.js";
import { DesktopControl } from "../models && skills/core/desktop-control.js";

function textArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be text.`);
  return value;
}

function numberArg(args: Record<string, unknown>, name: string): number {
  const value = Number(args[name]);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}

export class DesktopPlugin extends ToolPlugin {
  private control: DesktopControl | null;

  /**
   * @param control  The desktop to drive. Injectable so a test can stand in
   *                 for a machine with no display; by default it is the real
   *                 one, behind the same shared AccessManager the Access page
   *                 edits.
   */
  constructor(definition: PluginDefinition, control?: DesktopControl) {
    super(definition);
    this.control = control ?? null;
    this.defineTools();
  }

  private desktop(): DesktopControl {
    if (!this.control) this.control = new DesktopControl(sharedAccessManager());
    return this.control;
  }

  private defineTools(): void {
    this.defineTool({
      name: "probe",
      description: "What this machine can do graphically: the session, and which desktop tools are installed.",
      args: [],
      run: async () => this.desktop().probe(),
    });
    this.defineTool({
      name: "list_windows",
      description: "Every open window, and which ones the agent opened itself.",
      args: [],
      capability: "screen.observe",
      run: async () => this.desktop().listWindows(),
    });
    this.defineTool({
      name: "screenshot",
      description: "Capture the screen as a PNG.",
      args: [],
      capability: "screen.observe",
      // Base64, not a Buffer: the result goes back into the network inside a
      // zip archive, and ZipTree carries bytes as base64 (zip-halt.ts).
      run: async () => ({ mime: "image/png", base64: (await this.desktop().screenshot()).toString("base64") }),
    });
    this.defineTool({
      name: "launch_app",
      description: "Open an application in a window marked as the agent's own.",
      args: ["command"],
      optionalArgs: ["args"],
      capability: "app.launch",
      run: async args => this.desktop().launchAgentWindow(
        textArg(args, "command"),
        Array.isArray(args.args) ? args.args.map(String) : [],
      ),
    });
    this.defineTool({
      name: "move_window",
      description: "Move and resize one of the agent's own windows.",
      args: ["windowId", "x", "y", "width", "height"],
      capability: "window.manage",
      run: async args => {
        await this.desktop().moveWindow(
          textArg(args, "windowId"),
          numberArg(args, "x"),
          numberArg(args, "y"),
          numberArg(args, "width"),
          numberArg(args, "height"),
        );
        return { moved: args.windowId };
      },
    });
    this.defineTool({
      name: "close_window",
      description: "Close one of the agent's own windows.",
      args: ["windowId"],
      capability: "window.manage",
      run: async args => {
        await this.desktop().closeWindow(textArg(args, "windowId"));
        return { closed: args.windowId };
      },
    });
    this.defineTool({
      name: "type_text",
      description: "Type text into one of the agent's own windows.",
      args: ["windowId", "text"],
      capability: "keyboard.control",
      run: async args => {
        await this.desktop().typeInto(textArg(args, "windowId"), textArg(args, "text"));
        return { typed: String(args.text).length };
      },
    });
    this.defineTool({
      name: "click",
      description: "Click at a point inside one of the agent's own windows.",
      args: ["windowId", "x", "y"],
      optionalArgs: ["button"],
      capability: "mouse.control",
      run: async args => {
        await this.desktop().clickIn(
          textArg(args, "windowId"),
          numberArg(args, "x"),
          numberArg(args, "y"),
          args.button === undefined ? 1 : numberArg(args, "button"),
        );
        return { clicked: args.windowId };
      },
    });
  }

  /**
   * Strict, like the terminal: null unless the text names one of this
   * plugin's argument-free tools, so a message routed here that it cannot
   * answer falls through to the next candidate. The tools that need
   * arguments are reached by name (callTool) or by the network firing them,
   * not by guessing coordinates out of a sentence.
   */
  override async onMessage(message: unknown): Promise<unknown> {
    const input = (typeof message === "string" ? message : String(message ?? "")).trim();
    const m = input.match(/^desktop\s*:?\s+(probe|windows|list windows|screenshot)$/i);
    if (!m) return null;
    const word = m[1].toLowerCase();
    const tool = word === "probe" ? "probe" : word === "screenshot" ? "screenshot" : "list_windows";
    const event = await this.callTool(tool, {}, "message");
    return { tool: `desktop.${tool}`, result: event.ok ? event.result : event.error };
  }

  async onHealthCheck(): Promise<boolean> {
    return this.active;
  }
}
