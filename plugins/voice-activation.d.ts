import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
export interface VoiceCommand {
    transcript: string;
    confidence: number;
    timestamp: number;
    action?: string;
}
export declare class VoiceActivationPlugin extends BasePlugin {
    private listening;
    private commands;
    private wakeWord;
    private micProcess;
    constructor(definition: PluginDefinition);
    setWakeWord(word: string): void;
    getWakeWord(): string;
    startListening(): Promise<boolean>;
    stopListening(): Promise<boolean>;
    get isListening(): boolean;
    processTranscript(transcript: string): Promise<VoiceCommand | null>;
    getCommandHistory(): VoiceCommand[];
    clearHistory(): void;
    onDeactivate(): Promise<void>;
    private detectRecorder;
    private simulateSTT;
}
