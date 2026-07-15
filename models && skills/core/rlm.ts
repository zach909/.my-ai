import { BackgroundQuantizer } from './quantizer.js';

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

export class RLMTrainer {
  private config: RLMConfig;
  private policyWeights: Float32Array;
  private policyBias: Float32Array;
  private targetWeights: Float32Array;
  private targetBias: Float32Array;
  private replayBuffer: Experience[];
  private bufferPosition: number;
  private stepCount: number;
  private totalReward: number;
  private episodeCount: number;
  private recentActions: number[];
  private currentExplorationRate: number;

  // Section 6: quantization-aware training. The forward pass (both action
  // selection and TD-target computation) reads quantizedWeights/Bias, a
  // cached quantize(full-precision + residual) snapshot refreshed once per
  // train() tick; updatePolicy() still writes full-precision weights
  // directly (straight-through: gradient bypasses the quantization op).
  // The leftover (full-precision - quantized) each refresh is carried
  // forward as the residual folded into the *next* tick's quantize() call,
  // so rounding error isn't just discarded but corrected over time.
  private quantizer: BackgroundQuantizer | null;
  private quantizedWeights: Float32Array;
  private quantizedBias: Float32Array;
  private weightResidual: Float32Array;
  private biasResidual: Float32Array;

  constructor(config: Record<string, any> = {}) {
    this.config = {
      stateDim: config.stateDim ?? config.hiddenDim ?? 64,
      actionDim: config.actionDim ?? 10,
      hiddenDim: config.hiddenDim ?? 128,
      learningRate: config.learningRate ?? 0.001,
      discountFactor: config.discountFactor ?? 0.99,
      explorationRate: config.explorationRate ?? 1.0,
      explorationDecay: config.explorationDecay ?? 0.995,
      minExplorationRate: config.minExplorationRate ?? 0.01,
      replayBufferSize: config.replayBufferSize ?? 10000,
      batchSize: config.batchSize ?? 64,
      targetUpdateFrequency: config.targetUpdateFrequency ?? 100,
      lookaheadSteps: config.thinkSteps ?? config.lookaheadSteps ?? 3,
      loopDetectionWindow: config.loopDetectionWindow ?? 20,
      quantizationEnabled: config.quantizationEnabled ?? true,
      quantizationBits: config.quantizationBits ?? 8,
    };
    this.replayBuffer = new Array(this.config.replayBufferSize);
    this.bufferPosition = 0;
    this.stepCount = 0;
    this.totalReward = 0;
    this.episodeCount = 0;
    this.recentActions = [];
    this.currentExplorationRate = this.config.explorationRate;
    this.policyWeights = new Float32Array(this.config.stateDim * this.config.actionDim);
    this.policyBias = new Float32Array(this.config.actionDim);
    this.targetWeights = new Float32Array(this.config.stateDim * this.config.actionDim);
    this.targetBias = new Float32Array(this.config.actionDim);
    this.initializePolicy(this.policyWeights, this.policyBias);
    this.initializePolicy(this.targetWeights, this.targetBias);

    this.quantizer = this.config.quantizationEnabled
      ? new BackgroundQuantizer({
          enabled: true,
          bits: this.config.quantizationBits,
          method: 'symmetric',
          calibrationSamples: 0,
          excludeLayers: [],
        })
      : null;
    this.weightResidual = new Float32Array(this.policyWeights.length);
    this.biasResidual = new Float32Array(this.policyBias.length);
    this.quantizedWeights = new Float32Array(this.policyWeights);
    this.quantizedBias = new Float32Array(this.policyBias);
    this.refreshQuantizedForward();
  }

  /**
   * Re-quantize the current full-precision weights/bias (plus carried-over
   * residual from the last refresh) into the cache the forward pass reads.
   * Called once per train() tick — not on every forward call — so the
   * residual reflects genuine drift between ticks rather than compounding
   * across repeated reads of an unchanged weight matrix.
   */
  private refreshQuantizedForward(): void {
    if (!this.quantizer) return;

    const wPlusResidual = new Float32Array(this.policyWeights.length);
    for (let i = 0; i < wPlusResidual.length; i++) {
      wPlusResidual[i] = this.policyWeights[i] + this.weightResidual[i];
    }
    const wq = this.quantizer.quantize(wPlusResidual);
    for (let i = 0; i < wq.length; i++) {
      this.weightResidual[i] = wPlusResidual[i] - wq[i];
    }
    this.quantizedWeights = wq;

    const bPlusResidual = new Float32Array(this.policyBias.length);
    for (let i = 0; i < bPlusResidual.length; i++) {
      bPlusResidual[i] = this.policyBias[i] + this.biasResidual[i];
    }
    const bq = this.quantizer.quantize(bPlusResidual);
    for (let i = 0; i < bq.length; i++) {
      this.biasResidual[i] = bPlusResidual[i] - bq[i];
    }
    this.quantizedBias = bq;
  }

