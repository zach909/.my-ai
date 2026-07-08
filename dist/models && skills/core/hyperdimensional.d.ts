export interface HyperNeuron {
    id: number;
    /**
     * State vector, length = dimensions + 1. Index 0 is a reserved input-flag
     * dimension (1.0 when this neuron is directly externally driven this tick,
     * decaying/diffusing otherwise via the same propagation as any other
     * dimension); indices 1..dimensions are content.
     */
    state: Float32Array;
    energy: number;
    transitions: StateTransition[];
    influenceRadius: number;
    activationThreshold: number;
}
export interface StateTransition {
    fromState: Float32Array;
    toState: Float32Array;
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
    /** Sum of absolute per-dimension state change this tick, keyed by neuron id */
    stateDeltas: Map<number, number>;
    /**
     * |predicted - actual| between the compressed self-model's forecast of
     * this tick's outputVector (made at the end of the previous tick) and what
     * actually happened. 0 on the first tick, when there is no prior forecast.
     */
    selfModelSurprise: number;
    /** Number of sustained-divergence corrections applied during this tick's settle loop. */
    liveCorrections: number;
    /** Per-neuron reading of the input-flag dimension after settling: how close each neuron is, this tick, to a directly-driven input. */
    inputTopography: Map<number, number>;
    /** Iterations the settle loop actually ran (<= propagationSteps). */
    settleIterations: number;
}
export interface HyperConfig {
    neuronCount: number;
    /** Content dimensions per neuron (excludes the reserved input-flag dimension). */
    dimensions: number;
    stateBits: number;
    learningRate: number;
    influenceDecay: number;
    energyThreshold: number;
    noveltyWindow: number;
    crossInfluenceStrength: number;
    /** Max iterations of propagate-to-convergence per process() call. */
    propagationSteps: number;
    /** Settle loop stops early once total residual change drops below this. */
    convergenceThreshold: number;
    /** Rank of the compressed self-model used for meta-awareness (section 10). */
    selfModelRank: number;
    /** Live-correction (section 12): per-iteration divergence above this is "off track". */
    divergenceTolerance: number;
    /** Live-correction: how many consecutive off-track iterations before damping kicks in. */
    sustainedDivergenceTicks: number;
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
    private totalDims;
    /**
     * Section 8: persistent per-connection weight tensor, all-to-all.
     * Flattened for cache locality: [targetNeuron][dimension][sourceNeuron]
     * This ensures that for a fixed target neuron i and dimension d,
     * we can iterate over all source neurons j sequentially.
     */
    private connDiag;
    private connShift;
    /** Bias is per-neuron (added once after the full summed product) */
    private bias;
    /** Consolidated state buffer: [dimension][neuron] for sequential access in hot loop */
    private allStates;
    private selfModelA;
    private selfModelB;
    private lastOutputVector;
    private emaEnergy;
    private hasEma;
    private sustainedDivergence;
    private nextStatesBuffer;
    private tempCtx;
    private stateDeltasBuffer;
    constructor(config?: Record<string, any>);
    /**
     * Run one tick: settle the mesh to convergence for the given input, apply
     * value-gated Hebbian weight learning, and derive all reported signals.
     */
    process(inputVector: number[] | Map<string, Float32Array>, learningRates?: Map<number, number>, directInputNeuronIds?: Set<number>, vale?: Map<number, number>): HyperDimensionalOutput;
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
    getContextMatrix(): {
        data: Float32Array;
        neuronCount: number;
        dims: number;
    };
    getInputTopography(): Map<number, number>;
    isExclusiveInput(threshold?: number): {
        exclusive: boolean;
        neuronId?: number;
    };
    /**
     * Section 9: on-demand symbolic trace. The mesh computes numerically (fast,
     * Pi-feasible); this reconstructs the *literal* pre-activation equation for
     * one neuron's dimension by walking backward through the weighted
     * connections that fed it, using the current settled state. Each term is
     * evaluated so callers see both the algebra and the numeric contribution,
     * ranked by magnitude — the human-readable version of the autograd graph.
     *
     * The settle rule reproduced here is:
     *   state_i[d] = tanh( bias_i[d]
     *     + Σ_j ( state_j[d]·Wdiag_ij[d]
     *           + state_j[(d-1)%D]·Wshift_ij[d]·crossInfluenceStrength ) )
     *
     * @returns null if the neuron/dimension is out of range.
     */
    traceNeuron(neuronId: number, dim: number, topK?: number): {
        neuronId: number;
        dim: number;
        bias: number;
        preActivation: number;
        value: number;
        /**
         * True when this neuron was clamped to external input on the last tick
         * (its input-flag dimension is hot). Its stored state then comes from the
         * input, not from tanh(W·S), so `value` here is the *counterfactual* the
         * mesh would have settled to from its incoming connections alone, not the
         * clamped value actually held.
         */
        inputClamped: boolean;
        terms: Array<{
            source: string;
            weight: number;
            sourceValue: number;
            contribution: number;
        }>;
        equation: string;
    } | null;
    /**
     * Section 4: declarative "definishon" training (neuron-level unit testing).
     * Each definition is a contract: when `driveNeuronId` is the *only*
     * externally-driven neuron (clamped to `input`), the mesh must settle so
     * that `readoutNeuronId`'s content matches `target`. We satisfy all
     * contracts at once by a delta-rule update on each readout neuron's incoming
     * weights (clamp → settle → check → adjust), plus a weight penalty so the
     * underdetermined solution prefers small weights.
     *
     * Contradictory contracts (e.g. same drive/readout, different targets) can
     * never all be satisfied; we detect them by tracking each contract's loss
     * over epochs and flagging pairs whose losses are strongly anti-correlated
     * (driving one down drives the other up).
     *
     * When a contract's loss is under `tolerance` its readout neuron is reported
     * as satisfied — the hook the notes describe for raising that neuron's vale
     * (locking it) in the external value budget.
     */
    trainDefinitions(definitions: Array<{
        driveNeuronId: number;
        input: number[];
        readoutNeuronId: number;
        target: number[];
    }>, opts?: {
        epochs?: number;
        learningRate?: number;
        weightPenalty?: number;
        tolerance?: number;
    }): {
        converged: boolean;
        epochs: number;
        losses: number[];
        satisfied: number[];
        conflicts: Array<{
            a: number;
            b: number;
            correlation: number;
        }>;
    };
    private initializeNeurons;
    private initializeConnections;
    /**
     * Propagate-to-convergence: S <- activate(bias + W . S), repeated.
     * Optimized for cache locality by using row-major access on weights
     * and consolidated sequential access on states.
     */
    private settle;
    private applyWeightLearning;
    private meanContentEnergyBuffer;
    /**
     * Section 13 → §12: evaluate the compressed self-model AND its instantaneous
     * rate of change in a single forward pass using dual numbers. `velocity` is
     * the per-dimension rate of change of the input (e.g. current minus previous
     * output). Each input dimension enters as a dual (value, velocity) and is
     * propagated through the linear self-model, so the ε-component of the output
     * is the predicted derivative. Live correction can then react to the trend
     * (is divergence growing?) rather than only the current level.
     */
    predictSelfModelWithDerivative(vec: number[], velocity: number[]): {
        value: number[];
        derivative: number[];
    };
    /** Rank-r compressed self-model: predict(x) = B^T (A^T x). */
    private selfModelPredict;
    private selfModelTrainStep;
    private meanAbsDiff;
    private resolveStateTransitions;
    private computeStateEnergy;
    private computeOutputVector;
    private getActiveStates;
    private computeDimensionalEntropy;
    private computeNoveltyScore;
    private recordPattern;
    private hashVector;
}
