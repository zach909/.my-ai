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

export interface DefinitionCheckResult {
  neuronId: number;
  loss: number;
  satisfied: boolean;
  readout: Float32Array;
  target: Float32Array;
}

export interface ElasticCoreParameters {
  weights: Float32Array;
  biases: Float32Array;
  inputProjection: Float32Array;
  outputProjection: Float32Array;
  shapes: {
    weights: [targetNeurons: number, sourceNeurons: number, outDim: number, inDim: number];
    biases: [neurons: number, stateDim: number];
    inputProjection: [inputDim: number, stateDim: number];
    outputProjection: [stateDim: number, outputDim: number];
  };
}

export interface ElasticCoreGradients {
  weights?: Float32Array;
  biases?: Float32Array;
  inputProjection?: Float32Array;
  outputProjection?: Float32Array;
}

export interface ElasticCoreGradientOptions {
  learningRate?: number;
  weightDecay?: number;
  /** Vale fraction per neuron in [0,1]. High vale scales weight/bias updates down. */
  vale?: Map<number, number>;
  /** Additional multiplier applied after vale scaling. Defaults to 1. */
  scale?: number;
}

export interface ElasticCoreUpdateSummary {
  weightsL1: number;
  biasesL1: number;
  inputProjectionL1: number;
  outputProjectionL1: number;
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
  private readonly quantizationAware: boolean;
  private readonly quantizationBits: number;
  private quantizationResidual: Float32Array;
  private state: Float32Array;
  private bias: Float32Array;
  private weights: Float32Array;
  private inputProjection: Float32Array;
  private outputProjection: Float32Array;
  private nextState: Float32Array;
  private directInputFlags: Float32Array;
  private groups: Map<number, string> = new Map();
  private definitionTargets: Map<number, Float32Array> = new Map();
  private rngState: number;

  // Bolt's Optimization: Reusable scratch buffers to eliminate GC pressure in forward pass hot-paths
  private startState: Float32Array;
  private vAlloc: Float32Array;
  private frozen: Uint8Array;
  private sums: Float32Array;