  /** Mean absolute quantization residual currently carried for the weight matrix — a drift diagnostic. */
  getQuantizationDrift(): number {
    if (!this.quantizer || this.weightResidual.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.weightResidual.length; i++) sum += Math.abs(this.weightResidual[i]);
    return sum / this.weightResidual.length;
  }

  selectAction(state: Float32Array, availableActions?: number[]): { action: number; thinkingSteps: number[] } {
    const actions = availableActions || Array.from({ length: this.config.actionDim }, (_, i) => i);

    if (Math.random() < this.currentExplorationRate) {
      const idx = Math.floor(Math.random() * actions.length);
      return { action: actions[idx], thinkingSteps: [idx] };
    }

    const qValues = this.computeQValues(state);

    // Predict-before-commit: score every candidate action once (immediate Q
    // value plus a discounted simulated-reward estimate), then keep the top
    // `lookaheadSteps` candidates by score. Previously this looped
    // `lookaheadSteps` times over the *same* undisturbed state with only the
    // discount exponent changing per iteration, which never simulated a
    // future state and — since the exponent only shrinks each pass — could
    // never actually change which action won; it just repeated the same
    // one-ply evaluation and padded thinkingSteps with duplicates.
    const scored = actions
      .map(a => ({ action: a, score: qValues[a] + this.simulateStep(state, a) * this.config.discountFactor }))
      .sort((x, y) => y.score - x.score);

    const topK = scored.slice(0, Math.max(1, this.config.lookaheadSteps));
    const thinkingSteps = topK.map(c => c.action);
    let bestAction = topK[0].action;

    const loopAction = this.detectLoop(bestAction);
    if (loopAction !== -1) {
      const nonLoopActions = actions.filter(a => a !== loopAction);
      if (nonLoopActions.length > 0) {
        bestAction = nonLoopActions[0];
        let bestQ2 = -Infinity;
        for (const a of nonLoopActions) {
          if (qValues[a] > bestQ2) {
            bestQ2 = qValues[a];
            bestAction = a;
          }
        }
      }
    }

    return { action: bestAction, thinkingSteps };
  }

  addExperience(experience: Experience): void {
    this.replayBuffer[this.bufferPosition] = experience;
    this.bufferPosition = (this.bufferPosition + 1) % this.config.replayBufferSize;
    this.totalReward += experience.reward;
    this.stepCount++;

    this.recentActions.push(experience.action);
    if (this.recentActions.length > this.config.loopDetectionWindow) {
      this.recentActions.shift();
    }

    if (experience.done) {
      this.episodeCount++;
    }
  }

  async train(): Promise<TrainingResult> {
    const batch = this.sampleBatch();
    if (batch.length === 0) {
      return {
        loss: 0,
        avgReward: 0,
        explorationRate: this.currentExplorationRate,
        policyState: this.getPolicyState(),
        tdErrors: [],
        stepsTrained: 0,
      };
    }

    const tdErrors: number[] = [];
    let totalLoss = 0;

    for (const exp of batch) {
      const qValues = this.computeQValues(exp.state);
      const targetQValues = this.computeQValues(exp.nextState);
      const currentQ = qValues[exp.action];

      const maxNextQ = Math.max(...Array.from(targetQValues));
      const targetQ = exp.reward + (exp.done ? 0 : this.config.discountFactor * maxNextQ);
      const tdError = targetQ - currentQ;
      tdErrors.push(tdError);
      totalLoss += tdError * tdError;

      this.updatePolicy(exp.state, exp.action, tdError);
    }

    if (this.stepCount % this.config.targetUpdateFrequency === 0) {
      this.syncTargetPolicy();
    }

    this.decayExploration();

    // Once per tick: fold this batch's full-precision weight changes back
    // through the quantizer, carrying forward whatever rounding error is
    // left over as the residual for the next tick's forward pass.
    this.refreshQuantizedForward();

    const avgReward = batch.reduce((s, e) => s + e.reward, 0) / batch.length;

    return {
      loss: totalLoss / batch.length,
      avgReward,
      explorationRate: this.currentExplorationRate,
      policyState: this.getPolicyState(),
      tdErrors,
      stepsTrained: batch.length,
    };
  }

