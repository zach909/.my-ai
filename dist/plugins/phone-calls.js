import { BasePlugin } from "../plugin_manager/sdk.js";
export class PhoneCallsPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.calls = [];
    }
    async log(number, direction, duration = 0, contactName) {
        const call = {
            id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            number, direction, duration, timestamp: Date.now(), contactName,
        };
        this.calls.push(call);
        return call;
    }
    async getHistory(limit = 50) {
        return [...this.calls].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
    }
    async getMissed() {
        return this.calls.filter(c => c.direction === "missed").sort((a, b) => b.timestamp - a.timestamp);
    }
}
