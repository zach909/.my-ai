import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
export interface Email {
    id: string;
    from: string;
    to: string[];
    subject: string;
    body: string;
    timestamp: number;
    read: boolean;
    folder: "inbox" | "sent" | "drafts" | "trash";
}
export declare class EmailPlugin extends BasePlugin {
    private emails;
    constructor(definition: PluginDefinition);
    send(from: string, to: string[], subject: string, body: string): Promise<Email>;
    inbox(): Promise<Email[]>;
    markRead(id: string): Promise<boolean>;
    search(query: string): Promise<Email[]>;
    listSent(): Promise<Email[]>;
    listAll(): Promise<Email[]>;
    private trySendmail;
    private which;
    private loadFromDisk;
    private saveToDisk;
}
