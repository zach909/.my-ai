export interface MoEConfig {
  expertCount: number;
  topK: number;
  capacityFactor: number;
  loadBalanceWeight: number;
  expertHiddenDim: number;
  inputDim: number;
  outputDim: number;
  routerHiddenDim: number;
}

export interface RouterDecision {
  expertIndices: number[];
  routerWeights: number[];
  expertOutputs: Float32Array[];
  combinedOutput: Float32Array;
  entropy: number;
  loadBalanceLoss: number;
}

export interface MoELayerOutput {
  output: Float32Array;
  decision: RouterDecision;
  layerIndex: number;
  expertContributions: Map<string, number>;
}

export interface ExpertUtilizationStats {
  expertId: number;
  utilization: number;
  totalCalls: number;
  totalTokens: number;
  avgWeight: number;
}

export class MoERouter {
  private config: MoEConfig;
  private experts: Map<number, { weights: Float32Array; bias: Float32Array }>;
  private routerWeights: Float32Array;
  private routerBias: Float32Array;
  private utilization: Map<number, { calls: number; tokens: number; weightSum: number }>;
  private iteration: number = 0;
  private scoresScratch: number[];
  private selectScratch: Int32Array;

  constructor(config: Partial<MoEConfig> & Record<string, any> = {}) {
    this.config = {
      expertCount: config.numExperts ?? config.expertCount ?? 8,
      topK: config.topK ?? 2,
      capacityFactor: config.capacityFactor ?? 1.25,
      loadBalanceWeight: config.loadBalancingLoss ?? config.loadBalanceWeight ?? 0.01,
      expertHiddenDim: config.expertHiddenDim ?? 512,
      inputDim: config.inputDim ?? 768,
      outputDim: config.outputDim ?? 768,
      routerHiddenDim: config.routerHiddenDim ?? 256,
    };
    this.experts = new Map();
    this.utilization = new Map();
    this.routerWeights = new Float32Array(this.config.inputDim * this.config.expertCount);
    this.routerBias = new Float32Array(this.config.expertCount);
    this.scoresScratch = new Array<number>(this.config.expertCount);
    this.selectScratch = new Int32Array(this.config.expertCount);
    this.initializeExpertWeights();
    this.initializeExperts();
  }

  private initializeExpertWeights(): void {
    const scale = Math.sqrt(2.0 / this.config.inputDim);
    for (let i = 0; i < this.routerWeights.length; i++) {
      this.routerWeights[i] = (Math.random() * 2 - 1) * scale;
    }
  }

  private initializeExperts(): void {
    for (let i = 0; i < this.config.expertCount; i++) {
      const fanIn = this.config.inputDim;
      const fanOut = this.config.expertHiddenDim;
      const scale = Math.sqrt(2.0 / fanIn);
      const weights = new Float32Array(fanIn * fanOut);
      const bias = new Float32Array(fanOut);
      for (let j = 0; j < weights.length; j++) {
        weights[j] = (Math.random() * 2 - 1) * scale;
      }
      this.experts.set(i, { weights, bias });
      this.utilization.set(i, { calls: 0, tokens: 0, weightSum: 0 });
    }
  }

