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
    constructor(config?: Record<string, any>);
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
