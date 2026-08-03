import type { BrainSnapshot } from "../models && skills/core/unified-brain.js";
export interface NeuronData {
    id: string;
    name: string;
    type: 'neuron' | 'codenet' | 'netsearch' | 'output';
    value: number;
    dims: number;
    definition: string;
    code: string;
    corpus: string;
    netPath: string;
    query: string;
    x: number;
    y: number;
    vale: number;
    endpoint: string;
    method: string;
    external: string[];
    trainedWeights?: Float32Array;
    trained?: boolean;
}
export interface ConnectionData {
    id: string;
    fromId: string;
    toId: string;
    weight: number;
    bias: number;
}
export interface LayerData {
    id: string;
    name: string;
    type: 'input' | 'hidden' | 'output';
    neurons: string[];
}
export interface LabelData {
    id: string;
    text: string;
    x: number;
    y: number;
}
export interface ProjectData {
    id: string;
    name: string;
    description: string;
    neurons: Map<string, NeuronData>;
    connections: Map<string, ConnectionData>;
    layers: Map<string, LayerData>;
    labels: Map<string, LabelData>;
    dims: number;
    createdAt: number;
    updatedAt: number;
}
export interface APIOutputConfig {
    endpoints: {
        path: string;
        method: string;
    }[];
    port: number;
    host: string;
    authRequired: boolean;
}
export declare class ExtensionBuilder {
    private projects;
    private currentProjectId;
    private quantizer;
    private neuroLang;
    private codeToNet;
    private neuronCounter;
    constructor();
    createProject(name: string, description: string): ProjectData;
    getProject(projectId: string): ProjectData | undefined;
    setCurrentProject(projectId: string): boolean;
    getCurrentProject(): ProjectData | undefined;
    addNeuron(projectId: string, name: string, value: number, position?: {
        x: number;
        y: number;
    }): NeuronData | null;
    /** Real neuron/connection/vale baseline imported from a live UnifiedBrain snapshot -- see unified-brain.ts's save(). */
    importFromBrainSnapshot(projectId: string, snapshot: BrainSnapshot): {
        neuronsImported: number;
        connectionsImported: number;
    } | null;
    addCodeNet(projectId: string, name: string, code: string, position?: {
        x: number;
        y: number;
    }): NeuronData | null;
    addNetSearch(projectId: string, name: string, corpus: string, query: string, netPath: string, position?: {
        x: number;
        y: number;
    }): NeuronData | null;
    addOutputLayer(projectId: string, name: string, apiConfig: APIOutputConfig, position?: {
        x: number;
        y: number;
    }): NeuronData | null;
    addLayer(projectId: string, name: string, type: 'input' | 'hidden' | 'output'): LayerData | null;
    connectNeurons(projectId: string, fromId: string, toId: string, weight: number, bias?: number): boolean;
    disconnectNeurons(projectId: string, connectionId: string): boolean;
    deleteNeuron(projectId: string, neuronId: string): boolean;
    dragLabel(projectId: string, neuronId: string, label: string): boolean;
    moveNeuron(projectId: string, neuronId: string, x: number, y: number): boolean;
    searchNeurons(projectId: string, query: string): NeuronData[];
    typeModelOutput(projectId: string, neuronId: string, inputValue: number): string;
    trainNetSearch(projectId: string, epochs: number): boolean;
    netSearch(projectId: string, query: string): {
        results: string[];
        confidence: number;
    }[];
    netSearchGenerate(projectId: string, query: string, topK?: number): {
        neuron: NeuronData;
        matches: { id: string; name: string; score: number }[];
    } | null;
    tokenizeForSearch(text: string): string[];
    semanticSimilarity(a: string[], b: string[]): number;
    importCodeToNet(projectId: string, name: string, binaryCode: Uint8Array): NeuronData | null;
    saveWithoutQuantization(projectId: string): string | null;
    installWithQuantization(projectId: string, options: {
        bits: number;
    }): Promise<string | null>;
    addAPIOutputLayer(projectId: string, config: APIOutputConfig): boolean;
    parseNeuroLang(projectId: string, source: string): Promise<{
        success: boolean;
        errors: string[];
    }>;
    exportToNeuroLang(projectId: string): string;
    listProjects(): ProjectData[];
    deleteProject(projectId: string): boolean;
    getStats(projectId: string): {
        neuronCount: number;
        connectionCount: number;
        layerCount: number;
        labelCount: number;
    } | null;
}
