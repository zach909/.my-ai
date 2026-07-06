import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
export interface Contact {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    group?: string;
    notes?: string;
}
export declare class ContactsPlugin extends BasePlugin {
    private contacts;
    constructor(definition: PluginDefinition);
    onActivate(context: any): Promise<void>;
    list(): Promise<Contact[]>;
    get(id: string): Promise<Contact | undefined>;
    add(contact: Omit<Contact, "id">): Promise<Contact>;
    update(id: string, updates: Partial<Contact>): Promise<boolean>;
    remove(id: string): Promise<boolean>;
    search(query: string): Promise<Contact[]>;
    private generateId;
    private load;
    private save;
}
