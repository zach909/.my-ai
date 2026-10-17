/**
 * Apps: store items and local programs that call Corona's API.
 *
 * An "app" is anything that is not Corona itself and wants to use it: an item
 * published to the store under the `apps` kind, or a program running on this
 * machine that was never published at all. Both reach Corona the same way,
 * through `/api/corona/v1/*` with a bearer token, and both are held to the
 * same rule the rest of this project follows: nothing is granted by default.
 *
 *   - Installing a store app does NOT give it a token. Publishing shares a
 *     document and installing puts files on this device; letting it call the
 *     agent is a third, separate decision, made by whoever owns the device.
 *   - A token carries scopes. An app can only do what its scopes name, and an
 *     app that came from the store can only be granted scopes its own
 *     `app.json` asked for, so what it asked for is what the owner reviewed.
 *   - The token is shown once, at registration. Only a SHA-256 of it is kept,
 *     which is enough to recognise a token and not enough to learn one.
 *   - Revoking is immediate and permanent for that token.
 *
 * State is per-device and never committed: it is this machine's list of who
 * may call its agent.
 *
 *   ~/.neuroclaw/apps.json     (override: CORONA_APPS_FILE)
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";
export class AppError extends Error {
}
/** Everything an app can be allowed to do. Anything not listed here cannot be granted. */
export const APP_SCOPES = [
    "status", // read whether the agent is up
    "chat", // send the agent a message and read the reply
    "store.read", // browse the public store
    "store.publish", // publish to the public store (it is public: anyone pulling gets it)
    "compute.borrow", // spend this device's compute credits on a peer's computer
    "donor.status", // read the data-donor settings (never the data itself)
];
export const APP_SOURCES = ["store", "program"];
export function appsFile() {
    return process.env.CORONA_APPS_FILE
        ? path.resolve(process.env.CORONA_APPS_FILE)
        : path.join(homedir(), ".neuroclaw", "apps.json");
}
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
function load(file = appsFile()) {
    try {
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        if (!Array.isArray(parsed.apps))
            return [];
        // Unknown scopes are dropped, not carried: a renamed scope must not come
        // back as a grant nothing checks.
        return parsed.apps
            .filter(a => a && typeof a.id === "string" && typeof a.tokenHash === "string")
            .map(a => ({ ...a, scopes: (Array.isArray(a.scopes) ? a.scopes : []).filter(s => APP_SCOPES.includes(s)) }));
    }
    catch {
        // A file we cannot read means nobody is registered, which is the safe answer.
        return [];
    }
}
function save(apps, file = appsFile()) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeJsonAtomic(file, { apps });
    try {
        chmodSync(file, 0o600);
    }
    catch {
        // Not every filesystem has modes; the hashes are not replayable anyway.
    }
}
const pub = ({ tokenHash: _omit, ...rest }) => rest;
export function normalizeScopes(scopes) {
    if (!Array.isArray(scopes))
        throw new AppError("Expected \"scopes\" to be a list.");
    const out = [];
    for (const s of scopes) {
        if (typeof s !== "string" || !APP_SCOPES.includes(s)) {
            throw new AppError(`"${String(s)}" is not a scope. Expected any of: ${APP_SCOPES.join(", ")}.`);
        }
        if (!out.includes(s))
            out.push(s);
    }
    return out;
}
/**
 * What a store app says it needs: the `scopes` list in its `app.json`.
 * Unknown entries are ignored here (an app written for a newer Corona may ask
 * for more than this one has), and an unreadable manifest asks for nothing.
 */
