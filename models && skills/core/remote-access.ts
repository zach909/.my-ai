/**
 * Remote Access — the password someone types to reach this instance from
 * anywhere that is not the machine it runs on, and the sessions that
 * password buys.
 *
 * Before this, the remote password lived only in memory and only ever
 * arrived through NEUROCLAW_WEB_PASSWORD: nobody could set one from the
 * interface, and every restart forgot it. That is fine for a server started
 * by hand with an environment variable in front of it. It is no good at all
 * for "I want to log in from my phone", which is a password you set once, on
 * a page, and then use.
 *
 * So the credential is stored -- as a PBKDF2 hash over a random per-instance
 * salt, never the password itself -- and the running server checks against
 * it. What is stored is enough to VERIFY a password and not enough to learn
 * one.
 *
 *   ~/.neuroclaw/remote-access.json   { salt, hash, iterations, createdAt }
 *
 * Written 0600. Deliberately outside the repository: it is this machine's
 * credential, and the one thing in this project that must never be committed
 * or shared, unlike the wiki, the store, and the chat rooms, which all exist
 * to be public.
 *
 * ── Who may set it ──────────────────────────────────────────────────────
 *
 * Setting the first password is the one moment when there is no password to
 * ask for, so it has to be authorised some other way:
 *
 *   - From the machine itself (localhost), freely. Someone at the keyboard
 *     already has everything this password protects.
 *   - From anywhere else, only with the setup code printed to the server's
 *     own console at startup. A stranger who reaches the port before you do
 *     cannot claim the instance, because they cannot see that console.
 *
 * CHANGING an existing password always requires the existing one (or
 * localhost), and clearing it entirely is destruction -- privileged, never
 * open, the same rule the wiki and the store follow.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import crypto from "node:crypto";

/** Iterations for new credentials. Stored per-credential so raising it later does not lock anyone out. */
const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const DIGEST = "sha512";

/** Long enough to be worth having. Short enough that someone will actually set one. */
export const MIN_PASSWORD_LENGTH = 8;

/** How long a login lasts before it has to be done again. */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = "neuroclaw_session";

export class RemoteAccessError extends Error {}

interface StoredCredential {
  salt: string;
  hash: string;
  iterations: number;
  createdAt: number;
}

function derive(password: string, salt: Buffer, iterations: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, KEY_LENGTH, DIGEST, (err, key) => {
      if (err) reject(new Error(`PBKDF2 failed: ${err.message}`));
      else resolve(key);
    });
  });
}

export class RemoteAccessStore {
  private readonly file: string;
  /** Live logins. In memory only: a restart is a logout, which is the safer default. */
  private readonly sessions = new Map<string, number>();
  /**
   * Printed to the console at startup when there is no password yet, and the
   * only way to set one from off the machine. Regenerated per process, so a
   * code from a previous run is worth nothing.
   */
  private readonly setupCode = crypto.randomBytes(4).toString("hex");

  constructor(file?: string) {
    this.file = file ?? join(homedir(), ".neuroclaw", "remote-access.json");
  }

  /** The code that authorises a first password from off the machine. */
  get firstTimeSetupCode(): string {
    return this.setupCode;
  }

  private read(): StoredCredential | null {
    if (!existsSync(this.file)) return null;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as StoredCredential;
      if (typeof raw?.salt !== "string" || typeof raw?.hash !== "string") return null;
      return raw;
    } catch {
      // A corrupt credential file is treated as no credential rather than as
      // a permanent lockout: the setup rules above still decide who may write
      // a new one, so this cannot be used to get in.
      return null;
    }
  }

  /** Whether a password has ever been set on this machine. */
  isSet(): boolean {
    return this.read() !== null;
  }

  /**
   * Set or replace the password.
   *
   * `authorised` is the caller's answer to "are you allowed to do this" --
   * worked out by the server from where the request came and what it carried,
   * not by this store, which has no idea what a request is.
   */
  async set(password: string, authorised: boolean): Promise<void> {
    if (!authorised) {
      throw new RemoteAccessError(
        this.isSet()
          ? "Changing the remote password needs the current one, or a request from the machine itself."
          : "Setting the first remote password needs the setup code from the server console, or a request from the machine itself.",
      );
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      throw new RemoteAccessError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    const salt = crypto.randomBytes(16);
    const hash = await derive(password, salt, ITERATIONS);
    const credential: StoredCredential = {
      salt: salt.toString("base64"),
      hash: hash.toString("base64"),
      iterations: ITERATIONS,
      createdAt: Date.now(),
    };
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(credential, null, 2), "utf8");
    // Best effort: on a filesystem without POSIX modes this throws and the
    // credential is still hashed, which is the protection that matters.
    try { chmodSync(this.file, 0o600); } catch { /* not a POSIX filesystem */ }
    // Every existing login was bought with the old password.
    this.sessions.clear();
  }

  /** Constant-time check of a supplied password against the stored one. */
  async check(password: string): Promise<boolean> {
    const credential = this.read();
    if (!credential) return false;
    if (typeof password !== "string" || password.length === 0) return false;
    let supplied: Buffer;
    try {
      supplied = await derive(
        password,
        Buffer.from(credential.salt, "base64"),
        credential.iterations || ITERATIONS,
      );
    } catch {
      return false;
    }
    const stored = Buffer.from(credential.hash, "base64");
    if (supplied.length !== stored.length) return false;
    return crypto.timingSafeEqual(supplied, stored);
  }

  /** Whether a first-time setup attempt from off the machine carried the right code. */
  checkSetupCode(code: unknown): boolean {
    if (typeof code !== "string") return false;
    const supplied = Buffer.from(code.trim().toLowerCase(), "utf8");
    const expected = Buffer.from(this.setupCode, "utf8");
    if (supplied.length !== expected.length) return false;
    return crypto.timingSafeEqual(supplied, expected);
  }

  /** Remove the password entirely. Destruction, so the server only allows it with authority. */
  clear(authorised: boolean): void {
    if (!authorised) {
      throw new RemoteAccessError("Removing the remote password needs the current one, or a request from the machine itself.");
    }
    if (existsSync(this.file)) unlinkSync(this.file);
    this.sessions.clear();
  }

  /** A logged-in session, as an opaque token to hand back in a cookie. */
  openSession(): string {
    this.sweep();
    const token = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
  }

  /** Whether a token names a live session. */
  hasSession(token: unknown): boolean {
    if (typeof token !== "string" || token.length === 0) return false;
    const expires = this.sessions.get(token);
    if (expires === undefined) return false;
    if (expires <= Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  /** Log one session out. Logging out something already gone is not an error. */
  closeSession(token: unknown): void {
    if (typeof token === "string") this.sessions.delete(token);
  }

  /** Number of live sessions, for tests and for telling someone what is logged in. */
  liveSessions(): number {
    this.sweep();
    return this.sessions.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, expires] of this.sessions) {
      if (expires <= now) this.sessions.delete(token);
    }
  }
}

/** Pull one cookie out of a request's Cookie header. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

let shared: RemoteAccessStore | null = null;
/** The one store the running server uses. Tests make their own with a temp file. */
export function getRemoteAccessStore(): RemoteAccessStore {
  if (!shared) shared = new RemoteAccessStore();
  return shared;
}