  route(input: Float32Array): RouterDecision {
    const scores = this.computeRouterScores(input);
    const topKIndices = this.selectTopK(scores);

    // OPTIMIZATION: Manually map scores to topScores to avoid callback overhead.
    const numK = topKIndices.length;
    const topScores = new Array<number>(numK);
    for (let i = 0; i < numK; i++) {
      topScores[i] = scores[topKIndices[i]];
    }
    const routerWeights = this.softmax(topScores);

    const expertOutputs: Float32Array[] = [];
    for (let i = 0; i < numK; i++) {
      const expertIdx = topKIndices[i];
      const expert = this.experts.get(expertIdx)!;
      const output = new Float32Array(this.config.outputDim);

      // Initialize with bias, then accumulate the expert's matrix-vector
      // product using row-major (sequential) memory access.
      output.set(expert.bias);

      const weights = expert.weights;
      const hiddenDim = this.config.expertHiddenDim;

      // OPTIMIZATION: 8x loop unrolling on inner dimension and zero-value skip-path.
      const limit = hiddenDim - 7;
      for (let k = 0; k < input.length; k++) {
        const inputVal = input[k];
        if (inputVal === 0) continue; // Skip multiplications for zero-inputs (sparsity fast-path)
        const weightOffset = k * hiddenDim;
        let j = 0;
        for (; j < limit; j += 8) {
          output[j] += inputVal * weights[weightOffset + j];
          output[j + 1] += inputVal * weights[weightOffset + j + 1];
          output[j + 2] += inputVal * weights[weightOffset + j + 2];
          output[j + 3] += inputVal * weights[weightOffset + j + 3];
          output[j + 4] += inputVal * weights[weightOffset + j + 4];
          output[j + 5] += inputVal * weights[weightOffset + j + 5];
          output[j + 6] += inputVal * weights[weightOffset + j + 6];
          output[j + 7] += inputVal * weights[weightOffset + j + 7];
        }
        for (; j < hiddenDim; j++) {
          output[j] += inputVal * weights[weightOffset + j];
        }
      }

      expertOutputs.push(output);
      this.trackUtilization(expertIdx, routerWeights[i]);
    }

    const combinedOutput = new Float32Array(this.config.outputDim);

    // OPTIMIZATION: Specialize combination step for typical top-K configurations
    // to bypass nested loops, pointer indexing, and bounds checks.
    if (numK === 1) {
      const out0 = expertOutputs[0];
      const w0 = routerWeights[0];
      for (let j = 0; j < this.config.outputDim; j++) {
        combinedOutput[j] = out0[j] * w0;
      }
    } else if (numK === 2) {
      const out0 = expertOutputs[0];
      const out1 = expertOutputs[1];
      const w0 = routerWeights[0];
      const w1 = routerWeights[1];
      for (let j = 0; j < this.config.outputDim; j++) {
        combinedOutput[j] = out0[j] * w0 + out1[j] * w1;
      }
    } else if (numK === 4) {
      const out0 = expertOutputs[0];
      const out1 = expertOutputs[1];
      const out2 = expertOutputs[2];
      const out3 = expertOutputs[3];
      const w0 = routerWeights[0];
      const w1 = routerWeights[1];
      const w2 = routerWeights[2];
      const w3 = routerWeights[3];
      for (let j = 0; j < this.config.outputDim; j++) {
        combinedOutput[j] = out0[j] * w0 + out1[j] * w1 + out2[j] * w2 + out3[j] * w3;
      }
    } else {
      // General fallback loop for non-standard top-K values
      for (let j = 0; j < this.config.outputDim; j++) {
        let sum = 0;
        for (let i = 0; i < numK; i++) {
          sum += expertOutputs[i][j] * routerWeights[i];
        }
        combinedOutput[j] = sum;
      }
    }

    const entropy = this.computeEntropy(scores);
    const loadBalanceLoss = this.computeLoadBalanceLoss();

    return {
      expertIndices: topKIndices,
      routerWeights,
      expertOutputs,
      combinedOutput,
      entropy,
      loadBalanceLoss,
    };
  }

  forward(input: Float32Array, layerIndex: number = 0): MoELayerOutput {
    const decision = this.route(input);
    const expertContributions = new Map<string, number>();
    for (let i = 0; i < decision.expertIndices.length; i++) {
      expertContributions.set(`expert_${decision.expertIndices[i]}`, decision.routerWeights[i] || 0);
    }
    return {
      output: decision.combinedOutput,
      decision,
      layerIndex,
      expertContributions,
    };
  }

  addExpert(weights: Float32Array, bias: Float32Array): number;
  addExpert(config: { id: string; name: string; specialization: string }): number;
  addExpert(first: Float32Array | { id: string; name: string; specialization: string }, bias?: Float32Array): number {
    const expertId = this.experts.size;
    if (first instanceof Float32Array) {
      this.experts.set(expertId, { weights: first, bias: bias || new Float32Array(0) });
    } else {
      const dim = this.config.expertHiddenDim || 128;
      const weights = new Float32Array(this.config.inputDim * dim);
      const scale = Math.sqrt(2.0 / this.config.inputDim);
      for (let i = 0; i < weights.length; i++) {
        weights[i] = (Math.random() * 2 - 1) * scale;
      }
      this.experts.set(expertId, { weights, bias: new Float32Array(dim) });
    }
    this.utilization.set(expertId, { calls: 0, tokens: 0, weightSum: 0 });
    this.growRouterCapacity();
    return expertId;
  }

