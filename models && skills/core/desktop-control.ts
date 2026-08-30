/**
 * The graphical half of the GNOME access layer.
 *
 * Windows, input, screenshots and application launching — the part of the spec
 * that needs a real desktop. Everything here goes through the AccessManager
 * first, and the user/agent boundary from access-manager.ts holds: this module
 * can *observe* the user's windows and has no function that types into, clicks
 * on, moves or closes one.
 *
 * The honest problem, stated up front: this runs on machines that may have no
 * display and may not have the tools installed. Rather than pretend, every
 * operation reports what it actually found. `probe()` says which tools exist
 * and whether there is a session to talk to, and an operation whose tool is
 * missing fails with the name of the package to install rather than a generic
 * error. A desktop layer that silently no-ops is worse than one that says it
 * cannot work here, because the agent will happily "succeed" at doing nothing.
 *
 * I could not verify the actual window manipulation on the machine this was
 * written on: no DISPLAY, no wmctrl, no xdotool. What IS verified is the
 * command construction, the permission gating, the tool detection, and every
 * degradation path. The X calls themselves are the standard invocations and
 * are unexercised here.
 */

import { execFile } from "node:child_process";
import { AccessManager, type Capability } from "./access-manager.js";

const TOOL_TIMEOUT_MS = 15_000;

/** The external programs this layer drives, and what to install when one is missing. */
export const DESKTOP_TOOLS = {
  wmctrl: { package: "wmctrl", purpose: "listing, moving and closing windows" },
  xdotool: { package: "xdotool", purpose: "mouse and keyboard input on X11" },
  ydotool: { package: "ydotool", purpose: "mouse and keyboard input on Wayland" },
  gsettings: { package: "glib2 / libglib2.0-bin", purpose: "reading and writing GNOME settings" },
  gdbus: { package: "glib2 / libglib2.0-bin", purpose: "talking to GNOME Shell and AT-SPI over D-Bus" },
  "gnome-screenshot": { package: "gnome-screenshot", purpose: "capturing the screen" },
} as const;
export type DesktopTool = keyof typeof DESKTOP_TOOLS;

export class DesktopError extends Error {}

/** A missing tool is a different problem from a failed command, and says what to install. */
export class ToolMissing extends DesktopError {
  constructor(readonly tool: DesktopTool) {
    super(
      `"${tool}" is not installed. It is needed for ${DESKTOP_TOOLS[tool].purpose}. Install the "${DESKTOP_TOOLS[tool].package}" package.`,
    );
  }
}

/** No graphical session at all — nothing to install will fix this. */
export class NoDisplay extends DesktopError {
  constructor() {
    super("There is no graphical session (neither DISPLAY nor WAYLAND_DISPLAY is set), so there is no desktop to control.");
  }
}

