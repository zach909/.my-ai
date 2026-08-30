import { HyperDimensionalEngine as CoreHyperDimensionalEngine } from './core/onebrain.js';
import type { Neuron } from './neuron.js';
export { CoreHyperDimensionalEngine as HyperDimensionalEngine };
export interface HyperDimensionalState {
    neuronId: string;
    dimensionalVector: Map<string, number>;
    contextWindow: Array<{
        timestamp: number;
        state: Map<string, number>;
    }>;
    attentionWeights: Map<string, number>;
}
export declare class HyperDimensionalNetwork {
    private neurons;
    private core;
    private contextWindow;
    private maxDimensions;
    constructor(contextWindow?: number, maxDimensions?: number);
    addNeuron(neuron: Neuron): void;
    getNeuron(id: string): Neuron | undefined;
    process(input: number[]): number[];
    getCore(): CoreHyperDimensionalEngine;
    getSeenPatternCount(): number;
}
