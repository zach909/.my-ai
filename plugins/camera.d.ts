import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
export interface CameraData {
    imageData: string;
    width: number;
    height: number;
    format: string;
    timestamp: number;
    path?: string;
}
export declare class CameraPlugin extends BasePlugin {
    private streaming;
    private streamDir;
    constructor(definition: PluginDefinition);
    captureImage(): Promise<CameraData>;
    startStream(): Promise<boolean>;
    stopStream(): Promise<boolean>;
    get isStreaming(): boolean;
    onDeactivate(): Promise<void>;
}
