export interface ElasticCoreConfig {
    neuronCount?: number;
    stateDim?: number;
    inputDim?: number;
    outputDim?: number;
    maxTicks?: number;
    convergenceThreshold?: number;
    weightScale?: number;
    seed?: number;
    inputFlagDim?: number;
    quantizationAware?: boolean;
    quantizationBits?: number;
}
export interface ElasticCoreRunOptions {
    /** Vale fraction per neuron in [0,1]. High vale resists state movement. */
    vale?: Map<number, number>;
    /** Optional MoE labels to compute this tick; unselected labelled neurons hold state. */
    activeGroups?: Set<string>;
    /** Externally-driven neuron ids for the input-source flag dimension. */
    drivenNeurons?: Set<number>;
}
export interface ElasticCoreResult {
    output: Float32Array;
    settledState: Float32Array;
    ticks: number;
    converged: boolean;
    residual: number;
    inputTopography: Map<number, number>;
    /** Per-neuron L1 state movement during the settle, for vale-budget feedback. */
    stateDeltas: Map<number, number>;
}
/**
 * Experimental transformer-core replacement for Prometheus Elastic Core.
 *
 * This block intentionally keeps the surrounding transformer infrastructure
 * reusable: callers pass normal token/embedding vectors in and receive a normal
 * output embedding back. Internally, however, the attention/MLP block is
 * replaced by a true all-to-all mesh of multidimensional neurons. Every source
 * neuron owns a dense state vector and every target neuron receives a full
 * stateDim x stateDim weight block from every other source neuron. Bias is
 * added exactly once per target neuron/dimension after all incoming products
 * are summed.
 */
export declare class ElasticCoreBlock {
    private readonly neuronCount;
    private readonly stateDim;
    private readonly inputDim;
    private readonly outputDim;
    private readonly maxTicks;
    private readonly convergenceThreshold;
    private readonly inputFlagDim;
    private readonly quantizationAware;
    private readonly quantizationBits;
    private quantizationResidual;
    private state;
    private bias;
    private weights;
    private inputProjection;
    private outputProjection;
    private groups;
    private rngState;
    constructor(config?: ElasticCoreConfig);
    setNeuronGroup(neuronId: number, group: string): void;
    connectionDensity(): number;
    connectionBlock(target: number, source: number): Float32Array;
    forward(input: Float32Array, options?: ElasticCoreRunOptions): ElasticCoreResult;
    private inject;
    private quantizeWithResidual;
    private readout;
    private stateDeltas;
    private inputTopography;
    private weightIndex;
    private rand;
    private assertNeuron;
}
