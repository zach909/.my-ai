export interface ElasticCoreConfig {
  neuronCount?: number;
  stateDim?: number;
  inputDim?: number;
  outputDim?: number;
  maxTicks?: number;
  convergenceThreshold?: number;
  weightScale?: number;
  seed?: number;
  inputFlagDim?: number;
  /** Enable quantization-aware state settling: quantize inside forward and retain residual feedback. */
  quantizationAware?: boolean;
  /** Bit width for quantized state values when quantizationAware is enabled. */
  quantizationBits?: number;
}

export interface ElasticCoreRunOptions {
  /** Vale fraction per neuron in [0,1]. High vale resists state movement. */
  vale?: Map<number, number>;
  /** Optional MoE labels to compute this tick; unselected labelled neurons hold state. */
  activeGroups?: Set<string>;
  /** Externally-driven neuron ids for the input-source flag dimension. */
  drivenNeurons?: Set<number>;
}

export interface ElasticCoreResult {
  output: Float32Array;
  settledState: Float32Array;
  ticks: number;
  converged: boolean;
  residual: number;
  inputTopography: Map<number, number>;
  /** Per-neuron L1 state movement during the settle, for vale-budget feedback. */
  stateDeltas: Map<number, number>;
  /** Mean absolute residual introduced by the quantizer on this forward pass. */
  quantizationDrift: number;
}

/**
 * Experimental transformer-core replacement for Prometheus Elastic Core.
 *
 * This block intentionally keeps the surrounding transformer infrastructure
 * reusable: callers pass normal token/embedding vectors in and receive a normal
 * output embedding back. Internally, however, the attention/MLP block is
 * replaced by a true all-to-all mesh of multidimensional neurons. Every source
 * neuron owns a dense state vector and every target neuron receives a full
 * stateDim x stateDim weight block from every other source neuron. Bias is
 * added exactly once per target neuron/dimension after all incoming products
 * are summed.
 */
export class ElasticCoreBlock {
  private neuronCount: number;
  private readonly neuronCount: number;
  private readonly stateDim: number;
  private readonly inputDim: number;
  private readonly outputDim: number;
  private readonly maxTicks: number;
  private readonly convergenceThreshold: number;
  private readonly inputFlagDim: number;
  private state: Float32Array;
  private bias: Float32Array;
  private weights: Float32Array;
  private inputProjection: Float32Array;
  private outputProjection: Float32Array;
  private groups: Map<number, string> = new Map();
  private rngState: number;
  private readonly quantizationAware: boolean;
  private readonly quantizationBits: number;
  private quantizationResidual: Float32Array;

  constructor(config: ElasticCoreConfig = {}) {
    this.neuronCount = config.neuronCount ?? 16;
    this.stateDim = config.stateDim ?? 8;
    this.inputDim = config.inputDim ?? this.stateDim;
    this.outputDim = config.outputDim ?? this.inputDim;
    this.maxTicks = config.maxTicks ?? 32;
    this.convergenceThreshold = config.convergenceThreshold ?? 1e-3;
    this.inputFlagDim = Math.min(this.stateDim - 1, Math.max(0, config.inputFlagDim ?? 0));
    this.rngState = config.seed ?? 123456789;
    this.quantizationAware = config.quantizationAware ?? false;
    this.quantizationBits = Math.max(2, Math.min(16, config.quantizationBits ?? 8));

    this.state = new Float32Array(this.neuronCount * this.stateDim);
    this.bias = new Float32Array(this.neuronCount * this.stateDim);
    this.weights = new Float32Array(this.neuronCount * this.neuronCount * this.stateDim * this.stateDim);
    this.inputProjection = new Float32Array(this.inputDim * this.stateDim);
    this.outputProjection = new Float32Array(this.stateDim * this.outputDim);
    this.quantizationResidual = new Float32Array(this.state.length);

    const scale = config.weightScale ?? Math.sqrt(1 / Math.max(1, this.neuronCount * this.stateDim));
    for (let i = 0; i < this.bias.length; i++) this.bias[i] = (this.rand() * 2 - 1) * 0.05;
    for (let t = 0; t < this.neuronCount; t++) {
      for (let s = 0; s < this.neuronCount; s++) {
        if (t === s) continue;
        for (let od = 0; od < this.stateDim; od++) {
          for (let id = 0; id < this.stateDim; id++) {
            this.weights[this.weightIndex(t, s, od, id)] = (this.rand() * 2 - 1) * scale;
          }
        }
      }
    }
    for (let i = 0; i < this.inputProjection.length; i++) this.inputProjection[i] = (this.rand() * 2 - 1) * scale;
    for (let i = 0; i < this.outputProjection.length; i++) this.outputProjection[i] = (this.rand() * 2 - 1) * scale;
  }

