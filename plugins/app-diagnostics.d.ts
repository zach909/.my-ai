import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
export interface DiagnosticReport {
    cpu: {
        model: string;
        cores: number;
        load: number[];
        usage: number;
    };
    memory: {
        total: number;
        free: number;
        used: number;
        percentUsed: number;
    };
    system: {
        uptime: number;
        processes: number;
    };
    timestamp: number;
}
export declare class AppDiagnosticsPlugin extends BasePlugin {
    constructor(definition: PluginDefinition);
    runDiagnostics(): Promise<DiagnosticReport>;
    checkDisk(): Promise<Record<string, {
        total: number;
        used: number;
        free: number;
        percent: number;
    }>>;
    private getCpuUsage;
    private getProcessCount;
}