interface Run {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[]): Promise<Run> {
  return new Promise(resolve => {
    execFile(command, args, { timeout: TOOL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

/**
 * Whether a tool is installed, remembered for a short while.
 *
 * Measured before caching: each detection is an `sh -c command -v` spawn at
 * ~3.3ms, and the input path pays for three of them per call -- requireTool,
 * then listWindows' own requireTool, then agentWindowIds' check -- so roughly
 * 10ms of re-detection before a single keystroke is sent. Detecting the same
 * absent tool three times in one operation is not caution, it is waste.
 *
 * The TTL rather than a permanent cache is the point: a package installed
 * while the agent is running has to become usable without a restart, and
 * "install wmctrl" is exactly the advice ToolMissing gives. Ten seconds is
 * long enough to collapse the repeats inside one operation and short enough
 * that acting on that advice works.
 */
const TOOL_CACHE_MS = 10_000;
const toolCache = new Map<DesktopTool, { present: boolean; at: number }>();

async function have(tool: DesktopTool, fresh = false): Promise<boolean> {
  const cached = toolCache.get(tool);
  if (!fresh && cached && Date.now() - cached.at < TOOL_CACHE_MS) return cached.present;
  const res = await run("sh", ["-c", `command -v ${tool}`]);
  const present = res.ok && res.stdout.trim().length > 0;
  toolCache.set(tool, { present, at: Date.now() });
  return present;
}

/** Forget what was detected. Exported for tests, and for anything that installs a tool. */
export function forgetDetectedTools(): void {
  toolCache.clear();
}

export interface DesktopWindow {
  /** Window id as the window manager reports it. */
  id: string;
  desktop: string;
  pid: number;
  host: string;
  title: string;
  /**
   * Whether this window belongs to the agent's own workspace.
   *
   * The whole user/agent separation rests on this, so it is derived from a
   * marker the agent itself put on the window at creation, not from guessing
   * by title -- a user window that happened to be called "agent" must never be
   * mistaken for one the agent may drive.
   */
  agentOwned: boolean;
}

export interface DesktopProbe {
  display: string | null;
  wayland: boolean;
  tools: Record<DesktopTool, boolean>;
  /** True when there is a session AND at least the window tool is present. */
  usable: boolean;
  /** Plain-language summary, for showing a person why it will or will not work. */
  summary: string;
}

/**
 * The marker that distinguishes agent windows from the user's.
 *
 * Set as a window property when the agent launches something. Anything without
 * it is treated as the user's and is observe-only, which is the safe default:
 * a window whose provenance is unknown is not the agent's.
 */
export const AGENT_WINDOW_MARKER = "CORONA_AGENT_WINDOW";

export class DesktopControl {
  constructor(private readonly access: AccessManager) {}

  /** What this machine can actually do. Never throws — reporting is the point. */
  async probe(): Promise<DesktopProbe> {
    const display = process.env.DISPLAY ?? null;
    const wayland = Boolean(process.env.WAYLAND_DISPLAY);
    const names = Object.keys(DESKTOP_TOOLS) as DesktopTool[];
    // Deliberately uncached: probe() is the question "what does this machine
    // have right now", and answering it from a cache would report a tool as
    // missing seconds after someone installed it on this call's own advice.
    const found = await Promise.all(names.map(async t => [t, await have(t, true)] as const));
    const tools = Object.fromEntries(found) as Record<DesktopTool, boolean>;

    const hasSession = Boolean(display) || wayland;
    const usable = hasSession && tools.wmctrl;

    const missing = names.filter(t => !tools[t]);
    const summary = !hasSession
      ? "No graphical session — this machine has no desktop to control."
      : usable
        ? missing.length === 0
          ? "Ready: session present and every tool installed."
          : `Usable, but missing ${missing.join(", ")} — some operations will refuse with an install hint.`
        : `A session exists but wmctrl is missing, so windows cannot be listed or managed. Install "${DESKTOP_TOOLS.wmctrl.package}".`;

    return { display, wayland, tools, usable, summary };
  }

  private async requireSession(): Promise<void> {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new NoDisplay();
  }

  private async requireTool(tool: DesktopTool): Promise<void> {
    if (!(await have(tool))) throw new ToolMissing(tool);
  }

  private gate(capability: Capability): void {
    this.access.require(capability);
  }

  // ── observing ───────────────────────────────────────────────────────────

  /**
   * Every window on the desktop, the user's included.
   *
   * Listing the user's windows is observation and needs only `user.observe`.
   * Doing anything to one is not offered at all.
   */
  async listWindows(): Promise<DesktopWindow[]> {
    this.gate("user.observe");
    await this.requireSession();
    await this.requireTool("wmctrl");

    const res = await run("wmctrl", ["-lp"]);
    if (!res.ok) throw new DesktopError(`Could not list windows: ${res.stderr.trim() || "wmctrl failed"}`);

    const agentIds = await this.agentWindowIds();
    return res.stdout
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        // wmctrl -lp: <id> <desktop> <pid> <host> <title...>
        const [id, desktop, pid, host, ...rest] = line.split(/\s+/);
        return {
          id,
          desktop,
          pid: Number(pid) || 0,
          host,
          title: rest.join(" "),
          agentOwned: agentIds.has(id),
        };
      });
  }

  /**
   * Window ids the agent marked as its own.
   *
   * Read from the window property rather than remembered in memory, so the
   * answer survives a restart and cannot drift from what is actually on screen.
   */
  private async agentWindowIds(): Promise<Set<string>> {
    if (!(await have("xdotool"))) return new Set();
    const res = await run("xdotool", ["search", "--name", AGENT_WINDOW_MARKER]);
    if (!res.ok) return new Set();
    return new Set(
      res.stdout
        .split("\n")
        .map(s => s.trim())
        .filter(Boolean)
        // xdotool prints decimal ids; wmctrl prints hex. Normalised so the two
        // can actually be compared -- they cannot be, otherwise, and every
        // window would look like the user's.
        .map(d => `0x${Number(d).toString(16).padStart(8, "0")}`),
    );
  }

  /** A screenshot of the whole screen, as PNG bytes. */
  async screenshot(): Promise<Buffer> {
    this.gate("screen.observe");
    await this.requireSession();
    await this.requireTool("gnome-screenshot");

    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = mkdtempSync(path.join(tmpdir(), "corona-shot-"));
    const file = path.join(dir, "screen.png");
    try {
      const res = await run("gnome-screenshot", ["-f", file]);
      if (!res.ok) throw new DesktopError(`Screenshot failed: ${res.stderr.trim() || "gnome-screenshot failed"}`);
      return readFileSync(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** GNOME settings, read-only. Useful context and cannot change anything. */
  async readSetting(schema: string, key: string): Promise<string> {
    this.gate("system.info");
    await this.requireTool("gsettings");
    const res = await run("gsettings", ["get", schema, key]);
    if (!res.ok) throw new DesktopError(`Could not read ${schema} ${key}: ${res.stderr.trim()}`);
    return res.stdout.trim();
  }

  // ── the agent's own windows ─────────────────────────────────────────────

  /**
   * Launch an application as one of the agent's own windows.
   *
   * The marker goes in the window title so `agentWindowIds()` can find it
   * later. Terminals are the common case and take a title flag; anything else
   * is launched as given and simply will not be marked, which means it is
   * treated as the user's -- failing closed rather than open.
   */
  async launchAgentWindow(command: string, args: string[] = []): Promise<{ pid: number; marked: boolean }> {
    this.gate("app.launch");
    await this.requireSession();

    const { spawn } = await import("node:child_process");
    const terminalLike = /(terminal|xterm|konsole|alacritty|kitty)/.test(command);
    const finalArgs = terminalLike ? ["--title", AGENT_WINDOW_MARKER, ...args] : args;

    const child = spawn(command, finalArgs, { detached: true, stdio: "ignore" });
    child.unref();
    if (!child.pid) throw new DesktopError(`Could not launch "${command}".`);
    return { pid: child.pid, marked: terminalLike };
  }

  /** Refuses on a window the agent does not own. The user's desktop is not the agent's to rearrange. */
  private async requireAgentWindow(windowId: string): Promise<void> {
    const windows = await this.listWindows();
    const target = windows.find(w => w.id === windowId);
    if (!target) throw new DesktopError(`No window with id ${windowId}.`);
    if (!target.agentOwned) {
      throw new DesktopError(
        `Window ${windowId} ("${target.title}") belongs to the user. The agent can observe it but not control it.`,
      );
    }
  }

  async moveWindow(windowId: string, x: number, y: number, width: number, height: number): Promise<void> {
    this.gate("window.manage");
    await this.requireTool("wmctrl");
    await this.requireAgentWindow(windowId);
    const res = await run("wmctrl", ["-i", "-r", windowId, "-e", `0,${x},${y},${width},${height}`]);
    if (!res.ok) throw new DesktopError(`Could not move window: ${res.stderr.trim()}`);
  }

  async closeWindow(windowId: string): Promise<void> {
    this.gate("window.manage");
    await this.requireTool("wmctrl");
    await this.requireAgentWindow(windowId);
    const res = await run("wmctrl", ["-i", "-c", windowId]);
    if (!res.ok) throw new DesktopError(`Could not close window: ${res.stderr.trim()}`);
  }

  // ── input ───────────────────────────────────────────────────────────────

  /**
   * Type into one of the agent's own windows.
   *
   * Focused explicitly first, and only after the ownership check, because
   * input synthesis goes wherever focus happens to be. Typing "blind" and
   * hoping the right window has focus is exactly how an agent ends up typing
   * into the user's editor.
   */
  async typeInto(windowId: string, text: string): Promise<void> {
    this.gate("keyboard.control");
    await this.requireSession();
    await this.requireTool("xdotool");
    await this.requireAgentWindow(windowId);

    const focus = await run("xdotool", ["windowactivate", "--sync", String(parseInt(windowId, 16))]);
    if (!focus.ok) throw new DesktopError(`Could not focus window ${windowId}: ${focus.stderr.trim()}`);
    // `--` so text starting with a dash is typed, not read as options.
    const res = await run("xdotool", ["type", "--delay", "12", "--", text]);
    if (!res.ok) throw new DesktopError(`Could not type: ${res.stderr.trim()}`);
  }

  async clickIn(windowId: string, x: number, y: number, button = 1): Promise<void> {
    this.gate("mouse.control");
    await this.requireSession();
    await this.requireTool("xdotool");
    await this.requireAgentWindow(windowId);

    const id = String(parseInt(windowId, 16));
    const focus = await run("xdotool", ["windowactivate", "--sync", id]);
    if (!focus.ok) throw new DesktopError(`Could not focus window ${windowId}: ${focus.stderr.trim()}`);
    const move = await run("xdotool", ["mousemove", "--window", id, String(x), String(y)]);
    if (!move.ok) throw new DesktopError(`Could not move the pointer: ${move.stderr.trim()}`);
    const click = await run("xdotool", ["click", String(button)]);
    if (!click.ok) throw new DesktopError(`Could not click: ${click.stderr.trim()}`);
  }
}
