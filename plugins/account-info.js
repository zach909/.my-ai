import { BasePlugin } from "../plugin_manager/sdk";
import { execSync } from "node:child_process";
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
        if (key)
            return { [key]: process.env[key] };
        return { ...process.env };
    }
    async whoami() {
        try {
            return execSync("whoami", { encoding: "utf8", timeout: 3000 }).trim();
        }
        catch {
            return userInfo().username;
        }
    }
}
