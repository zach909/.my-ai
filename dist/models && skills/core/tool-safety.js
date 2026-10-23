/**
 * Risky tools: the ones that ask first instead of just going.
 *
 * The agent can do real things to your computer and your life: run commands,
 * change files, send email, make calls, see through the camera. Access
 * (access-manager.ts) already decides what it is ALLOWED to do. This is the
 * other half: for the tools below, being allowed is not enough. The call is held
 * until you say yes, one call at a time.
 *
 * ── How a call is held ─────────────────────────────────────────────────
 *
 * When the agent is about to use a risky tool, the plugin registry asks
 * ToolGate.check(). If the tool needs approval, the tool is NOT run. Instead:
 *
 *   - the request is put in a queue of pending approvals (what tool, what it was
 *     asked to do, when),
 *   - the agent's reply says it is waiting for permission,
 *   - nothing happens until the owner approves it in Settings. Approving runs
 *     that one call once. Denying throws it away.
 *
 * Asking is decided before the tool runs, from how strongly the message points
 * at the tool, so an occasional question about a tool the agent would not
 * actually have used still comes up for approval. That is the safe side to err
 * on: an unneeded question costs a click, an unasked action cannot be undone.
 *
 * ── Complete access ────────────────────────────────────────────────────
 *
 * One setting turns the asking off and grants every capability at every level.
 * It is the setting for someone who wants the agent to just do things. It takes
 * a typed acknowledgement to switch on, and turning it off puts the previous
 * access settings back to the defaults. The only thing it does not change is the
 * rule that the agent never controls the window you are using: that is not a
 * permission level, it is not a capability that exists (access-manager.ts).
 *
 * ── What this does NOT do (stated plainly) ─────────────────────────────
 *
 * It sits on the plugin path, where chat and the experts reach tools. The Access
 * layer's own checks still stand on their own and are not weakened by it, and a
 * tool nobody listed as risky does not ask. The list is data, not a promise
 * that everything not on it is safe: it is meant to be edited.
 *
 * Settings: config/tool-safety.json (override CORONA_SAFETY_FILE).
 * Pending approvals live in memory only, so a restart denies everything waiting.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";
import { configFile } from "../../interface/platform/app-paths.js";
import { ACCESS_SWITCHES, CAPABILITIES } from "./access-manager.js";
import { defaultSettings, saveSettings } from "./access-settings.js";
import { USER_PLUGINS } from "./accounts.js";
import { isOwnerOrAdmin } from "./user-context.js";
/**
 * The tools that ask first. Roughly: anything that changes the outside world or
 * the machine, speaks for you, or looks at you or your private data.
 */
