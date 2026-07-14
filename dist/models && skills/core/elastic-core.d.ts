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
export interface ElasticCoreParameters {
    weights: Float32Array;
    biases: Float32Array;
    inputProjection: Float32Array;
    outputProjection: Float32Array;
    shapes: {
        weights: [targetNeurons: number, sourceNeurons: number, outDim: number, inDim: number];
        biases: [neurons: number, stateDim: number];
        inputProjection: [inputDim: number, stateDim: number];
        outputProjection: [stateDim: number, outputDim: number];
    };
}
export interface ElasticCoreGradients {
    weights?: Float32Array;
    biases?: Float32Array;
    inputProjection?: Float32Array;
    outputProjection?: Float32Array;
}
export interface ElasticCoreGradientOptions {
    learningRate?: number;
    weightDecay?: number;
    /** Vale fraction per neuron in [0,1]. High vale scales weight/bias updates down. */
    vale?: Map<number, number>;
    /** Additional multiplier applied after vale scaling. Defaults to 1. */
    scale?: number;
}
export interface ElasticCoreUpdateSummary {
    weightsL1: number;
    biasesL1: number;
    inputProjectionL1: number;
    outputProjectionL1: number;
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
    private nextState;
    private directInputFlags;
    private groups;
    private definitionTargets;
    private rngState;
    constructor(config?: ElasticCoreConfig);
    setNeuronGroup(neuronId: number, group: string): void;
    getNeuronCount(): number;
    getStateDim(): number;
    connectionDensity(): number;
    connectionBlock(target: number, source: number): Float32Array;
    /**
     * Program an explicit dense source->target block. This is how extension
     * builder definitions can install cross-dimensional links directly: every
     * output dimension of the target can read every input dimension of the source.
     */
    setConnectionBlock(target: number, source: number, block: Float32Array | number[]): void;
    /** Convenience helper for DSL-style scalar connections: fill the whole block. */
    setConnectionScalar(target: number, source: number, weight: number): void;
    setDefinitionTarget(neuronId: number, target: ArrayLike<number>): void;
    checkDefinition(neuronId: number, tolerance?: number): DefinitionCheckResult;
    /**
     * Add a live neuron to the core and wire it all-to-all with every existing
     * neuron. This is the Elastic Core side of the extension-builder story:
     * newly materialized NeuroLang/skill neurons become ordinary mesh neurons,
     * not a side table or separate adapter layer. Existing weights are preserved.
     */
    addNeuron(group?: string): number;
    /**
     * Optimizer-facing structured parameter view. The returned typed arrays are
     * live references, so AdamW-style trainers can keep moments keyed to these
     * arrays and mutate them directly when needed.
     */
    getParameters(): ElasticCoreParameters;
    /** Apply SGD/AdamW-compatible gradients in-place, with optional vale masks. */
    applyGradients(gradients: ElasticCoreGradients, options?: ElasticCoreGradientOptions): ElasticCoreUpdateSummary;
    forward(input: Float32Array, options?: ElasticCoreRunOptions): ElasticCoreResult;
    private clearDirectInputFlags;
    private inject;
    /**
     * Section 8: In-place quantization with residual feedback. Compares each
     * state's candidate value (plus its accumulated error) to the nearest
     * dequantized level, then stores the new rounding error back into the
     * residual buffer so it is compensated for on the next tick. This lets
     * the network learn to "expect" its own quantized substrate.
     */
    private applyQuantizationInPlace;
    private quantizeWithResidual;
    private readout;
    private meanAbs;
    private stateDeltas;
    private inputTopography;
    private weightIndex;
    private weightIndexForCount;
    private updateScaleForNeuron;
    private assertGradientLength;
    private rand;
    private assertNeuron;
}
