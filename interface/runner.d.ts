import { EventEmitter } from 'node:events';
import { EncryptionManager } from './encryption.js';
import { SystemAccess } from './system-access.js';
import { MultiDesktopManager } from './multi-desktop.js';
import type { NeuroclawLLM } from "../models && skills/llm.js";
import type { NeuroPipeline } from "../models && skills/core/pipeline.js";
import type { ThesaurusDictionary } from "../models && skills/thesaurus.js";
import type { PluginRegistry } from "../plugin_manager/registry.js";
export declare class NeuroclawRunner extends EventEmitter {
    private llm;
    private pipeline;
    private thesaurus;
    private pluginRegistry;
    private encryptionManager;
    private systemAccess;
    private multiDesktopManager;
    private running;
    private startTime;
    constructor(llm: NeuroclawLLM, pipeline: NeuroPipeline, thesaurus: ThesaurusDictionary, pluginRegistry: PluginRegistry, systemAccess?: SystemAccess, multiDesktopManager?: MultiDesktopManager);
    generate(prompt: string): Promise<string>;
    start(): Promise<void>;
    stop(): Promise<void>;
    getStatus(): {
        running: boolean;
        subsystems: {
            llm: boolean;
            plugins: boolean;
            webServer: boolean;
            encryption: boolean;
            systemAccess: boolean;
            multiDesktop: boolean;
        };
        energy: {
            currentWatts: number;
            averageWatts: number;
            peakWatts: number;
            totalKWh: number;
        };
        uptime: number;
        llm: {
            built: boolean;
            trained: boolean;
            trainingLoss: number;
            samplesProcessed: number;
            neuronCount: number;
            connectionCount: number;
            layerCount: number;
            expertCount: number;
            moeUtilization: import("../models && skills/index.js").ExpertUtilizationStats[];
            valueDistribution: {
                totalPoints: number;
                neuronCount: number;
            };
            hyperPatternsSeen: number;
            rlmBufferSize: number;
            rlmExplorationRate: number;
            selfExtensionCount: number;
            generationCount: number;
            contextLength: number;
        };
    };
    isRunning(): boolean;
    getEncryptionManager(): EncryptionManager;
    getSystemAccess(): SystemAccess;
    getMultiDesktopManager(): MultiDesktopManager;
    getLLM(): NeuroclawLLM;
    getPipeline(): NeuroPipeline;
    getThesaurus(): ThesaurusDictionary;
    getPluginRegistry(): PluginRegistry;
}
