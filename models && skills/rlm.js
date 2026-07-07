import { RLMTrainer as CoreRLMTrainer } from './core/rlm.js';
export { CoreRLMTrainer as RLMTrainer };
export class RLMAgent {
    core;
    constructor(hiddenDim = 64, actionDim = 10) {
        this.core = new CoreRLMTrainer({
            hiddenDim, stateDim: hiddenDim, actionDim,
            explorationRate: 0.1, discountFactor: 0.99,
            replayBufferSize: 10000, batchSize: 32, thinkSteps: 3,
        });
    }
    getCore() { return this.core; }
    selectAction(state) { return this.core.selectAction(state); }
    addExperience(exp) { this.core.addExperience(exp); }
    async train() { return this.core.train(); }
    getBufferSize() { return this.core.getBufferSize(); }
    getExplorationRate() { return this.core.getExplorationRate(); }
}
