export interface HyperNeuron {
    id: number;
    /**
     * State vector, length = dimensions + 1. Index 0 is a reserved input-flag
     * dimension (1.0 when this neuron is directly externally driven this tick,
     * decaying/diffusing otherwise via the same propagation as any other
     * dimension); indices 1..dimensions are content.
     */
    state: number[];
    energy: number;
    transitions: StateTransition[];
    influenceRadius: number;
    activationThreshold: number;
}
export interface StateTransition {
    fromState: number[];
    toState: number[];
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
    private connDiag;
    private connShift;
    private bias;
    private selfModelA;
    private selfModelB;
    private lastOutputVector;
    private emaEnergy;
    private hasEma;
    private sustainedDivergence;
    constructor(config?: Record<string, any>);
    /**
     * Run one tick: settle the mesh to convergence for the given input, apply
     * value-gated Hebbian weight learning, and derive all reported signals
     * from the resulting settled state S.
     *
     * @param directInputNeuronIds Neurons directly clamped to `inputVector`
     *   this tick (their input-flag dimension goes hot; all others evolve
     *   purely by propagation from the weight tensor). Omit to drive every
     *   neuron directly, matching the legacy shared-input behaviour.
     */
    process(inputVector: number[] | Map<string, Float32Array>, learningRates?: Map<number, number>, directInputNeuronIds?: Set<number>): HyperDimensionalOutput;
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
    /**
     * The settled state S as a single matrix accessor (neurons x totalDims,
     * row-major) — "current full context", reused by self-reading,
     * quantization, and (when built) the alignment veto.
     */
    getContextMatrix(): {
        data: Float32Array;
        neuronCount: number;
        dims: number;
    };
    /** Per-neuron reading of the input-flag dimension (section 5 self-reading). */
    getInputTopography(): Map<number, number>;
    /**
     * Formalizes "exclusive input": true iff exactly one neuron's input-flag
     * dimension is hot (>= threshold) this tick.
     */
    isExclusiveInput(threshold?: number): {
        exclusive: boolean;
        neuronId?: number;
    };
    private initializeNeurons;
    private initializeConnections;
    /**
     * Propagate-to-convergence: S <- activate(bias + W . S), repeated, rather
     * than a single hop. Neurons in `drivenIds` are clamped to the external
     * input for the whole settle (the "exclusive input" contract); everyone
     * else evolves purely from the connection tensor, so their input-flag
     * dimension diffuses outward from the driven neurons and gives every
     * neuron a reading of the input topography once settled.
     */
    private settle;
    /**
     * Hebbian weight update gated per-node by an externally supplied learning
     * rate (from the elastic value budget), applied to the connection tensor
     * built in initializeConnections(). Weight-change magnitude is folded into
     * `stateDeltas` so callers can feed one combined signal back into the
     * value budget.
     */
    private applyWeightLearning;
    private meanContentEnergy;
    /** Rank-r compressed self-model: predict(x) = B^T (A^T x). */
    private selfModelPredict;
    /** One online gradient step on the compressed self-model toward reducing predicted-vs-actual error. */
    private selfModelTrainStep;
    private meanAbsDiff;
    private resolveStateTransitions;
    /** Content-only energy (excludes the reserved input-flag dimension at index 0). */
    private computeStateEnergy;
    private computeOutputVector;
    private getActiveStates;
    private computeDimensionalEntropy;
    private computeNoveltyScore;
    private recordPattern;
    private hashVector;
}