  /**
   * Grow routerWeights/routerBias to cover every expert currently registered.
   * Both addExpert overloads must call this: the router-scoring loop indexes
   * routerWeights as `input[i] * routerWeights[i * expertCount + e]`, so a
   * bumped expertCount without a resized routerWeights reads past the end of
   * the array (undefined -> NaN, which then poisons the whole pipeline).
   * The old flat-copy grow also silently scrambled the row-major
   * (inputDim x expertCount) layout whenever expertCount changed; this
   * rebuild copies element-by-element in (input, expert) coordinates so
   * existing experts keep their learned router weights.
   */
  private growRouterCapacity(): void {
    const inputDim = this.config.inputDim;
    const oldCount = this.routerBias.length;
    const newCount = this.experts.size;
    if (newCount <= oldCount) {
      this.config.expertCount = newCount;
      return;
    }

    const scale = Math.sqrt(2.0 / inputDim);
    const newWeights = new Float32Array(inputDim * newCount);
    for (let i = 0; i < inputDim; i++) {
      for (let e = 0; e < newCount; e++) {
        newWeights[i * newCount + e] = e < oldCount
          ? this.routerWeights[i * oldCount + e]
          : (Math.random() * 2 - 1) * scale;
      }
    }
    this.routerWeights = newWeights;

    const newBias = new Float32Array(newCount);
    newBias.set(this.routerBias);
    this.routerBias = newBias;

    this.scoresScratch = new Array<number>(newCount);
    this.selectScratch = new Int32Array(newCount);

    this.config.expertCount = newCount;
  }

  removeExpert(expertId: number): boolean {
    if (!this.experts.has(expertId)) return false;

    // The router indexes routerWeights as input[i] * routerWeights[i *
    // expertCount + e] and selectTopK returns dense positions 0..expertCount-1,
    // so experts must stay a contiguous 0..n-1 block. A bare delete would
    // shrink expertCount while leaving routerWeights at the old width and the
    // id space sparse, and the next forward() would index out of bounds.
    // Rebuild everything densely, dropping the removed expert's router column
    // and preserving each survivor's learned column.
    const inputDim = this.config.inputDim;
    const oldCount = this.routerBias.length;
    const survivors = Array.from(this.experts.keys())
      .filter(id => id !== expertId)
      .sort((a, b) => a - b);

    const newExperts = new Map<number, { weights: Float32Array; bias: Float32Array }>();
    const newUtil = new Map<number, { calls: number; tokens: number; weightSum: number }>();
    const newWeights = new Float32Array(inputDim * survivors.length);
    const newBias = new Float32Array(survivors.length);

    survivors.forEach((oldId, newId) => {
      newExperts.set(newId, this.experts.get(oldId)!);
      newUtil.set(newId, this.utilization.get(oldId) ?? { calls: 0, tokens: 0, weightSum: 0 });
      newBias[newId] = this.routerBias[oldId] ?? 0;
      for (let i = 0; i < inputDim; i++) {
        newWeights[i * survivors.length + newId] = this.routerWeights[i * oldCount + oldId] ?? 0;
      }
    });

    this.experts = newExperts;
    this.utilization = newUtil;
    this.routerWeights = newWeights;
    this.routerBias = newBias;
    this.scoresScratch = new Array<number>(survivors.length);
    this.selectScratch = new Int32Array(survivors.length);
    this.config.expertCount = survivors.length;
    return true;
  }

  setExpertWeights(expertId: number, weights: Float32Array, bias: Float32Array): void {
    if (this.experts.has(expertId)) {
      this.experts.set(expertId, { weights, bias });
    }
  }

