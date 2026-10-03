/**
 * The graphical half of the access layer.
 *
 * Windows, input, screenshots and application launching -- the part of the
 * spec that needs a real display. Everything here goes through the
 * AccessManager first, and the user/agent boundary from access-manager.ts
 * holds: this module can *observe* the user's windows and has no function that
 * types into, clicks on, moves or closes one.
 *
 * It no longer shells out to anything. The X11 protocol, the D-Bus protocol
 * the desktop portals use, and PNG encoding are implemented in
 * models && skills/core/desktop/ with Node built-ins only, so there is nothing
 * to install on a Linux machine and the same code path serves it. Phones
 * (Android, iOS) are reached through the NeuroClaw app's own bridge. Windows
 * and macOS are not supported, and say so.
 *
 * Every operation reports what it actually found. `probe()` says which
 * backend is in use, whether it can be reached and what it can do; an
 * operation the platform cannot do fails with the reason rather than
 * "succeeding" at nothing, which is worse than failing because the agent will
 * believe it.
 *
 * What has and has not been exercised: the X11 and D-Bus clients are tested
 * against a real X server and a real bus daemon (test/core/x11-native.test.ts,
 * dbus-native.test.ts). Not exercised anywhere yet: a window manager (the
 * EWMH paths), a live desktop portal, and the phone apps' side of the bridge.
 */

import { AccessManager, type Capability } from "./access-manager.js";
import {
  DesktopError,
  NoDisplay,
  DisplayUnreachable,
  Unsupported,
  selectBackend,
  type BackendKind,
  type DesktopBackend,
  type DesktopFeature,
} from "./desktop/backends.js";

export { DesktopError, NoDisplay, DisplayUnreachable, Unsupported };
export type { BackendKind, DesktopFeature };

export interface DesktopWindow {
  /** Window id as the backend reports it (hex on X11, an opaque string on a phone). */
  id: string;
  desktop: string;
  pid: number;
  host: string;
  title: string;
  /**
   * Whether this window belongs to the agent's own workspace.
   *
   * The whole user/agent separation rests on this, so on a desktop it is
   * derived from a marker the agent itself put on the window at creation, not
   * from guessing by title -- a user window that happened to be called "agent"
   * must never be mistaken for one the agent may drive. On a phone the app
   * decides: only its own windows are owned.
   */
  agentOwned: boolean;
}

export interface DesktopProbe {
  display: string | null;
  wayland: boolean;
  /** Which backend answered: x11, wayland, phone, unsupported or none. */
  backend: BackendKind;
  platform: string;
  /** What can really be done right now on this backend. */
  capabilities: Record<DesktopFeature, boolean>;
  /** True when the backend is reachable AND can at least list windows or take a screenshot. */
  usable: boolean;
  /** Plain-language summary, for showing a person why it will or will not work. */
  summary: string;
}

/**
 * The marker that distinguishes agent windows from the user's.
 *
 * Put in the window title when the agent launches something. Anything without
 * it is treated as the user's and is observe-only, which is the safe default:
 * a window whose provenance is unknown is not the agent's.
 */
export const AGENT_WINDOW_MARKER = "CORONA_AGENT_WINDOW";

export class DesktopControl {
  /**
   * @param backend  Injectable for tests. By default the backend is chosen from
   *                 the environment on every call, so a session that appears
   *                 after startup is noticed.
   */
  constructor(
    private readonly access: AccessManager,
    private readonly fixedBackend?: DesktopBackend,
  ) {}

  private backend(): DesktopBackend {
    return this.fixedBackend ?? selectBackend();
  }

  /** What this machine can actually do. Never throws -- reporting is the point. */
  async probe(): Promise<DesktopProbe> {
    const backend = this.backend();
    const display = process.env.DISPLAY ?? null;
    const wayland = Boolean(process.env.WAYLAND_DISPLAY);
    const report = await backend.describe().catch(e => ({
      reachable: false,
      notes: [(e as Error).message],
      features: Object.fromEntries(["windows", "screenshot", "keyboard", "pointer", "moveResize", "settings", "launch"].map(n => [n, false])) as Record<DesktopFeature, boolean>,
      platform: process.platform,
    }));

    const usable = report.reachable && (report.features.windows || report.features.screenshot);
    const can = Object.entries(report.features).filter(([, v]) => v).map(([k]) => k);
    const summary = !report.reachable
      ? report.notes.join(" ") || "The desktop could not be reached."
      : [
          usable
            ? `Ready on ${report.platform} (${backend.kind}): ${can.join(", ")}.`
            : `Reachable on ${report.platform}, but it can neither list windows nor take screenshots.`,
          ...report.notes,
        ].join(" ");

    return {
      display: backend.kind === "phone" ? null : display,
      wayland: backend.kind === "phone" ? false : wayland,
      backend: backend.kind,
      platform: report.platform,
      capabilities: report.features,
      usable,
      summary,
    };
  }

