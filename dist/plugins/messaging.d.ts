import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
export interface Message {
    id: string;
    from: string;
    to: string;
    text: string;
    timestamp: number;
    read: boolean;
    channel: string;
}
export declare class MessagingPlugin extends BasePlugin {
    private messages;
    constructor(definition: PluginDefinition);
    send(from: string, to: string, text: string, channel?: string): Promise<Message>;
    getConversation(contact: string, limit?: number): Promise<Message[]>;
    markRead(id: string): Promise<boolean>;
}
