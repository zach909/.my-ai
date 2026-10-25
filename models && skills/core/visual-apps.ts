/**
 * Visual apps: a visual (see interface/visuals.ts) kept as an app and, only if
 * the owner says yes, put on this computer as a launcher.
 *
 * Two separate steps, and the second one is never taken for the owner:
 *
 *   1. Saving. The app's code is kept in this device's data folder. Nothing
 *      outside it changes, and nothing is launched.
 *   2. Installing. A single small file is written where the operating system
 *      looks for apps (a .desktop entry on Linux, a .webloc in ~/Applications
 *      on macOS, a Start Menu .url shortcut on Windows). It opens the app's page
 *      on this computer's own NeuroClaw. Before anything is written the exact
 *      path and the exact text of the file are shown, and the install only goes
 *      ahead with the approval that preview returned (`approvals`), which
 *      expires. A request that never saw the preview cannot install.
 *
 * The AI can propose an app (it is a visual in a reply) but has no way here to
 * install one: this module is reached only from routes for the owner or an
 * admin, and a launcher is never written from a chat turn.
 *
 * Uninstalling removes only the file this module wrote, and only if it still
 * carries the marker it wrote into it, so a file someone replaced is left alone.
 *
 * State: ~/.neuroclaw/visual-apps/<id>.json (override the folder with
 * CORONA_VISUAL_APPS_DIR). Node built-ins only.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { writeFileAtomic } from "./atomic-write.js";

export class VisualAppError extends Error {}

export const APP_NAME_MAX = 40;
/** Same ceiling as one panel in chat (interface/visuals.ts VISUAL_MAX_BYTES). */
export const APP_CODE_MAX = 64 * 1024;
export const APPS_MAX = 200;
/** How long a preview's approval stays good. */
export const APPROVAL_TTL_MS = 5 * 60 * 1000;

export interface VisualApp {
  id: string;
  name: string;
  code: string;
  createdAt: number;
  /** Set once a launcher was written: where, and for which system. */
  launcher?: { platform: LauncherPlatform; path: string; at: number };
  /** The tools the owner let this app ask for. Absent means none, which is the default. */
  os?: { tools: string[]; at: number };
}

/**
 * What an installed app can be allowed to ask this computer to do, and nothing else. Each id is an existing tool
 * (plugins/) that the agent itself uses, so every request still goes through the tool gate: the risky ones wait
 * for the owner, call by call, and the danger protocol and access settings still apply. Left out on purpose,
 * because an app has no need to reach them: anything that speaks or publishes for you (email, messaging, calls,
 * passkeys, GitHub), looks at you (camera, microphone, screen, location, contacts), or changes the agent itself
 * (computer access, store, plugin and skill makers, self repair).
 */
export const OS_TOOLS: ReadonlyArray<{ id: string; label: string; why: string }> = [
  { id: "terminal", label: "Terminal", why: "Runs commands on this computer." },
  { id: "file-system", label: "Files", why: "Reads, lists and opens your files." },
  { id: "desktop", label: "Desktop", why: "Clicks, types and opens windows for you." },
  { id: "multi-input", label: "Mouse and keyboard", why: "Drives your mouse and keyboard." },
  { id: "linux-permission-tools", label: "System permissions", why: "Changes system permissions, services and security policy." },
  { id: "radios", label: "Radios", why: "Turns Bluetooth, Wi-Fi and other radios on and off." },
  { id: "notifications", label: "Notifications", why: "Shows notifications on this computer." },
];
const OS_TOOL_IDS = new Set(OS_TOOLS.map((t) => t.id));
export const OS_REQUEST_MAX = 600;

export type LauncherPlatform = "linux" | "macos" | "windows";

export interface LauncherPlan {
  platform: LauncherPlatform;
  /** The one file that would be written. */
  path: string;
  /** Its exact content. */
  content: string;
  /** The page it opens. */
  url: string;
}

export interface Unavailable {
  unavailable: string;
}

const MARK = (id: string) => `neuroclaw-visual-app:${id}`;

/** Letters, digits, spaces and a few marks; no control characters, no path pieces. */
export function cleanName(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  const name = s.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim().slice(0, APP_NAME_MAX).trim();
  if (!name) throw new VisualAppError("Give the app a name.");
  return name;
}

export function appsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CORONA_VISUAL_APPS_DIR) return path.resolve(env.CORONA_VISUAL_APPS_DIR);
  const root = env.CORONA_DATA_DIR ? path.resolve(env.CORONA_DATA_DIR) : path.join(homedir(), ".neuroclaw");
  return path.join(root, "visual-apps");
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const isAppId = (s: unknown): s is string => typeof s === "string" && ID_RE.test(s);

function slug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/g, "");
  return s || "app";
}