export const RISKY_TOOLS = [
    { id: "terminal", label: "Terminal", why: "Runs commands on your computer.", level: "high" },
    { id: "desktop", label: "Desktop control", why: "Clicks, types and opens windows for you.", level: "high" },
    { id: "multi-input", label: "Mouse and keyboard", why: "Drives your mouse and keyboard.", level: "high" },
    { id: "computer-access", label: "Computer access", why: "Changes what the agent is allowed to reach.", level: "high" },
    { id: "file-system", label: "File system", why: "Reads, writes and deletes your files.", level: "high" },
    { id: "linux-permission-tools", label: "Linux permissions", why: "Changes system permissions, services and security policy.", level: "high" },
    { id: "email", label: "Email", why: "Sends email in your name.", level: "high" },
    { id: "messaging", label: "Messaging", why: "Sends messages in your name.", level: "high" },
    { id: "phone-calls", label: "Phone calls", why: "Places calls from your phone.", level: "high" },
    { id: "passkeys", label: "Passkeys", why: "Uses your sign-in credentials.", level: "high" },
    { id: "robotics", label: "Robotics", why: "Moves physical hardware.", level: "high" },
    { id: "robotics-api", label: "Robotics", why: "Moves physical hardware.", level: "high" },
    { id: "github-publish", label: "Publish to GitHub", why: "Pushes your work out to a public place.", level: "high" },
    { id: "store", label: "Store", why: "Publishes and installs things that run on your computer.", level: "high" },
    { id: "plugin-maker", label: "Plugin maker", why: "Writes new code that the agent then runs.", level: "high" },
    { id: "skill-maker", label: "Skill maker", why: "Writes new skills the agent then uses.", level: "medium" },
    { id: "self-heal", label: "Self repair", why: "Changes the agent's own files.", level: "high" },
    { id: "other-devices", label: "Other devices", why: "Reaches your other computers and phones.", level: "high" },
    { id: "radios", label: "Radios", why: "Turns Bluetooth, Wi-Fi and other radios on and off.", level: "medium" },
    { id: "browser", label: "Browser", why: "Opens pages and acts on the web as you.", level: "medium" },
    { id: "camera", label: "Camera", why: "Looks through your camera.", level: "high" },
    { id: "microphone", label: "Microphone", why: "Listens through your microphone.", level: "high" },
    { id: "screenshots", label: "Screen capture", why: "Sees and records your screen.", level: "high" },
    { id: "location", label: "Location", why: "Reads where you are.", level: "medium" },
    { id: "contacts", label: "Contacts", why: "Reads or changes your contacts.", level: "medium" },
    { id: "calendar", label: "Calendar", why: "Reads or changes your calendar.", level: "medium" },
    { id: "call-history", label: "Call history", why: "Reads who you have called.", level: "medium" },
    { id: "account-info", label: "Account info", why: "Reads details of your accounts.", level: "medium" },
];
const RISK_BY_ID = new Map(RISKY_TOOLS.map(t => [t.id, t]));
/** A tool's id the way the registry and the list spell it. */
export const normalizeToolId = (id) => String(id ?? "").toLowerCase().trim().replace(/\s+/g, "-");
/** How strongly a message has to point at a tool before it is held. One matching word is enough; the router scores each at 4. */
export const HOLD_SCORE = 4;
// ── Settings ───────────────────────────────────────────────────────────
export const MAX_CONTINUE_STEPS = 10;
export const DEFAULT_CONTINUE_STEPS = 3;
export const defaultSafety = () => ({ fullAccess: false, ask: {}, autoContinue: { enabled: true, maxSteps: DEFAULT_CONTINUE_STEPS } });
/** Saved in the user's data folder (see interface/platform/app-paths.ts), not the working directory. */
export function safetyFile() {
    return configFile("tool-safety.json", process.env.CORONA_SAFETY_FILE).write;
}
function safetyReadFile() {
    return configFile("tool-safety.json", process.env.CORONA_SAFETY_FILE).read;
}
/** Never throws. A file we cannot read means the safe defaults (everything on the list asks), never "ask nothing". */
export function loadSafety(file = safetyReadFile()) {
    const d = defaultSafety();
    if (!existsSync(file))
        return d;
    try {
        const raw = JSON.parse(readFileSync(file, "utf8"));
        const ask = {};
        for (const [id, v] of Object.entries(raw.ask ?? {}))
            if (typeof v === "boolean" && /^[a-z0-9-]{1,48}$/.test(id))
                ask[id] = v;
        const steps = raw.autoContinue?.maxSteps;
        return {
            fullAccess: raw.fullAccess === true,
            ask,
            autoContinue: {
                enabled: raw.autoContinue?.enabled !== false,
                maxSteps: typeof steps === "number" && Number.isFinite(steps) ? Math.min(MAX_CONTINUE_STEPS, Math.max(1, Math.round(steps))) : DEFAULT_CONTINUE_STEPS,
            },
        };
    }
    catch {
        return d;
    }
}
export function saveSafety(s, file = safetyFile()) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeJsonAtomic(file, s);
}
/** Whether a tool is held for approval under these settings. */
export function needsApproval(toolId, s) {
    const id = normalizeToolId(toolId);
    if (s.fullAccess)
        return false;
    return RISK_BY_ID.has(id) && s.ask[id] !== false;
}
export function describeTools(s) {
    return RISKY_TOOLS.map(t => ({ ...t, ask: needsApproval(t.id, s) }));
}
export class SafetyError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_APPROVALS = 50;
const MAX_REQUEST_CHARS = 600;
export class ToolGate {
    constructor(opts = {}) {
        this.opts = opts;
        this.approvals = [];
    }
    now() {
        return (this.opts.now ?? Date.now)();
    }
    settings() {
        return this.opts.settings ? this.opts.settings() : loadSafety(this.opts.file);
    }
    sweep() {
        const now = this.now();
        for (const a of this.approvals)
            if (a.status === "pending" && now - a.requestedAt > APPROVAL_TTL_MS)
                a.status = "expired";
        if (this.approvals.length > MAX_APPROVALS)
            this.approvals = this.approvals.slice(-MAX_APPROVALS);
    }
    /**
     * Decides before the tool runs. A message that does not clearly point at the
     * tool (low score) is not held: it would not have been this tool's to do.
     */
    check(pluginId, input, score, acts) {
        // The plugin knows whether it will act; the router's score is only a ranking.
        // A plugin that says it will act is held however weakly the router scored it,
        // and one that says it will not is not held however strongly it scored.
        const pointed = acts === undefined ? score >= HOLD_SCORE : acts;
        // Plugins act as the machine's owner. Anyone who is not the admin may use only
        // the ones that touch neither the owner's computer nor the owner's data
        // (accounts.ts USER_PLUGINS); the rest are not even offered an approval.
        // Weak matches are let through only so ordinary chat is not refused for
        // sounding a little like a tool.
        if (!isOwnerOrAdmin() && pointed && !USER_PLUGINS.includes(normalizeToolId(pluginId))) {
            return { allow: false, approvalId: "", message: `[Not allowed] ${RISK_BY_ID.get(normalizeToolId(pluginId))?.label ?? pluginId} is for the admin only.` };
        }
        const s = this.settings();
        if (!needsApproval(pluginId, s) || !pointed)
            return { allow: true };
        this.sweep();
        const id = normalizeToolId(pluginId);
        const request = String(input ?? "").slice(0, MAX_REQUEST_CHARS);
        // Asking twice for the same thing is one question, not two.
        let a = this.approvals.find(x => x.status === "pending" && x.toolId === id && x.request === request);
        if (!a) {
            a = { id: randomBytes(5).toString("hex"), toolId: id, label: RISK_BY_ID.get(id)?.label ?? id, request, requestedAt: this.now(), status: "pending", decidedAt: null, result: null };
            this.approvals.push(a);
        }
        return {
            allow: false,
            approvalId: a.id,
            message: `[Waiting for your permission] ${a.label} is a risky tool, so it asks first: "${request.slice(0, 160)}". Nothing has been done. Approve or deny it in Settings (request ${a.id}).`,
        };
    }
    list() {
        this.sweep();
        return this.approvals.slice().reverse();
    }
    pending() {
        return this.list().filter(a => a.status === "pending");
    }
    get(id) {
        return this.approvals.find(a => a.id === id) ?? null;
    }
    /**
     * Decide one request. Approving runs it ONCE through `run` (the registry's
     * ungated call) and keeps what came back. A request that is not pending
     * cannot be decided again, so a double click cannot run a tool twice.
     */
    async decide(id, approve, run) {
        this.sweep();
        const a = this.get(id);
        if (!a)
            throw new SafetyError("No such request.", 404);
        if (a.status !== "pending")
            throw new SafetyError(`That request was already ${a.status}.`, 409);
        a.decidedAt = this.now();
        if (!approve) {
            a.status = "denied";
            return a;
        }
        a.status = "approved";
        try {
            const out = await run(a.toolId, a.request);
            a.result = out === null ? "That tool did not need to do anything for this request." : out.slice(0, 2000);
        }
        catch (err) {
            a.result = `It failed: ${err instanceof Error ? err.message : String(err)}`;
        }
        return a;
    }
}
let shared = null;
/** The one gate the running system uses. */
export function sharedToolGate() {
    if (!shared)
        shared = new ToolGate();
    return shared;
}
export function resetSharedToolGate() {
    shared = null;
}
// ── Complete access ────────────────────────────────────────────────────
/** What a person has to type to turn complete access on, so it cannot happen by a stray click or a forged request. */
export const COMPLETE_ACCESS_PHRASE = "give it complete access";
/**
 * Turns on complete access: no questions, every switch on, every capability
 * granted at the highest level. Takes a typed phrase.
 */