  getUtilizationStats(): ExpertUtilizationStats[] {
    const stats: ExpertUtilizationStats[] = [];
    for (const [expertId, util] of this.utilization) {
      const totalCalls = util.calls;
      stats.push({
        expertId,
        utilization: totalCalls > 0 ? util.tokens / totalCalls : 0,
        totalCalls,
        totalTokens: util.tokens,
        avgWeight: totalCalls > 0 ? util.weightSum / totalCalls : 0,
      });
    }
    return stats;
  }

  getExpertCount(): number {
    return this.experts.size;
  }

  getExpertList(): number[] {
    return Array.from(this.experts.keys());
  }

  private computeRouterScores(input: Float32Array): number[] {
    const expertCount = this.config.expertCount;
    const scores = this.scoresScratch;
    const weights = this.routerWeights;
    const inputLen = input.length;
    const bias = this.routerBias;
    
    // OPTIMIZATION: Initialize scores with expert biases
    for (let exp = 0; exp < expertCount; exp++) {
      scores[exp] = bias[exp];
    }

    // OPTIMIZATION: Sequential cache-locality outer-input inner-expert loop.
    // Since weights are stored in (inputDim x expertCount) layout, scanning
    // expertCount contiguously keeps all memory accesses fully sequential (step size of 1).
    for (let i = 0; i < inputLen; i++) {
      const inputVal = input[i];
      if (inputVal === 0) continue; // Sparsity fast-path
      const weightOffset = i * expertCount;
      
      let exp = 0;
      const limit = expertCount - 7;
      for (; exp < limit; exp += 8) {
        scores[exp]     += inputVal * weights[weightOffset + exp];
        scores[exp + 1] += inputVal * weights[weightOffset + exp + 1];
        scores[exp + 2] += inputVal * weights[weightOffset + exp + 2];
        scores[exp + 3] += inputVal * weights[weightOffset + exp + 3];
        scores[exp + 4] += inputVal * weights[weightOffset + exp + 4];
        scores[exp + 5] += inputVal * weights[weightOffset + exp + 5];
        scores[exp + 6] += inputVal * weights[weightOffset + exp + 6];
        scores[exp + 7] += inputVal * weights[weightOffset + exp + 7];
      }
      for (; exp < expertCount; exp++) {
        scores[exp] += inputVal * weights[weightOffset + exp];
      }
    }
    return scores;
  }

  private selectTopK(scores: number[]): number[] {
    const k = Math.min(this.config.topK, scores.length);

    // OPTIMIZATION: Avoid sorting and allocations for small k
    if (k === 1) {
      let maxIdx = 0;
      let maxVal = scores[0];
      for (let i = 1; i < scores.length; i++) {
        if (scores[i] > maxVal) {
          maxVal = scores[i];
          maxIdx = i;
        }
      }
      return [maxIdx];
    } else if (k === 2 && scores.length >= 2) {
      let max0 = 0, max1 = 1;
      if (scores[1] > scores[0]) {
        max0 = 1;
        max1 = 0;
      }
      let val0 = scores[max0];
      let val1 = scores[max1];
      for (let i = 2; i < scores.length; i++) {
        const val = scores[i];
        if (val > val0) {
          val1 = val0;
          max1 = max0;
          val0 = val;
          max0 = i;
        } else if (val > val1) {
          val1 = val;
          max1 = i;
        }
      }
      return [max0, max1];
    } else if (k === 4 && scores.length >= 4) {
      // OPTIMIZATION: 4-element specialization using inline sorting network
      // and branchless element-shifting to completely bypass array sorting/allocations.
      let max0 = 0, max1 = 1, max2 = 2, max3 = 3;
      if (scores[max1] > scores[max0]) { const t = max0; max0 = max1; max1 = t; }
      if (scores[max2] > scores[max0]) { const t = max0; max0 = max2; max2 = t; }
      if (scores[max3] > scores[max0]) { const t = max0; max0 = max3; max3 = t; }
      if (scores[max2] > scores[max1]) { const t = max1; max1 = max2; max2 = t; }
      if (scores[max3] > scores[max1]) { const t = max1; max1 = max3; max3 = t; }
      if (scores[max3] > scores[max2]) { const t = max2; max2 = max3; max3 = t; }

      let val0 = scores[max0];
      let val1 = scores[max1];
      let val2 = scores[max2];
      let val3 = scores[max3];

      for (let i = 4; i < scores.length; i++) {
        const val = scores[i];
        if (val > val0) {
          val3 = val2; max3 = max2;
          val2 = val1; max2 = max1;
          val1 = val0; max1 = max0;
          val0 = val; max0 = i;
        } else if (val > val1) {
          val3 = val2; max3 = max2;
          val2 = val1; max2 = max1;
          val1 = val; max1 = i;
        } else if (val > val2) {
          val3 = val2; max3 = max2;
          val2 = val; max2 = i;
        } else if (val > val3) {
          val3 = val; max3 = i;
        }
      }
      return [max0, max1, max2, max3];
    }

    // OPTIMIZATION: Reuse pre-allocated selectScratch buffer to avoid allocations.
    const indices = this.selectScratch;
    for (let i = 0; i < scores.length; i++) {
      indices[i] = i;
    }
    indices.sort((a, b) => scores[b] - scores[a]);
    const result = new Array<number>(k);
    for (let i = 0; i < k; i++) {
      result[i] = indices[i];
    }
    return result;
  }