  constructor(config: ElasticCoreConfig = {}) {
    this.neuronCount = config.neuronCount ?? 16;
    this.stateDim = config.stateDim ?? 8;
    this.inputDim = config.inputDim ?? this.stateDim;
    this.outputDim = config.outputDim ?? this.inputDim;
    this.maxTicks = config.maxTicks ?? 32;
    this.convergenceThreshold = config.convergenceThreshold ?? 1e-3;
    this.inputFlagDim = Math.min(this.stateDim - 1, Math.max(0, config.inputFlagDim ?? 0));
    this.quantizationAware = config.quantizationAware ?? false;
    this.quantizationBits = Math.max(2, Math.min(16, Math.floor(config.quantizationBits ?? 8)));
    this.rngState = config.seed ?? 123456789;

    this.state = new Float32Array(this.neuronCount * this.stateDim);
    this.quantizationResidual = new Float32Array(this.state.length);
    this.bias = new Float32Array(this.neuronCount * this.stateDim);
    this.weights = new Float32Array(this.neuronCount * this.neuronCount * this.stateDim * this.stateDim);
    this.inputProjection = new Float32Array(this.inputDim * this.stateDim);
    this.outputProjection = new Float32Array(this.stateDim * this.outputDim);
    this.nextState = new Float32Array(this.neuronCount * this.stateDim);
    this.directInputFlags = new Float32Array(this.neuronCount);

    // Bolt's Optimization: Initialize scratch buffers to avoid allocation inside forward loop
    this.startState = new Float32Array(this.neuronCount * this.stateDim);
    this.vAlloc = new Float32Array(this.neuronCount);
    this.frozen = new Uint8Array(this.neuronCount);
    this.sums = new Float32Array(this.stateDim);

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

  getStateDim(): number {
    return this.stateDim;
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

  setDefinitionTarget(neuronId: number, target: ArrayLike<number>): void {
    this.assertNeuron(neuronId);
    const v = new Float32Array(this.stateDim);
    for (let i = 0; i < this.stateDim; i++) v[i] = target[i] ?? 0;
    this.definitionTargets.set(neuronId, v);
  }

  checkDefinition(neuronId: number, tolerance = 0.25): DefinitionCheckResult {
    this.assertNeuron(neuronId);
    const target = this.definitionTargets.get(neuronId) ?? new Float32Array(this.stateDim);
    const readout = new Float32Array(this.state.subarray(neuronId * this.stateDim, (neuronId + 1) * this.stateDim));
    let loss = 0;
    for (let d = 0; d < this.stateDim; d++) {
      const e = target[d] - readout[d];
      loss += e * e;
    }
    loss /= this.stateDim;
    return { neuronId, loss, satisfied: loss <= tolerance, readout, target };
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
    const newDirectFlags = new Float32Array(newCount);
    newDirectFlags.set(this.directInputFlags);

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
    this.nextState = new Float32Array(newCount * this.stateDim);
    this.directInputFlags = newDirectFlags;

    // Bolt's Optimization: Resize scratch buffers when neuron count changes
    this.startState = new Float32Array(newCount * this.stateDim);
    this.vAlloc = new Float32Array(newCount);
    this.frozen = new Uint8Array(newCount);

    if (group !== undefined) this.groups.set(oldCount, group);
    return oldCount;
  }

  /**
   * Optimizer-facing structured parameter view. The returned typed arrays are
   * live references, so AdamW-style trainers can keep moments keyed to these
   * arrays and mutate them directly when needed.
   */
  getParameters(): ElasticCoreParameters {
    return {
      weights: this.weights,
      biases: this.bias,
      inputProjection: this.inputProjection,
      outputProjection: this.outputProjection,
      shapes: {
        weights: [this.neuronCount, this.neuronCount, this.stateDim, this.stateDim],
        biases: [this.neuronCount, this.stateDim],
        inputProjection: [this.inputDim, this.stateDim],
        outputProjection: [this.stateDim, this.outputDim],
      },
    };
  }

  /** Apply SGD/AdamW-compatible gradients in-place, with optional vale masks. */
  applyGradients(gradients: ElasticCoreGradients, options: ElasticCoreGradientOptions = {}): ElasticCoreUpdateSummary {
    const lr = options.learningRate ?? 1;
    const decay = options.weightDecay ?? 0;
    const scale = options.scale ?? 1;
    const summary: ElasticCoreUpdateSummary = { weightsL1: 0, biasesL1: 0, inputProjectionL1: 0, outputProjectionL1: 0 };

    if (gradients.weights) {
      this.assertGradientLength('weights', gradients.weights, this.weights.length);
      for (let t = 0; t < this.neuronCount; t++) {
        const tScale = this.updateScaleForNeuron(t, options.vale) * scale;
        for (let s = 0; s < this.neuronCount; s++) for (let od = 0; od < this.stateDim; od++) for (let id = 0; id < this.stateDim; id++) {
          const i = this.weightIndex(t, s, od, id);
          const update = lr * tScale * (gradients.weights[i] + decay * this.weights[i]);
          if (Number.isFinite(update)) { this.weights[i] -= update; summary.weightsL1 += Math.abs(update); }
        }
      }
    }

    if (gradients.biases) {
      this.assertGradientLength('biases', gradients.biases, this.bias.length);
      for (let n = 0; n < this.neuronCount; n++) {
        const nScale = this.updateScaleForNeuron(n, options.vale) * scale;
        for (let d = 0; d < this.stateDim; d++) {
          const i = n * this.stateDim + d;
          const update = lr * nScale * (gradients.biases[i] + decay * this.bias[i]);
          if (Number.isFinite(update)) { this.bias[i] -= update; summary.biasesL1 += Math.abs(update); }
        }
      }
    }

    if (gradients.inputProjection) {
      this.assertGradientLength('inputProjection', gradients.inputProjection, this.inputProjection.length);
      for (let i = 0; i < this.inputProjection.length; i++) {
        const update = lr * scale * (gradients.inputProjection[i] + decay * this.inputProjection[i]);
        if (Number.isFinite(update)) { this.inputProjection[i] -= update; summary.inputProjectionL1 += Math.abs(update); }
      }
    }

    if (gradients.outputProjection) {
      this.assertGradientLength('outputProjection', gradients.outputProjection, this.outputProjection.length);
      for (let d = 0; d < this.stateDim; d++) {
        let dimScale = 0;
        for (let n = 0; n < this.neuronCount; n++) dimScale += this.updateScaleForNeuron(n, options.vale);
        dimScale = (dimScale / this.neuronCount) * scale;
        for (let o = 0; o < this.outputDim; o++) {
          const i = d * this.outputDim + o;
          const update = lr * dimScale * (gradients.outputProjection[i] + decay * this.outputProjection[i]);
          if (Number.isFinite(update)) { this.outputProjection[i] -= update; summary.outputProjectionL1 += Math.abs(update); }
        }
      }
    }
    return summary;
  }

  forward(input: Float32Array, options: ElasticCoreRunOptions = {}): ElasticCoreResult {
    const driven = options.drivenNeurons ?? new Set([0]);
    const N = this.neuronCount;
    const SD = this.stateDim;
    this.clearDirectInputFlags();

    for (const n of driven) {
      if (n >= 0 && n < N) {
        this.directInputFlags[n] = 1;
        this.inject(n, input, true);
      }
    }

    // Bolt's Optimization: Copy state to pre-allocated startState and reuse pre-allocated scratch arrays
    this.startState.set(this.state);
    const startState = this.startState;
    const vAlloc = this.vAlloc;
    const frozen = this.frozen;

    // Clear frozen flags before reuse
    frozen.fill(0);

    for (let t = 0; t < N; t++) {
      vAlloc[t] = Math.min(1, Math.max(0, options.vale?.get(t) ?? 0));
      const group = this.groups.get(t);
      if (!driven.has(t) && options.activeGroups !== undefined && group !== undefined && !options.activeGroups.has(group)) {
        frozen[t] = 1;
      }
    }

    let ticks = 0, residual = 0, converged = false;
    const next = this.nextState;
    const weights = this.weights;
    const bias = this.bias;

    const sums = this.sums;
    for (; ticks < this.maxTicks; ticks++) {
      const curr = this.state;
      for (let t = 0; t < N; t++) {
        const off = t * SD;
        if (frozen[t]) {
          for (let d = 0; d < SD; d++) next[off + d] = curr[off + d];
          continue;
        }

        for (let od = 0; od < SD; od++) {
          sums[od] = bias[off + od];
        }

        // Split source loop to eliminate "s === t" branch with 4x loop unrolling
        for (let s = 0; s < t; s++) {
          const sOff = s * SD;
          const wBase = (t * N + s) * SD * SD;
          for (let od = 0; od < SD; od++) {
            const wRowOff = wBase + od * SD;
            let sum = sums[od];
            let id = 0;
            for (; id <= SD - 4; id += 4) {
              sum += curr[sOff + id] * weights[wRowOff + id]
                   + curr[sOff + id + 1] * weights[wRowOff + id + 1]
                   + curr[sOff + id + 2] * weights[wRowOff + id + 2]
                   + curr[sOff + id + 3] * weights[wRowOff + id + 3];
            }
            for (; id < SD; id++) {
              sum += curr[sOff + id] * weights[wRowOff + id];
            }
            sums[od] = sum;
          }
        }

        for (let s = t + 1; s < N; s++) {
          const sOff = s * SD;
          const wBase = (t * N + s) * SD * SD;
          for (let od = 0; od < SD; od++) {
            const wRowOff = wBase + od * SD;
            let sum = sums[od];
            let id = 0;
            for (; id <= SD - 4; id += 4) {
              sum += curr[sOff + id] * weights[wRowOff + id]
                   + curr[sOff + id + 1] * weights[wRowOff + id + 1]
                   + curr[sOff + id + 2] * weights[wRowOff + id + 2]
                   + curr[sOff + id + 3] * weights[wRowOff + id + 3];
            }
            for (; id < SD; id++) {
              sum += curr[sOff + id] * weights[wRowOff + id];
            }
            sums[od] = sum;
          }
        }

        const v = vAlloc[t];
        const oneMinusV = 1 - v;
        for (let od = 0; od < SD; od++) {
          next[off + od] = v * curr[off + od] + oneMinusV * Math.tanh(sums[od]);
        }
      }

      this.applyQuantizationInPlace(next);
      for (const n of driven) if (n >= 0 && n < N) next[n * SD + this.inputFlagDim] = 1;

      residual = 0;
      for (let i = 0; i < next.length; i++) {
        const diff = next[i] - curr[i];
        residual += diff < 0 ? -diff : diff;
        curr[i] = next[i];
      }
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

  private clearDirectInputFlags(): void {
    for (let n = 0; n < this.neuronCount; n++) {
      this.state[n * this.stateDim + this.inputFlagDim] = 0;
      this.directInputFlags[n] = 0;
    }
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

  /**
   * Section 8: In-place quantization with residual feedback. Compares each
   * state's candidate value (plus its accumulated error) to the nearest
   * dequantized level, then stores the new rounding error back into the
   * residual buffer so it is compensated for on the next tick. This lets
   * the network learn to "expect" its own quantized substrate.
   */
  /**
   * Section 8: In-place quantization with residual feedback. Compares each
   * state's candidate value (plus its accumulated error) to the nearest
   * dequantized level, then stores the new rounding error back into the
   * residual buffer so it is compensated for on the next tick. This lets
   * the network learn to "expect" its own quantized substrate.
   * 
   * Optimization: SIMD-friendly loop unrolling and branch-free clamping.
   */
  private applyQuantizationInPlace(next: Float32Array): void {
    if (!this.quantizationAware) {
      return;
    }
    const levels = (1 << this.quantizationBits) - 1;
    const invLevels = 1.0 / levels;
    const len = next.length;
    
    // Process in chunks of 4 for better CPU pipeline utilization
    let i = 0;
    for (; i + 3 < len; i += 4) {
      for (let j = 0; j < 4; j++) {
        const idx = i + j;
        const compensated = next[idx] + this.quantizationResidual[idx];
        const clamped = compensated < -1 ? -1 : (compensated > 1 ? 1 : compensated);
        const q = Math.round(((clamped + 1) * 0.5) * levels);
        const dequantized = q * invLevels * 2 - 1;
        this.quantizationResidual[idx] = clamped - dequantized;
        next[idx] = dequantized;
      }
    }
    // Handle remaining elements
    for (; i < len; i++) {
      const compensated = next[i] + this.quantizationResidual[i];
      const clamped = compensated < -1 ? -1 : (compensated > 1 ? 1 : compensated);
      const q = Math.round(((clamped + 1) * 0.5) * levels);
      const dequantized = q * invLevels * 2 - 1;
      this.quantizationResidual[i] = clamped - dequantized;
      next[i] = dequantized;
    }
  }

  private readout(): Float32Array {
    const mean = new Float32Array(this.stateDim);
    for (let n = 0; n < this.neuronCount; n++) for (let d = 0; d < this.stateDim; d++) mean[d] += this.state[n * this.stateDim + d] / this.neuronCount;
    const out = new Float32Array(this.outputDim);
    for (let o = 0; o < this.outputDim; o++) for (let d = 0; d < this.stateDim; d++) out[o] += mean[d] * this.outputProjection[d * this.outputDim + o];
    return out;
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
    for (let n = 0; n < this.neuronCount; n++) topography.set(n, this.directInputFlags[n]);
    return topography;
  }

  private weightIndex(target: number, source: number, outDim: number, inDim: number): number {
    return this.weightIndexForCount(this.neuronCount, target, source, outDim, inDim);
  }

  private weightIndexForCount(count: number, target: number, source: number, outDim: number, inDim: number): number {
    return (((target * count + source) * this.stateDim + outDim) * this.stateDim + inDim);
  }

  private updateScaleForNeuron(neuronId: number, vale?: Map<number, number>): number {
    const v = Math.min(1, Math.max(0, vale?.get(neuronId) ?? 0));
    return 1 - v;
  }

  private assertGradientLength(name: string, gradient: Float32Array, expected: number): void {
    if (gradient.length !== expected) throw new Error(`${name} gradient length ${gradient.length} !== ${expected}`);
  }

  private rand(): number {
    this.rngState = (1664525 * this.rngState + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }

  private assertNeuron(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.neuronCount) throw new Error(`neuron id out of range: ${id}`);
  }
}
