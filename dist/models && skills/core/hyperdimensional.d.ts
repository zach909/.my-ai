export interface HyperNeuron {
    id: number;
    state: number[];
    energy: number;
    transitions: StateTransition[];
    influenceRadius: number;
    activationThreshold: number;
}
export interface StateTransition {
    fromState: number[];
    toState: number[];
    energy: number;
    timestamp: number;
    cause: string;
}
export interface HyperDimensionalOutput {
    outputVector: number[];
    activeStates: HyperNeuron[];
    totalEnergy: number;
    dimensionalEntropy: number;
    noveltyScore: number;
    transitionCount: number;
}
export interface HyperConfig {
    neuronCount: number;
    dimensions: number;
    stateBits: number;
    learningRate: number;
    influenceDecay: number;
    energyThreshold: number;
    noveltyWindow: number;
    crossInfluenceStrength: number;
}
export interface SeenPattern {
    hash: string;
    frequency: number;
    firstSeen: number;
    lastSeen: number;
    novelty: number;
}
export declare class HyperDimensionalEngine {
    private config;
    private neurons;
    private seenPatterns;
    private history;
    private iteration;
    constructor(config?: Record<string, any>);
    process(inputVector: number[] | Map<string, Float32Array>): HyperDimensionalOutput;
    hasSeenPattern(patternHash: string): boolean;
    getPatternNovelty(patternHash: string): number;
    getSeenPatternCount(): number;
    getHistory(): Array<{
        hash: string;
        count: number;
        lastSeen: number;
        step: number;
    }>;
    getNeuronStates(): HyperNeuron[];
    private initializeNeurons;
    private updateNeuronState;
    private crossInfluence;
    private resolveStateTransitions;
    private computeStateEnergy;
    private computeOutputVector;
    private getActiveStates;
    private computeDimensionalEntropy;
    private computeNoveltyScore;
    private recordPattern;
    private hashVector;
}
