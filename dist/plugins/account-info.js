import { BasePlugin } from "../plugin_manager/sdk.js";
import { execFileSync } from "node:child_process";
import { homedir, hostname, userInfo, platform, release, arch, cpus, totalmem, freemem, uptime } from "node:os";
export class AccountInfoPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
    }
    async getInfo() {
        const info = userInfo();
        return {
            username: info.username,
            hostname: hostname(),
            homeDir: homedir(),
            shell: info.shell || "/bin/bash",
            uid: info.uid,
            gid: info.gid,
            platform: platform(),
            release: release(),
            arch: arch(),
            cpuCount: cpus().length,
            totalMemory: totalmem(),
            freeMemory: freemem(),
            uptime: uptime(),
            display: process.env.DISPLAY,
        };
    }
    async getEnv(key) {
        // Regular expression matching potentially sensitive environment variables (keys, secrets, database configs, passwords, tokens, etc.)
        const SENSITIVE_ENV_PATTERN = /key|secret|password|token|auth|pass|credential|cert|cookie|jwt|hash|salt|ssh|database|db_|session|bearer|sig|private/i;
        if (key) {
            if (SENSITIVE_ENV_PATTERN.test(key)) {
                throw new Error(`Security Error: Access to sensitive environment variable is blocked: ${key}`);
            }
            return { [key]: process.env[key] };
        }
        const safeEnv = {};
        for (const k of Object.keys(process.env)) {
            if (!SENSITIVE_ENV_PATTERN.test(k)) {
                safeEnv[k] = process.env[k];
            }
        }
        return safeEnv;
    }
    async whoami() {
        try {
            return execFileSync("whoami", [], { encoding: "utf8", timeout: 3000 }).trim();
        }
        catch {
            return userInfo().username;
        }
    }
}