  private softmax(values: number[]): number[] {
    const len = values.length;
    // OPTIMIZATION: Specialize softmax for len === 1 and len === 2 to bypass allocation
    if (len === 1) {
      return [1.0];
    } else if (len === 2) {
      const v0 = values[0], v1 = values[1];
      const max = v0 > v1 ? v0 : v1;
      const e0 = Math.exp(v0 - max);
      const e1 = Math.exp(v1 - max);
      const sum = e0 + e1;
      return [e0 / sum, e1 / sum];
    } else if (len === 4) {
      // OPTIMIZATION: Specialize softmax for len === 4 to bypass loops, array allocations, and divisions.
      const v0 = values[0], v1 = values[1], v2 = values[2], v3 = values[3];
      let max = v0;
      if (v1 > max) max = v1;
      if (v2 > max) max = v2;
      if (v3 > max) max = v3;
      const e0 = Math.exp(v0 - max);
      const e1 = Math.exp(v1 - max);
      const e2 = Math.exp(v2 - max);
      const e3 = Math.exp(v3 - max);
      const sum = e0 + e1 + e2 + e3;
      const invSum = sum === 0 ? 1 : 1.0 / sum;
      return [e0 * invSum, e1 * invSum, e2 * invSum, e3 * invSum];
    }

    // OPTIMIZATION: Single-pass loops over standard arrays without spread operator
    // or nested/higher-order functions, avoiding GC and engine optimization boundaries.
    let max = values[0];
    for (let i = 1; i < len; i++) {
      if (values[i] > max) {
        max = values[i];
      }
    }
    const exps = new Float64Array(len);
    let sum = 0;
    for (let i = 0; i < len; i++) {
      const e = Math.exp(values[i] - max);
      exps[i] = e;
      sum += e;
    }
    if (sum === 0) sum = 1;
    const result = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      result[i] = exps[i] / sum;
    }
    return result;
  }

  private computeEntropy(scores: number[]): number {
    const probs = this.softmax(scores);
    let entropy = 0;
    for (const p of probs) {
      if (p > 0) entropy -= p * Math.log(p);
    }
    return entropy;
  }

  private computeLoadBalanceLoss(): number {
    const stats = this.getUtilizationStats();
    if (stats.length === 0) return 0;
    const totalUtil = stats.reduce((s, x) => s + x.utilization, 0);
    const meanUtil = totalUtil / stats.length;
    let variance = 0;
    for (const s of stats) {
      variance += Math.pow(s.utilization - meanUtil, 2);
    }
    return variance / stats.length;
  }

  private trackUtilization(expertId: number, weight: number): void {
    const util = this.utilization.get(expertId);
    if (util) {
      util.calls++;
      util.tokens++;
      util.weightSum += weight;
    }
  }

  private hashInput(input: Float32Array): string {
    let hash = 0;
    for (let i = 0; i < Math.min(input.length, 64); i++) {
      hash = ((hash << 5) - hash) + Math.round(input[i] * 1000);
      hash = hash & hash;
    }
    return `h_${hash}`;
  }
}
