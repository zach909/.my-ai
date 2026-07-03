import { BasePlugin } from "../plugin_manager/sdk.js";
import { execSync } from "node:child_process";
import { cpus, totalmem, freemem, loadavg, uptime } from "node:os";
export class AppDiagnosticsPlugin extends BasePlugin {
    constructor(definition) { super(definition); }
    async runDiagnostics() {
        const cpuInfo = cpus();
        const load = loadavg();
        return {
            cpu: {
                model: cpuInfo[0]?.model ?? "unknown",
                cores: cpuInfo.length,
                load,
                usage: this.getCpuUsage(),
            },
            memory: {
                total: totalmem(),
                free: freemem(),
                used: totalmem() - freemem(),
                percentUsed: ((totalmem() - freemem()) / totalmem()) * 100,
            },
            system: {
                uptime: uptime(),
                processes: this.getProcessCount(),
            },
            timestamp: Date.now(),
        };
    }
    async checkDisk() {
        try {
            const out = execSync("df -B1 / /home 2>/dev/null", { encoding: "utf8", timeout: 5000 });
            const lines = out.trim().split("\n").slice(1);
            const result = {};
            for (const line of lines) {
                const parts = line.split(/\s+/);
                if (parts.length >= 6) {
                    result[parts[5]] = {
                        total: parseInt(parts[1]),
                        used: parseInt(parts[2]),
                        free: parseInt(parts[3]),
                        percent: parseFloat(parts[4].replace("%", "")),
                    };
                }
            }
            return result;
        }
        catch {
            return {};
        }
    }
    getCpuUsage() {
        const c = cpus();
        let totalIdle = 0, totalTick = 0;
        for (const cpu of c) {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        }
        return 100 - (totalIdle / totalTick) * 100;
    }
    getProcessCount() {
        try {
            const out = execSync("ps -e --no-headers 2>/dev/null | wc -l", { encoding: "utf8", timeout: 3000 });
            return parseInt(out.trim()) || 0;
        }
        catch {
            return 0;
        }
    }
}
