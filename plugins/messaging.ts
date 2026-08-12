import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";

export interface Message {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  read: boolean;
  channel: string;
}

export class MessagingPlugin extends BasePlugin {
  private messages: Message[] = [];

  constructor(definition: PluginDefinition) { super(definition); }

  async send(from: string, to: string, text: string, channel: string = "default"): Promise<Message> {
    if (typeof from !== "string" || typeof to !== "string" || typeof text !== "string" || typeof channel !== "string") {
      throw new Error("Security Error: Parameter type mismatch. All inputs must be strings.");
    }
    if (!from.trim() || !to.trim() || !text.trim()) {
      throw new Error("Security Error: 'from', 'to', and 'text' cannot be empty or whitespace only.");
    }
    if (from.length > 100 || to.length > 100 || channel.length > 100) {
      throw new Error("Security Error: 'from', 'to', or 'channel' name exceeds maximum length limit of 100 characters.");
    }
    if (text.length > 4096) {
      throw new Error("Security Error: 'text' exceeds maximum length limit of 4096 characters.");
    }

    const msg: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2,9)}`,
      from, to, text, timestamp: Date.now(), read: true, channel,
    };
    this.messages.push(msg);
    console.log(`[Message] ${from} -> ${to}: ${text}`);
    return msg;
  }

  async getConversation(contact: string, limit: number = 50): Promise<Message[]> {
    if (typeof contact !== "string") {
      throw new Error("Security Error: 'contact' must be a string.");
    }
    if (!contact.trim()) {
      throw new Error("Security Error: 'contact' cannot be empty.");
    }
    if (contact.length > 100) {
      throw new Error("Security Error: 'contact' name exceeds maximum length limit of 100 characters.");
    }
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error("Security Error: 'limit' must be an integer between 1 and 1000.");
    }

    return this.messages
      .filter(m => m.from === contact || m.to === contact)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async markRead(id: string): Promise<boolean> {
    if (typeof id !== "string") {
      throw new Error("Security Error: Message 'id' must be a string.");
    }
    if (id.length > 100) {
      throw new Error("Security Error: Message 'id' exceeds maximum length limit of 100 characters.");
    }

    const m = this.messages.find(msg => msg.id === id);
    if (!m) return false;
    m.read = true; return true;
  }
}
