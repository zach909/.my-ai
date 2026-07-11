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

  constructor(config: ElasticCoreConfig = {}) {
    this.neuronCount = config.neuronCount ?? 16;
    this.stateDim = config.stateDim ?? 8;
    this.inputDim = config.inputDim ?? this.stateDim;
    this.outputDim = config.outputDim ?? this.inputDim;
    this.maxTicks = config.maxTicks ?? 32;
    this.convergenceThreshold = config.convergenceThreshold ?? 1e-3;
    this.inputFlagDim = Math.min(this.stateDim - 1, Math.max(0, config.inputFlagDim ?? 0));
    this.rngState = config.seed ?? 123456789;

    this.state = new Float32Array(this.neuronCount * this.stateDim);
    this.bias = new Float32Array(this.neuronCount * this.stateDim);
    this.weights = new Float32Array(this.neuronCount * this.neuronCount * this.stateDim * this.stateDim);
    this.inputProjection = new Float32Array(this.inputDim * this.stateDim);
    this.outputProjection = new Float32Array(this.stateDim * this.outputDim);

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

  getNeuronCount(): number {
    return this.neuronCount;
  }

  addNeuron(group?: string): number {
    const oldCount = this.neuronCount;
    const newCount = oldCount + 1;
    const scale = Math.sqrt(1 / Math.max(1, newCount * this.stateDim));

    const oldState = this.state;
    const oldBias = this.bias;
    const oldWeights = this.weights;
    this.state = new Float32Array(newCount * this.stateDim);
    this.bias = new Float32Array(newCount * this.stateDim);
    this.weights = new Float32Array(newCount * newCount * this.stateDim * this.stateDim);
    this.state.set(oldState);
    this.bias.set(oldBias);

    const oldWeightIndex = (target: number, source: number, outDim: number, inDim: number) =>
      (((target * oldCount + source) * this.stateDim + outDim) * this.stateDim + inDim);
    for (let t = 0; t < oldCount; t++) {
      for (let s = 0; s < oldCount; s++) {
        if (t === s) continue;
        for (let od = 0; od < this.stateDim; od++) {
          for (let id = 0; id < this.stateDim; id++) {
            this.weights[this.weightIndexForCount(newCount, t, s, od, id)] = oldWeights[oldWeightIndex(t, s, od, id)];
          }
        }
      }
    }

    this.neuronCount = newCount;
    const neuronId = oldCount;
    for (let d = 0; d < this.stateDim; d++) this.bias[neuronId * this.stateDim + d] = (this.rand() * 2 - 1) * 0.05;
    for (let other = 0; other < newCount; other++) {
      if (other === neuronId) continue;
      for (let od = 0; od < this.stateDim; od++) {
        for (let id = 0; id < this.stateDim; id++) {
          this.weights[this.weightIndex(neuronId, other, od, id)] = (this.rand() * 2 - 1) * scale;
          this.weights[this.weightIndex(other, neuronId, od, id)] = (this.rand() * 2 - 1) * scale;
        }
      }
    }
    if (group !== undefined) this.groups.set(neuronId, group);
    return neuronId;
  }

  connectionDensity(): number {
    return this.neuronCount <= 1 ? 0 : 1.0;
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
    return this.weightIndexForCount(this.neuronCount, target, source, outDim, inDim);
  }

  private weightIndexForCount(count: number, target: number, source: number, outDim: number, inDim: number): number {
    return (((target * count + source) * this.stateDim + outDim) * this.stateDim + inDim);
  }

  private rand(): number {
    this.rngState = (1664525 * this.rngState + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }

  private assertNeuron(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.neuronCount) throw new Error(`neuron id out of range: ${id}`);
  }
}
