import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";

export interface PhoneCall {
  id: string;
  number: string;
  contactName?: string;
  direction: "incoming" | "outgoing" | "missed";
  duration: number;
  timestamp: number;
  notes?: string;
}

export class PhoneCallsPlugin extends BasePlugin {
  private calls: PhoneCall[] = [];

  constructor(definition: PluginDefinition) { super(definition); }

  async log(number: string, direction: PhoneCall["direction"], duration: number = 0, contactName?: string): Promise<PhoneCall> {
    const call: PhoneCall = {
      id: `call-${Date.now()}-${Math.random().toString(36).slice(2,9)}`,
      number, direction, duration, timestamp: Date.now(), contactName,
    };
    this.calls.push(call); return call;
  }

  async getHistory(limit: number = 50): Promise<PhoneCall[]> {
    return [...this.calls].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  async getMissed(): Promise<PhoneCall[]> {
    return this.calls.filter(c => c.direction === "missed").sort((a, b) => b.timestamp - a.timestamp);
  }
}
