/**
 * HTTP routes for accounts: set up the admin, sign up, log in, and (for the
 * admin) manage everyone else.
 *
 *   GET  /api/accounts/status                 public: is there an admin, is signup open, who am I
 *   POST /api/accounts/setup                  public: make the FIRST account (the admin)
 *   POST /api/accounts/register               public: make an account, if signup is open
 *   POST /api/accounts/login                  public
 *   POST /api/accounts/logout
 *   GET  /api/accounts/me
 *   POST /api/accounts/password               {oldPassword, newPassword}  your own
 *
 *   admin only:
 *   GET  /api/accounts/users                  everyone, and the settings
 *   POST /api/accounts/users                  {name, password}  make an account, whatever the signup mode
 *   POST /api/accounts/users/:id/(disable|enable)
 *   POST /api/accounts/users/:id/password     {password}  set someone's password
 *   POST /api/accounts/users/:id/delete       {purge?}  remove an account; its data only if purge is true
 *   POST /api/accounts/settings               {signup?: "open"|"invite", learnFromUsers?: boolean}
 *
 * Every POST reads a JSON body (parseBody insists on a JSON content type, the
 * server's guard against another tab posting here). A wrong name and a wrong
 * password get the same answer, and repeated wrong passwords lock the name for a
 * minute (accounts.ts).
 */
import { AccountError, MAX_PASSWORD_LENGTH, SESSION_TTL_MS, USER_COOKIE } from "../models && skills/core/accounts.js";
import { isOwnerOrAdmin, who as currentWho } from "../models && skills/core/user-context.js";
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
export const isAccountsRoute = (pathname) => pathname.startsWith("/api/accounts/");
/** Routes that must answer to someone who is not logged in: that is how they log in. */
export function isAccountsPublicRoute(pathname, method) {
    if (method === "GET")
        return pathname === "/api/accounts/status" || pathname === "/accounts";
    return method === "POST" && ["/api/accounts/setup", "/api/accounts/register", "/api/accounts/login", "/api/accounts/logout"].includes(pathname);
}
function cookie(res, token) {
    res.setHeader("Set-Cookie", token === null
        ? `${USER_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
        : `${USER_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}
const describe = (w) => w.kind === "user" ? { kind: "user", name: w.name, role: w.role } : w.kind === "owner" ? { kind: "owner", name: null, role: "admin" } : { kind: "anonymous", name: null, role: null };
/** Returns true when the route was handled. */
export async function handleAccountsRoutes(ctx) {
    if (!isAccountsRoute(ctx.pathname))
        return false;
    try {
        return await route(ctx);
    }
    catch (err) {
        const status = err instanceof AccountError ? err.status : typeof err?.status === "number" ? err.status : 500;
        ctx.sendJson(ctx.res, { error: err instanceof Error ? err.message : String(err) }, status);
        return true;
    }
}
async function route(ctx) {
    const { pathname, method, req, res, accounts } = ctx;
    const send = (data, status = 200) => {
        ctx.sendJson(res, data, status);
        return true;
    };
    const body = async () => {
        const b = await ctx.parseBody(req, 8 * 1024);
        if (!isObj(b))
            throw new AccountError("Expected a JSON object.");
        return b;
    };
    const str = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
    const me = currentWho();
    const admin = () => {
        if (!isOwnerOrAdmin())
            throw new AccountError("Only the admin can do that.", 403);
    };
    if (pathname === "/api/accounts/status" && method === "GET") {
        return send({ hasAdmin: accounts.hasAdmin(), signup: accounts.signupMode(), me: describe(me), onThisMachine: ctx.fromThisMachine(req) });
    }
    if (pathname === "/api/accounts/setup" && method === "POST") {
        const b = await body();
        const authorised = ctx.fromThisMachine(req) || ctx.setupCodeOk(b.setupCode);
        const user = await accounts.setupAdmin(str(b.name, 40), str(b.password, MAX_PASSWORD_LENGTH + 1), authorised);
        ctx.onSetup();
        const { token } = await accounts.login(user.name, str(b.password, MAX_PASSWORD_LENGTH + 1));
        cookie(res, token);
        return send({ user }, 201);
    }
    if (pathname === "/api/accounts/register" && method === "POST") {
        const b = await body();
        const user = await accounts.register(str(b.name, 40), str(b.password, MAX_PASSWORD_LENGTH + 1));
        const { token } = await accounts.login(user.name, str(b.password, MAX_PASSWORD_LENGTH + 1));
        cookie(res, token);
        return send({ user }, 201);
    }
    if (pathname === "/api/accounts/login" && method === "POST") {
        const b = await body();
        const { token, user } = await accounts.login(str(b.name, 40), str(b.password, MAX_PASSWORD_LENGTH + 1));
        cookie(res, token);
        return send({ user });
    }
    if (pathname === "/api/accounts/logout" && method === "POST") {
        await body();
        accounts.logout(ctx.token(req));
        cookie(res, null);
        return send({ loggedOut: true });
    }
    if (pathname === "/api/accounts/me" && method === "GET")
        return send({ me: describe(me) });
    if (pathname === "/api/accounts/password" && method === "POST") {
        const b = await body();
        if (me.kind !== "user")
            throw new AccountError("You are not signed in with an account.", 400);
        await accounts.changeOwnPassword(me.id, str(b.oldPassword, MAX_PASSWORD_LENGTH + 1), str(b.newPassword, MAX_PASSWORD_LENGTH + 1));
        cookie(res, null); // every login, this one included, ended with the old password
        return send({ changed: true, loginAgain: true });
    }
    // ── The admin's controls ─────────────────────────────────────────────
    if (pathname === "/api/accounts/users" && method === "GET") {
        admin();
        return send({ users: accounts.listUsers(), signup: accounts.signupMode(), learnFromUsers: accounts.learnFromUsers(), liveLogins: accounts.liveSessions() });
    }
    if (pathname === "/api/accounts/users" && method === "POST") {
        admin();
        const b = await body();
        return send({ user: await accounts.createUser(str(b.name, 40), str(b.password, MAX_PASSWORD_LENGTH + 1)) }, 201);
    }
    if (pathname === "/api/accounts/settings" && method === "POST") {
        admin();
        const b = await body();
        if (b.signup !== undefined)
            accounts.setSignup(b.signup);
        if (b.learnFromUsers !== undefined)
            accounts.setLearnFromUsers(b.learnFromUsers === true);
        return send({ signup: accounts.signupMode(), learnFromUsers: accounts.learnFromUsers() });
    }
    const m = /^\/api\/accounts\/users\/([a-f0-9]{8})\/(disable|enable|password|delete)$/.exec(pathname);
    if (m && method === "POST") {
        admin();
        const b = await body();
        if (m[2] === "disable" || m[2] === "enable")
            return send({ user: accounts.setDisabled(m[1], m[2] === "disable") });
        if (m[2] === "password")
            return send({ user: await accounts.resetPassword(m[1], str(b.password, MAX_PASSWORD_LENGTH + 1)) });
        return send({ deleted: accounts.deleteUser(m[1], b.purge === true) });
    }
    return false;
}
