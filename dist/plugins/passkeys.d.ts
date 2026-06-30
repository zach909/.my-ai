import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
export interface Passkey {
    id: string;
    name: string;
    publicKey: string;
    algorithm: string;
    createdAt: number;
    lastUsed?: number;
}
export declare class PasskeysPlugin extends BasePlugin {
    private keys;
    constructor(definition: PluginDefinition);
    create(name: string): Promise<Passkey>;
    list(): Promise<Passkey[]>;
    remove(id: string): Promise<boolean>;
    sign(id: string, data: string): Promise<string | null>;
    verify(id: string, data: string, signature: string): Promise<boolean>;
    private toPublic;
}
