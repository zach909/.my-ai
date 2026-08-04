import { ExtensionBuilder } from "../extension-builder/builder.js";
import { ExtensionManager } from "../extension_system/manager.js";
import { MoERouter } from "./core/moe-router.js";
import { NeuronMesh } from "./core/mesh.js";
import { HyperDimensionalEngine } from "./core/hyperdimensional.js";
import { ValueRangeAllocator } from "./core/value-range.js";
import { UnifiedBrain, type BrainSnapshot } from "./core/unified-brain.js";
import { NeuroPipeline } from "./core/pipeline.js";
import { Tokenizer } from "./tokenizer.js";
import { NeuroclawTrainer } from "./trainer.js";
export interface LLMConfig {
    embeddingDim: number;
    hiddenDim: number;
    numExperts: number;
    meshNodes: number;
    hyperNeurons: number;
    hyperDimensions: number;
    ballStates: number;
    thinkSteps: number;
    valuePoints: number;
    contextLength: number;
    /** Off by default -- toggle via setQuantumEnabled(). */
    quantumEnabled?: boolean;
    /** Directory where self-authored extensions are persisted. */
    selfExtensionsDir?: string;
}
export interface GenerateOptions {
    maxTokens: number;
    temperature: number;
    /** Relevant prior conversation turns to ground the response in (Section 7). */
    memoryContext: string[];
}
export type PredictorMode = "word" | "code";
export declare class NeuroclawLLM {
    private config;
    private builder;
    private tokenizer;
    private trainer;
    private codeTrainer;
    private predictorMode;
    private quantizer;
    private brain;
    private rlmTrainer;
    private thornsEngine;
    private projectId;
    private built;
    private trained;
    private context;
    private selfExtensions;
    private selfExtensionsDir;
    private extensionManager;
    private generationCount;
    private pipeline;
    private autonomousStopRequested;
    constructor(config?: Partial<LLMConfig>);
    get valueAllocator(): ValueRangeAllocator;
    get moeRouter(): MoERouter;
    get mesh(): NeuronMesh;
    get hyperEngine(): HyperDimensionalEngine;
    setQuantumEnabled(enabled: boolean): void;
    isQuantumEnabled(): boolean;
    setPredictorMode(mode: PredictorMode): void;
    getPredictorMode(): PredictorMode;
    trainOnCode(code: string): Promise<void>;
    build(code?: string): Promise<void>;
    buildFromCode(code: string): Promise<void>;
    trainOnText(text: string): Promise<void>;
    generate(prompt: string, options?: Partial<GenerateOptions>): Promise<string>;
    private generateTokens;
    runAutonomous(
        nextPrompt: () => Promise<string | null | undefined>,
        onOutput: (output: string) => void | Promise<void>,
        shouldStop?: () => boolean,
        idleDelayMs?: number,
    ): Promise<void>;
    requestAutonomousStop(): void;
    saveAndStop(): Promise<BrainSnapshot>;
    private createSelfExtension;
    thinkAbout(prompt: string): Promise<import("./core/thorns.js").ThornsOutput>;
    loadModel(model: {
        id?: string;
        name?: string;
        config?: Record<string, unknown>;
        weights?: Record<string, number[]>;
    }): Promise<void>;
    unloadModel(): void;
    getActiveModel(): {
        id: string;
        neurons: number;
        experts: number;
    } | null;
    reloadSelfExtensions(): void;
    quantize(): Promise<string | null>;
    save(): string | null;
    searchNeurons(query: string): import("../extension-builder/builder.js").NeuronData[];
    netSearch(query: string): {
        results: string[];
        confidence: number;
    }[];
    netSearchGenerate(query: string, topK?: number): {
        neuron: any;
        matches: { id: string; name: string; score: number }[];
    } | null;
    typeOutput(neuronId: string, inputValue: number): string;
    getStats(): {
        built: boolean;
        trained: boolean;
        trainingLoss: number;
        samplesProcessed: number;
        neuronCount: number;
        connectionCount: number;
        layerCount: number;
        expertCount: number;
        moeUtilization: import("./index.js").ExpertUtilizationStats[];
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
    getHyperHistory(): {
        hash: string;
        count: number;
        lastSeen: number;
        step: number;
    }[];
    traceNeuron(neuronId: number, dim: number, topK?: number): any;
    demoteFailingNeurons(failureId: string): void;
    getBuilder(): ExtensionBuilder;
    getExtensionManager(): ExtensionManager;
    getTokenizer(): Tokenizer;
    getTrainer(): NeuroclawTrainer;
    getMoERouter(): MoERouter;
    isBuilt(): boolean;
    getPipeline(): NeuroPipeline | null;
    private sampleFromProbs;
}
