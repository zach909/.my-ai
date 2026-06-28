import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
import { PhoneCallsPlugin } from "./phone-calls";

export class CallHistoryPlugin extends BasePlugin {
  private source?: PhoneCallsPlugin;

  constructor(definition: PluginDefinition) { super(definition); }

  setSource(plugin: PhoneCallsPlugin): void { this.source = plugin; }

  async getCallHistory(limit?: number): Promise<any[]> {
    if (!this.source) return [];
    return this.source.getHistory(limit);
  }

  async getStats(): Promise<{ total: number; missed: number; outgoing: number; incoming: number }> {
    if (!this.source) return { total: 0, missed: 0, outgoing: 0, incoming: 0 };
    const all = await this.source.getHistory(10000);
    return {
      total: all.length,
      missed: all.filter(c => c.direction === "missed").length,
      outgoing: all.filter(c => c.direction === "outgoing").length,
      incoming: all.filter(c => c.direction === "incoming").length,
    };
  }
}
