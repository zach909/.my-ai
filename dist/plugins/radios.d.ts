import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
export interface RadioDevice {
    name: string;
    type: "wifi" | "bluetooth" | "cellular" | "nfc";
    enabled: boolean;
    power: number;
}
export declare class RadiosPlugin extends BasePlugin {
    private devices;
    constructor(definition: PluginDefinition);
    list(): Promise<RadioDevice[]>;
    enable(name: string): Promise<boolean>;
    disable(name: string): Promise<boolean>;
    scan(type?: RadioDevice["type"]): Promise<string[]>;
}
