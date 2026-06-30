export interface ExpertConfig {
    inputDim: number;
    hiddenDim: number;
    outputDim: number;
    learningRate: number;
    dropoutRate: number;
    activation: 'gelu' | 'relu' | 'tanh';
}
export interface ExpertMetadata {
    expertId: number;
    config: ExpertConfig;
    totalForwardCalls: number;
    loadFactor: number;
    creationTimestamp: number;
    parameterCount: number;
}
export declare class ExpertNetwork {
    private config;
    private expertId;
    private w1;
    private b1;
    private w2;
    private b2;
    private forwardCalls;
    private loadFactor;
    private createdAt;
    constructor(expertId: number, config?: Partial<ExpertConfig>);
    forward(input: Float32Array, outputDim?: number): Float32Array;
    private gelu;
    getExpert(): ExpertMetadata;
}
