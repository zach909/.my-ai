import type { NeuronState } from '../../interface/types.js';
export interface ValueRangeConfig {
    enabled: boolean;
    totalPoints: number;
    minLearningRate: number;
    maxLearningRate: number;
    redistributionInterval: number;
    decayFactor: number;
}
export interface NeuronAllocation {
    id: string;
    valuePoints: number;
    learningRate: number;
}
export declare class ValueRangeAllocator {
    private config;
    /** Map of neuron string-id → current value points */
    private allocations;
    private stepCount;
    constructor(config: ValueRangeConfig);
    /**
     * Distribute totalPoints equally across all provided neurons.
     */
    initializeNeurons(neuronStates: NeuronState[]): void;
    /**
     * Zero-sum update: apply delta*0.1 to target neuron; redistribute
     * the opposite amount proportionally across all other neurons.
     */
    updateNeuronValue(id: string, delta: number): void;
    /**
     * Decay step: runs every redistributionInterval steps internally.
     * Each call is one step; when count reaches interval, decay fires.
     */
    applyDecay(): void;
    /**
     * Returns current distribution.
     * neuronAllocations shape matches NeuronAllocation interface.
     */
    getDistribution(): {
        totalPoints: number;
        neuronAllocations: NeuronAllocation[];
    };
    /**
     * Demotion: takes 50% of neuron's points and gives them to others equally.
     */
    demoteNeuron(id: string): void;
    /** Convert value points to learning rate via linear interpolation.
     * More points → minLearningRate (stable). Fewer points → maxLearningRate (plastic).
     */
    private _pointsToLearningRate;
    /** Rescale all allocations so they sum exactly to totalPoints. */
    private _normalise;
}