  /** Throws the right kind of error when there is nothing to talk to at all. */
  private async requireSession(): Promise<DesktopBackend> {
    const backend = this.backend();
    if (backend.kind === "none") throw new NoDisplay();
    if (backend.kind === "unsupported") throw new Unsupported((await backend.describe()).notes[0]);
    return backend;
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
    const backend = await this.requireSession();
    const raw = await backend.listWindows();
    return raw.map(w => ({
      id: w.id,
      desktop: w.desktop,
      pid: w.pid,
      host: w.host,
      title: w.title,
      // A backend that knows ownership says so; otherwise the title marker decides.
      agentOwned: w.owned ?? w.title.includes(AGENT_WINDOW_MARKER),
    }));
  }

  /** A screenshot of the whole screen, as PNG bytes. */
  async screenshot(): Promise<Buffer> {
    this.gate("screen.observe");
    const backend = await this.requireSession();
    return backend.screenshot();
  }

  /** A desktop setting, read-only. Useful context and cannot change anything. */
  async readSetting(schema: string, key: string): Promise<string> {
    this.gate("system.info");
    const backend = await this.requireSession();
    return backend.readSetting(schema, key);
  }

  // ── the agent's own windows ─────────────────────────────────────────────

  /**
   * Launch an application as one of the agent's own windows.
   *
   * On a desktop the marker goes in the window title so listWindows() can find
   * it later. Terminals are the common case and take a title flag; anything
   * else is launched as given and simply will not be marked, which means it is
   * treated as the user's -- failing closed rather than open. On a phone the
   * app launches the target itself; what it opens is another app's window, and
   * so is not the agent's.
   */
  async launchAgentWindow(command: string, args: string[] = []): Promise<{ pid: number; marked: boolean }> {
    this.gate("app.launch");
    const backend = await this.requireSession();
    if (backend.launch) {
      await backend.launch(command);
      return { pid: 0, marked: false };
    }

    const { spawn } = await import("node:child_process");
    const terminalLike = /(terminal|xterm|konsole|alacritty|kitty)/.test(command);
    const finalArgs = terminalLike ? ["--title", AGENT_WINDOW_MARKER, ...args] : args;

    const child = spawn(command, finalArgs, { detached: true, stdio: "ignore" });
    // An unlaunchable command arrives as an 'error' event, not an exception.
    const failed = await new Promise<Error | null>(resolve => {
      child.once("error", resolve);
      child.once("spawn", () => resolve(null));
    });
    if (failed || !child.pid) throw new DesktopError(`Could not launch "${command}"${failed ? `: ${failed.message}` : "."}`);
    child.unref();
    return { pid: child.pid, marked: terminalLike };
  }

  /** Refuses on a window the agent does not own. The user's desktop is not the agent's to rearrange. */
  private async requireAgentWindow(windowId: string): Promise<DesktopBackend> {
    const windows = await this.listWindows();
    const target = windows.find(w => w.id === windowId);
    if (!target) throw new DesktopError(`No window with id ${windowId}.`);
    if (!target.agentOwned) {
      throw new DesktopError(
        `Window ${windowId} ("${target.title}") belongs to the user. The agent can observe it but not control it.`,
      );
    }
    return this.backend();
  }

  async moveWindow(windowId: string, x: number, y: number, width: number, height: number): Promise<void> {
    this.gate("window.manage");
    await this.requireSession();
    const backend = await this.requireAgentWindow(windowId);
    await backend.moveWindow(windowId, x, y, width, height);
  }

  async closeWindow(windowId: string): Promise<void> {
    this.gate("window.manage");
    await this.requireSession();
    const backend = await this.requireAgentWindow(windowId);
    await backend.closeWindow(windowId);
  }

  // ── input ───────────────────────────────────────────────────────────────

  /**
   * Type into one of the agent's own windows.
   *
   * Focused explicitly first, and only after the ownership check, because
   * input synthesis goes wherever focus happens to be. Typing "blind" and
   * hoping the right window has focus is exactly how an agent ends up typing
   * into the user's editor. The backend confirms the focus took before it
   * sends a key.
   */
  async typeInto(windowId: string, text: string): Promise<void> {
    this.gate("keyboard.control");
    await this.requireSession();
    const backend = await this.requireAgentWindow(windowId);
    await backend.typeInto(windowId, text);
  }

  async clickIn(windowId: string, x: number, y: number, button = 1): Promise<void> {
    this.gate("mouse.control");
    await this.requireSession();
    const backend = await this.requireAgentWindow(windowId);
    await backend.clickIn(windowId, x, y, button);
  }
}
