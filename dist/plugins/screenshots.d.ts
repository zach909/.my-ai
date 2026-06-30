import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
export interface ScreenshotData {
    data: string;
    width: number;
    height: number;
    format: string;
    timestamp: number;
    path?: string;
}
export declare class ScreenshotsPlugin extends BasePlugin {
    constructor(definition: PluginDefinition);
    capture(filename?: string): Promise<ScreenshotData>;
    captureArea(x: number, y: number, w: number, h: number): Promise<ScreenshotData>;
}
