export interface MoEConfig {
    expertCount: number;
    topK: number;
    capacityFactor: number;
    loadBalanceWeight: number;
    expertHiddenDim: number;
    inputDim: number;
    outputDim: number;
    routerHiddenDim: number;
}
export interface RouterDecision {
    expertIndices: number[];
    routerWeights: number[];
    expertOutputs: Float32Array[];
    combinedOutput: Float32Array;
    entropy: number;
    loadBalanceLoss: number;
}
export interface MoELayerOutput {
    output: Float32Array;
    decision: RouterDecision;
    layerIndex: number;
    expertContributions: Map<string, number>;
}
export interface ExpertUtilizationStats {
    expertId: number;
    utilization: number;
    totalCalls: number;
    totalTokens: number;
    avgWeight: number;
}
export declare class MoERouter {
    private config;
    private experts;
    private routerWeights;
    private routerBias;
    private utilization;
    private iteration;
    constructor(config?: Partial<MoEConfig> & Record<string, any>);
    private initializeExpertWeights;
    private initializeExperts;
    route(input: Float32Array): RouterDecision;
    forward(input: Float32Array, layerIndex?: number): MoELayerOutput;
    addExpert(weights: Float32Array, bias: Float32Array): number;
    addExpert(config: {
        id: string;
        name: string;
        specialization: string;
    }): number;
    removeExpert(expertId: number): boolean;
    setExpertWeights(expertId: number, weights: Float32Array, bias: Float32Array): void;
    getUtilizationStats(): ExpertUtilizationStats[];
    getExpertCount(): number;
    getExpertList(): number[];
    private computeRouterScores;
    private selectTopK;
    private softmax;
    private computeEntropy;
    private computeLoadBalanceLoss;
    private trackUtilization;
    private hashInput;
}