/** A file name for the launcher: the app's name, safe on every file system. */
function fileName(app: VisualApp): string {
  const s = app.name.replace(/[^A-Za-z0-9 _-]/g, "").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  return s || app.id;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * What installing would write, without writing it. `baseUrl` is where this
 * NeuroClaw answers (for example http://127.0.0.1:7861).
 */
export function planLauncher(
  app: Pick<VisualApp, "id" | "name">,
  baseUrl: string,
  system: { platform: string; home: string; env: NodeJS.ProcessEnv } = { platform: process.platform, home: homedir(), env: process.env },
): LauncherPlan | Unavailable {
  const url = `${baseUrl.replace(/\/+$/, "")}/visual-apps/${app.id}`;
  const full = app as VisualApp;
  if (system.platform === "linux") {
    const data = system.env.XDG_DATA_HOME ? path.resolve(system.env.XDG_DATA_HOME) : path.join(system.home, ".local", "share");
    return {
      platform: "linux",
      path: path.join(data, "applications", `neuroclaw-${app.id}.desktop`),
      content: ["[Desktop Entry]", "Type=Application", `Name=${app.name}`, "Comment=A NeuroClaw app", `Exec=xdg-open ${url}`, "Terminal=false", "Categories=Utility;", `X-${MARK(app.id)}=1`, ""].join("\n"),
      url,
    };
  }
  if (system.platform === "darwin") {
    return {
      platform: "macos",
      path: path.join(system.home, "Applications", `${fileName(full)}.webloc`),
      content: `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${MARK(app.id)} -->\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>URL</key><string>${xml(url)}</string></dict></plist>\n`,
      url,
    };
  }
  if (system.platform === "win32") {
    const appData = system.env.APPDATA ? path.resolve(system.env.APPDATA) : path.join(system.home, "AppData", "Roaming");
    return {
      platform: "windows",
      path: path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", `${fileName(full)}.url`),
      content: `[InternetShortcut]\r\nURL=${url}\r\nNeuroClawApp=${MARK(app.id)}\r\n`,
      url,
    };
  }
  return { unavailable: `This system (${system.platform}) has no launcher folder this can write to. Open ${url} in the browser and use "Add to home screen" or "Install app".` };
}

export const isUnavailable = (p: LauncherPlan | Unavailable): p is Unavailable => "unavailable" in p;

export class VisualAppStore {
  /** Approvals handed out by a preview, by app id and what they approve. In memory only: a restart cancels them. */
  private approvals = new Map<string, { token: string; path: string; expires: number }>();

  private hold(key: string, what: string): string {
    const token = randomBytes(18).toString("hex");
    this.approvals.set(key, { token, path: what, expires: this.now() + APPROVAL_TTL_MS });
    return token;
  }

  /** Spend the approval for `key`: it is gone whether or not it matched, and must match `what` and be in time. */
  private spend(key: string, given: unknown, what: string): boolean {
    const held = this.approvals.get(key);
    this.approvals.delete(key);
    const g = typeof given === "string" ? Buffer.from(given) : Buffer.alloc(0);
    return !!held && held.expires >= this.now() && held.path === what && g.length === held.token.length && timingSafeEqual(g, Buffer.from(held.token));
  }

  constructor(private readonly dir: string = appsDir(), private readonly now: () => number = Date.now) {}

  private file(id: string): string {
    if (!isAppId(id)) throw new VisualAppError("Not an app id.");
    return path.join(this.dir, `${id}.json`);
  }

  list(): VisualApp[] {
    if (!existsSync(this.dir)) return [];
    const out: VisualApp[] = [];
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith(".json")) continue;
      const app = this.get(f.slice(0, -5));
      if (app) out.push(app);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): VisualApp | null {
    if (!isAppId(id)) return null;
    try {
      const raw = JSON.parse(readFileSync(this.file(id), "utf8")) as VisualApp;
      return raw && raw.id === id && typeof raw.name === "string" && typeof raw.code === "string" ? raw : null;
    } catch {
      return null;
    }
  }

  /** Save an app (step 1). Changes nothing outside the data folder. */
  save(nameRaw: unknown, codeRaw: unknown): VisualApp {
    const name = cleanName(nameRaw);
    const code = typeof codeRaw === "string" ? codeRaw : "";
    if (!code.trim()) throw new VisualAppError("There is no visual to save.");
    if (code.length > APP_CODE_MAX) throw new VisualAppError(`The visual is over ${APP_CODE_MAX / 1024} KB.`);
    const existing = this.list();
    if (existing.length >= APPS_MAX) throw new VisualAppError(`There is room for ${APPS_MAX} apps; remove one first.`);
    const taken = new Set(existing.map((a) => a.id));
    let id = slug(name);
    for (let n = 2; taken.has(id); n++) id = `${slug(name).slice(0, 40)}-${n}`;
    const app: VisualApp = { id, name, code, createdAt: this.now() };
    mkdirSync(this.dir, { recursive: true });
    writeFileAtomic(this.file(id), JSON.stringify(app, null, 2));
    return app;
  }

  /**
   * Show what an install would write and hand back the approval it needs.
   * Writes nothing.
   */
  preview(id: string, baseUrl: string, system?: Parameters<typeof planLauncher>[2]): { plan: LauncherPlan; approval: string } | Unavailable {
    const app = this.get(id);
    if (!app) throw new VisualAppError("No such app.");
    const plan = planLauncher(app, baseUrl, system);
    if (isUnavailable(plan)) return plan;
    return { plan, approval: this.hold(`${id}:install`, plan.path) };
  }

  /**
   * Install (step 2), only with the approval a preview returned. The file written
   * is the one the preview showed; the plan is made again and must match it.
   */
  install(id: string, approval: unknown, baseUrl: string, system?: Parameters<typeof planLauncher>[2]): VisualApp {
    const app = this.get(id);
    if (!app) throw new VisualAppError("No such app.");
    const plan = planLauncher(app, baseUrl, system);
    if (isUnavailable(plan)) throw new VisualAppError(plan.unavailable);
    // One approval, one install; it must be for the file the preview showed.
    if (!this.spend(`${id}:install`, approval, plan.path)) throw new VisualAppError("Not approved. Review what will be written first, then approve it.");
    mkdirSync(path.dirname(plan.path), { recursive: true });
    writeFileAtomic(plan.path, plan.content);
    const next: VisualApp = { ...app, launcher: { platform: plan.platform, path: plan.path, at: this.now() } };
    writeFileAtomic(this.file(id), JSON.stringify(next, null, 2));
    return next;
  }

  private osKey(id: string): string { return `${id}:os`; }

  /** The tools asked for, checked against the list an app may ever be given, in a fixed order, no repeats. */
  private cleanTools(raw: unknown): string[] {
    const given: unknown[] = Array.isArray(raw) ? raw : [];
    const bad = given.find((t) => typeof t !== "string" || !OS_TOOL_IDS.has(t));
    if (bad !== undefined) throw new VisualAppError(`An app cannot be given "${String(bad).slice(0, 40)}".`);
    const asked = given as string[];
    const tools = OS_TOOLS.map((t) => t.id).filter((t) => asked.includes(t));
    if (!tools.length) throw new VisualAppError("Pick at least one thing the app may ask for.");
    return tools;
  }

  /** Show what an app would be allowed to ask for, and hand back the approval granting it needs. Grants nothing. */
  previewOs(id: string, toolsRaw: unknown): { tools: Array<{ id: string; label: string; why: string }>; approval: string } {
    if (!this.get(id)) throw new VisualAppError("No such app.");
    const ids = this.cleanTools(toolsRaw);
    return { tools: OS_TOOLS.filter((t) => ids.includes(t.id)), approval: this.hold(this.osKey(id), ids.join(",")) };
  }

  /** Let the app ask for these tools (and only these), with the approval previewOs returned. Replaces any earlier grant. */
  grantOs(id: string, toolsRaw: unknown, approval: unknown): VisualApp {
    const app = this.get(id);
    if (!app) throw new VisualAppError("No such app.");
    const ids = this.cleanTools(toolsRaw);
    if (!this.spend(this.osKey(id), approval, ids.join(","))) throw new VisualAppError("Not approved. Review what the app would be allowed to ask for first, then approve it.");
    const next: VisualApp = { ...app, os: { tools: ids, at: this.now() } };
    writeFileAtomic(this.file(id), JSON.stringify(next, null, 2));
    return next;
  }

  revokeOs(id: string): VisualApp {
    const app = this.get(id);
    if (!app) throw new VisualAppError("No such app.");
    const { os: _gone, ...rest } = app;
    writeFileAtomic(this.file(id), JSON.stringify(rest, null, 2));
    return rest as VisualApp;
  }

  /** Whether the owner let this app ask for this tool. */
  osAllows(id: string, tool: unknown): boolean {
    return typeof tool === "string" && !!this.get(id)?.os?.tools.includes(tool);
  }

  /** Take an app off the computer and out of the store. Touches the launcher only if it is still the one this wrote. */
  remove(id: string): { removed: boolean; launcherRemoved: boolean } {
    const app = this.get(id);
    if (!app) return { removed: false, launcherRemoved: false };
    let launcherRemoved = false;
    if (app.launcher) {
      try {
        if (readFileSync(app.launcher.path, "utf8").includes(MARK(app.id))) {
          rmSync(app.launcher.path);
          launcherRemoved = true;
        }
      } catch { /* already gone */ }
    }
    rmSync(this.file(id), { force: true });
    this.approvals.delete(`${id}:install`);
    this.approvals.delete(this.osKey(id));
    return { removed: true, launcherRemoved };
  }
}
