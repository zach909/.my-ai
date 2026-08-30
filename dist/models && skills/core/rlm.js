import { BackgroundQuantizer } from './quantizer.js';
export class RLMTrainer {
    constructor(config = {}) {
        this.bufferSize = 0;
        this.cachedTotalPriority = 0;
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
            // Clamped like elastic-core.ts's identical field: BackgroundQuantizer's
            // symmetric path divides by qMax = floor((2^bits - 1) / 2), which is 0
            // at bits <= 1 (scale becomes Infinity, then 0 * Infinity = NaN),
            // permanently poisoning the quantized weights/bias from then on.
            quantizationBits: Math.max(2, Math.min(16, Math.floor(config.quantizationBits ?? 8))),
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
        this.prioritiesBuffer = new Array(this.config.replayBufferSize);
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
        this.qValuesBuffer = new Float32Array(this.config.actionDim);
        this.wPlusResidualBuffer = new Float32Array(this.policyWeights.length);
        this.bPlusResidualBuffer = new Float32Array(this.policyBias.length);
        this.defaultActions = Array.from({ length: this.config.actionDim }, (_, i) => i);
        this.scoredScratch = Array.from({ length: this.config.actionDim }, () => ({ action: 0, score: 0 }));
        this.sampledBatchBuffer = new Array(this.config.batchSize);
        this.refreshQuantizedForward();
    }
    /**
     * Re-quantize the current full-precision weights/bias (plus carried-over
     * residual from the last refresh) into the cache the forward pass reads.
     * Called once per train() tick — not on every forward call — so the
     * residual reflects genuine drift between ticks rather than compounding
     * across repeated reads of an unchanged weight matrix.
     */
    refreshQuantizedForward() {
        if (!this.quantizer)
            return;
        const wPlusResidual = this.wPlusResidualBuffer;
        const lenW = wPlusResidual.length;
        let i = 0;
        for (; i < lenW - 3; i += 4) {
            wPlusResidual[i] = this.policyWeights[i] + this.weightResidual[i];
            wPlusResidual[i + 1] = this.policyWeights[i + 1] + this.weightResidual[i + 1];
            wPlusResidual[i + 2] = this.policyWeights[i + 2] + this.weightResidual[i + 2];
            wPlusResidual[i + 3] = this.policyWeights[i + 3] + this.weightResidual[i + 3];
        }
        for (; i < lenW; i++) {
            wPlusResidual[i] = this.policyWeights[i] + this.weightResidual[i];
        }
        const wq = this.quantizer.quantize(wPlusResidual, undefined, this.quantizedWeights);
        i = 0;
        for (; i < lenW - 3; i += 4) {
            this.weightResidual[i] = wPlusResidual[i] - wq[i];
            this.weightResidual[i + 1] = wPlusResidual[i + 1] - wq[i + 1];
            this.weightResidual[i + 2] = wPlusResidual[i + 2] - wq[i + 2];
            this.weightResidual[i + 3] = wPlusResidual[i + 3] - wq[i + 3];
        }
        for (; i < lenW; i++) {
            this.weightResidual[i] = wPlusResidual[i] - wq[i];
        }
        const bPlusResidual = this.bPlusResidualBuffer;
        const lenB = bPlusResidual.length;
        let j = 0;
        for (; j < lenB - 3; j += 4) {
            bPlusResidual[j] = this.policyBias[j] + this.biasResidual[j];
            bPlusResidual[j + 1] = this.policyBias[j + 1] + this.biasResidual[j + 1];
            bPlusResidual[j + 2] = this.policyBias[j + 2] + this.biasResidual[j + 2];
            bPlusResidual[j + 3] = this.policyBias[j + 3] + this.biasResidual[j + 3];
        }
        for (; j < lenB; j++) {
            bPlusResidual[j] = this.policyBias[j] + this.biasResidual[j];
        }
        const bq = this.quantizer.quantize(bPlusResidual, undefined, this.quantizedBias);
        j = 0;
        for (; j < lenB - 3; j += 4) {
            this.biasResidual[j] = bPlusResidual[j] - bq[j];
            this.biasResidual[j + 1] = bPlusResidual[j + 1] - bq[j + 1];
            this.biasResidual[j + 2] = bPlusResidual[j + 2] - bq[j + 2];
            this.biasResidual[j + 3] = bPlusResidual[j + 3] - bq[j + 3];
        }
        for (; j < lenB; j++) {
            this.biasResidual[j] = bPlusResidual[j] - bq[j];
        }
    }
    /** Mean absolute quantization residual currently carried for the weight matrix — a drift diagnostic. */
    getQuantizationDrift() {
        if (!this.quantizer || this.weightResidual.length === 0)
            return 0;
        let sum = 0;
        for (let i = 0; i < this.weightResidual.length; i++)
            sum += Math.abs(this.weightResidual[i]);
        return sum / this.weightResidual.length;
    }
    selectAction(state, availableActions) {
        const actions = availableActions || this.defaultActions;
        if (Math.random() < this.currentExplorationRate) {
            const idx = Math.floor(Math.random() * actions.length);
            return { action: actions[idx], thinkingSteps: [idx] };
        }
        const qValues = this.computeQValues(state);
        const numActions = actions.length;
        while (this.scoredScratch.length < numActions) {
            this.scoredScratch.push({ action: 0, score: 0 });
        }
        // Predict-before-commit: score every candidate action once (immediate Q
        // value plus a discounted simulated-reward estimate).
        // OPTIMIZATION: Bypassing simulateStep avoids recalculating computeQValues (re-evaluating neural forward pass)
        // multiple times redundantly inside the loop. This reduces complexity from O(A^2 * S) to O(A * S).
        const discount = this.config.discountFactor;
        for (let i = 0; i < numActions; i++) {
            const a = actions[i];
            const obj = this.scoredScratch[i];
            obj.action = a;
            obj.score = qValues[a] + (qValues[a] * 0.1) * discount;
        }
        // Sort scoredScratch prefix of size numActions in-place (Insertion Sort in descending order) to avoid any allocations
        for (let i = 1; i < numActions; i++) {
            const keyAction = this.scoredScratch[i].action;
            const keyScore = this.scoredScratch[i].score;
            let j = i - 1;
            while (j >= 0 && this.scoredScratch[j].score < keyScore) {
                this.scoredScratch[j + 1].action = this.scoredScratch[j].action;
                this.scoredScratch[j + 1].score = this.scoredScratch[j].score;
                j--;
            }
            this.scoredScratch[j + 1].action = keyAction;
            this.scoredScratch[j + 1].score = keyScore;
        }
        const k = Math.min(numActions, Math.max(1, this.config.lookaheadSteps));
        const thinkingSteps = new Array(k);
        for (let i = 0; i < k; i++) {
            thinkingSteps[i] = this.scoredScratch[i].action;
        }
        let bestAction = thinkingSteps[0];
        const loopAction = this.detectLoop(bestAction);
        if (loopAction !== -1) {
            // OPTIMIZATION: Manually find the best non-loop action to completely avoid allocating a filtered array.
            let bestQ2 = -Infinity;
            let bestAction2 = -1;
            for (let i = 0; i < numActions; i++) {
                const a = actions[i];
                if (a !== loopAction) {
                    if (qValues[a] > bestQ2) {
                        bestQ2 = qValues[a];
                        bestAction2 = a;
                    }
                }
            }
            if (bestAction2 !== -1) {
                bestAction = bestAction2;
            }
        }
        return { action: bestAction, thinkingSteps };
    }
    addExperience(experience) {
        const oldExp = this.replayBuffer[this.bufferPosition];
        const oldP = oldExp ? (oldExp.priority || 1) : 0;
        const newP = experience.priority || 1;
        const diff = newP - oldP;
        this.replayBuffer[this.bufferPosition] = experience;
        const prev = this.bufferPosition > 0 ? this.prioritiesBuffer[this.bufferPosition - 1] : 0;
        this.prioritiesBuffer[this.bufferPosition] = prev + newP;
        if (oldExp) {
            if (diff !== 0) {
                for (let i = this.bufferPosition + 1; i < this.bufferSize; i++) {
                    this.prioritiesBuffer[i] += diff;
                }
            }
        }
        else {
            this.bufferSize++;
        }
        this.cachedTotalPriority = this.prioritiesBuffer[this.bufferSize - 1];
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
    async train() {
        const batchSize = this.sampleBatch();
        if (batchSize === 0) {
            return {
                loss: 0,
                avgReward: 0,
                explorationRate: this.currentExplorationRate,
                policyState: this.getPolicyState(),
                tdErrors: [],
                stepsTrained: 0,
            };
        }
        const tdErrors = [];
        let totalLoss = 0;
        const discount = this.config.discountFactor;
        for (let b = 0; b < batchSize; b++) {
            const exp = this.sampledBatchBuffer[b];
            // Avoid copying since computeQValues reuses the buffer; reading currentQ immediately avoids the allocation.
            const currentQ = this.computeQValues(exp.state)[exp.action];
            const targetQValues = this.computeQValues(exp.nextState);
            let maxNextQ = -Infinity;
            for (let i = 0; i < targetQValues.length; i++) {
                if (targetQValues[i] > maxNextQ)
                    maxNextQ = targetQValues[i];
            }
            const targetQ = exp.reward + (exp.done ? 0 : discount * maxNextQ);
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
        let rewardSum = 0;
        for (let b = 0; b < batchSize; b++) {
            rewardSum += this.sampledBatchBuffer[b].reward;
        }
        const avgReward = rewardSum / batchSize;
        return {
            loss: totalLoss / batchSize,
            avgReward,
            explorationRate: this.currentExplorationRate,
            policyState: this.getPolicyState(),
            tdErrors,
            stepsTrained: batchSize,
        };
    }
    computeQValues(state) {
        // QAT: forward reads the quantized snapshot when enabled, so action
        // selection and TD-targets both "think" in the same reduced-precision
        // representation the network will actually run under after export.
        const weights = this.quantizer ? this.quantizedWeights : this.policyWeights;
        const bias = this.quantizer ? this.quantizedBias : this.policyBias;
        const actionDim = this.config.actionDim;
        const qValues = this.qValuesBuffer;
        qValues.set(bias);
        // Optimized matrix-vector multiplication with row-major (sequential)
        // memory access. Swapping loops ensures we read weights sequentially.
        for (let s = 0; s < state.length; s++) {
            const stateVal = state[s];
            if (stateVal === 0)
                continue; // Skip zero-value elements (sparsity fast-path)
            const offset = s * actionDim;
            // 4x loop unrolling for the inner loop to improve throughput
            let a = 0;
            for (; a <= actionDim - 4; a += 4) {
                qValues[a] += stateVal * weights[offset + a];
                qValues[a + 1] += stateVal * weights[offset + a + 1];
                qValues[a + 2] += stateVal * weights[offset + a + 2];
                qValues[a + 3] += stateVal * weights[offset + a + 3];
            }
            for (; a < actionDim; a++) {
                qValues[a] += stateVal * weights[offset + a];
            }
        }
        return qValues;
    }
    computeTDError(experience) {
        // Avoid copying since computeQValues reuses the buffer; reading currentQ immediately avoids the allocation.
        const currentQ = this.computeQValues(experience.state)[experience.action];
        const targetQValues = this.computeQValues(experience.nextState);
        let maxNextQ = -Infinity;
        for (let i = 0; i < targetQValues.length; i++) {
            if (targetQValues[i] > maxNextQ)
                maxNextQ = targetQValues[i];
        }
        const targetQ = experience.reward + (experience.done ? 0 : this.config.discountFactor * maxNextQ);
        return targetQ - currentQ;
    }
    updatePolicy(state, action, tdError) {
        const gradient = tdError * this.config.learningRate;
        const actionDim = this.config.actionDim;
        const len = state.length;
        let s = 0;
        const limit = len - 3;
        for (; s < limit; s += 4) {
            this.policyWeights[s * actionDim + action] += gradient * state[s];
            this.policyWeights[(s + 1) * actionDim + action] += gradient * state[s + 1];
            this.policyWeights[(s + 2) * actionDim + action] += gradient * state[s + 2];
            this.policyWeights[(s + 3) * actionDim + action] += gradient * state[s + 3];
        }
        for (; s < len; s++) {
            this.policyWeights[s * actionDim + action] += gradient * state[s];
        }
        this.policyBias[action] += gradient;
    }
    simulateStep(state, action) {
        const qValues = this.computeQValues(state);
        return qValues[action] * 0.1;
    }
    sampleBatch() {
        const bufferSize = this.bufferSize;
        if (bufferSize === 0)
            return 0;
        const priorities = this.prioritiesBuffer;
        const totalPriority = this.cachedTotalPriority;
        const batchSize = Math.min(this.config.batchSize, bufferSize);
        // Ensure our sampledBatchBuffer is properly sized (safety resize)
        while (this.sampledBatchBuffer.length < batchSize) {
            this.sampledBatchBuffer.push(this.replayBuffer[0]);
        }
        for (let i = 0; i < batchSize; i++) {
            const target = Math.random() * totalPriority;
            let low = 0;
            let high = bufferSize - 1;
            let idx = high;
            while (low <= high) {
                const mid = (low + high) >> 1;
                if (priorities[mid] >= target) {
                    idx = mid;
                    high = mid - 1;
                }
                else {
                    low = mid + 1;
                }
            }
            this.sampledBatchBuffer[i] = this.replayBuffer[idx];
        }
        return batchSize;
    }
    syncTargetPolicy() {
        for (let i = 0; i < this.targetWeights.length; i++) {
            this.targetWeights[i] = this.policyWeights[i];
        }
        for (let i = 0; i < this.targetBias.length; i++) {
            this.targetBias[i] = this.policyBias[i];
        }
    }
    decayExploration() {
        this.currentExplorationRate = Math.max(this.config.minExplorationRate, this.currentExplorationRate * this.config.explorationDecay);
    }
    argmax(values) {
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
    secondArgmax(values) {
        const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
        return sorted.length > 1 ? sorted[1].i : sorted[0].i;
    }
    initializePolicy(weights, bias) {
        const scale = Math.sqrt(2.0 / this.config.stateDim);
        for (let i = 0; i < weights.length; i++) {
            weights[i] = (Math.random() * 2 - 1) * scale;
        }
        for (let i = 0; i < bias.length; i++) {
            bias[i] = (Math.random() * 2 - 1) * 0.01;
        }
    }
    /**
     * Detects loops in action history.
     * OPTIMIZATION: Replaces array slicing and temporary array allocations with
     * direct element comparison over the existing bounded array to achieve zero-allocation loop detection.
     */
    detectLoop(action) {
        const windowSize = this.config.loopDetectionWindow;
        if (this.recentActions.length < windowSize || (windowSize & 1) !== 0)
            return -1;
        const startIdx = this.recentActions.length - windowSize;
        const half = windowSize >> 1;
        for (let i = 0; i < half; i++) {
            if (this.recentActions[startIdx + i] !== this.recentActions[startIdx + half + i]) {
                return -1;
            }
        }
        return action;
    }
    getBufferSize() {
        return this.bufferSize;
    }
    getExplorationRate() {
        return this.currentExplorationRate;
    }
    getPolicyState() {
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
