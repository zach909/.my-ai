/**
 * The places the desktop layer can run, behind one interface.
 *
 * "Controlling the desktop" means something different on each platform this
 * project targets, and pretending otherwise is how a layer ends up succeeding
 * at nothing:
 *
 *   x11       Everything: windows, pixels, keys, clicks -- spoken to the
 *             display directly (x11.ts).
 *   wayland   Screenshots and settings through the desktop portal over D-Bus
 *             (dbus.ts), which asks the user. Windows and input only for
 *             XWayland apps, because a Wayland compositor deliberately does
 *             not let one program see or drive another's windows.
 *   phone     Android and iOS. A phone has no display server to connect to; the
 *             operating system only lets an app act through its own first-party
 *             APIs, so the NeuroClaw app on the phone exposes a small HTTP
 *             bridge (mobile/android, mobile/ios) and this talks to it.
 *   unsupported / none   Windows and macOS are out of scope by decision, and a
 *             machine with no session has nothing to control. Both say so.
 *
 * Every backend reports what it can really do, so callers (and the probe)
 * never have to guess from the platform name.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { X11, X11Error, X11Unreachable } from "./x11.js";
import { DBusConnection, DBusError, Variant, portalRequest, variantText } from "./dbus.js";

export class DesktopError extends Error {}

/** No graphical session at all -- nothing to install will fix this. */
export class NoDisplay extends DesktopError {
  constructor() {
    super("There is no graphical session (neither DISPLAY nor WAYLAND_DISPLAY is set), so there is no desktop to control.");
  }
}

/** A session is configured but could not be reached or authenticated with. */
export class DisplayUnreachable extends DesktopError {}

/** This platform cannot do this, and says why. Different from a failure: retrying will not help. */
export class Unsupported extends DesktopError {}

export type BackendKind = "x11" | "wayland" | "phone" | "unsupported" | "none";

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawWindow {
  id: string;
  desktop: string;
  pid: number;
  host: string;
  title: string;
  /**
   * Set by backends that know ownership themselves (the phone app knows which
   * windows are its own). Left undefined on a desktop, where ownership comes
   * from the marker the agent put in the window title.
   */
  owned?: boolean;
}

export const CAPABILITY_NAMES = ["windows", "screenshot", "keyboard", "pointer", "moveResize", "settings", "launch"] as const;
export type DesktopFeature = (typeof CAPABILITY_NAMES)[number];

export interface BackendReport {
  reachable: boolean;
  /** Why it is not reachable, or caveats that apply even when it is. */
  notes: string[];
  features: Record<DesktopFeature, boolean>;
  platform: string;
}

const noFeatures = (): Record<DesktopFeature, boolean> =>
  Object.fromEntries(CAPABILITY_NAMES.map(n => [n, false])) as Record<DesktopFeature, boolean>;

export interface DesktopBackend {
  readonly kind: BackendKind;
  describe(): Promise<BackendReport>;
  listWindows(): Promise<RawWindow[]>;
  /** The whole screen, or just `region` where the platform can do that. */
  screenshot(region?: Region): Promise<Buffer>;
  typeInto(windowId: string, text: string): Promise<void>;
  clickIn(windowId: string, x: number, y: number, button: number): Promise<void>;
  moveWindow(windowId: string, x: number, y: number, width: number, height: number): Promise<void>;
  closeWindow(windowId: string): Promise<void>;
  readSetting(schema: string, key: string): Promise<string>;
  /** Start an app on a backend that launches it itself. Desktop backends leave this out; the caller spawns the process. */
  launch?(target: string): Promise<void>;
}

/** Run X work and translate the client's errors into this layer's vocabulary. */
async function onX11<T>(display: string, fn: (x: X11) => Promise<T>): Promise<T> {
  try {
    return await X11.with(fn, display);
  } catch (e) {
    if (e instanceof X11Unreachable) throw new DisplayUnreachable(e.message);
    if (e instanceof X11Error) throw new DesktopError(e.message);
    throw e;
  }
}

// ── settings via the portal (shared by both desktop backends) ─────────────

async function onBus<T>(fn: (bus: DBusConnection) => Promise<T>): Promise<T> {
  let bus: DBusConnection;
  try {
    bus = await DBusConnection.connect();
  } catch (e) {
    throw new DesktopError(`No desktop session bus to talk to: ${(e as Error).message}`);
  }
  try {
    return await fn(bus);
  } catch (e) {
    if (e instanceof DBusError) throw new DesktopError(e.message);
    throw e;
  } finally {
    bus.close();
  }
}

