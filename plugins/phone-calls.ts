import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";

export interface CallRecord {
  id: string;
  number: string;
  direction: "missed" | "outgoing" | "incoming";
  timestamp: number;
  duration: number; // in seconds
}

export class PhoneCallsPlugin extends BasePlugin {
  private history: CallRecord[] = [];

  constructor(definition: PluginDefinition) {
    super(definition);
    // Seed some initial data
    this.history = [
      { id: "1", number: "+15550199", direction: "incoming", timestamp: Date.now() - 3600000, duration: 120 },
      { id: "2", number: "+15550188", direction: "outgoing", timestamp: Date.now() - 7200000, duration: 45 },
      { id: "3", number: "+15550177", direction: "missed", timestamp: Date.now() - 86400000, duration: 0 },
    ];
  }

  async getHistory(limit?: number): Promise<CallRecord[]> {
    return limit ? this.history.slice(0, limit) : this.history;
  }

  async onMessage(message: unknown): Promise<unknown> {
    return { type: "phone-calls", history: this.history };
  }
}
