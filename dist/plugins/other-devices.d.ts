import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
export interface Device {
    id: string;
    name: string;
    type: string;
    connected: boolean;
    lastSeen: number;
}
export declare class OtherDevicesPlugin extends BasePlugin {
    private devices;
    constructor(definition: PluginDefinition);
    register(name: string, type: string): Promise<Device>;
    list(): Promise<Device[]>;
    disconnect(id: string): Promise<boolean>;
    reconnect(id: string): Promise<boolean>;
}