export function enableCompleteAccess(manager, phrase, file = safetyFile(), accessFile) {
    if (typeof phrase !== "string" || phrase.trim().toLowerCase() !== COMPLETE_ACCESS_PHRASE) {
        throw new SafetyError(`To turn on complete access, type exactly: ${COMPLETE_ACCESS_PHRASE}`);
    }
    for (const name of ACCESS_SWITCHES)
        manager.setSwitch(name, true);
    for (const capability of CAPABILITIES)
        manager.grant({ capability, level: "privileged" });
    saveSettings({ switches: manager.switchState(), grants: manager.list() }, accessFile);
    const s = { ...loadSafety(file), fullAccess: true };
    saveSafety(s, file);
    return s;
}
/** Puts the questions back and the access settings back to their defaults. */
export function disableCompleteAccess(manager, file = safetyFile(), accessFile) {
    const defaults = defaultSettings();
    for (const name of ACCESS_SWITCHES)
        manager.setSwitch(name, defaults.switches[name]);
    for (const capability of CAPABILITIES)
        manager.revoke(capability);
    for (const g of defaults.grants)
        manager.grant(g);
    saveSettings({ switches: manager.switchState(), grants: manager.list() }, accessFile);
    const s = { ...loadSafety(file), fullAccess: false };
    saveSafety(s, file);
    return s;
}
export function setAsk(toolId, ask, file = safetyFile()) {
    const id = normalizeToolId(toolId);
    if (!RISK_BY_ID.has(id))
        throw new SafetyError("That tool is not on the list.", 404);
    const s = loadSafety(file);
    s.ask[id] = ask === true;
    saveSafety(s, file);
    return s;
}
export function setAutoContinue(patch, file = safetyFile()) {
    const s = loadSafety(file);
    if (patch.enabled !== undefined)
        s.autoContinue.enabled = patch.enabled === true;
    if (patch.maxSteps !== undefined) {
        if (typeof patch.maxSteps !== "number" || !Number.isFinite(patch.maxSteps) || patch.maxSteps < 1 || patch.maxSteps > MAX_CONTINUE_STEPS)
            throw new SafetyError(`It may chain 1 to ${MAX_CONTINUE_STEPS} steps.`);
        s.autoContinue.maxSteps = Math.round(patch.maxSteps);
    }
    saveSafety(s, file);
    return s;
}
