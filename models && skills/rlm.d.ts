import { RLMTrainer as CoreRLMTrainer } from './core/rlm.js';
export { CoreRLMTrainer as RLMTrainer };
export declare class RLMAgent {
    private core;
    constructor(hiddenDim?: number, actionDim?: number);
    getCore(): CoreRLMTrainer;
    selectAction(state: Float32Array): {
        action: number;
        thinkingSteps: number[];
    };
    addExperience(exp: import("./core/rlm.js").Experience): void;
    train(): Promise<import("./core/rlm.js").TrainingResult>;
    getBufferSize(): number;
    getExplorationRate(): number;
}
