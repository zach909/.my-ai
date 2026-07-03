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
    const msg: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2,9)}`,
      from, to, text, timestamp: Date.now(), read: true, channel,
    };
    this.messages.push(msg);
    console.log(`[Message] ${from} -> ${to}: ${text}`);
    return msg;
  }

  async getConversation(contact: string, limit: number = 50): Promise<Message[]> {
    return this.messages
      .filter(m => m.from === contact || m.to === contact)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async markRead(id: string): Promise<boolean> {
    const m = this.messages.find(msg => msg.id === id);
    if (!m) return false;
    m.read = true; return true;
  }
}
