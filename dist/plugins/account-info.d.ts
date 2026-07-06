import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
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
export declare class AccountInfoPlugin extends BasePlugin {
    constructor(definition: PluginDefinition);
    getInfo(): Promise<AccountInfo>;
    getEnv(key?: string): Promise<Record<string, string | undefined>>;
    whoami(): Promise<string>;
}
