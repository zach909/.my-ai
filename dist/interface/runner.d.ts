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
    private continuousTimer;
    private pendingInputs;
    private continuousTickInFlight;
    private continuousEmbeddingDim;
    constructor(llm: NeuroclawLLM, pipeline: NeuroPipeline, thesaurus: ThesaurusDictionary, pluginRegistry: PluginRegistry, systemAccess?: SystemAccess, multiDesktopManager?: MultiDesktopManager);
    generate(prompt: string): Promise<string>;
    start(): Promise<void>;
    stop(): Promise<void>;
    /**
     * Section 4.1: non-blocking input injection. Returns immediately — never
     * waits for the output loop to pause or finish a tick. The queued text is
     * picked up by whichever tick fires next; if none is ever queued, the
     * output loop keeps running on the mesh's own recurrent dynamics alone.
     */
    injectInput(text: string): void;
    /** Whether the continuous output loop is currently running. */
    isContinuousRunning(): boolean;
    /**
     * Section 4.1: starts the continuous output loop. Each tick runs
     * pipeline.run() — propagate, QIL collapse, RLM thinking-steps, live
     * correction, and a zip-io append — unconditionally, on `intervalMs`,
     * regardless of whether injectInput() queued anything new. A tick that's
     * still in flight when the timer fires again is left to finish rather
     * than overlapped (Node has one thread; overlapping would race two
     * concurrent writes into the same mesh state), so "continuous" here means
     * decoupled and non-blocking for the caller, not literally simultaneous.
     */
    startContinuous(intervalMs?: number): void;
    stopContinuous(): void;
    private continuousTick;
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