  private computeQValues(state: Float32Array): number[] {
    // QAT: forward reads the quantized snapshot when enabled, so action
    // selection and TD-targets both "think" in the same reduced-precision
    // representation the network will actually run under after export.
    const weights = this.quantizer ? this.quantizedWeights : this.policyWeights;
    const bias = this.quantizer ? this.quantizedBias : this.policyBias;

    const qValues: number[] = [];
    for (let a = 0; a < this.config.actionDim; a++) {
      let q = bias[a];
      for (let s = 0; s < state.length; s++) {
        q += state[s] * weights[s * this.config.actionDim + a];
      }
      qValues.push(q);
    }
    return qValues;
  }

  private computeTDError(experience: Experience): number {
    const qValues = this.computeQValues(experience.state);
    const targetQValues = this.computeQValues(experience.nextState);
    const currentQ = qValues[experience.action];
    const maxNextQ = Math.max(...Array.from(targetQValues));
    const targetQ = experience.reward + (experience.done ? 0 : this.config.discountFactor * maxNextQ);
    return targetQ - currentQ;
  }

  private updatePolicy(state: Float32Array, action: number, tdError: number): void {
    const gradient = tdError * this.config.learningRate;
    for (let s = 0; s < state.length; s++) {
      const idx = s * this.config.actionDim + action;
      this.policyWeights[idx] += gradient * state[s];
    }
    this.policyBias[action] += gradient;
  }

  private simulateStep(state: Float32Array, action: number): number {
    const qValues = this.computeQValues(state);
    return qValues[action] * 0.1;
  }

  private sampleBatch(): Experience[] {
    const available: Experience[] = [];
    for (let i = 0; i < this.config.replayBufferSize; i++) {
      const exp = this.replayBuffer[i];
      if (exp) available.push(exp);
    }
    if (available.length === 0) return [];

    const priorities = available.map(e => e.priority || 1);
    const totalPriority = priorities.reduce((s, p) => s + p, 0);
    const batch: Experience[] = [];
    const batchSize = Math.min(this.config.batchSize, available.length);

    for (let i = 0; i < batchSize; i++) {
      let r = Math.random() * totalPriority;
      let idx = 0;
      for (let j = 0; j < available.length; j++) {
        r -= priorities[j];
        if (r <= 0) {
          idx = j;
          break;
        }
      }
      batch.push(available[idx]);
    }

    return batch;
  }

  private syncTargetPolicy(): void {
    for (let i = 0; i < this.targetWeights.length; i++) {
      this.targetWeights[i] = this.policyWeights[i];
    }
    for (let i = 0; i < this.targetBias.length; i++) {
      this.targetBias[i] = this.policyBias[i];
    }
  }

  private decayExploration(): void {
    this.currentExplorationRate = Math.max(
      this.config.minExplorationRate,
      this.currentExplorationRate * this.config.explorationDecay
    );
  }

  private argmax(values: number[]): number {
    let maxIdx = 0;
    let maxVal = values[0];
    for (let i = 1; i < values.length; i++) {
      if (values[i] > maxVal) {
        maxVal = values[i];
        maxIdx = i;
      }
    }
    return maxIdx;
  }

  private secondArgmax(values: number[]): number {
    const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    return sorted.length > 1 ? sorted[1].i : sorted[0].i;
  }

  private initializePolicy(weights: Float32Array, bias: Float32Array): void {
    const scale = Math.sqrt(2.0 / this.config.stateDim);
    for (let i = 0; i < weights.length; i++) {
      weights[i] = (Math.random() * 2 - 1) * scale;
    }
    for (let i = 0; i < bias.length; i++) {
      bias[i] = (Math.random() * 2 - 1) * 0.01;
    }
  }

  private detectLoop(action: number): number {
    if (this.recentActions.length < this.config.loopDetectionWindow) return -1;
    const lastActions = this.recentActions.slice(-this.config.loopDetectionWindow);
    const half = Math.floor(lastActions.length / 2);
    const firstHalf = lastActions.slice(0, half);
    const secondHalf = lastActions.slice(half);
    if (firstHalf.length !== secondHalf.length) return -1;
    for (let i = 0; i < firstHalf.length; i++) {
      if (firstHalf[i] !== secondHalf[i]) return -1;
    }
    return action;
  }

  getBufferSize(): number {
    let count = 0;
    for (let i = 0; i < this.config.replayBufferSize; i++) {
      if (this.replayBuffer[i]) count++;
    }
    return count;
  }

  getExplorationRate(): number {
    return this.currentExplorationRate;
  }

  private getPolicyState(): PolicyState {
    const qValues = this.computeQValues(new Float32Array(this.config.stateDim));
    const avgQ = qValues.reduce((s, q) => s + q, 0) / qValues.length;
    return {
      stepCount: this.stepCount,
      totalReward: this.totalReward,
      episodeCount: this.episodeCount,
      avgQValue: avgQ,
    };
  }
}