  setNeuronGroup(neuronId: number, group: string): void {
    this.assertNeuron(neuronId);
    this.groups.set(neuronId, group);
  }

  /**
   * Add a live neuron to the core and wire it all-to-all with every existing
   * neuron. This is the Elastic Core side of the extension-builder story:
   * newly materialized NeuroLang/skill neurons become ordinary mesh neurons,
   * not a side table or separate adapter layer. Existing weights are preserved.
   */
  addNeuron(group?: string): number {
    const oldCount = this.neuronCount;
    const newCount = oldCount + 1;
    const newState = new Float32Array(newCount * this.stateDim);
    newState.set(this.state);
    const newResidual = new Float32Array(newCount * this.stateDim);
    newResidual.set(this.quantizationResidual);
    const newBias = new Float32Array(newCount * this.stateDim);
    newBias.set(this.bias);
    for (let d = 0; d < this.stateDim; d++) {
      newBias[oldCount * this.stateDim + d] = (this.rand() * 2 - 1) * 0.05;
    }

    const oldWeights = this.weights;
    const newWeights = new Float32Array(newCount * newCount * this.stateDim * this.stateDim);
    const scale = Math.sqrt(1 / Math.max(1, newCount * this.stateDim));
    const newIndex = (target: number, source: number, outDim: number, inDim: number): number =>
      (((target * newCount + source) * this.stateDim + outDim) * this.stateDim + inDim);
    const oldIndex = (target: number, source: number, outDim: number, inDim: number): number =>
      (((target * oldCount + source) * this.stateDim + outDim) * this.stateDim + inDim);

    for (let t = 0; t < newCount; t++) {
      for (let src = 0; src < newCount; src++) {
        if (t === src) continue;
        for (let od = 0; od < this.stateDim; od++) {
          for (let id = 0; id < this.stateDim; id++) {
            if (t < oldCount && src < oldCount) {
              newWeights[newIndex(t, src, od, id)] = oldWeights[oldIndex(t, src, od, id)];
            } else {
              newWeights[newIndex(t, src, od, id)] = (this.rand() * 2 - 1) * scale;
            }
          }
        }
      }
    }

    this.neuronCount = newCount;
    this.state = newState;
    this.quantizationResidual = newResidual;
    this.bias = newBias;
    this.weights = newWeights;
    if (group !== undefined) this.groups.set(oldCount, group);
    return oldCount;
  }

  getNeuronCount(): number {
    return this.neuronCount;
  }

  connectionDensity(): number {
    return this.neuronCount <= 1 ? 0 : 1.0;
  }

  /**
   * Program an explicit dense source->target block. This is how extension
   * builder definitions can install cross-dimensional links directly: every
   * output dimension of the target can read every input dimension of the source.
   */
  setConnectionBlock(target: number, source: number, block: Float32Array | number[]): void {
    this.assertNeuron(target); this.assertNeuron(source);
    if (target === source) throw new Error('self-connections are not part of the all-to-all core');
    if (block.length !== this.stateDim * this.stateDim) {
      throw new Error(`connection block must have ${this.stateDim * this.stateDim} entries`);
    }
    for (let od = 0; od < this.stateDim; od++) {
      for (let id = 0; id < this.stateDim; id++) {
        this.weights[this.weightIndex(target, source, od, id)] = block[od * this.stateDim + id];
      }
    }
  }

  /** Convenience helper for DSL-style scalar connections: fill the whole block. */
  setConnectionScalar(target: number, source: number, weight: number): void {
    this.setConnectionBlock(target, source, new Float32Array(this.stateDim * this.stateDim).fill(weight));
  }

  connectionBlock(target: number, source: number): Float32Array {
    this.assertNeuron(target); this.assertNeuron(source);
    const block = new Float32Array(this.stateDim * this.stateDim);
    for (let od = 0; od < this.stateDim; od++) for (let id = 0; id < this.stateDim; id++) {
      block[od * this.stateDim + id] = this.weights[this.weightIndex(target, source, od, id)];
    }
    return block;
  }

