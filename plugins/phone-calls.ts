import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";

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
    if (typeof number !== "string") {
      throw new Error("Security Error: Phone number must be a string.");
    }
    if (!number || number.trim().length === 0) {
      throw new Error("Security Error: Phone number cannot be empty.");
    }
    if (number.length > 30) {
      throw new Error("Security Error: Phone number exceeds maximum length limit of 30 characters.");
    }
    const safePhoneRegex = /^[0-9+\s().-]+$/;
    if (!safePhoneRegex.test(number)) {
      throw new Error("Security Error: Phone number contains invalid characters.");
    }

    if (typeof direction !== "string" || !["incoming", "outgoing", "missed"].includes(direction)) {
      throw new Error("Security Error: Invalid call direction.");
    }

    if (typeof duration !== "number" || isNaN(duration) || !isFinite(duration) || duration < 0) {
      throw new Error("Security Error: Duration must be a non-negative finite number.");
    }

    if (contactName !== undefined) {
      if (typeof contactName !== "string") {
        throw new Error("Security Error: Contact name must be a string.");
      }
      if (contactName.length > 100) {
        throw new Error("Security Error: Contact name exceeds maximum length limit of 100 characters.");
      }
    }

    const call: PhoneCall = {
      id: `call-${Date.now()}-${Math.random().toString(36).slice(2,9)}`,
      number, direction, duration, timestamp: Date.now(), contactName,
    };
    this.calls.push(call); return call;
  }

  async getHistory(limit: number = 50): Promise<PhoneCall[]> {
    if (limit !== undefined) {
      if (typeof limit !== "number" || isNaN(limit) || !isFinite(limit) || limit <= 0 || !Number.isInteger(limit)) {
        throw new Error("Security Error: Limit must be a positive integer.");
      }
    }
    return [...this.calls].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  async getMissed(): Promise<PhoneCall[]> {
    return this.calls.filter(c => c.direction === "missed").sort((a, b) => b.timestamp - a.timestamp);
  }
}
