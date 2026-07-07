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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class HyperDimensionalEngine {
  private config: HyperConfig;
  private neurons: HyperNeuron[];
  private seenPatterns: Map<string, SeenPattern>;
  private history: StateTransition[];
  private iteration: number = 0;
  private totalDims: number;

  /**
   * Section 8: persistent per-connection weight tensor, all-to-all.
   * Flattened for cache locality: [targetNeuron][dimension][sourceNeuron]
   * This ensures that for a fixed target neuron i and dimension d,
   * we can iterate over all source neurons j sequentially.
   */
  private connDiag: Float32Array;
  private connShift: Float32Array;

  /** Bias is per-neuron (added once after the full summed product) */
  private bias: Float32Array;

  /** Consolidated state buffer: [dimension][neuron] for sequential access in hot loop */
  private allStates: Float32Array;

  // Section 10: compressed (rank-r) self-model
  private selfModelA: Float32Array;
  private selfModelB: Float32Array;
  private lastOutputVector: number[] | null = null;

  // Section 12: fast intra-settle self-model (EMA over mean content energy)
  private emaEnergy: number = 0;
  private hasEma: boolean = false;
  private sustainedDivergence: number = 0;

  // Pre-allocated scratch buffers
  private nextStatesBuffer: Float32Array;
  private tempCtx: Float32Array;
  private stateDeltasBuffer: Float32Array;

  constructor(config: Record<string, any> = {}) {
    this.config = {
      neuronCount: config.neuronCount ?? 100,
      dimensions: config.dimensions ?? config.hyperDimensions ?? 64,
      stateBits: config.stateBits ?? config.ballStates ?? 8,
      learningRate: config.learningRate ?? 0.1,
      influenceDecay: config.influenceDecay ?? config.noveltyDecay ?? 0.9,
      energyThreshold: config.stateTransitionThreshold ?? config.energyThreshold ?? 0.5,
      noveltyWindow: config.historyLength ?? config.noveltyWindow ?? 1000,
      crossInfluenceStrength: config.crossInfluenceStrength ?? 0.3,
      propagationSteps: config.propagationSteps ?? 8,
      convergenceThreshold: config.convergenceThreshold ?? 0.05,
      selfModelRank: config.selfModelRank ?? 4,
      divergenceTolerance: config.divergenceTolerance ?? 0.05,
      sustainedDivergenceTicks: config.sustainedDivergenceTicks ?? 3,
    };
    const N = this.config.neuronCount;
    const D = this.config.dimensions + 1;
    this.totalDims = D;
    this.neurons = [];
    this.seenPatterns = new Map();
    this.history = [];

    this.allStates = new Float32Array(D * N);
    this.connDiag = new Float32Array(N * D * N);
    this.connShift = new Float32Array(N * D * N);
    this.bias = new Float32Array(N * D);

    this.nextStatesBuffer = new Float32Array(N * D);
    this.tempCtx = new Float32Array(D);
    this.stateDeltasBuffer = new Float32Array(N);

    this.initializeNeurons();
    this.initializeConnections();

    const rank = this.config.selfModelRank;
    const dims = this.config.dimensions;
    this.selfModelA = new Float32Array(dims * rank);
    this.selfModelB = new Float32Array(rank * dims);
    const scale = Math.sqrt(1 / Math.max(1, dims));
    for (let i = 0; i < this.selfModelA.length; i++) this.selfModelA[i] = (Math.random() * 2 - 1) * scale;
    for (let i = 0; i < this.selfModelB.length; i++) this.selfModelB[i] = (Math.random() * 2 - 1) * scale;
  }

  /**
   * Run one tick: settle the mesh to convergence for the given input, apply
   * value-gated Hebbian weight learning, and derive all reported signals.
   */
  process(
    inputVector: number[] | Map<string, Float32Array>,
    learningRates?: Map<number, number>,
    directInputNeuronIds?: Set<number>
  ): HyperDimensionalOutput {
    let resolvedInput: number[];
    if (inputVector instanceof Map) {
      const arrays = Array.from(inputVector.values());
      if (arrays.length > 0) {
        resolvedInput = Array.from(arrays[0]);
      } else {
        resolvedInput = new Array(this.config.dimensions).fill(0);
      }
    } else {
      resolvedInput = inputVector;
    }

    const drivenIds = directInputNeuronIds ?? new Set(this.neurons.map(n => n.id));

    const preSettleStates = this.neurons.map(n => new Float32Array(n.state));
    const preSettleEnergies = new Map(this.neurons.map(n => [n.id, n.energy]));

    const { stateDeltas, liveCorrections, iterations } = this.settle(resolvedInput, drivenIds);

    this.applyWeightLearning(learningRates, stateDeltas);

    const transitions: StateTransition[] = [];
    for (let idx = 0; idx < this.neurons.length; idx++) {
      const neuron = this.neurons[idx];
      const newEnergy = this.computeStateEnergy(neuron.state);
      if (newEnergy !== preSettleEnergies.get(neuron.id)) {
        transitions.push({
          fromState: preSettleStates[idx],
          toState: new Float32Array(neuron.state),
          energy: newEnergy - (preSettleEnergies.get(neuron.id) ?? 0),
          timestamp: Date.now(),
          cause: 'input_update',
        });
      }
      neuron.energy = newEnergy;
    }

    const resolvedTransitions = this.resolveStateTransitions();

    const activeStates = this.getActiveStates();
    const outputVector = this.computeOutputVector(activeStates);
    const totalEnergy = this.neurons.reduce((s, n) => s + n.energy, 0);
    const dimensionalEntropy = this.computeDimensionalEntropy();
    const patternHash = this.hashVector(outputVector);
    const patternNovelty = this.computeNoveltyScore(patternHash);

    let selfModelSurprise = 0;
    if (this.lastOutputVector) {
      const predicted = this.selfModelPredict(this.lastOutputVector);
      selfModelSurprise = this.meanAbsDiff(predicted, outputVector);
      this.selfModelTrainStep(this.lastOutputVector, predicted, outputVector);
    }
    this.lastOutputVector = outputVector;

    const noveltyScore = clamp(0.6 * patternNovelty + 0.4 * selfModelSurprise, 0, 1);

    this.recordPattern(patternHash, noveltyScore);
    this.history.push(...transitions, ...resolvedTransitions);
    this.iteration++;

    const inputTopography = new Map<number, number>();
    for (const n of this.neurons) inputTopography.set(n.id, n.state[0]);

    return {
      outputVector,
      activeStates,
      totalEnergy,
      dimensionalEntropy,
      noveltyScore,
      transitionCount: resolvedTransitions.length,
      stateDeltas,
      selfModelSurprise,
      liveCorrections,
      inputTopography,
      settleIterations: iterations,
    };
  }

  hasSeenPattern(patternHash: string): boolean {
    return this.seenPatterns.has(patternHash);
  }

  getPatternNovelty(patternHash: string): number {
    return this.seenPatterns.get(patternHash)?.novelty ?? 1;
  }

  getSeenPatternCount(): number {
    return this.seenPatterns.size;
  }

  getHistory(): Array<{ hash: string; count: number; lastSeen: number; step: number }> {
    return Array.from(this.seenPatterns.entries()).map(([hash, pattern]) => ({
      hash,
      count: pattern.frequency,
      lastSeen: pattern.lastSeen,
      step: this.iteration,
    }));
  }

  getNeuronStates(): HyperNeuron[] {
    return this.neurons.map(n => ({ ...n, state: new Float32Array(n.state) }));
  }

  getContextMatrix(): { data: Float32Array; neuronCount: number; dims: number } {
    const N = this.config.neuronCount;
    const D = this.totalDims;
    const data = new Float32Array(N * D);
    for (let i = 0; i < N; i++) {
      for (let d = 0; d < D; d++) {
        data[i * D + d] = this.allStates[d * N + i];
      }
    }
    return { data, neuronCount: N, dims: D };
  }

  getInputTopography(): Map<number, number> {
    const map = new Map<number, number>();
    for (const n of this.neurons) map.set(n.id, n.state[0]);
    return map;
  }

  isExclusiveInput(threshold: number = 0.9): { exclusive: boolean; neuronId?: number } {
    const hot: number[] = [];
    for (const n of this.neurons) {
      if (n.state[0] >= threshold) hot.push(n.id);
    }
    return hot.length === 1 ? { exclusive: true, neuronId: hot[0] } : { exclusive: false };
  }

  private initializeNeurons(): void {
    const N = this.config.neuronCount;
    const D = this.totalDims;
    for (let i = 0; i < N; i++) {
      // Individual states are now interleaved in allStates,
      // we can't use subarray() for sequential per-neuron state easily
      // without sacrificing the hot loop's speed.
      // We'll keep 'state' as a separate Float32Array in HyperNeuron
      // for compatibility with other methods, but the hot loop
      // will use allStates directly.
      const state = new Float32Array(D);
      state[0] = 0;
      for (let d = 1; d < D; d++) {
        const val = Math.random() * 2 - 1;
        state[d] = val;
        this.allStates[d * N + i] = val;
      }
      this.neurons.push({
        id: i,
        state,
        energy: 0,
        transitions: [],
        influenceRadius: 0.1 + Math.random() * 0.4,
        activationThreshold: 0.3 + Math.random() * 0.4,
      });
    }
  }

  private initializeConnections(): void {
    const D = this.totalDims;
    const N = this.neurons.length;
    const scale = Math.sqrt(1 / Math.max(1, N));

    for (let i = 0; i < N; i++) {
      const biasOffset = i * D;
      for (let d = 0; d < D; d++) {
        this.bias[biasOffset + d] = 0;
      }

      for (let d = 0; d < D; d++) {
        const rowOffset = (i * D + d) * N;
        for (let j = 0; j < N; j++) {
          if (i === j) continue;
          this.connDiag[rowOffset + j] = (Math.random() * 2 - 1) * scale;
          this.connShift[rowOffset + j] = (Math.random() * 2 - 1) * scale * 0.5;
        }
      }
    }
  }

  /**
   * Propagate-to-convergence: S <- activate(bias + W . S), repeated.
   * Optimized for cache locality by using row-major access on weights
   * and consolidated sequential access on states.
   */
  private settle(
    resolvedInput: number[],
    drivenIds: Set<number>
  ): { stateDeltas: Map<number, number>; liveCorrections: number; iterations: number } {
    const D = this.totalDims;
    const N = this.neurons.length;
    const deltas = this.stateDeltasBuffer;
    deltas.fill(0);

    let liveCorrections = 0;
    let iterations = 0;
    const nextStates = this.nextStatesBuffer;
    const strength = this.config.crossInfluenceStrength;

    for (; iterations < this.config.propagationSteps; iterations++) {
      for (let i = 0; i < N; i++) {
        const biasOffset = i * D;
        for (let d = 0; d < D; d++) {
          let sum = this.bias[biasOffset + d];
          const rowOffset = (i * D + d) * N;

          // Row-major sequential access for fixed i, d
          const wdRow = this.connDiag.subarray(rowOffset, rowOffset + N);
          const wsRow = this.connShift.subarray(rowOffset, rowOffset + N);

          const sjRow = this.allStates.subarray(d * N, (d + 1) * N);
          const srcD = (d - 1 + D) % D;
          const sjShiftRow = this.allStates.subarray(srcD * N, (srcD + 1) * N);

          for (let j = 0; j < N; j++) {
            sum += sjRow[j] * wdRow[j] + sjShiftRow[j] * wsRow[j] * strength;
          }
          nextStates[i * D + d] = Math.tanh(sum);
        }
      }

      for (let i = 0; i < N; i++) {
        if (drivenIds.has(i)) {
          const offset = i * D;
          nextStates[offset] = 1.0;
          for (let d = 0; d < this.config.dimensions; d++) {
            nextStates[offset + d + 1] = clamp(resolvedInput[d] ?? 0, -1, 1);
          }
        }
      }

      const actualEnergy = this.meanContentEnergyBuffer(nextStates);
      const predictedEnergy = this.hasEma ? this.emaEnergy : actualEnergy;
      const divergence = Math.abs(actualEnergy - predictedEnergy);

      this.sustainedDivergence = divergence > this.config.divergenceTolerance ? this.sustainedDivergence + 1 : 0;

      if (this.sustainedDivergence >= this.config.sustainedDivergenceTicks) {
        for (let i = 0; i < N; i++) {
          if (drivenIds.has(i)) continue;
          const offset = i * D;
          const state = this.neurons[i].state;
          for (let d = 0; d < D; d++) {
            nextStates[offset + d] = 0.5 * nextStates[offset + d] + 0.5 * state[d];
          }
        }
        liveCorrections++;
        this.sustainedDivergence = 0;
      }

      const settledEnergy = this.meanContentEnergyBuffer(nextStates);
      this.emaEnergy = this.hasEma
        ? this.config.influenceDecay * this.emaEnergy + (1 - this.config.influenceDecay) * settledEnergy
        : settledEnergy;
      this.hasEma = true;

      let residual = 0;
      for (let i = 0; i < N; i++) {
        const state = this.neurons[i].state;
        const offset = i * D;
        let nodeDelta = 0;
        for (let d = 0; d < D; d++) {
          const nextVal = nextStates[offset + d];
          const diff = Math.abs(nextVal - state[d]);
          nodeDelta += diff;
          state[d] = nextVal;
          this.allStates[d * N + i] = nextVal;
        }
        residual += nodeDelta;
        deltas[i] += nodeDelta;
      }

      if (residual < this.config.convergenceThreshold) {
        iterations++;
        break;
      }
    }

    const stateDeltas = new Map<number, number>();
    for (let i = 0; i < N; i++) stateDeltas.set(i, deltas[i]);

    return { stateDeltas, liveCorrections, iterations };
  }

  private applyWeightLearning(learningRates: Map<number, number> | undefined, stateDeltas: Map<number, number>): void {
    const D = this.totalDims;
    const N = this.neurons.length;
    for (let i = 0; i < N; i++) {
      const rate = learningRates?.get(i) ?? this.config.learningRate;
      const si = this.neurons[i].state;
      const biasOffset = i * D;
      let deltaSum = 0;

      for (let d = 0; d < D; d++) {
        const rowOffset = (i * D + d) * N;
        const srcD = (d - 1 + D) % D;
        const sid = si[d];
        for (let j = 0; j < N; j++) {
          if (i === j) continue;
          const sj = this.neurons[j].state;

          const wdIdx = rowOffset + j;
          const oldWd = this.connDiag[wdIdx];
          const newWd = clamp(oldWd + rate * sid * sj[d], -2, 2);
          this.connDiag[wdIdx] = newWd;
          deltaSum += Math.abs(newWd - oldWd);

          const oldWs = this.connShift[wdIdx];
          const newWs = clamp(oldWs + rate * sid * sj[srcD], -2, 2);
          this.connShift[wdIdx] = newWs;
          deltaSum += Math.abs(newWs - oldWs);
        }
      }

      for (let d = 0; d < D; d++) {
        this.bias[biasOffset + d] = clamp(this.bias[biasOffset + d] + rate * 0.1 * si[d], -1, 1);
      }

      stateDeltas.set(i, (stateDeltas.get(i) ?? 0) + deltaSum);
    }
  }

  private meanContentEnergyBuffer(buffer: Float32Array): number {
    const N = this.config.neuronCount;
    const dims = this.config.dimensions;
    const D = this.totalDims;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const offset = i * D;
      for (let d = 1; d < D; d++) {
        const val = buffer[offset + d];
        sum += val * val;
      }
    }
    return sum / (N * dims);
  }

  private selfModelPredict(vec: number[]): number[] {
    const dims = this.config.dimensions;
    const rank = this.config.selfModelRank;
    const h = new Float32Array(rank);
    for (let d = 0; d < dims; d++) {
      const v = vec[d] ?? 0;
      for (let r = 0; r < rank; r++) h[r] += v * this.selfModelA[d * rank + r];
    }
    const out = new Array<number>(dims).fill(0);
    for (let r = 0; r < rank; r++) {
      for (let d = 0; d < dims; d++) out[d] += h[r] * this.selfModelB[r * dims + d];
    }
    return out;
  }

  private selfModelTrainStep(prevVec: number[], predicted: number[], actual: number[]): void {
    const dims = this.config.dimensions;
    const rank = this.config.selfModelRank;
    const lr = 0.01;

    const h = new Float32Array(rank);
    for (let d = 0; d < dims; d++) {
      const v = prevVec[d] ?? 0;
      for (let r = 0; r < rank; r++) h[r] += v * this.selfModelA[d * rank + r];
    }

    const error = new Float32Array(dims);
    for (let d = 0; d < dims; d++) error[d] = (actual[d] ?? 0) - (predicted[d] ?? 0);

    const dh = new Float32Array(rank);
    for (let r = 0; r < rank; r++) {
      let acc = 0;
      for (let d = 0; d < dims; d++) acc += error[d] * this.selfModelB[r * dims + d];
      dh[r] = acc;
    }

    for (let r = 0; r < rank; r++) {
      for (let d = 0; d < dims; d++) {
        this.selfModelB[r * dims + d] += lr * error[d] * h[r];
      }
    }
    for (let d = 0; d < dims; d++) {
      const v = prevVec[d] ?? 0;
      for (let r = 0; r < rank; r++) {
        this.selfModelA[d * rank + r] += lr * dh[r] * v;
      }
    }
  }

  private meanAbsDiff(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
    return sum / n;
  }

  private resolveStateTransitions(): StateTransition[] {
    const resolved: StateTransition[] = [];
    for (const neuron of this.neurons) {
      if (neuron.energy > this.config.energyThreshold) {
        const fromState = neuron.transitions.length > 0
          ? neuron.transitions[neuron.transitions.length - 1].toState
          : neuron.state;
        const transition: StateTransition = {
          fromState: new Float32Array(fromState),
          toState: new Float32Array(neuron.state),
          energy: neuron.energy,
          timestamp: Date.now(),
          cause: 'energy_resolved',
        };
        neuron.transitions.push(transition);
        resolved.push(transition);
      }
    }
    return resolved;
  }

  private computeStateEnergy(state: Float32Array): number {
    let energy = 0;
    for (let d = 1; d < state.length; d++) {
      energy += state[d] * state[d];
    }
    return energy / this.config.dimensions;
  }

  private computeOutputVector(activeStates: HyperNeuron[]): number[] {
    const dims = this.config.dimensions;
    const output = new Array(dims).fill(0);
    if (activeStates.length === 0) return output;

    for (const neuron of activeStates) {
      const state = neuron.state;
      const energy = neuron.energy;
      for (let d = 0; d < dims; d++) {
        output[d] += state[d + 1] * energy;
      }
    }

    const norm = Math.sqrt(output.reduce((s, v) => s + v * v, 0)) || 1;
    for (let d = 0; d < dims; d++) {
      output[d] /= norm;
    }

    return output;
  }

  private getActiveStates(): HyperNeuron[] {
    return this.neurons.filter(n => n.energy > this.config.energyThreshold);
  }

  private computeDimensionalEntropy(): number {
    const N = this.neurons.length;
    const dims = this.config.dimensions;
    let entropy = 0;
    const buckets = 10;
    const hist = new Array(buckets);

    for (let d = 0; d < dims; d++) {
      hist.fill(0);
      for (let i = 0; i < N; i++) {
        const v = this.neurons[i].state[d + 1];
        const idx = Math.min(buckets - 1, Math.floor(((v + 1) / 2) * buckets));
        hist[idx]++;
      }
      for (let b = 0; b < buckets; b++) {
        const p = hist[b] / N;
        if (p > 0) entropy -= p * Math.log2(p);
      }
    }
    return entropy / dims;
  }

  private computeNoveltyScore(patternHash: string): number {
    const seen = this.seenPatterns.get(patternHash);
    if (!seen) return 1;

    const timeSinceLastSeen = Date.now() - seen.lastSeen;
    const recencyFactor = Math.exp(-timeSinceLastSeen / this.config.noveltyWindow);
    const frequencyPenalty = Math.min(1, seen.frequency / 10);

    return Math.max(0, 1 - recencyFactor * frequencyPenalty);
  }

  private recordPattern(patternHash: string, novelty: number): void {
    const existing = this.seenPatterns.get(patternHash);
    if (existing) {
      existing.frequency++;
      existing.lastSeen = Date.now();
      existing.novelty = novelty;
    } else {
      this.seenPatterns.set(patternHash, {
        hash: patternHash,
        frequency: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        novelty,
      });
    }
  }

  private hashVector(vector: number[]): string {
    let hash = 0;
    for (let i = 0; i < vector.length; i++) {
      const val = Math.round(vector[i] * 10000);
      hash = ((hash << 5) - hash) + val;
      hash = hash & hash;
    }
    return `hd_${hash}`;
  }
}
