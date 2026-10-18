/**
 * Who is this request for?
 *
 * One admin sets the server up and anyone else can use it, but nobody sees
 * anyone else's stuff. The simplest way to make that true without changing
 * every function signature is to carry "who" along with the request, and let
 * each store ask "where is MY data" instead of assuming one fixed folder.
 *
 * Node's AsyncLocalStorage does the carrying: the server wraps handling of a
 * request in runAs(who, ...), and anything that request starts (including the
 * awaits and timers it creates) sees the same `who`. Nothing is passed around
 * and nothing is global, so two requests at once cannot see each other's user.
 *
 * ── The three kinds of "who" ───────────────────────────────────────────
 *
 *   owner      the machine's own data, in ~/.neuroclaw exactly where it has
 *              always been. This is what you are when nothing set up accounts,
 *              when you are the admin, and when code runs outside any request
 *              (a timer, a test).
 *   user       someone else. Their data lives in ~/.neuroclaw/users/<id>/ and
 *              nowhere else.
 *   anonymous  not logged in. It has NO data directory: asking for one throws,
 *              so a route that forgot to check cannot quietly fall through to
 *              the owner's files.
 *
 * ── What this does and does not keep apart ─────────────────────────────
 *
 * Every store that asks dataDir() is separate per user. Stores that never ask
 * (a plugin with a hard-coded path, a global memory) are NOT, which is why the
 * server also keeps users away from those with an allowlist (accounts.ts) rather
 * than trusting every path to behave.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { homedir } from "node:os";
import path from "node:path";

export type Who =
  | { kind: "owner" }
  | { kind: "user"; id: string; name: string; role: "admin" | "user" }
  | { kind: "anonymous" };

const store = new AsyncLocalStorage<Who>();

export const OWNER: Who = { kind: "owner" };
export const ANONYMOUS: Who = { kind: "anonymous" };

/** Run `fn` as `who`. Everything it starts sees the same one. */
export function runAs<T>(who: Who, fn: () => T): T {
  return store.run(who, fn);
}

/** Who the running code is for. Outside any request that is the owner. */
export function who(): Who {
  return store.getStore() ?? OWNER;
}

const autonomousStore = new AsyncLocalStorage<boolean>();

/**
 * Run `fn` as the agent acting on its own (an expert, a schedule, the
 * background hive) rather than answering a person. The danger protocol judges
 * the agent by what it reaches for by itself; a person asking for something is
 * not the agent misbehaving.
 */
export function runAutonomously<T>(fn: () => T): T {
  return autonomousStore.run(true, fn);
}

/** Whether the running code is the agent acting on its own. */
export function isAutonomous(): boolean {
  return autonomousStore.getStore() === true;
}

/** The machine's owner or the admin: allowed to see the owner's data and to use the machine itself. */
export function isOwnerOrAdmin(): boolean {
  const w = who();
  return w.kind === "owner" || (w.kind === "user" && w.role === "admin");
}

/** A name to put next to a request ("Sam asked ..."), or null for the owner. */
export function currentName(): string | null {
  const w = who();
  return w.kind === "user" ? w.name : null;
}

/** The folder everything per-user lives under. CORONA_DATA_DIR overrides it, for tests. */
export function baseDir(): string {
  return process.env.CORONA_DATA_DIR ? path.resolve(process.env.CORONA_DATA_DIR) : path.join(homedir(), ".neuroclaw");
}

export const userDir = (id: string): string => path.join(baseDir(), "users", id);

/**
 * Where the current user's data lives. The owner and the admin use the base
 * folder (so everything that existed before accounts is still theirs); anyone
 * else gets their own. Anonymous gets nothing.
 */
export function dataDir(): string {
  const w = who();
  if (w.kind === "anonymous") throw new Error("Not logged in: there is no data folder for you.");
  if (w.kind === "user" && w.role !== "admin") return userDir(w.id);
  return baseDir();
}

/** Where a named file for the current user goes: ~/.neuroclaw/<name> for the owner, their own folder otherwise. */
export const dataFile = (name: string): string => path.join(dataDir(), name);

// ── The shared brain ───────────────────────────────────────────────────

let learnPolicy: () => boolean = () => false;

/** The server says whether the admin has let the brain learn from, and remember, other people. Until it says so: no. */
export function setLearnPolicy(fn: () => boolean): void {
  learnPolicy = fn;
}

/**
 * Whether the shared brain (what it learns, its long-term memory, its
 * conversation log) may take in, and give out, what the current person says.
 *
 * The owner and the admin: always. Anyone else: only if the admin turned
 * learnFromUsers on. Off, a regular user's words never enter the brain, so they
 * cannot come back out in someone else's answer, and they cannot read what the
 * owner put in. Not logged in: never.
 */
export function sharedBrainOpen(): boolean {
  const w = who();
  if (w.kind === "anonymous") return false;
  if (isOwnerOrAdmin()) return true;
  try {
    return learnPolicy();
  } catch {
    return false;
  }
}
