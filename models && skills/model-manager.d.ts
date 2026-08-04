import { NeuroclawLLM } from './llm.js';
export interface ModelMetadata {
    id: string;
    name: string;
    version: string;
    description: string;
    createdAt: number;
    updatedAt: number;
    size: number;
    format: 'json' | 'binary' | 'quantized';
    quantizationBits?: number;
    tags: string[];
    author?: string;
    license?: string;
}
export interface ModelData {
    metadata: ModelMetadata;
    weights: Record<string, Float32Array | number[]>;
    config: Record<string, any>;
    checkpoints?: string[];
}
export interface ModelLoadOptions {
    loadWeights: boolean;
    loadConfig: boolean;
    quantize: boolean;
    quantizationBits?: number;
}
export interface ModelSaveOptions {
    quantize: boolean;
    quantizationBits?: number;
    includeCheckpoints: boolean;
    compression: boolean;
}
export interface ModelManagerConfig {
    modelsDirectory: string;
    maxCacheSize: number;
    autoSave: boolean;
    autoSaveInterval: number;
    defaultQuantizationBits: number;
}
export declare class ModelManager {
    private config;
    private models;
    private loadedModels;
    private quantizer;
    private autoSaveTimer;
    constructor(config?: Partial<ModelManagerConfig>);
    private ensureDirectory;
    private startAutoSave;
    private stopAutoSave;
    registerModel(modelData: ModelData): string;
    loadModel(modelId: string, options?: ModelLoadOptions): ModelData | null;
    saveModel(modelId: string, options?: ModelSaveOptions): boolean;
    saveAllModels(): void;
    deleteModel(modelId: string): boolean;
    getModel(modelId: string): ModelData | undefined;
    listModels(): ModelMetadata[];
    loadLLM(modelId: string): NeuroclawLLM | null;
    unloadLLM(modelId: string): boolean;
    getLoadedLLM(modelId: string): NeuroclawLLM | undefined;
    createModel(name: string, description: string, config: Record<string, any>): ModelData;
    updateModelWeights(modelId: string, weights: Record<string, Float32Array>): boolean;
    updateModelConfig(modelId: string, config: Record<string, any>): boolean;
    addCheckpoint(modelId: string, checkpointId: string): boolean;
    exportModel(modelId: string, exportPath: string): boolean;
    importModel(importPath: string, modelId?: string): string | null;
    searchModels(query: string): ModelMetadata[];
    addTag(modelId: string, tag: string): boolean;
    removeTag(modelId: string, tag: string): boolean;
    getModelStats(modelId: string): {
        weightCount: number;
        totalParameters: number;
        sizeBytes: number;
        format: string;
        quantized: boolean;
    } | null;
    clearCache(): void;
    getConfig(): ModelManagerConfig;
    updateConfig(config: Partial<ModelManagerConfig>): void;
    autoUpdateModels(): Promise<Array<{ modelId?: string; type: string; suggestedBits?: number }>>;
    updateModel(modelId: string, updates: { metadata?: Partial<ModelMetadata>; weights?: Record<string, Float32Array>; config?: Record<string, any> }): boolean;
    shutdown(): void;
}
