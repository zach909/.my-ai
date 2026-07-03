import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { PhoneCallsPlugin } from "./phone-calls.js";
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