export function requestedScopes(manifestText) {
    if (!manifestText)
        return [];
    try {
        const parsed = JSON.parse(manifestText);
        if (!Array.isArray(parsed.scopes))
            return [];
        return parsed.scopes.filter((s) => typeof s === "string" && APP_SCOPES.includes(s));
    }
    catch {
        return [];
    }
}
/** Register an app and return its token. This is the only time the token exists in the clear. */
export function registerApp(input, file = appsFile()) {
    if (typeof input.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(input.name)) {
        throw new AppError("An app name is letters, digits, spaces, '.', '-' and '_', up to 64 characters.");
    }
    if (!APP_SOURCES.includes(input.source)) {
        throw new AppError(`"source" must be one of: ${APP_SOURCES.join(", ")}.`);
    }
    const scopes = normalizeScopes(input.scopes);
    if (input.source === "store") {
        if (!input.storeItem)
            throw new AppError("A store app needs the \"storeItem\" it came from.");
        const over = scopes.filter(s => !(input.requested ?? []).includes(s));
        if (over.length > 0) {
            throw new AppError(`This app never asked for: ${over.join(", ")}. A store app can only be granted what its app.json requested.`);
        }
    }
    const apps = load(file);
    if (apps.some(a => !a.revokedAt && a.name.toLowerCase() === input.name.toLowerCase())) {
        throw new AppError(`An app called "${input.name}" is already registered. Revoke it first to issue a new token.`);
    }
    const token = `ca_${randomBytes(32).toString("base64url")}`;
    const record = {
        id: randomBytes(8).toString("hex"),
        name: input.name,
        source: input.source,
        ...(input.storeItem ? { storeItem: input.storeItem } : {}),
        scopes,
        tokenHash: hashToken(token),
        createdAt: Date.now(),
        lastUsedAt: null,
        revokedAt: null,
    };
    apps.push(record);
    save(apps, file);
    return { app: pub(record), token };
}
export function listApps(file = appsFile()) {
    return load(file).map(pub);
}
export function revokeApp(id, file = appsFile()) {
    const apps = load(file);
    const app = apps.find(a => a.id === id && !a.revokedAt);
    if (!app)
        return false;
    app.revokedAt = Date.now();
    save(apps, file);
    return true;
}
/** Narrow or widen what a registered app may do. A revoked app cannot be changed. */
export function setAppScopes(id, scopes, requested, file = appsFile()) {
    const next = normalizeScopes(scopes);
    const apps = load(file);
    const app = apps.find(a => a.id === id && !a.revokedAt);
    if (!app)
        throw new AppError("No such app.");
    if (app.source === "store") {
        const over = next.filter(s => !(requested ?? []).includes(s));
        if (over.length > 0)
            throw new AppError(`This app never asked for: ${over.join(", ")}.`);
    }
    app.scopes = next;
    save(apps, file);
    return pub(app);
}
/** Pulls a bearer token out of an Authorization header. */
export function bearerToken(header) {
    const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
    return m ? m[1] : null;
}
/** Remember last-use at most this often, so a busy app is not a disk write per request. */
const TOUCH_INTERVAL_MS = 60000;
/** The app a token belongs to, or null. Revoked apps never authenticate. */
export function authenticateApp(token, file = appsFile()) {
    if (!token || token.length > 256)
        return null;
    const want = Buffer.from(hashToken(token), "hex");
    const apps = load(file);
    let found = null;
    // Walk every record rather than stopping at the first match, so the time
    // taken does not say which position a token sits in.
    for (const a of apps) {
        const have = Buffer.from(a.tokenHash, "hex");
        if (have.length === want.length && timingSafeEqual(have, want) && !a.revokedAt)
            found = a;
    }
    if (!found)
        return null;
    const now = Date.now();
    if (found.lastUsedAt === null || now - found.lastUsedAt > TOUCH_INTERVAL_MS) {
        found.lastUsedAt = now;
        try {
            save(apps, file);
        }
        catch {
            // Bookkeeping never gets to refuse a legitimate call.
        }
    }
    return pub(found);
}
export const appAllows = (app, scope) => app.scopes.includes(scope);
/** A fixed-window limiter per app, in memory. Resets on restart, which is fine for a courtesy limit. */
export class AppRateLimiter {
    constructor(perMinute = 120, now = Date.now) {
        this.perMinute = perMinute;
        this.now = now;
        this.hits = new Map();
    }
    allow(appId) {
        const t = this.now();
        const h = this.hits.get(appId);
        if (!h || t - h.windowStart >= 60000) {
            this.hits.set(appId, { windowStart: t, count: 1 });
            return true;
        }
        h.count++;
        return h.count <= this.perMinute;
    }
}
