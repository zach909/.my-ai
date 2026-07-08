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
export declare class PhoneCallsPlugin extends BasePlugin {
    private calls;
    constructor(definition: PluginDefinition);
    log(number: string, direction: PhoneCall["direction"], duration?: number, contactName?: string): Promise<PhoneCall>;
    getHistory(limit?: number): Promise<PhoneCall[]>;
    getMissed(): Promise<PhoneCall[]>;
}
