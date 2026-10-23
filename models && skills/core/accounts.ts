/**
 * Accounts: one admin sets the server up, anyone else can use it, and nobody
 * sees anyone else's stuff.
 *
 *   ~/.neuroclaw/accounts.json   users (hashed passwords), signup mode, learning setting
 *
 * Written 0600 and outside the repository. Passwords are PBKDF2-SHA512 over a
 * random per-user salt, the same scheme remote-access.ts uses: what is stored is
 * enough to VERIFY a password and not enough to learn one.
 *
 * ── Who is who ─────────────────────────────────────────────────────────
 *
 *   admin   exactly one, the first account. Runs the machine: the compute,
 *           the tools, the settings, the other accounts. Uses the existing
 *           ~/.neuroclaw data, so nothing that was already there moves.
 *   user    everyone else. Their own chats, folders, projects, points,
 *           experts and schedules, in their own folder (user-context.ts), and a
 *           short list of things they may do (userMayReach, USER_PLUGINS).
 *
 * Making the first account is the one moment there is no admin to ask, so it is
 * authorised the way the remote password already is: from the machine itself, or
 * with the setup code printed to the server's console. A stranger who reaches the
 * port first cannot claim the server.
 *
 * ── Signup ─────────────────────────────────────────────────────────────
 *
 * "open" lets anyone make an account; "invite" means only the admin can. The
 * admin changes it any time. A new instance starts "open" because the idea is
 * that anyone can use it.
 *
 * ── The brain is shared (stated plainly) ───────────────────────────────
 *
 * Every user is talking to the same brain. By default it does NOT learn from, or
 * remember, what other people say (learnFromUsers is off), because otherwise one
 * person's chat could surface in someone else's answer. The admin can turn it on.
 * What the brain has already learned is shared; that cannot be un-shared.
 */

import crypto from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";
import { baseDir, isOwnerOrAdmin, userDir, who, type Who } from "./user-context.js";

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const DIGEST = "sha512";
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_USERS = 200;
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const USER_COOKIE = "neuroclaw_user";
/** Wrong passwords in a row before a name is locked for a while. */
export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 60_000;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,31}$/;

export type Role = "admin" | "user";
export type SignupMode = "open" | "invite";

interface StoredUser {
  id: string;
  name: string;
  role: Role;
  salt: string;
  hash: string;
  iterations: number;
  createdAt: number;
  disabledAt: number | null;
}

/** What is safe to show: never the hash or the salt. */
export interface PublicUser {
  id: string;
  name: string;
  role: Role;
  createdAt: number;
  disabledAt: number | null;
}

interface AccountsFile {
  users: StoredUser[];
  signup: SignupMode;
  /** Whether the shared brain learns from, and remembers, non-admin users' chats. Off unless the admin says. */
  learnFromUsers: boolean;
}

export function accountsFile(): string {
  return process.env.CORONA_ACCOUNTS_FILE ? path.resolve(process.env.CORONA_ACCOUNTS_FILE) : path.join(baseDir(), "accounts.json");
}

const publicUser = (u: StoredUser): PublicUser => ({ id: u.id, name: u.name, role: u.role, createdAt: u.createdAt, disabledAt: u.disabledAt });

function derive(password: string, salt: Buffer, iterations: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, KEY_LENGTH, DIGEST, (err, key) => (err ? reject(new Error(`PBKDF2 failed: ${err.message}`)) : resolve(key)));
  });
}

function checkName(name: unknown): string {
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new AccountError("A name is 2 to 32 letters, digits, '.', '-' or '_', starting with a letter or digit.");
  return name;
}

function checkPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) throw new AccountError(`A password is at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (password.length > MAX_PASSWORD_LENGTH) throw new AccountError(`A password is at most ${MAX_PASSWORD_LENGTH} characters.`);
  return password;
}

export class AccountsStore {
  /** Live logins. In memory only: a restart is a logout, which is the safer default. */
  private readonly sessions = new Map<string, { userId: string; expires: number }>();
  private readonly failures = new Map<string, { count: number; until: number }>();
  /** A real hash to compare against when the name does not exist, so "no such user" takes as long as "wrong password". */
  private dummy: { salt: Buffer; hash: Buffer } | null = null;

  constructor(
    private readonly file: string = accountsFile(),
    private readonly now: () => number = Date.now,
  ) {}

  // ── Reading and writing ──────────────────────────────────────────────

  private read(): AccountsFile {
    const empty: AccountsFile = { users: [], signup: "open", learnFromUsers: false };
    if (!existsSync(this.file)) return empty;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<AccountsFile>;
      const users = (Array.isArray(raw.users) ? raw.users : []).filter(
        (u): u is StoredUser => !!u && typeof u.id === "string" && /^[a-f0-9]{8}$/.test(u.id) && typeof u.name === "string" && typeof u.salt === "string" && typeof u.hash === "string" && (u.role === "admin" || u.role === "user"),
      ).map(u => ({ ...u, iterations: typeof u.iterations === "number" ? u.iterations : ITERATIONS, createdAt: u.createdAt ?? 0, disabledAt: typeof u.disabledAt === "number" ? u.disabledAt : null }));
      // At most one admin: a file claiming several is read as only the first being one.
      let seenAdmin = false;
      for (const u of users) {
        if (u.role === "admin") {
          if (seenAdmin) u.role = "user";
          seenAdmin = true;
        }
      }
      return { users, signup: raw.signup === "invite" ? "invite" : "open", learnFromUsers: raw.learnFromUsers === true };
    } catch {
      // An unreadable file must never mean "no admin yet", which would let a stranger claim the server.
      throw new AccountError("The accounts file is damaged. Fix or remove it from the server's console.", 500);
    }
  }

  private write(data: AccountsFile): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeJsonAtomic(this.file, data);
    try {
      chmodSync(this.file, 0o600);
    } catch {
      // Not every filesystem has modes; the hashing is the protection that matters.
    }
  }

  // ── State ────────────────────────────────────────────────────────────

  /** Whether accounts are in use at all: once there is an admin, everyone logs in. */
  hasAdmin(): boolean {
    try {
      return this.read().users.some(u => u.role === "admin");
    } catch {
      return true; // damaged: fail closed, never open
    }
  }

  signupMode(): SignupMode {
    return this.read().signup;
  }

  learnFromUsers(): boolean {
    try {
      return this.read().learnFromUsers;
    } catch {
      return false;
    }
  }

  // ── Making accounts ──────────────────────────────────────────────────

  private async make(name: string, password: string, role: Role): Promise<PublicUser> {
    checkName(name);
    checkPassword(password);
    const data = this.read();
    if (data.users.length >= MAX_USERS) throw new AccountError(`This server has the most accounts it allows (${MAX_USERS}).`, 409);
    if (data.users.some(u => u.name.toLowerCase() === name.toLowerCase())) throw new AccountError(`The name "${name}" is taken.`, 409);
    const salt = crypto.randomBytes(16);
    const hash = await derive(password, salt, ITERATIONS);
    // Re-read: another account may have been made while the hash was being computed.
    const fresh = this.read();
    if (fresh.users.some(u => u.name.toLowerCase() === name.toLowerCase())) throw new AccountError(`The name "${name}" is taken.`, 409);
    if (role === "admin" && fresh.users.some(u => u.role === "admin")) throw new AccountError("This server already has an admin.", 409);
    const user: StoredUser = { id: crypto.randomBytes(4).toString("hex"), name, role, salt: salt.toString("base64"), hash: hash.toString("base64"), iterations: ITERATIONS, createdAt: this.now(), disabledAt: null };
    fresh.users.push(user);
    this.write(fresh);
    return publicUser(user);
  }

  /**
   * Make the first account, the admin. `authorised` is the server's answer to
   * "is this from the machine itself, or does it carry the setup code" -- this
   * store has no idea what a request is.
   */
  async setupAdmin(name: string, password: string, authorised: boolean): Promise<PublicUser> {
    if (this.hasAdmin()) throw new AccountError("This server already has an admin.", 409);
    if (!authorised) throw new AccountError("Setting this up needs the computer's administrator at the machine itself, or the setup code from the server's console.", 403);
    return this.make(name, password, "admin");
  }

  /** Make an account for yourself, if signup is open. */
  async register(name: string, password: string): Promise<PublicUser> {
    if (!this.hasAdmin()) throw new AccountError("This server has not been set up yet. The admin has to make the first account.", 409);
    if (this.signupMode() !== "open") throw new AccountError("Signup is closed. Ask the admin for an account.", 403);
    return this.make(name, password, "user");
  }

  /** The admin makes an account, whatever the signup mode. */
  async createUser(name: string, password: string): Promise<PublicUser> {
    return this.make(name, password, "user");
  }

  // ── Logging in ───────────────────────────────────────────────────────

  private async dummyHash(): Promise<{ salt: Buffer; hash: Buffer }> {
    if (!this.dummy) {
      const salt = crypto.randomBytes(16);
      this.dummy = { salt, hash: await derive(crypto.randomBytes(16).toString("hex"), salt, ITERATIONS) };
    }
    return this.dummy;
  }

  async login(name: string, password: string): Promise<{ token: string; user: PublicUser }> {
    const key = String(name ?? "").toLowerCase();
    const lock = this.failures.get(key);
    if (lock && lock.until > this.now()) throw new AccountError("Too many wrong passwords. Wait a minute and try again.", 429);
    const stored = typeof name === "string" ? this.read().users.find(u => u.name.toLowerCase() === key) : undefined;
    let ok = false;
    if (stored && typeof password === "string" && password.length > 0 && password.length <= MAX_PASSWORD_LENGTH) {
      const supplied = await derive(password, Buffer.from(stored.salt, "base64"), stored.iterations || ITERATIONS);
      const have = Buffer.from(stored.hash, "base64");
      ok = supplied.length === have.length && crypto.timingSafeEqual(supplied, have);
    } else {
      // Same work either way, so a wrong name cannot be told from a wrong password by how long it took.
      const d = await this.dummyHash();
      const supplied = await derive(typeof password === "string" ? password.slice(0, MAX_PASSWORD_LENGTH) : "", d.salt, ITERATIONS);
      crypto.timingSafeEqual(supplied, d.hash);
    }
    if (!ok || !stored) {
      const f = this.failures.get(key) ?? { count: 0, until: 0 };
      f.count += 1;
      if (f.count >= MAX_FAILURES) { f.until = this.now() + LOCKOUT_MS; f.count = 0; }
      this.failures.set(key, f);
      throw new AccountError("That name and password do not match.", 401);
    }
    if (stored.disabledAt !== null) throw new AccountError("This account has been turned off by the admin.", 403);
    this.failures.delete(key);
    this.sweep();
    const token = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(token, { userId: stored.id, expires: this.now() + SESSION_TTL_MS });
    return { token, user: publicUser(stored) };
  }

  /** The user a login token belongs to, or null. A turned-off account's sessions stop working at once. */
  userFor(token: unknown): PublicUser | null {
    if (typeof token !== "string" || !token) return null;
    const s = this.sessions.get(token);
    if (!s) return null;
    if (s.expires <= this.now()) {
      this.sessions.delete(token);
      return null;
    }
    let u: StoredUser | undefined;
    try {
      u = this.read().users.find(x => x.id === s.userId);
    } catch {
      return null;
    }
    return u && u.disabledAt === null ? publicUser(u) : null;
  }

  logout(token: unknown): void {
    if (typeof token === "string") this.sessions.delete(token);
  }

  private logoutEveryone(userId: string): void {
    for (const [token, s] of this.sessions) if (s.userId === userId) this.sessions.delete(token);
  }

  private sweep(): void {
    const now = this.now();
    for (const [token, s] of this.sessions) if (s.expires <= now) this.sessions.delete(token);
  }

  // ── The admin's controls ─────────────────────────────────────────────

  listUsers(): PublicUser[] {
    return this.read().users.map(publicUser);
  }

  private target(data: AccountsFile, id: string): StoredUser {
    const u = data.users.find(x => x.id === id);
    if (!u) throw new AccountError("No such account.", 404);
    return u;
  }

  setDisabled(id: string, disabled: boolean): PublicUser {
    const data = this.read();
    const u = this.target(data, id);
    if (u.role === "admin") throw new AccountError("The admin account cannot be turned off.", 409);
    u.disabledAt = disabled ? this.now() : null;
    this.write(data);
    if (disabled) this.logoutEveryone(id);
    return publicUser(u);
  }

  async resetPassword(id: string, password: string): Promise<PublicUser> {
    checkPassword(password);
    const data = this.read();
    const u = this.target(data, id);
    const salt = crypto.randomBytes(16);
    const hash = await derive(password, salt, ITERATIONS);
    const fresh = this.read();
    const f = this.target(fresh, id);
    f.salt = salt.toString("base64");
    f.hash = hash.toString("base64");
    f.iterations = ITERATIONS;
    this.write(fresh);
    this.logoutEveryone(u.id); // a new password ends every old login
    return publicUser(f);
  }

  /** Someone changes their OWN password, proving the old one first. */
  async changeOwnPassword(id: string, oldPassword: string, newPassword: string): Promise<void> {
    const u = this.target(this.read(), id);
    await this.login(u.name, oldPassword); // throws the same error as a wrong login, and counts toward the lockout
    await this.resetPassword(id, newPassword);
  }

  /**
   * Delete an account. Its data folder is only removed if `purge` is explicitly
   * true: deleting someone's chats cannot happen by accident.
   */
  deleteUser(id: string, purge: boolean): boolean {
    const data = this.read();
    const u = this.target(data, id);
    if (u.role === "admin") throw new AccountError("The admin account cannot be deleted.", 409);
    data.users = data.users.filter(x => x.id !== id);
    this.write(data);
    this.logoutEveryone(id);
    if (purge === true) rmSync(userDir(id), { recursive: true, force: true });
    return true;
  }

  setSignup(mode: SignupMode): SignupMode {
    if (mode !== "open" && mode !== "invite") throw new AccountError('Signup is "open" or "invite".');
    const data = this.read();
    data.signup = mode;
    this.write(data);
    return mode;
  }

  setLearnFromUsers(on: boolean): boolean {
    const data = this.read();
    data.learnFromUsers = on === true;
    this.write(data);
    return data.learnFromUsers;
  }

  /** Live logins, for the admin to see. */
  liveSessions(): number {
    this.sweep();
    return this.sessions.size;
  }
}

let shared: AccountsStore | null = null;
/** The one store the running server uses. Tests make their own with a temp file. */
export function getAccounts(): AccountsStore {
  if (!shared) shared = new AccountsStore();
  return shared;
}
export function resetAccounts(): void {
  shared = null;
}

// ── Working out who is asking ──────────────────────────────────────────

/**
 * Who a request is, given its login cookie and whether the older shared-password
 * login (or an open, never-set-up server) let it in.
 *
 *   - A valid login cookie is that user.
 *   - Otherwise, if the server has no admin yet, the old rules decide: allowed
 *     means the owner (exactly the behaviour from before accounts existed).
 *   - Otherwise, once there is an admin, the old shared password still means the
 *     owner, so setting up accounts cannot lock the owner out, but an open
 *     server (no password at all) no longer is: everyone has to log in.
 *
 * Null means "not logged in".
 */
export function resolveWho(accounts: AccountsStore, token: unknown, legacyAllowed: boolean, legacyPasswordSet: boolean): Who | null {
  const user = accounts.userFor(token);
  if (user) return { kind: "user", id: user.id, name: user.name, role: user.role };
  if (!accounts.hasAdmin()) return legacyAllowed ? { kind: "owner" } : null;
  return legacyAllowed && legacyPasswordSet ? { kind: "owner" } : null;
}

// ── What a regular user may reach ──────────────────────────────────────

/**
 * Plugins a regular user's chat may use. Plugins act as the machine's owner on
 * the owner's computer and data, so this is a short list of ones that touch
 * neither: everything else is for the admin.
 */
export const USER_PLUGINS: readonly string[] = ["research", "tools", "coding", "image", "video", "game", "universal-language", "tasks", "schedule"];

/** Routes only the admin may reach, even though they sit under a path a user may otherwise use. */
const ADMIN_ONLY: RegExp[] = [
  /^\/api\/commons\/market(\/|$)/, // trades through the machine's computers and leases
  /^\/api\/commons\/projects\/[^/]+\/publish$/, // pushes to the repository with the machine's credentials
];

const USER_EXACT = new Set<string>([
  "/", "/commons", "/login", "/accounts", "/ambient.css", "/ambient.js", "/settings", "/api/app-info", "/api/app-settings",
  "/api/status", "/api/agent", "/api/commons", "/api/chat", "/api/chat/messages", "/api/chat/correct",
  "/api/chat-history/save", "/api/chat-history/search", "/api/chat-history/groups", "/api/chat-history/threads",
  "/api/chat-history/export", "/api/chat-history/import",
]);

const USER_PATTERNS: RegExp[] = [
  /^\/api\/commons\/[a-z0-9/-]*$/,
  /^\/api\/chat-history\/threads\/[^/]+(\/pin)?$/,
  /^\/api\/accounts\/(status|login|logout|register|me|password)$/,
  /^\/api\/auth\/(status|logout)$/,
];

/**
 * Default-deny: a regular user may reach exactly what is listed here. A new
 * route is closed to them until someone decides it is safe, which is the right
 * way round for a server whose routes include a terminal, the file system and
 * app launching.
 */
export function userMayReach(pathname: string, method: string): boolean {
  void method;
  if (ADMIN_ONLY.some(r => r.test(pathname))) return false;
  return USER_EXACT.has(pathname) || USER_PATTERNS.some(r => r.test(pathname));
}

/**
 * Whether `name` is the name of someone else's account, so that nobody can put
 * it on the points board (or take it for themselves) and pass for that person.
 * A regular user may use their own account's name and any name that is not an
 * account's. The owner and the admin are exempt: they run the machine and may
 * list a friend who also has an account. Unreadable accounts block, not allow.
 */
export function nameBelongsToAnotherAccount(accounts: AccountsStore, name: string): boolean {
  if (isOwnerOrAdmin()) return false;
  try {
    const w = who();
    const lower = name.trim().toLowerCase();
    return accounts.listUsers().some(u => u.name.toLowerCase() === lower && !(w.kind === "user" && w.id === u.id));
  } catch {
    return true;
  }
}
