export class MoERouter {
    config;
    experts;
    routerWeights;
    routerBias;
    utilization;
    iteration = 0;
    constructor(config = {}) {
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
            // Optimization: Using bias directly and swapping loops for row-major access
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
        if (first instanceof Float32Array) {
            const expertId = this.experts.size;
            this.experts.set(expertId, { weights: first, bias: bias || new Float32Array(0) });
            this.utilization.set(expertId, { calls: 0, tokens: 0, weightSum: 0 });
            const newRouterWeights = new Float32Array(this.config.inputDim * (this.experts.size));
            for (let i = 0; i < this.routerWeights.length; i++) {
                newRouterWeights[i] = this.routerWeights[i];
            }
            const scale = Math.sqrt(2.0 / this.config.inputDim);
            for (let i = this.routerWeights.length; i < newRouterWeights.length; i++) {
                newRouterWeights[i] = (Math.random() * 2 - 1) * scale;
            }
            this.routerWeights = newRouterWeights;
            const newBias = new Float32Array(this.experts.size);
            for (let i = 0; i < this.routerBias.length; i++) {
                newBias[i] = this.routerBias[i];
            }
            this.routerBias = newBias;
            this.config.expertCount = this.experts.size;
            return expertId;
        }
        else {
            const expertId = this.experts.size;
            const dim = this.config.expertHiddenDim || 128;
            const weights = new Float32Array(this.config.inputDim * dim);
            const scale = Math.sqrt(2.0 / this.config.inputDim);
            for (let i = 0; i < weights.length; i++) {
                weights[i] = (Math.random() * 2 - 1) * scale;
            }
            this.experts.set(expertId, { weights, bias: new Float32Array(dim) });
            this.utilization.set(expertId, { calls: 0, tokens: 0, weightSum: 0 });
            this.config.expertCount = this.experts.size;
            return expertId;
        }
    }
    removeExpert(expertId) {
        if (!this.experts.has(expertId))
            return false;
        this.experts.delete(expertId);
        this.utilization.delete(expertId);
        this.config.expertCount = this.experts.size;
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
        const scores = new Float32Array(this.config.expertCount);
        scores.set(this.routerBias);
        const weights = this.routerWeights;
        const expertCount = this.config.expertCount;
        for (let i = 0; i < input.length; i++) {
            const inputVal = input[i];
            const weightOffset = i * expertCount;
            for (let e = 0; e < expertCount; e++) {
                scores[e] += inputVal * weights[weightOffset + e];
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
