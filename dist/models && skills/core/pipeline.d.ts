import { ZipIOSystem } from './zip-io.js';
import { type VetoDecision } from './alignment-veto.js';
export interface PipelineConfig {
    embeddingDim: number;
    hiddenDim: number;
    meshNodes: number;
    hyperDimensions: number;
    /**
     * Directory for the zip-loop's periodic disk checkpoints. When set, the
     * ring buffer's context survives past its own live window (and past
     * process restarts) by reloading the last checkpoint on startup. Omit to
     * keep the loop purely in-memory (checkpoints still get a tmpdir path but
     * are never auto-restored).
     */
    zipPersistDir?: string;
    /** Section 3.3 tuning: consecutive over-tolerance settle iterations
     *  required before live correction fires. Defaults to the engine's own
     *  default (3) when omitted. */
    hyperSustainedDivergenceTicks?: number;
    /** Section 3.3 tuning: energy-divergence-from-EMA threshold a settle
     *  iteration must exceed to count toward sustained divergence. Defaults
     *  to the engine's own default (0.05) when omitted. */
    hyperDivergenceTolerance?: number;
    /** Use the multidimensional all-to-all ElasticCoreBlock as the transformer-core replacement. */
    useElasticCore?: boolean;
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
    /** Real plugin/skill ids the MoE router picked for this run, if any */
    selectedPlugins: string[];
    /** Section 3: alignment veto verdict on this run's chosen action. */
    alignment: VetoDecision;
    /** Section 3.2: this tick's self-model prediction-error signal. */
    selfModelSurprise: number;
    /** Section 3.3: 1 if live correction fired on this tick's hyperdimensional settle, else 0. */
    liveCorrections: number;
    /** Per-elastic-core-neuron movement from this tick, keyed by neuron id. */
    elasticStateDeltas: Map<number, number>;
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
    private alignmentVeto;
    private elasticCore;
    private valueBudgetSize;
    private valueInitialized;
    private expertPluginMap;
    private expertNeuronRegistry;
    private runHistory;
    constructor(config?: Partial<PipelineConfig>);
    private ensureSubsystems;
    /**
     * Reload the zip-loop's last disk checkpoint, if zipPersistDir is
     * configured and a checkpoint exists. Call once after construction/reset
     * and before the first run() to pick up context from a prior process.
     */
    restorePersistedState(): Promise<void>;
    /**
     * Elastic value budget → per-neuron learning rates (Section 1.3 / audit
     * item 1). Higher value points → lower learning rate (stable, "locked in"
     * knowledge); lower value points → higher learning rate (plastic, still
     * adapting). Node ids from both the mesh and the hyperdimensional engine
     * share this one budget space, sized to the larger of the two in
     * ensureSubsystems().
     */
    private ensureValueInitialized;
    private getValueLearningRates;
    /**
     * The same zero-sum points as getValueLearningRates(), read as a raw [0,1]
     * vale fraction instead of a learning rate. This is what gates the
     * state-transition blend (new_state = vale*old_state + (1-vale)*computed)
     * in both the mesh and the hyperdimensional engine, so a neuron's
     * accumulated value simultaneously slows its weight updates *and* makes
     * its activation resist being overwritten each tick.
     */
    private getValeFractions;
    /**
     * Feed a subsystem's per-neuron activity (how much each neuron just
     * changed) back into the value budget: neurons that changed a lot give up
     * value points (become more plastic / lower-value); neurons that barely
     * changed keep theirs and gradually accrue points redistributed from
     * unstable neighbors (the zero-sum "learn but don't forget" mechanism).
     */
    private feedbackToValueBudget;
    /**
     * Grow the Elastic Core by one neuron and enroll the new neuron id in the
     * zero-sum ValueRangeAllocator without reinitializing existing allocations.
     */
    addElasticNeuron(group?: string): number;
    getValeFraction(neuronId: number): number | undefined;
    /**
     * Run all 7 subsystems in sequence on an embedding vector.
     *
     * Sequence:
     *   0. ZipIO   — infinite loop context ingestion (Section 1.10)
     *   1. MoE     — mixture-of-experts routing on the embedding
     *   2. Elastic — all-to-all multidimensional transformer-core replacement
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
     * MoE expert index → real plugin/skill id, for introspection of which
     * concrete capability each expert slot represents.
     */
    getExpertPluginMap(): Map<number, string>;
    /** Real plugin/skill id -> Elastic Core neuron ids that exist. */
    getExpertNeuronRegistry(): Map<string, number[]>;
    private neuronIdsForExperts;
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
