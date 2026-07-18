import { BasePlugin } from "../plugin_manager/sdk.js";
export class MessagingPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.messages = [];
    }
    async send(from, to, text, channel = "default") {
        const msg = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            from, to, text, timestamp: Date.now(), read: true, channel,
        };
        this.messages.push(msg);
        console.log(`[Message] ${from} -> ${to}: ${text}`);
        return msg;
    }
    async getConversation(contact, limit = 50) {
        return this.messages
            .filter(m => m.from === contact || m.to === contact)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }
    async markRead(id) {
        const m = this.messages.find(msg => msg.id === id);
        if (!m)
            return false;
        m.read = true;
        return true;
    }
}
