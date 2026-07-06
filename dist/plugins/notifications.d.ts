import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
export interface Notification {
    id: string;
    title: string;
    body: string;
    scheduledAt?: number;
    shown: boolean;
}
export declare class NotificationsPlugin extends BasePlugin {
    private notifications;
    constructor(definition: PluginDefinition);
    onActivate(context: any): Promise<void>;
    show(title: string, body: string): Promise<string>;
    schedule(title: string, body: string, delayMs: number): Promise<string>;
    dismiss(id: string): Promise<boolean>;
    listActive(): Notification[];
    private generateId;
    private loadFromStorage;
    private saveToStorage;
}