  forward(input: Float32Array, options: ElasticCoreRunOptions = {}): ElasticCoreResult {
    const driven = options.drivenNeurons ?? new Set([0]);
    for (const n of driven) if (n >= 0 && n < this.neuronCount) this.inject(n, input, true);

    const startState = new Float32Array(this.state);
    let ticks = 0, residual = 0, converged = false;
    for (; ticks < this.maxTicks; ticks++) {
      const next = new Float32Array(this.state.length);
      residual = 0;
      for (let t = 0; t < this.neuronCount; t++) {
        const group = this.groups.get(t);
        const externallyDriven = driven.has(t);
        const frozen = options.activeGroups !== undefined && group !== undefined && !options.activeGroups.has(group);
        if (frozen && !externallyDriven) {
        const frozen = !externallyDriven && options.activeGroups !== undefined && group !== undefined && !options.activeGroups.has(group);
        if (frozen) {
          next.set(this.state.subarray(t * this.stateDim, (t + 1) * this.stateDim), t * this.stateDim);
          continue;
        }
        for (let od = 0; od < this.stateDim; od++) {
          let sum = this.bias[t * this.stateDim + od];
          for (let s = 0; s < this.neuronCount; s++) {
            if (s === t) continue;
            for (let id = 0; id < this.stateDim; id++) sum += this.state[s * this.stateDim + id] * this.weights[this.weightIndex(t, s, od, id)];
          }
          const computed = Math.tanh(sum);
          const v = Math.min(1, Math.max(0, options.vale?.get(t) ?? 0));
          const old = this.state[t * this.stateDim + od];
          const value = v * old + (1 - v) * computed;
          next[t * this.stateDim + od] = value;
          residual += Math.abs(value - old);
        }
      }
      const quantized = this.quantizeWithResidual(next);
      this.state = quantized.state;
      this.state = next;
      for (const n of driven) if (n >= 0 && n < this.neuronCount) this.state[n * this.stateDim + this.inputFlagDim] = 1;
      if (residual < this.convergenceThreshold) { converged = true; ticks++; break; }
    }

    return {
      output: this.readout(),
      settledState: new Float32Array(this.state),
      ticks,
      converged,
      residual,
      inputTopography: this.inputTopography(),
      stateDeltas: this.stateDeltas(startState),
      quantizationDrift: this.meanAbs(this.quantizationResidual),
    };
  }

  private inject(neuronId: number, input: Float32Array, flag: boolean): void {
    const off = neuronId * this.stateDim;
    for (let od = 0; od < this.stateDim; od++) {
      let sum = 0;
      for (let i = 0; i < Math.min(input.length, this.inputDim); i++) sum += input[i] * this.inputProjection[i * this.stateDim + od];
      this.state[off + od] = Math.tanh(sum);
    }
    if (flag) this.state[off + this.inputFlagDim] = 1;
  }

  private readout(): Float32Array {
    const mean = new Float32Array(this.stateDim);
    for (let n = 0; n < this.neuronCount; n++) for (let d = 0; d < this.stateDim; d++) mean[d] += this.state[n * this.stateDim + d] / this.neuronCount;
    const out = new Float32Array(this.outputDim);
    for (let o = 0; o < this.outputDim; o++) for (let d = 0; d < this.stateDim; d++) out[o] += mean[d] * this.outputProjection[d * this.outputDim + o];
    return out;
  }

  private quantizeWithResidual(next: Float32Array): { state: Float32Array; drift: number } {
    if (!this.quantizationAware) {
      this.quantizationResidual.fill(0);
      return { state: next, drift: 0 };
    }

    const levels = (1 << this.quantizationBits) - 1;
    const quantized = new Float32Array(next.length);
    let drift = 0;
    for (let i = 0; i < next.length; i++) {
      const compensated = Math.max(-1, Math.min(1, next[i] + this.quantizationResidual[i]));
      const q = Math.round(((compensated + 1) / 2) * levels);
      const dequantized = (q / levels) * 2 - 1;
      quantized[i] = dequantized;
      this.quantizationResidual[i] = compensated - dequantized;
      drift += Math.abs(this.quantizationResidual[i]);
    }
    return { state: quantized, drift: drift / Math.max(1, next.length) };
  }

  private meanAbs(values: Float32Array): number {
    let sum = 0;
    for (const value of values) sum += Math.abs(value);
    return sum / Math.max(1, values.length);
  }

  private stateDeltas(startState: Float32Array): Map<number, number> {
    const deltas = new Map<number, number>();
    for (let n = 0; n < this.neuronCount; n++) {
      let delta = 0;
      for (let d = 0; d < this.stateDim; d++) {
        const i = n * this.stateDim + d;
        delta += Math.abs(this.state[i] - startState[i]);
      }
      deltas.set(n, delta);
    }
    return deltas;
  }

  private inputTopography(): Map<number, number> {
    const topography = new Map<number, number>();
    for (let n = 0; n < this.neuronCount; n++) topography.set(n, this.state[n * this.stateDim + this.inputFlagDim]);
    return topography;
  }

  private weightIndex(target: number, source: number, outDim: number, inDim: number): number {
    return (((target * this.neuronCount + source) * this.stateDim + outDim) * this.stateDim + inDim);
  }

  private rand(): number {
    this.rngState = (1664525 * this.rngState + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }

  private assertNeuron(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.neuronCount) throw new Error(`neuron id out of range: ${id}`);
  }
}
