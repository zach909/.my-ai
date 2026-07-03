import { RLMTrainer as CoreRLMTrainer } from './core/rlm.js';

export { CoreRLMTrainer as RLMTrainer };

export class RLMAgent {
  private core: CoreRLMTrainer;

  constructor(hiddenDim: number = 64, actionDim: number = 10) {
    this.core = new CoreRLMTrainer({
      hiddenDim, stateDim: hiddenDim, actionDim,
      explorationRate: 0.1, discountFactor: 0.99,
      replayBufferSize: 10000, batchSize: 32, thinkSteps: 3,
    });
  }

  getCore(): CoreRLMTrainer { return this.core; }
  selectAction(state: Float32Array): { action: number; thinkingSteps: number[] } { return this.core.selectAction(state); }
  addExperience(exp: import("./core/rlm.js").Experience): void { this.core.addExperience(exp); }
  async train(): Promise<import("./core/rlm.js").TrainingResult> { return this.core.train(); }
  getBufferSize(): number { return this.core.getBufferSize(); }
  getExplorationRate(): number { return this.core.getExplorationRate(); }
}