async function busReachable(): Promise<boolean> {
  try {
    await onBus(async () => undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read one desktop setting through the Settings portal.
 *
 * The portal only exposes the settings it chooses to (appearance, fonts,
 * accessibility), which is narrower than everything gsettings could read. That
 * is the honest limit of doing it through the supported interface, and a
 * setting outside it comes back as a plain "not available" rather than a guess.
 */
async function readPortalSetting(schema: string, key: string): Promise<string> {
  return onBus(async bus => {
    const dest = "org.freedesktop.portal.Desktop";
    const path = "/org/freedesktop/portal/desktop";
    const iface = "org.freedesktop.portal.Settings";
    try {
      const [v] = await bus.call(dest, path, iface, "ReadOne", "ss", [schema, key]);
      return variantText(v);
    } catch (e) {
      if (!(e instanceof DBusError) || !/UnknownMethod|NotFound|InvalidArgs|Failed/i.test(e.name_ ?? e.message)) throw e;
    }
    try {
      const [v] = await bus.call(dest, path, iface, "Read", "ss", [schema, key]);
      return variantText(v);
    } catch (e) {
      throw new DesktopError(`The desktop does not expose ${schema} ${key} through its settings portal (${(e as Error).message}).`);
    }
  });
}

// ── X11 ───────────────────────────────────────────────────────────────────

export class X11Backend implements DesktopBackend {
  readonly kind: BackendKind = "x11";
  constructor(protected readonly display: string) {}

  async describe(): Promise<BackendReport> {
    try {
      const { xtest, wm } = await onX11(this.display, async x => ({ xtest: await x.hasXtest(), wm: await x.hasWindowManager() }));
      const notes: string[] = [];
      if (!xtest) notes.push("The display has no XTEST extension, so keyboard and mouse input cannot be sent.");
      if (!wm) notes.push("No EWMH window manager is running; windows are found by scanning the display and focus is set directly.");
      return {
        reachable: true,
        notes,
        platform: "linux-x11",
        features: {
          windows: true,
          screenshot: true,
          keyboard: xtest,
          pointer: xtest,
          moveResize: true,
          settings: await busReachable(),
          launch: true,
        },
      };
    } catch (e) {
      return { reachable: false, notes: [(e as Error).message], platform: "linux-x11", features: noFeatures() };
    }
  }

  async listWindows(): Promise<RawWindow[]> {
    return onX11(this.display, x => x.listWindows());
  }

  async screenshot(region?: Region): Promise<Buffer> {
    return onX11(this.display, x => x.screenshot(region));
  }

  typeInto(windowId: string, text: string): Promise<void> {
    return onX11(this.display, async x => {
      // Focus first, and confirmed: input goes wherever focus is.
      await x.focus(parseInt(windowId, 16));
      await x.typeText(text);
    });
  }

  clickIn(windowId: string, px: number, py: number, button: number): Promise<void> {
    return onX11(this.display, async x => {
      const win = parseInt(windowId, 16);
      const geo = await x.geometry(win);
      // A click outside the window would land on whatever is beside it, which
      // is by definition not the agent's. Refuse rather than "close enough".
      if (px < 0 || py < 0 || px >= geo.width || py >= geo.height) {
        throw new DesktopError(`(${px}, ${py}) is outside window ${windowId}, which is ${geo.width}x${geo.height}.`);
      }
      await x.focus(win);
      const at = await x.toRoot(win, px, py);
      await x.clickAt(at.x, at.y, button);
    });
  }

  moveWindow(windowId: string, x: number, y: number, width: number, height: number): Promise<void> {
    return onX11(this.display, c => c.moveResize(parseInt(windowId, 16), x, y, width, height));
  }

  closeWindow(windowId: string): Promise<void> {
    return onX11(this.display, c => c.closeWindow(parseInt(windowId, 16)));
  }

  readSetting(schema: string, key: string): Promise<string> {
    return readPortalSetting(schema, key);
  }
}

// ── Wayland ───────────────────────────────────────────────────────────────

export class WaylandBackend implements DesktopBackend {
  readonly kind: BackendKind = "wayland";
  private readonly x11: X11Backend | null;

  constructor(xwaylandDisplay: string | undefined) {
    this.x11 = xwaylandDisplay ? new X11Backend(xwaylandDisplay) : null;
  }

  async describe(): Promise<BackendReport> {
    const portal = await busReachable();
    const x = this.x11 ? await this.x11.describe() : null;
    const notes = [
      "Wayland session: windows and input reach XWayland apps only, because Wayland does not let one program see or drive another's windows.",
    ];
    if (!portal) notes.push("The desktop portal (D-Bus session bus) is unreachable, so screenshots and settings are unavailable.");
    if (!x) notes.push("No XWayland display (DISPLAY is unset), so no windows can be listed or driven.");
    else if (!x.reachable) notes.push(...x.notes);
    const xOk = Boolean(x?.reachable);
    return {
      reachable: portal || xOk,
      notes,
      platform: "linux-wayland",
      features: {
        windows: xOk,
        screenshot: portal,
        keyboard: xOk && x!.features.keyboard,
        pointer: xOk && x!.features.pointer,
        moveResize: xOk,
        settings: portal,
        launch: true,
      },
    };
  }

  private requireX(what: string): X11Backend {
    if (!this.x11) {
      throw new Unsupported(
        `${what} is not possible on a Wayland session without XWayland: Wayland deliberately does not let a program list or drive other programs' windows.`,
      );
    }
    return this.x11;
  }

  listWindows() { return this.requireX("Listing windows").listWindows(); }
  typeInto(id: string, text: string) { return this.requireX("Typing").typeInto(id, text); }
  clickIn(id: string, x: number, y: number, b: number) { return this.requireX("Clicking").clickIn(id, x, y, b); }
  moveWindow(id: string, x: number, y: number, w: number, h: number) { return this.requireX("Moving a window").moveWindow(id, x, y, w, h); }
  closeWindow(id: string) { return this.requireX("Closing a window").closeWindow(id); }
  readSetting(schema: string, key: string) { return readPortalSetting(schema, key); }

  /**
   * A screenshot through the desktop portal.
   *
   * The X screen is deliberately not used as a fallback: under XWayland it
   * shows only X apps and a black background, so a "successful" capture would
   * be a picture of the wrong thing. The portal may ask the user to allow it
   * the first time; a refusal is reported as a refusal.
   */
  async screenshot(region?: Region): Promise<Buffer> {
    if (region) {
      throw new Unsupported("Capturing part of the screen is not available through the Wayland portal; capture the whole screen.");
    }
    return onBus(async bus => {
      const res = await portalRequest(
        bus,
        "org.freedesktop.portal.Screenshot",
        "Screenshot",
        "sa{sv}",
        token => ["", new Map([["handle_token", new Variant("s", token)], ["interactive", new Variant("b", false)]])],
        120_000,
      );
      if (res.response === 1) throw new DesktopError("The screenshot was declined at the desktop's permission prompt.");
      if (res.response !== 0) throw new DesktopError("The desktop portal could not take the screenshot.");
      const uri = res.results.get("uri")?.value;
      if (typeof uri !== "string") throw new DesktopError("The desktop portal answered without a screenshot file.");
      const file = fileURLToPath(uri);
      try {
        return fs.readFileSync(file);
      } finally {
        // The portal saves into the user's Pictures folder; this is a capture
        // for the agent, not a keepsake, so it is not left behind.
        try { fs.rmSync(file, { force: true }); } catch { /* best effort */ }
      }
    });
  }
}

// ── phones ────────────────────────────────────────────────────────────────

interface BridgeInfo {
  platform: string;
  features?: Partial<Record<DesktopFeature, boolean>>;
  notes?: string[];
}

/**
 * Talks to the NeuroClaw app on a phone.
 *
 * Android and iOS give a program no way to reach across apps, so the app
 * itself does the work with its operating system's own APIs and exposes it as
 * the small HTTP surface below. The ownership boundary lives there too: the
 * app only marks its own windows as `owned`, so the rule "the agent may observe
 * the user's windows but only drive its own" holds on a phone exactly as it
 * does on a desktop.
 *
 *   GET  /v1/info                     -> { platform, features, notes }
 *   GET  /v1/windows                  -> [{ id, title, pid?, owned }]
 *   GET  /v1/screenshot               -> image/png
 *   POST /v1/type    { windowId, text }
 *   POST /v1/click   { windowId, x, y, button }
 *   POST /v1/close   { windowId }
 *   POST /v1/launch  { target }
 *
 * A 501 means "this phone's operating system does not allow that".
 */
export class PhoneBackend implements DesktopBackend {
  readonly kind: BackendKind = "phone";
  constructor(private readonly base: string, private readonly token: string) {}

  private async http(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.base.replace(/\/+$/, "") + path, {
        method,
        headers: {
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new DisplayUnreachable(`Could not reach the NeuroClaw phone app at ${this.base}: ${(e as Error).message}`);
    }
    if (res.ok) return res;
    let message = `The phone app answered ${res.status}.`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) message = j.error;
    } catch { /* keep the status text */ }
    if (res.status === 501) throw new Unsupported(message);
    if (res.status === 401 || res.status === 403) {
      throw new DesktopError(`The phone app refused the bridge token. ${message} Set NEUROCLAW_PHONE_BRIDGE_TOKEN to the token shown in the app.`);
    }
    throw new DesktopError(message);
  }

  async describe(): Promise<BackendReport> {
    try {
      const info = (await (await this.http("GET", "/v1/info")).json()) as BridgeInfo;
      return {
        reachable: true,
        notes: info.notes ?? [],
        platform: info.platform,
        features: { ...noFeatures(), ...info.features },
      };
    } catch (e) {
      return { reachable: false, notes: [(e as Error).message], platform: "phone", features: noFeatures() };
    }
  }

  async listWindows(): Promise<RawWindow[]> {
    const rows = (await (await this.http("GET", "/v1/windows")).json()) as Array<Partial<RawWindow> & { id: string | number }>;
    return rows.map(r => ({
      id: String(r.id),
      desktop: r.desktop ?? "0",
      pid: r.pid ?? 0,
      host: r.host ?? "phone",
      title: r.title ?? "",
      owned: r.owned === true,
    }));
  }

  async screenshot(region?: Region): Promise<Buffer> {
    if (region) throw new Unsupported("Capturing part of a phone screen is not available; capture the whole screen.");
    return Buffer.from(await (await this.http("GET", "/v1/screenshot")).arrayBuffer());
  }

  async typeInto(windowId: string, text: string): Promise<void> {
    await this.http("POST", "/v1/type", { windowId, text });
  }

  async clickIn(windowId: string, x: number, y: number, button: number): Promise<void> {
    await this.http("POST", "/v1/click", { windowId, x, y, button });
  }

  async moveWindow(): Promise<void> {
    throw new Unsupported("Phone windows are full-screen and cannot be moved or resized.");
  }

  async closeWindow(windowId: string): Promise<void> {
    await this.http("POST", "/v1/close", { windowId });
  }

  async readSetting(): Promise<string> {
    throw new Unsupported("Reading desktop settings is not available on a phone.");
  }

  async launch(target: string): Promise<void> {
    await this.http("POST", "/v1/launch", { target });
  }
}

// ── no desktop here ───────────────────────────────────────────────────────

/** Windows and macOS: out of scope by decision. Says so rather than half-working. */
export class UnsupportedBackend implements DesktopBackend {
  readonly kind: BackendKind = "unsupported";
  constructor(private readonly platform: string) {}

  private refuse(): never {
    throw new Unsupported(
      `Desktop control is not offered on ${this.platform === "win32" ? "Windows" : this.platform === "darwin" ? "macOS" : this.platform}. It runs on Linux (X11 and Wayland), Android and iOS.`,
    );
  }
  async describe(): Promise<BackendReport> {
    return {
      reachable: false,
      notes: [`Desktop control is not offered on ${this.platform}. It runs on Linux (X11 and Wayland), Android and iOS.`],
      platform: this.platform,
      features: noFeatures(),
    };
  }
  async listWindows(): Promise<RawWindow[]> { return this.refuse(); }
  async screenshot(): Promise<Buffer> { return this.refuse(); }
  async typeInto(): Promise<void> { return this.refuse(); }
  async clickIn(): Promise<void> { return this.refuse(); }
  async moveWindow(): Promise<void> { return this.refuse(); }
  async closeWindow(): Promise<void> { return this.refuse(); }
  async readSetting(): Promise<string> { return this.refuse(); }
}

export class NoDisplayBackend implements DesktopBackend {
  readonly kind: BackendKind = "none";
  async describe(): Promise<BackendReport> {
    return {
      reachable: false,
      notes: ["No graphical session — this machine has no desktop to control."],
      platform: process.platform,
      features: noFeatures(),
    };
  }
  async listWindows(): Promise<RawWindow[]> { throw new NoDisplay(); }
  async screenshot(): Promise<Buffer> { throw new NoDisplay(); }
  async typeInto(): Promise<void> { throw new NoDisplay(); }
  async clickIn(): Promise<void> { throw new NoDisplay(); }
  async moveWindow(): Promise<void> { throw new NoDisplay(); }
  async closeWindow(): Promise<void> { throw new NoDisplay(); }
  async readSetting(): Promise<string> { throw new NoDisplay(); }
}

/**
 * Pick the backend for this process. Called per operation rather than once, so
 * a session that appears (or a bridge URL that is set) after startup is seen.
 */
export function selectBackend(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): DesktopBackend {
  // Node on Android (Termux-style) reports "android"; the app is on loopback.
  const bridge = env.NEUROCLAW_PHONE_BRIDGE_URL || (platform === "android" ? "http://127.0.0.1:7862" : "");
  if (bridge) return new PhoneBackend(bridge, env.NEUROCLAW_PHONE_BRIDGE_TOKEN ?? "");
  if (platform === "win32" || platform === "darwin") return new UnsupportedBackend(platform);
  if (env.WAYLAND_DISPLAY) return new WaylandBackend(env.DISPLAY);
  if (env.DISPLAY) return new X11Backend(env.DISPLAY);
  return new NoDisplayBackend();
}
