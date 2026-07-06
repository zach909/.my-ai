export interface RLMConfig {
    stateDim: number;
    actionDim: number;
    hiddenDim: number;
    learningRate: number;
    discountFactor: number;
    explorationRate: number;
    explorationDecay: number;
    minExplorationRate: number;
    replayBufferSize: number;
    batchSize: number;
    targetUpdateFrequency: number;
    lookaheadSteps: number;
    loopDetectionWindow: number;
    /** Quantization-aware training: forward pass reads quantized weights/bias. */
    quantizationEnabled: boolean;
    quantizationBits: number;
}
export interface Experience {
    state: Float32Array;
    action: number;
    reward: number;
    nextState: Float32Array;
    done: boolean;
    priority: number;
    timestamp: number;
    thinkingSteps?: number[];
}
export interface ThinkStep {
    stepIndex: number;
    state: Float32Array;
    selectedAction: number;
    qValues: number[];
    reward: number;
    isLoop: boolean;
}
export interface ReplayBuffer {
    experiences: Experience[];
    capacity: number;
    size: number;
    position: number;
}
export interface TrainingResult {
    loss: number;
    avgReward: number;
    explorationRate: number;
    policyState: PolicyState;
    tdErrors: number[];
    stepsTrained: number;
}
export interface PolicyState {
    stepCount: number;
    totalReward: number;
    episodeCount: number;
    avgQValue: number;
}
export declare class RLMTrainer {
    private config;
    private policyWeights;
    private policyBias;
    private targetWeights;
    private targetBias;
    private replayBuffer;
    private bufferPosition;
    private stepCount;
    private totalReward;
    private episodeCount;
    private recentActions;
    private currentExplorationRate;
    private quantizer;
    private quantizedWeights;
    private quantizedBias;
    private weightResidual;
    private biasResidual;
    constructor(config?: Record<string, any>);
    /**
     * Re-quantize the current full-precision weights/bias (plus carried-over
     * residual from the last refresh) into the cache the forward pass reads.
     * Called once per train() tick — not on every forward call — so the
     * residual reflects genuine drift between ticks rather than compounding
     * across repeated reads of an unchanged weight matrix.
     */
    private refreshQuantizedForward;
    /** Mean absolute quantization residual currently carried for the weight matrix — a drift diagnostic. */
    getQuantizationDrift(): number;
    selectAction(state: Float32Array, availableActions?: number[]): {
        action: number;
        thinkingSteps: number[];
    };
    addExperience(experience: Experience): void;
    train(): Promise<TrainingResult>;
    private computeQValues;
    private computeTDError;
    private updatePolicy;
    private simulateStep;
    private sampleBatch;
    private syncTargetPolicy;
    private decayExploration;
    private argmax;
    private secondArgmax;
    private initializePolicy;
    private detectLoop;
    getBufferSize(): number;
    getExplorationRate(): number;
    private getPolicyState;
}
