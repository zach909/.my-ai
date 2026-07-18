import { type Dual, dual, add as dAdd, scale as dScale } from './dual.js';

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

/** Pearson correlation of two equal-length series; 0 if undefined (no variance). */
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
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
    directInputNeuronIds?: Set<number>,
    vale?: Map<number, number>
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

    const { stateDeltas, liveCorrections, iterations } = this.settle(resolvedInput, drivenIds, vale);

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

  /** Total configured neuron count (fixed at construction). */
  getNeuronCount(): number {
    return this.neurons.length;
  }

  /** Content dimensions per neuron (excludes the reserved input-flag dimension). */
  getDimensions(): number {
    return this.config.dimensions;
  }

  /**
   * Section 2.3: directly set a connection's diagonal weight (targetId's
   * incoming weight from sourceId, for one content dimension) — the write
   * path the NeuroLang DSL's `@connections=` primitive uses to wire two
   * declared neurons together, rather than only ever learning weights
   * through Hebbian/delta-rule updates.
   */
  setConnectionWeight(targetId: number, sourceId: number, dim: number, weight: number): void {
    const D = this.totalDims;
    if (targetId === sourceId || dim < 0 || dim >= D) return;
    if (!this.neurons.some(n => n.id === targetId) || !this.neurons.some(n => n.id === sourceId)) return;
    const N = this.neurons.length;
    const idx = (targetId * D + dim) * N + sourceId;
    this.connDiag[idx] = clamp(weight, -2, 2);
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
  traceNeuron(
    neuronId: number,
    dim: number,
    topK: number = 8
  ): {
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
    terms: Array<{ source: string; weight: number; sourceValue: number; contribution: number }>;
    equation: string;
  } | null {
    const D = this.totalDims;
    if (dim < 0 || dim >= D) return null;
    const target = this.neurons.find(n => n.id === neuronId);
    if (!target) return null;

    const N = this.neurons.length;
    const bias = this.bias[neuronId * D + dim];
    const rowOffset = (neuronId * D + dim) * N;
    const srcD = (dim - 1 + D) % D;
    const cross = this.config.crossInfluenceStrength;

    const terms: Array<{ source: string; weight: number; sourceValue: number; contribution: number }> = [];
    let preActivation = bias;
    for (const nj of this.neurons) {
      if (nj.id === neuronId) continue;
      const wd = this.connDiag[rowOffset + nj.id];
      const ws = this.connShift[rowOffset + nj.id];

      const diagContribution = nj.state[dim] * wd;
      preActivation += diagContribution;
      terms.push({ source: `n${nj.id}.d${dim}`, weight: wd, sourceValue: nj.state[dim], contribution: diagContribution });

      const shiftWeight = ws * cross;
      const shiftContribution = nj.state[srcD] * shiftWeight;
      preActivation += shiftContribution;
      terms.push({ source: `n${nj.id}.d${srcD}`, weight: shiftWeight, sourceValue: nj.state[srcD], contribution: shiftContribution });
    }

    terms.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    const top = terms.slice(0, topK);

    const inputClamped = target.state[0] >= 0.9;

    const fmt = (v: number) => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(4);
    const body = top.map(t => `${fmt(t.weight)}·${t.source}`).join(' ');
    const omitted = terms.length > top.length ? ` … (+${terms.length - top.length} smaller terms)` : '';
    const clampNote = inputClamped ? ' [input-clamped: counterfactual]' : '';
    const equation = `n${neuronId}.d${dim} = tanh( ${fmt(bias)} ${body}${omitted} ) = ${Math.tanh(preActivation).toFixed(4)}${clampNote}`;

    return {
      neuronId,
      dim,
      bias,
      preActivation,
      value: Math.tanh(preActivation),
      inputClamped,
      terms: top,
      equation,
    };
  }

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
  trainDefinitions(
    definitions: Array<{ driveNeuronId: number; input: number[]; readoutNeuronId: number; target: number[] }>,
    opts: { epochs?: number; learningRate?: number; weightPenalty?: number; tolerance?: number } = {}
  ): {
    converged: boolean;
    epochs: number;
    losses: number[];
    satisfied: number[];
    conflicts: Array<{ a: number; b: number; correlation: number }>;
  } {
    const epochs = opts.epochs ?? 200;
    const lr = opts.learningRate ?? 0.1;
    const penalty = opts.weightPenalty ?? 1e-4;
    const tolerance = opts.tolerance ?? 1e-3;
    const dims = this.config.dimensions;
    const D = this.totalDims;

    const lossHistory: number[][] = definitions.map(() => []);
    let losses = definitions.map(() => Infinity);
    let converged = false;
    let ranEpochs = 0;

    for (let epoch = 0; epoch < epochs; epoch++) {
      ranEpochs = epoch + 1;
      losses = [];

      for (const def of definitions) {
        // clamp → settle → read
        this.settle(def.input, new Set([def.driveNeuronId]));
        const readout = this.neurons.find(n => n.id === def.readoutNeuronId);
        if (!readout) { losses.push(Infinity); continue; }

        // Delta rule on the readout's incoming diagonal weights, through tanh'.
        const N = this.neurons.length;
        const biasOffset = def.readoutNeuronId * D;
        let sse = 0;
        for (let d = 0; d < dims; d++) {
          const cd = d + 1; // content index (0 is the input flag)
          const actual = readout.state[cd];
          const err = (def.target[d] ?? 0) - actual;
          sse += err * err;
          const grad = err * (1 - actual * actual); // tanh'
          const rowOffset = (def.readoutNeuronId * D + cd) * N;
          for (const nj of this.neurons) {
            if (nj.id === def.readoutNeuronId) continue;
            const wdIdx = rowOffset + nj.id;
            this.connDiag[wdIdx] = clamp(this.connDiag[wdIdx] + lr * grad * nj.state[cd] - penalty * this.connDiag[wdIdx], -2, 2);
          }
          this.bias[biasOffset + cd] = clamp(this.bias[biasOffset + cd] + lr * grad - penalty * this.bias[biasOffset + cd], -1, 1);
        }
        losses.push(sse / dims);
      }

      for (let i = 0; i < definitions.length; i++) lossHistory[i].push(losses[i]);
      if (losses.every(l => l < tolerance)) { converged = true; break; }
    }

    const satisfied = definitions
      .map((def, i) => ({ id: def.readoutNeuronId, ok: losses[i] < tolerance }))
      .filter(x => x.ok)
      .map(x => x.id);

    // Conflict detection. A direct contradiction (same readout, incompatible
    // targets) drives both losses to a stuck, near-flat equilibrium rather
    // than a visibly oscillating one, so anti-correlation of loss *levels*
    // alone misses it. Combine two signals over pairs that did not both
    // converge: (1) a structural check — they constrain the same readout to
    // targets further apart than tolerance allows; (2) anti-correlated loss
    // *deltas* (satisfying one epoch-over-epoch worsens the other).
    const deltas = lossHistory.map(h => h.slice(1).map((v, k) => v - h[k]));
    const targetDist = (a: number[], b: number[]) => {
      let s = 0;
      for (let d = 0; d < dims; d++) { const e = (a[d] ?? 0) - (b[d] ?? 0); s += e * e; }
      return Math.sqrt(s / dims);
    };

    const conflicts: Array<{ a: number; b: number; correlation: number }> = [];
    for (let i = 0; i < definitions.length; i++) {
      for (let j = i + 1; j < definitions.length; j++) {
        if (losses[i] < tolerance && losses[j] < tolerance) continue;
        const structural =
          definitions[i].readoutNeuronId === definitions[j].readoutNeuronId &&
          targetDist(definitions[i].target, definitions[j].target) > Math.sqrt(tolerance);
        const corr = pearson(deltas[i], deltas[j]);
        if (structural || corr < -0.5) conflicts.push({ a: i, b: j, correlation: corr });
      }
    }

    return { converged, epochs: ranEpochs, losses, satisfied, conflicts };
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
    drivenIds: Set<number>,
    vale?: Map<number, number>
  ): { stateDeltas: Map<number, number>; liveCorrections: number; iterations: number } {
    const D = this.totalDims;
    const N = this.neurons.length;
    const deltas = this.stateDeltasBuffer;
    deltas.fill(0);

    let liveCorrections = 0;
    let iterations = 0;
    const nextStates = this.nextStatesBuffer;
    const strength = this.config.crossInfluenceStrength;
    const dims = this.config.dimensions;

    // Pre-allocate fast lookup structures to avoid Map/Set lookup inside loop
    const isDriven = new Uint8Array(N);
    for (const id of drivenIds) {
      if (id >= 0 && id < N) {
        isDriven[id] = 1;
      }
    }

    const vs = new Float32Array(N);
    const hasV = new Uint8Array(N);
    const priorStates = new Array<Float32Array>(N);
    for (let i = 0; i < N; i++) {
      priorStates[i] = this.neurons[i].state;
      const v = vale?.get(i);
      if (v !== undefined) {
        vs[i] = v;
        hasV[i] = 1;
      }
    }

    // Pre-fetch all dimension views of allStates to avoid subarray() in hot loops
    const stateViews = new Array<Float32Array>(D);
    for (let d = 0; d < D; d++) {
      stateViews[d] = this.allStates.subarray(d * N, (d + 1) * N);
    }

    const DN = D * N;
    const connDiag = this.connDiag;
    const connShift = this.connShift;
    const bias = this.bias;

    for (; iterations < this.config.propagationSteps; iterations++) {
      let currentTotalContentEnergy = 0;

      // Handle driven neurons first (isolated pass)
      for (let i = 0; i < N; i++) {
        if (!isDriven[i]) continue;
        const offset = i * D;
        nextStates[offset] = 1.0;
        for (let d = 0; d < dims; d++) {
          const val = clamp(resolvedInput[d] ?? 0, -1, 1);
          nextStates[offset + d + 1] = val;
          currentTotalContentEnergy += val * val;
        }
      }

      // Handle non-driven neurons using loop-swapping to hoist dimension/state/weight views
      for (let d = 0; d < D; d++) {
        const sjRow = stateViews[d];
        const srcD = (d - 1 + D) % D;
        const sjShiftRow = stateViews[srcD];
        const dn = d * N;

        for (let i = 0; i < N; i++) {
          if (isDriven[i]) continue;

          const biasOffset = i * D;
          const rowOffset = i * DN + dn;

          let dotDiag = 0;
          let dotShift = 0;
          // Direct indexing with cached arrays completely avoids subarray allocation overhead
          for (let j = 0; j < N; j++) {
            dotDiag += sjRow[j] * connDiag[rowOffset + j];
            dotShift += sjShiftRow[j] * connShift[rowOffset + j];
          }

          const computedState = Math.tanh(bias[biasOffset + d] + dotDiag + dotShift * strength);
          const finalVal = hasV[i] ? vs[i] * priorStates[i][d] + (1 - vs[i]) * computedState : computedState;
          nextStates[i * D + d] = finalVal;
          if (d > 0) {
            currentTotalContentEnergy += finalVal * finalVal;
          }
        }
      }

      const actualEnergy = currentTotalContentEnergy / (N * dims);
      const predictedEnergy = this.hasEma ? this.emaEnergy : actualEnergy;
      const divergence = Math.abs(actualEnergy - predictedEnergy);

      this.sustainedDivergence = divergence > this.config.divergenceTolerance ? this.sustainedDivergence + 1 : 0;

      if (this.sustainedDivergence >= this.config.sustainedDivergenceTicks) {
        for (let i = 0; i < N; i++) {
          if (isDriven[i]) continue;
          const offset = i * D;
          const state = priorStates[i];
          for (let d = 0; d < D; d++) {
            nextStates[offset + d] = 0.5 * nextStates[offset + d] + 0.5 * state[d];
          }
        }
        liveCorrections++;
        this.sustainedDivergence = 0;
      }

      const settledEnergy = this.sustainedDivergence === 0 ? actualEnergy : this.meanContentEnergyBuffer(nextStates);
      this.emaEnergy = this.hasEma
        ? this.config.influenceDecay * this.emaEnergy + (1 - this.config.influenceDecay) * settledEnergy
        : settledEnergy;
      this.hasEma = true;

      let residual = 0;
      for (let d = 0; d < D; d++) {
        const sjRow = stateViews[d];
        for (let i = 0; i < N; i++) {
          const offset = i * D;
          const nextVal = nextStates[offset + d];
          const diff = Math.abs(nextVal - sjRow[i]);

          deltas[i] += diff;

          sjRow[i] = nextVal;
          this.neurons[i].state[d] = nextVal;
          residual += diff;
        }
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

    // Pre-fetch all dimension views of allStates for sequential access
    const stateViews = new Array<Float32Array>(D);
    for (let d = 0; d < D; d++) {
      stateViews[d] = this.allStates.subarray(d * N, (d + 1) * N);
    }

    const states = new Array<Float32Array>(N);
    const rates = new Float32Array(N);
    const defaultRate = this.config.learningRate;
    for (let i = 0; i < N; i++) {
      states[i] = this.neurons[i].state;
      rates[i] = learningRates?.get(i) ?? defaultRate;
    }

    const connDiag = this.connDiag;
    const connShift = this.connShift;
    const bias = this.bias;

    const deltaSums = new Float32Array(N);

    // Keep i as outer loop and d as middle loop to ensure perfect sequential cache-friendly access to connDiag/connShift
    for (let i = 0; i < N; i++) {
      const rate = rates[i];
      const si = states[i];
      let deltaSum = 0;

      for (let d = 0; d < D; d++) {
        const sjRow = stateViews[d];
        const srcD = (d - 1 + D) % D;
        const sjShiftRow = stateViews[srcD];

        const sid = si[d];
        const rateSid = rate * sid;
        const rowOffset = (i * D + d) * N;

        // branch-free loops by splitting diagonal index i
        for (let j = 0; j < i; j++) {
          const wdIdx = rowOffset + j;
          const oldWd = connDiag[wdIdx];
          const valWd = oldWd + rateSid * sjRow[j];
          const newWd = valWd < -2 ? -2 : (valWd > 2 ? 2 : valWd);
          connDiag[wdIdx] = newWd;
          const diffWd = newWd - oldWd;
          deltaSum += diffWd < 0 ? -diffWd : diffWd;

          const oldWs = connShift[wdIdx];
          const valWs = oldWs + rateSid * sjShiftRow[j];
          const newWs = valWs < -2 ? -2 : (valWs > 2 ? 2 : valWs);
          connShift[wdIdx] = newWs;
          const diffWs = newWs - oldWs;
          deltaSum += diffWs < 0 ? -diffWs : diffWs;
        }

        for (let j = i + 1; j < N; j++) {
          const wdIdx = rowOffset + j;
          const oldWd = connDiag[wdIdx];
          const valWd = oldWd + rateSid * sjRow[j];
          const newWd = valWd < -2 ? -2 : (valWd > 2 ? 2 : valWd);
          connDiag[wdIdx] = newWd;
          const diffWd = newWd - oldWd;
          deltaSum += diffWd < 0 ? -diffWd : diffWd;

          const oldWs = connShift[wdIdx];
          const valWs = oldWs + rateSid * sjShiftRow[j];
          const newWs = valWs < -2 ? -2 : (valWs > 2 ? 2 : valWs);
          connShift[wdIdx] = newWs;
          const diffWs = newWs - oldWs;
          deltaSum += diffWs < 0 ? -diffWs : diffWs;
        }
      }

      deltaSums[i] = deltaSum;
    }

    for (let i = 0; i < N; i++) {
      stateDeltas.set(i, (stateDeltas.get(i) ?? 0) + deltaSums[i]);
    }

    // Update biases after weight updates
    for (let i = 0; i < N; i++) {
      const rate = rates[i];
      const si = states[i];
      const biasOffset = i * D;
      for (let d = 0; d < D; d++) {
        const valB = bias[biasOffset + d] + rate * 0.1 * si[d];
        bias[biasOffset + d] = valB < -1 ? -1 : (valB > 1 ? 1 : valB);
      }
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

  /**
   * Section 13 → §12: evaluate the compressed self-model AND its instantaneous
   * rate of change in a single forward pass using dual numbers. `velocity` is
   * the per-dimension rate of change of the input (e.g. current minus previous
   * output). Each input dimension enters as a dual (value, velocity) and is
   * propagated through the linear self-model, so the ε-component of the output
   * is the predicted derivative. Live correction can then react to the trend
   * (is divergence growing?) rather than only the current level.
   */
  predictSelfModelWithDerivative(vec: number[], velocity: number[]): { value: number[]; derivative: number[] } {
    const dims = this.config.dimensions;
    const rank = this.config.selfModelRank;

    const h: Dual[] = Array.from({ length: rank }, () => dual(0, 0));
    for (let d = 0; d < dims; d++) {
      const x = dual(vec[d] ?? 0, velocity[d] ?? 0);
      for (let r = 0; r < rank; r++) {
        h[r] = dAdd(h[r], dScale(x, this.selfModelA[d * rank + r]));
      }
    }

    const value = new Array<number>(dims).fill(0);
    const derivative = new Array<number>(dims).fill(0);
    for (let r = 0; r < rank; r++) {
      for (let d = 0; d < dims; d++) {
        const term = dScale(h[r], this.selfModelB[r * dims + d]);
        value[d] += term.val;
        derivative[d] += term.der;
      }
    }
    return { value, derivative };
  }

  /** Rank-r compressed self-model: predict(x) = B^T (A^T x). */
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

  /**
   * Neurons salient enough this tick to contribute to the output vector.
   * Falls back to every neuron when none clear energyThreshold, rather than
   * an empty set: computeOutputVector() treats "no active states" as "all
   * zero", so a hard cutoff with no fallback made the output vector (and
   * everything downstream of it — selfModelSurprise, noveltyScore,
   * patternHash) silently, permanently zero whenever the whole mesh's
   * energy happened to sit under the threshold — which, at the default
   * threshold and typical settled-state magnitudes, was most of the time,
   * including in the live pipeline's own default configuration.
   */
  private getActiveStates(): HyperNeuron[] {
    const active = this.neurons.filter(n => n.energy > this.config.energyThreshold);
    return active.length > 0 ? active : this.neurons;
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
