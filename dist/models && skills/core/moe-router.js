export class MoERouter {
    constructor(config = {}) {
        this.iteration = 0;
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
        this.initializeExpertWeights();
        this.initializeExperts();
    }
    initializeExpertWeights() {
        const scale = Math.sqrt(2.0 / this.config.inputDim);
        for (let i = 0; i < this.routerWeights.length; i++) {
            this.routerWeights[i] = (Math.random() * 2 - 1) * scale;
        }
    }
    initializeExperts() {
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
    route(input) {
        const scores = this.computeRouterScores(input);
        const topKIndices = this.selectTopK(scores);
        const routerWeights = this.softmax(topKIndices.map(i => scores[i]));
        const expertOutputs = [];
        for (let i = 0; i < topKIndices.length; i++) {
            const expertIdx = topKIndices[i];
            const expert = this.experts.get(expertIdx);
            const output = new Float32Array(this.config.outputDim);
            // Initialize with bias, then accumulate the expert's matrix-vector
            // product using row-major (sequential) memory access.
            output.set(expert.bias);
            const weights = expert.weights;
            const hiddenDim = this.config.expertHiddenDim;
            for (let k = 0; k < input.length; k++) {
                const inputVal = input[k];
                const weightOffset = k * hiddenDim;
                for (let j = 0; j < hiddenDim; j++) {
                    output[j] += inputVal * weights[weightOffset + j];
                }
            }
            expertOutputs.push(output);
            this.trackUtilization(expertIdx, routerWeights[i]);
        }
        const combinedOutput = new Float32Array(this.config.outputDim);
        for (let j = 0; j < this.config.outputDim; j++) {
            let sum = 0;
            for (let i = 0; i < topKIndices.length; i++) {
                sum += expertOutputs[i][j] * routerWeights[i];
            }
            combinedOutput[j] = sum;
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
    forward(input, layerIndex = 0) {
        const decision = this.route(input);
        const expertContributions = new Map();
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
    addExpert(first, bias) {
        const expertId = this.experts.size;
        if (first instanceof Float32Array) {
            this.experts.set(expertId, { weights: first, bias: bias || new Float32Array(0) });
        }
        else {
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
    growRouterCapacity() {
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
        this.config.expertCount = newCount;
    }
    removeExpert(expertId) {
        if (!this.experts.has(expertId))
            return false;
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
        const newExperts = new Map();
        const newUtil = new Map();
        const newWeights = new Float32Array(inputDim * survivors.length);
        const newBias = new Float32Array(survivors.length);
        survivors.forEach((oldId, newId) => {
            newExperts.set(newId, this.experts.get(oldId));
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
        this.config.expertCount = survivors.length;
        return true;
    }
    setExpertWeights(expertId, weights, bias) {
        if (this.experts.has(expertId)) {
            this.experts.set(expertId, { weights, bias });
        }
    }
    getUtilizationStats() {
        const stats = [];
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
    getExpertCount() {
        return this.experts.size;
    }
    getExpertList() {
        return Array.from(this.experts.keys());
    }
    computeRouterScores(input) {
        const expertCount = this.config.expertCount;
        const scores = new Float64Array(expertCount);
        // Initialize with router bias
        scores.set(this.routerBias);
        // Optimized router scoring with sequential (row-major) memory access.
        const weights = this.routerWeights;
        for (let i = 0; i < input.length; i++) {
            const inputVal = input[i];
            const offset = i * expertCount;
            for (let e = 0; e < expertCount; e++) {
                scores[e] += inputVal * weights[offset + e];
            }
        }
        return Array.from(scores);
    }
    selectTopK(scores) {
        const indexed = scores.map((s, i) => ({ score: s, index: i }));
        indexed.sort((a, b) => b.score - a.score);
        const k = Math.min(this.config.topK, indexed.length);
        return indexed.slice(0, k).map(x => x.index);
    }
    softmax(values) {
        const max = Math.max(...values, 0);
        const exps = values.map(v => Math.exp(v - max));
        const sum = exps.reduce((a, b) => a + b, 0) || 1;
        return exps.map(e => e / sum);
    }
    computeEntropy(scores) {
        const probs = this.softmax(scores);
        let entropy = 0;
        for (const p of probs) {
            if (p > 0)
                entropy -= p * Math.log(p);
        }
        return entropy;
    }
    computeLoadBalanceLoss() {
        const stats = this.getUtilizationStats();
        if (stats.length === 0)
            return 0;
        const totalUtil = stats.reduce((s, x) => s + x.utilization, 0);
        const meanUtil = totalUtil / stats.length;
        let variance = 0;
        for (const s of stats) {
            variance += Math.pow(s.utilization - meanUtil, 2);
        }
        return variance / stats.length;
    }
    trackUtilization(expertId, weight) {
        const util = this.utilization.get(expertId);
        if (util) {
            util.calls++;
            util.tokens++;
            util.weightSum += weight;
        }
    }
    hashInput(input) {
        let hash = 0;
        for (let i = 0; i < Math.min(input.length, 64); i++) {
            hash = ((hash << 5) - hash) + Math.round(input[i] * 1000);
            hash = hash & hash;
        }
        return `h_${hash}`;
    }
}
