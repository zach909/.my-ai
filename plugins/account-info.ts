import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { execSync } from "node:child_process";
import { homedir, hostname, userInfo, platform, release, arch, cpus, totalmem, freemem, uptime } from "node:os";

export interface AccountInfo {
  username: string;
  hostname: string;
  homeDir: string;
  shell: string;
  uid: number;
  gid: number;
  platform: string;
  release: string;
  arch: string;
  cpuCount: number;
  totalMemory: number;
  freeMemory: number;
  uptime: number;
  display?: string;
}

export class AccountInfoPlugin extends BasePlugin {
  constructor(definition: PluginDefinition) {
    super(definition);
  }

  async getInfo(): Promise<AccountInfo> {
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

  async getEnv(key?: string): Promise<Record<string, string | undefined>> {
    if (key) return { [key]: process.env[key] };
    return { ...process.env } as Record<string, string>;
  }

  async whoami(): Promise<string> {
    try {
      return execSync("whoami", { encoding: "utf8", timeout: 3000 }).trim();
    } catch {
      return userInfo().username;
    }
  }
}
