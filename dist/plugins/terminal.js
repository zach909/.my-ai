/**
 * Terminal plugin — execute shell commands with output capture.
 *
 * Runs commands via a real subprocess. A best-effort blocklist rejects the
 * specific destructive patterns named below (rm -rf on a root-like path,
 * mkfs, a fork bomb, shutdown/reboot/halt/poweroff, dd writing to a raw
 * disk device) before handing the command to the shell. This is NOT a
 * security boundary: a blocklist over free-form shell text can never
 * enumerate every way to destroy a filesystem (a node one-liner,
 * `find -delete`, `truncate`, overwriting a device via `cp`, ...), and
 * quoting/escaping/subshells can obscure a command from these patterns
 * entirely. Treat this as a guardrail against the most common catastrophic
 * accidents, not protection against a deliberately hostile command.
 *
 * Ported from the (already real, already tested) Python track's
 * plugins/plugin_terminal.py so the same guardrail logic and tool surface
 * (run/run_bg/which/env) exists on the live TS/web app side too, where
 * 'terminal' was already referenced as a dispatch candidate (plugin_manager/
 * registry.ts's intentToPlugins `command` bucket) but never actually
 * implemented or registered.
 */
import { exec, spawn, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { BasePlugin } from "../plugin_manager/sdk.js";
const execAsync = promisify(exec);
const FORK_BOMB = /:\(\)\{\s*[:\s|&]+\};:/;
const DANGEROUS_SIMPLE = /\bmkfs|\bshutdown|\breboot|\bhalt|\bpoweroff/i;
const DD_RAW_DISK = /\bdd\b.*\bof=\/dev\/(sd[a-z]|nvme|mmcblk)/i;
const SENSITIVE_ENV_PATTERN = /key|secret|password|token|auth|pass|credential|cert|cookie|jwt|hash|salt|ssh|database|db_|session|bearer|sig|private/i;
// `rm -rf /` matched literally would miss trivial variants: trailing
// content after the slash (`rm -rf /*`, `rm -rf //`), reordered short
// flags (`rm -fr`), separated flags (`rm -r -f`), and long-form flags
// (`rm --recursive --force`). Matched independently instead, mirroring
// plugin_terminal.py's _is_blocked() exactly: the command name `rm`, a
// recursive indicator, a force indicator, and a root-like target (just
// slashes, optionally followed by a wildcard or single `.`) can each
// appear anywhere in the string and in any order/spacing.
const RM_CMD = /\brm\b/i;
const RM_RECURSIVE = /(?<![\w-])-[a-zA-Z]*r[a-zA-Z]*(?![\w-])|--recursive\b/i;
const RM_FORCE = /(?<![\w-])-[a-zA-Z]*f[a-zA-Z]*(?![\w-])|--force\b/i;
const ROOT_LIKE_PATH = /(?<!\S)\/+[*.]{0,3}(?=\s|$|;|&|\|)/;
export function isBlockedCommand(cmd) {
    if (FORK_BOMB.test(cmd) || DANGEROUS_SIMPLE.test(cmd) || DD_RAW_DISK.test(cmd))
        return true;
    if (RM_CMD.test(cmd) && RM_RECURSIVE.test(cmd) && RM_FORCE.test(cmd) && ROOT_LIKE_PATH.test(cmd))
        return true;
    return false;
}
export class TerminalPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.bgProcs = [];
    }
    async run(cmd, opts = {}) {
        if (isBlockedCommand(cmd)) {
            return { stdout: "", stderr: "", returncode: null, error: "Blocked: destructive command pattern detected" };
        }
        try {
            const { stdout, stderr } = await execAsync(cmd, {
                cwd: opts.cwd,
                timeout: opts.timeoutMs ?? 30000,
            });
            return { stdout, stderr, returncode: 0 };
        }
        catch (err) {
            const e = err;
            if (e.killed) {
                return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", returncode: null, error: `Timeout after ${(opts.timeoutMs ?? 30000) / 1000}s` };
            }
            return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", returncode: typeof e.code === "number" ? e.code : null, error: e.message };
        }
    }
    /** Starts a background process, returns its PID. Throws if blocked. */
    runBg(cmd, cwd) {
        if (isBlockedCommand(cmd)) {
            throw new Error("Blocked: destructive command pattern detected");
        }
        const proc = spawn(cmd, { shell: true, cwd, stdio: "ignore" });
        this.bgProcs.push(proc);
        if (proc.pid === undefined)
            throw new Error("Failed to start background process");
        return proc.pid;
    }
    which(name) {
        return execWhichSync(name);
    }
    env(varName) {
        if (varName) {
            if (SENSITIVE_ENV_PATTERN.test(varName)) {
                throw new Error(`Security Error: Access to sensitive environment variable is blocked: ${varName}`);
            }
            return { [varName]: process.env[varName] };
        }
        const safeEnv = {};
        for (const [k, v] of Object.entries(process.env)) {
            if (!SENSITIVE_ENV_PATTERN.test(k))
                safeEnv[k] = v;
        }
        return safeEnv;
    }
    /**
     * Colon is optional -- "run: ls -la" and "run ls -la" both work, so
     * "you say run and then you say [the] command" (however it's punctuated)
     * reaches real execution. Returns null (not the echoed input) when the
     * message isn't actually a run-prefixed command, so dispatch()'s
     * 'command' bucket correctly falls through to the next candidate
     * (skill-maker/wiki/etc for "make a skill"-shaped messages) instead of
     * this plugin trivially "succeeding" on everything routed to it.
     */
    async onMessage(message) {
        const input = typeof message === "string" ? message : String(message ?? "");
        const m = input.match(/^(run|exec|execute|shell|terminal)\s*:?\s+([\s\S]+)$/i);
        if (!m)
            return null;
        return this.run(m[2]);
    }
    async onHealthCheck() {
        return this.active;
    }
}
/** Cross-platform `which`/`where` lookup, matching Python's shutil.which() semantics (returns null rather than throwing when the binary isn't found). */
function execWhichSync(name) {
    const cmd = process.platform === "win32" ? "where" : "which";
    try {
        const out = execFileSync(cmd, [name], { encoding: "utf8" }).trim();
        return out.split(/\r?\n/)[0] || null;
    }
    catch {
        return null;
    }
}
