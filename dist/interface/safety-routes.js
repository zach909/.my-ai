/**
 * HTTP routes for risky tools, approvals, complete access and auto-continue.
 *
 * Owner routes, behind the server's normal gate. They decide what the agent may
 * do on this computer, so every POST reads a JSON body (parseBody insists on a
 * JSON content type, which is the server's guard against another tab posting
 * here), and turning complete access on needs a typed phrase on top of that.
 *
 *   GET  /api/safety                      settings, the risky tools, approvals
 *   POST /api/safety/tools                {id, ask}            ask first, or not, for one tool
 *   POST /api/safety/complete-access      {on, phrase?}        everything on, no questions; or back to defaults
 *   POST /api/safety/auto-continue        {enabled?, maxSteps?}
 *   POST /api/safety/approvals/:id/(approve|deny)
 */
import { COMPLETE_ACCESS_PHRASE, MAX_CONTINUE_STEPS, SafetyError, describeTools, disableCompleteAccess, enableCompleteAccess, loadSafety, setAsk, setAutoContinue, } from "../models && skills/core/tool-safety.js";
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
export const isSafetyRoute = (pathname) => pathname === "/api/safety" || pathname.startsWith("/api/safety/");
function snapshot(ctx) {
    const s = loadSafety();
    return {
        fullAccess: s.fullAccess,
        completeAccessPhrase: COMPLETE_ACCESS_PHRASE,
        autoContinue: { ...s.autoContinue, max: MAX_CONTINUE_STEPS },
        tools: describeTools(s),
        approvals: ctx.gate.list().slice(0, 30),
    };
}
/** Returns true when the route was handled. */
export async function handleSafetyRoutes(ctx) {
    if (!isSafetyRoute(ctx.pathname))
        return false;
    try {
        return await route(ctx);
    }
    catch (err) {
        const status = err instanceof SafetyError ? err.status : typeof err?.status === "number" ? err.status : 500;
        ctx.sendJson(ctx.res, { error: err instanceof Error ? err.message : String(err) }, status);
        return true;
    }
}
async function route(ctx) {
    const { pathname, method, req, res } = ctx;
    const send = (data, status = 200) => {
        ctx.sendJson(res, data, status);
        return true;
    };
    const body = async () => {
        const b = await ctx.parseBody(req, 4096);
        if (!isObj(b))
            throw new SafetyError("Expected a JSON object.");
        return b;
    };
    if (pathname === "/api/safety" && method === "GET")
        return send(snapshot(ctx));
    if (pathname === "/api/safety/tools" && method === "POST") {
        const b = await body();
        if (typeof b.ask !== "boolean")
            throw new SafetyError('Expected {"id": "...", "ask": true|false}.');
        setAsk(String(b.id ?? ""), b.ask);
        return send(snapshot(ctx));
    }
    if (pathname === "/api/safety/auto-continue" && method === "POST") {
        const b = await body();
        setAutoContinue({ enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, maxSteps: b.maxSteps === undefined ? undefined : Number(b.maxSteps) });
        return send(snapshot(ctx));
    }
    if (pathname === "/api/safety/complete-access" && method === "POST") {
        const b = await body();
        const manager = await ctx.access();
        if (!manager)
            throw new SafetyError("The access layer is not available here.", 503);
        if (b.on === true)
            enableCompleteAccess(manager, b.phrase);
        else if (b.on === false)
            disableCompleteAccess(manager);
        else
            throw new SafetyError('Expected {"on": true|false}.');
        return send(snapshot(ctx));
    }
    const decision = /^\/api\/safety\/approvals\/([a-f0-9]{10})\/(approve|deny)$/.exec(pathname);
    if (decision && method === "POST") {
        await body();
        const approval = await ctx.gate.decide(decision[1], decision[2] === "approve", (tool, request) => ctx.runApproved(tool, request));
        return send({ approval, ...snapshot(ctx) });
    }
    return false;
}
