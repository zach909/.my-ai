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
    /** Enable quantization-aware state settling: quantize inside forward and retain residual feedback. */
    quantizationAware?: boolean;
    /** Bit width for quantized state values when quantizationAware is enabled. */
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
    /** Mean absolute residual introduced by the quantizer on this forward pass. */
    quantizationDrift: number;
}
export interface DefinitionCheckResult {
    neuronId: number;
    loss: number;
    satisfied: boolean;
    readout: Float32Array;
    target: Float32Array;
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
    private neuronCount;
    private readonly neuronCount;
    private readonly stateDim;
    private readonly inputDim;
    private readonly outputDim;
    private readonly maxTicks;
    private readonly convergenceThreshold;
    private readonly inputFlagDim;
    private state;
    private bias;
    private weights;
    private inputProjection;
    private outputProjection;
    private groups;
    private definitionTargets;
    private rngState;
    private readonly quantizationAware;
    private readonly quantizationBits;
    private quantizationResidual;
    constructor(config?: ElasticCoreConfig);
    setNeuronGroup(neuronId: number, group: string): void;
    /**
     * Add a live neuron to the core and wire it all-to-all with every existing
     * neuron. This is the Elastic Core side of the extension-builder story:
     * newly materialized NeuroLang/skill neurons become ordinary mesh neurons,
     * not a side table or separate adapter layer. Existing weights are preserved.
     */
    addNeuron(group?: string): number;
    getNeuronCount(): number;
    connectionDensity(): number;
    /**
     * Program an explicit dense source->target block. This is how extension
     * builder definitions can install cross-dimensional links directly: every
     * output dimension of the target can read every input dimension of the source.
     */
    setConnectionBlock(target: number, source: number, block: Float32Array | number[]): void;
    /** Convenience helper for DSL-style scalar connections: fill the whole block. */
    setConnectionScalar(target: number, source: number, weight: number): void;
    constructor(config?: ElasticCoreConfig);
    setNeuronGroup(neuronId: number, group: string): void;
    getNeuronCount(): number;
    getStateDim(): number;
    addNeuron(group?: string): number;
    setConnectionScalar(target: number, source: number, weight: number): void;
    setConnectionBlock(target: number, source: number, block: ArrayLike<number>): void;
    setDefinitionTarget(neuronId: number, target: ArrayLike<number>): void;
    checkDefinition(neuronId: number, tolerance?: number): DefinitionCheckResult;
    connectionDensity(): number;
    connectionBlock(target: number, source: number): Float32Array;
    forward(input: Float32Array, options?: ElasticCoreRunOptions): ElasticCoreResult;
    private inject;
    private readout;
    private quantizeWithResidual;
    private meanAbs;
    private stateDeltas;
    private inputTopography;
    private weightIndex;
    private rand;
    private assertNeuron;
}
