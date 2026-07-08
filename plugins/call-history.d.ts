import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
import { PhoneCallsPlugin } from "./phone-calls";
export declare class CallHistoryPlugin extends BasePlugin {
    private source?;
    constructor(definition: PluginDefinition);
    setSource(plugin: PhoneCallsPlugin): void;
    getCallHistory(limit?: number): Promise<any[]>;
    getStats(): Promise<{
        total: number;
        missed: number;
        outgoing: number;
        incoming: number;
    }>;
}
