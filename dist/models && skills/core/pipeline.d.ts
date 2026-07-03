import { ZipIOSystem } from './zip-io.js';
export interface PipelineConfig {
    embeddingDim: number;
    hiddenDim: number;
    meshNodes: number;
    hyperDimensions: number;
}
export interface PipelineStep {
    name: string;
    inputShape: number[];
    outputShape: number[];
    durationMs: number;
}
export interface PipelineResult {
    output: number[];
    steps: PipelineStep[];
    totalDurationMs: number;
}
export declare class NeuroPipeline {
    private config;
    private moeRouter;
    private mesh;
    private hyperEngine;
    private rlm;
    private valueRange;
    private quantumNet;
    private zipIO;
    private runHistory;
    constructor(config?: Partial<PipelineConfig>);
    private ensureSubsystems;
    /**
     * Run all 7 subsystems in sequence on an embedding vector.
     * Run all 6 subsystems in sequence on an embedding vector.
     *
     * Sequence:
     *   0. ZipIO   — infinite loop context ingestion (Section 1.10)
     *   1. MoE     — mixture-of-experts routing on the embedding
     *   2. Mesh    — propagation through the neuron mesh
     *   3. HyperDim — hyper-dimensional state processing
     *   4. Quantum — quantum interference for exclusive input neurons
     *   5. RLM     — reinforcement-learning action selection
     *   6. Token gen — combine outputs → final output vector
     */
    run(embedding: Float32Array, inputText?: string): Promise<PipelineResult>;
    getStats(): {
        avgDurationMs: number;
        stepBreakdown: Map<string, number>;
        runsCount: number;
    };
    reset(): void;
    /**
     * Access the Zip I/O system for context iteration
     */
    getZipIO(): ZipIOSystem | null;
    /**
     * Resize a Float32Array to targetLength, zero-padding or truncating.
     */
    private resizeVector;
    /**
     * Resize a number[] to targetLength, zero-padding or truncating.
     */
    private resizeArray;
    /**
     * Combine subsystem outputs into a final output vector.
     *
     * The output vector length matches embeddingDim so it can feed back into
     * the embedding space. Each position is a weighted blend of:
     *   - hyper-dimensional output (primary signal, weight 0.6)
     *   - MoE output (secondary signal, weight 0.3)
     *   - RLM action gate (weight 0.1)
     */
    private generateOutput;
}
