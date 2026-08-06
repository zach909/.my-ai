import type { BrainSnapshot } from "../models && skills/core/unified-brain.js";
export interface ScriptExample {
    userSays: string;
    response: string;
}
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
    /** "Scripting": (user says X -> should respond Y) training examples -- see ExtensionBuilder.addScript()/train(). */
    scripts: ScriptExample[];
    trainedWeights?: Float32Array;
    trained?: boolean;
}
export interface ConnectionData {
    id: string;
    fromId: string;
    toId: string;
    weight: number;
    bias: number;
    /** "Permanent" (true) vs "starting place" (false/undefined) -- see ExtensionBuilder.connectNeurons(). */
    locked?: boolean;
}
export interface TrainingResult {
    converged: boolean;
    definitionsConverged: boolean;
    scriptsConverged: boolean;
    epochs: number;
    satisfied: string[];
    conflicts: { a: string; b: string; correlation: number }[];
    trainedNeurons: string[];
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
    lastTraining?: TrainingResult;
    /** Internal O(1) index of "fromId|toId" pairs currently locked -- see connectNeurons(). */
    lockedPairs?: Set<string>;
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
    /** `locked: true` makes this connection "permanent" -- refused if a locked connection already exists between the same pair. */
    connectNeurons(projectId: string, fromId: string, toId: string, weight: number, bias?: number, locked?: boolean): boolean;
    /** Refuses (returns false) if the connection is locked ("permanent"). */
    disconnectNeurons(projectId: string, connectionId: string): boolean;
    /** Toggle a connection between "permanent" (locked) and "starting place" (unlocked). */
    setConnectionLocked(projectId: string, connectionId: string, locked: boolean): boolean;
    deleteNeuron(projectId: string, neuronId: string): boolean;
    dragLabel(projectId: string, neuronId: string, label: string): boolean;
    /** "Scripting": attach a (user says X -> should respond Y) training example to a neuron. */
    addScript(projectId: string, neuronId: string, userSays: string, response: string): boolean;
    removeScript(projectId: string, neuronId: string, index: number): boolean;
    /**
     * The real training sequence: connections -> @definishon + every
     * script trained together via HyperDimensionalEngine.trainDefinitions()
     * until convergence or `epochs` runs out. Not a script -- a genuine
     * training pass; see the method's own doc comment in builder.js.
     */
    train(projectId: string, opts?: { epochs?: number }): TrainingResult | null;
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
    /** Given a neuron already indexed by trainNetSearch(), which query tokens most strongly drove matches to it. */
    reverseNetSearch(projectId: string, neuronId: string): { token: string; weight: number }[];
    tokenizeForSearch(text: string): string[];
    semanticSimilarity(a: string[], b: string[]): number;
    importCodeToNet(projectId: string, name: string, binaryCode: Uint8Array): NeuronData | null;
    saveWithoutQuantization(projectId: string): string | null;
    /** Does NOT train -- call train() yourself first if you want the definitions/scripts trained before deploying. */
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
