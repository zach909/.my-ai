import { BasePlugin } from "../plugin_manager/sdk.js";
export class CallHistoryPlugin extends BasePlugin {
    constructor(definition) { super(definition); }
    setSource(plugin) { this.source = plugin; }
    async getCallHistory(limit) {
        if (limit !== undefined) {
            if (typeof limit !== "number" || isNaN(limit) || !isFinite(limit) || limit <= 0 || !Number.isInteger(limit)) {
                throw new Error("Security Error: Limit must be a positive integer.");
            }
        }
        if (!this.source)
            return [];
        return this.source.getHistory(limit);
    }
    async getStats() {
        if (!this.source)
            return { total: 0, missed: 0, outgoing: 0, incoming: 0 };
        const all = await this.source.getHistory(10000);
        return {
            total: all.length,
            missed: all.filter(c => c.direction === "missed").length,
            outgoing: all.filter(c => c.direction === "outgoing").length,
            incoming: all.filter(c => c.direction === "incoming").length,
        };
    }
}
