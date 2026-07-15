import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
export interface AudioData {
    data: string;
    duration: number;
    sampleRate: number;
    channels: number;
    timestamp: number;
    path?: string;
}
export declare class MicrophonePlugin extends BasePlugin {
    private recording;
    private recordPid;
    private recordPath;
    private audioLevel;
    constructor(definition: PluginDefinition);
    startRecording(): Promise<boolean>;
    stopRecording(): Promise<AudioData>;
    getAudioLevel(): number;
    get isRecording(): boolean;
    onDeactivate(): Promise<void>;
}
