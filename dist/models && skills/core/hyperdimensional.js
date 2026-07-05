function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}
export class HyperDimensionalEngine {
    config;
    neurons;
    seenPatterns;
    history;
    iteration = 0;
    totalDims;
    // Section 8: persistent per-connection weight tensor, all-to-all. Each
    // connection carries a diagonal weight vector (same-dimension coupling)
    // plus one shift vector (source dim d -> target dim (d+1)%totalDims) —
    // "diagonal-plus-few" cross terms rather than a full D x D block, so cost
    // per connection stays linear in D instead of quadratic.
    connDiag;
    connShift;
    // Bias is per-neuron (added once after the full summed product), not
    // per-connection — otherwise it would scale with connection count.
    bias;
    // Section 10: compressed (rank-r) self-model predicting next tick's
    // outputVector from this tick's. The prediction/actual gap is the
    // meta-awareness ("surprise") signal, not the prediction itself.
    selfModelA;
    selfModelB;
    lastOutputVector = null;
    // Section 12: fast intra-settle self-model (EMA over mean content energy)
    // used for live, per-iteration divergence correction. influenceDecay
    // drives the EMA smoothing — previously a config field that was consumed
    // but decayed cross-influence to zero over a long run with no real signal
    // behind it; here it is the actual self-model smoothing factor.
    emaEnergy = 0;
    hasEma = false;
    sustainedDivergence = 0;
    constructor(config = {}) {
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
        this.totalDims = this.config.dimensions + 1;
        this.neurons = [];
        this.seenPatterns = new Map();
        this.history = [];
        this.connDiag = new Map();
        this.connShift = new Map();
        this.bias = new Map();
        this.initializeNeurons();
        this.initializeConnections();
        const rank = this.config.selfModelRank;
        const dims = this.config.dimensions;
        this.selfModelA = new Float32Array(dims * rank);
        this.selfModelB = new Float32Array(rank * dims);
        const scale = Math.sqrt(1 / Math.max(1, dims));
        for (let i = 0; i < this.selfModelA.length; i++)
            this.selfModelA[i] = (Math.random() * 2 - 1) * scale;
        for (let i = 0; i < this.selfModelB.length; i++)
            this.selfModelB[i] = (Math.random() * 2 - 1) * scale;
    }
    /**
     * Run one tick: settle the mesh to convergence for the given input, apply
     * value-gated Hebbian weight learning, and derive all reported signals
     * from the resulting settled state S.
     *
     * @param directInputNeuronIds Neurons directly clamped to `inputVector`
     *   this tick (their input-flag dimension goes hot; all others evolve
     *   purely by propagation from the weight tensor). Omit to drive every
     *   neuron directly, matching the legacy shared-input behaviour.
     */
    process(inputVector, learningRates, directInputNeuronIds) {
        let resolvedInput;
        if (inputVector instanceof Map) {
            const arrays = Array.from(inputVector.values());
            if (arrays.length > 0) {
                resolvedInput = Array.from(arrays[0]);
            }
            else {
                resolvedInput = new Array(this.config.dimensions).fill(0);
            }
        }
        else {
            resolvedInput = inputVector;
        }
        const drivenIds = directInputNeuronIds ?? new Set(this.neurons.map(n => n.id));
        const preSettleStates = this.neurons.map(n => [...n.state]);
        const preSettleEnergies = new Map(this.neurons.map(n => [n.id, n.energy]));
        const { stateDeltas, liveCorrections, iterations } = this.settle(resolvedInput, drivenIds);
        // Value-gated Hebbian learning on the connection tensor, folding the
        // resulting weight-change magnitude into the same per-neuron delta
        // signal used to feed the elastic value budget.
        this.applyWeightLearning(learningRates, stateDeltas);
        const transitions = [];
        for (let idx = 0; idx < this.neurons.length; idx++) {
            const neuron = this.neurons[idx];
            const newEnergy = this.computeStateEnergy(neuron.state);
            if (newEnergy !== preSettleEnergies.get(neuron.id)) {
                transitions.push({
                    fromState: preSettleStates[idx],
                    toState: [...neuron.state],
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
        // Section 10: compare this tick's actual output to what the compressed
        // self-model predicted (from last tick's output), then train it one step.
        let selfModelSurprise = 0;
        if (this.lastOutputVector) {
            const predicted = this.selfModelPredict(this.lastOutputVector);
            selfModelSurprise = this.meanAbsDiff(predicted, outputVector);
            this.selfModelTrainStep(this.lastOutputVector, predicted, outputVector);
        }
        this.lastOutputVector = outputVector;
        // Blend pattern-repetition novelty with self-model surprise: a trajectory
        // can be novel either because the pattern itself is unfamiliar, or
        // because it diverged from what the network's own model expected.
        const noveltyScore = clamp(0.6 * patternNovelty + 0.4 * selfModelSurprise, 0, 1);
        this.recordPattern(patternHash, noveltyScore);
        this.history.push(...transitions, ...resolvedTransitions);
        this.iteration++;
        const inputTopography = new Map();
        for (const n of this.neurons)
            inputTopography.set(n.id, n.state[0]);
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
    hasSeenPattern(patternHash) {
        return this.seenPatterns.has(patternHash);
    }
    getPatternNovelty(patternHash) {
        return this.seenPatterns.get(patternHash)?.novelty ?? 1;
    }
    getSeenPatternCount() {
        return this.seenPatterns.size;
    }
    getHistory() {
        return Array.from(this.seenPatterns.entries()).map(([hash, pattern]) => ({
            hash,
            count: pattern.frequency,
            lastSeen: pattern.lastSeen,
            step: this.iteration,
        }));
    }
    getNeuronStates() {
        return this.neurons.map(n => ({ ...n, state: [...n.state] }));
    }
    /**
     * The settled state S as a single matrix accessor (neurons x totalDims,
     * row-major) — "current full context", reused by self-reading,
     * quantization, and (when built) the alignment veto.
     */
    getContextMatrix() {
        const D = this.totalDims;
        const data = new Float32Array(this.neurons.length * D);
        for (let i = 0; i < this.neurons.length; i++) {
            const s = this.neurons[i].state;
            for (let d = 0; d < D; d++)
                data[i * D + d] = s[d];
        }
        return { data, neuronCount: this.neurons.length, dims: D };
    }
    /** Per-neuron reading of the input-flag dimension (section 5 self-reading). */
    getInputTopography() {
        const map = new Map();
        for (const n of this.neurons)
            map.set(n.id, n.state[0]);
        return map;
    }
    /**
     * Formalizes "exclusive input": true iff exactly one neuron's input-flag
     * dimension is hot (>= threshold) this tick.
     */
    isExclusiveInput(threshold = 0.9) {
        const hot = [];
        for (const n of this.neurons) {
            if (n.state[0] >= threshold)
                hot.push(n.id);
        }
        return hot.length === 1 ? { exclusive: true, neuronId: hot[0] } : { exclusive: false };
    }
    initializeNeurons() {
        for (let i = 0; i < this.config.neuronCount; i++) {
            const state = [0]; // index 0: input-flag, starts cold
            for (let d = 0; d < this.config.dimensions; d++) {
                state.push(Math.random() * 2 - 1);
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
    initializeConnections() {
        const D = this.totalDims;
        const ids = this.neurons.map(n => n.id);
        const scale = Math.sqrt(1 / Math.max(1, ids.length));
        for (const i of ids) {
            const diagRow = new Map();
            const shiftRow = new Map();
            for (const j of ids) {
                if (i === j)
                    continue;
                const wd = new Float32Array(D);
                const ws = new Float32Array(D);
                for (let d = 0; d < D; d++) {
                    wd[d] = (Math.random() * 2 - 1) * scale;
                    ws[d] = (Math.random() * 2 - 1) * scale * 0.5;
                }
                diagRow.set(j, wd);
                shiftRow.set(j, ws);
            }
            this.connDiag.set(i, diagRow);
            this.connShift.set(i, shiftRow);
            this.bias.set(i, new Float32Array(D));
        }
    }
    /**
     * Propagate-to-convergence: S <- activate(bias + W . S), repeated, rather
     * than a single hop. Neurons in `drivenIds` are clamped to the external
     * input for the whole settle (the "exclusive input" contract); everyone
     * else evolves purely from the connection tensor, so their input-flag
     * dimension diffuses outward from the driven neurons and gives every
     * neuron a reading of the input topography once settled.
     */
    settle(resolvedInput, drivenIds) {
        const D = this.totalDims;
        const stateDeltas = new Map();
        for (const n of this.neurons)
            stateDeltas.set(n.id, 0);
        let liveCorrections = 0;
        let iterations = 0;
        for (; iterations < this.config.propagationSteps; iterations++) {
            const prevStates = this.neurons.map(n => n.state);
            const newStates = [];
            for (const ni of this.neurons) {
                const b = this.bias.get(ni.id);
                const ctx = new Float32Array(b);
                const diagRow = this.connDiag.get(ni.id);
                const shiftRow = this.connShift.get(ni.id);
                for (const nj of this.neurons) {
                    if (nj.id === ni.id)
                        continue;
                    const wd = diagRow.get(nj.id);
                    const ws = shiftRow.get(nj.id);
                    const sj = nj.state;
                    for (let d = 0; d < D; d++) {
                        const srcD = (d - 1 + D) % D;
                        ctx[d] += sj[d] * wd[d] + sj[srcD] * ws[d] * this.config.crossInfluenceStrength;
                    }
                }
                const squashed = new Array(D);
                for (let d = 0; d < D; d++)
                    squashed[d] = Math.tanh(ctx[d]);
                newStates.push(squashed);
            }
            for (let idx = 0; idx < this.neurons.length; idx++) {
                const ni = this.neurons[idx];
                if (!drivenIds.has(ni.id))
                    continue;
                const s = newStates[idx];
                s[0] = 1.0;
                for (let d = 0; d < this.config.dimensions; d++) {
                    s[d + 1] = clamp(resolvedInput[d] ?? 0, -1, 1);
                }
            }
            // Section 12 live correction: a cheap EMA over mean content energy is
            // this fast loop's own compressed self-model. Sustained (not
            // single-tick) divergence between predicted and actual energy triggers
            // damping — blending the update back toward the previous, more stable
            // state — so a noisy tick can't cancel a trajectory that was fine.
            const actualEnergy = this.meanContentEnergy(newStates);
            const predictedEnergy = this.hasEma ? this.emaEnergy : actualEnergy;
            const divergence = Math.abs(actualEnergy - predictedEnergy);
            this.sustainedDivergence = divergence > this.config.divergenceTolerance ? this.sustainedDivergence + 1 : 0;
            if (this.sustainedDivergence >= this.config.sustainedDivergenceTicks) {
                for (let idx = 0; idx < this.neurons.length; idx++) {
                    if (drivenIds.has(this.neurons[idx].id))
                        continue;
                    const s = newStates[idx];
                    const prev = prevStates[idx];
                    for (let d = 0; d < D; d++)
                        s[d] = 0.5 * s[d] + 0.5 * prev[d];
                }
                liveCorrections++;
                this.sustainedDivergence = 0;
            }
            const settledEnergy = this.meanContentEnergy(newStates);
            this.emaEnergy = this.hasEma
                ? this.config.influenceDecay * this.emaEnergy + (1 - this.config.influenceDecay) * settledEnergy
                : settledEnergy;
            this.hasEma = true;
            let residual = 0;
            for (let idx = 0; idx < this.neurons.length; idx++) {
                const prev = prevStates[idx];
                const next = newStates[idx];
                let delta = 0;
                for (let d = 0; d < D; d++)
                    delta += Math.abs(next[d] - prev[d]);
                residual += delta;
                const ni = this.neurons[idx];
                stateDeltas.set(ni.id, (stateDeltas.get(ni.id) ?? 0) + delta);
                ni.state = next;
            }
            if (residual < this.config.convergenceThreshold) {
                iterations++;
                break;
            }
        }
        return { stateDeltas, liveCorrections, iterations };
    }
    /**
     * Hebbian weight update gated per-node by an externally supplied learning
     * rate (from the elastic value budget), applied to the connection tensor
     * built in initializeConnections(). Weight-change magnitude is folded into
     * `stateDeltas` so callers can feed one combined signal back into the
     * value budget.
     */
    applyWeightLearning(learningRates, stateDeltas) {
        const D = this.totalDims;
        for (const ni of this.neurons) {
            const rate = learningRates?.get(ni.id) ?? this.config.learningRate;
            const diagRow = this.connDiag.get(ni.id);
            const shiftRow = this.connShift.get(ni.id);
            let deltaSum = 0;
            for (const nj of this.neurons) {
                if (nj.id === ni.id)
                    continue;
                const wd = diagRow.get(nj.id);
                const ws = shiftRow.get(nj.id);
                for (let d = 0; d < D; d++) {
                    const srcD = (d - 1 + D) % D;
                    const newWd = clamp(wd[d] + rate * ni.state[d] * nj.state[d], -2, 2);
                    deltaSum += Math.abs(newWd - wd[d]);
                    wd[d] = newWd;
                    const newWs = clamp(ws[d] + rate * ni.state[d] * nj.state[srcD], -2, 2);
                    deltaSum += Math.abs(newWs - ws[d]);
                    ws[d] = newWs;
                }
            }
            const b = this.bias.get(ni.id);
            for (let d = 0; d < D; d++) {
                b[d] = clamp(b[d] + rate * 0.1 * ni.state[d], -1, 1);
            }
            stateDeltas.set(ni.id, (stateDeltas.get(ni.id) ?? 0) + deltaSum);
        }
    }
    meanContentEnergy(states) {
        let sum = 0;
        for (const s of states) {
            for (let d = 1; d < s.length; d++)
                sum += s[d] * s[d];
        }
        return sum / (states.length * this.config.dimensions);
    }
    /** Rank-r compressed self-model: predict(x) = B^T (A^T x). */
    selfModelPredict(vec) {
        const dims = this.config.dimensions;
        const rank = this.config.selfModelRank;
        const h = new Float32Array(rank);
        for (let d = 0; d < dims; d++) {
            const v = vec[d] ?? 0;
            for (let r = 0; r < rank; r++)
                h[r] += v * this.selfModelA[d * rank + r];
        }
        const out = new Array(dims).fill(0);
        for (let r = 0; r < rank; r++) {
            for (let d = 0; d < dims; d++)
                out[d] += h[r] * this.selfModelB[r * dims + d];
        }
        return out;
    }
    /** One online gradient step on the compressed self-model toward reducing predicted-vs-actual error. */
    selfModelTrainStep(prevVec, predicted, actual) {
        const dims = this.config.dimensions;
        const rank = this.config.selfModelRank;
        const lr = 0.01;
        const h = new Float32Array(rank);
        for (let d = 0; d < dims; d++) {
            const v = prevVec[d] ?? 0;
            for (let r = 0; r < rank; r++)
                h[r] += v * this.selfModelA[d * rank + r];
        }
        const error = new Float32Array(dims);
        for (let d = 0; d < dims; d++)
            error[d] = (actual[d] ?? 0) - (predicted[d] ?? 0);
        const dh = new Float32Array(rank);
        for (let r = 0; r < rank; r++) {
            let acc = 0;
            for (let d = 0; d < dims; d++)
                acc += error[d] * this.selfModelB[r * dims + d];
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
    meanAbsDiff(a, b) {
        const n = Math.min(a.length, b.length);
        if (n === 0)
            return 0;
        let sum = 0;
        for (let i = 0; i < n; i++)
            sum += Math.abs(a[i] - b[i]);
        return sum / n;
    }
    resolveStateTransitions() {
        const resolved = [];
        for (const neuron of this.neurons) {
            if (neuron.energy > this.config.energyThreshold) {
                const fromState = neuron.transitions.length > 0
                    ? [...neuron.transitions[neuron.transitions.length - 1].toState]
                    : [...neuron.state];
                const transition = {
                    fromState,
                    toState: [...neuron.state],
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
    /** Content-only energy (excludes the reserved input-flag dimension at index 0). */
    computeStateEnergy(state) {
        let energy = 0;
        for (let d = 1; d < state.length; d++) {
            energy += state[d] * state[d];
        }
        return energy / this.config.dimensions;
    }
    computeOutputVector(activeStates) {
        const output = new Array(this.config.dimensions).fill(0);
        if (activeStates.length === 0)
            return output;
        for (const neuron of activeStates) {
            for (let d = 0; d < this.config.dimensions; d++) {
                output[d] += neuron.state[d + 1] * neuron.energy;
            }
        }
        const norm = Math.sqrt(output.reduce((s, v) => s + v * v, 0)) || 1;
        for (let d = 0; d < this.config.dimensions; d++) {
            output[d] /= norm;
        }
        return output;
    }
    getActiveStates() {
        return this.neurons.filter(n => n.energy > this.config.energyThreshold);
    }
    computeDimensionalEntropy() {
        let entropy = 0;
        for (let d = 0; d < this.config.dimensions; d++) {
            const values = this.neurons.map(n => n.state[d + 1]);
            const mean = values.reduce((s, v) => s + v, 0) / values.length;
            const buckets = 10;
            const hist = new Array(buckets).fill(0);
            for (const v of values) {
                const idx = Math.min(buckets - 1, Math.floor(((v + 1) / 2) * buckets));
                hist[idx]++;
            }
            for (const count of hist) {
                const p = count / values.length;
                if (p > 0)
                    entropy -= p * Math.log2(p);
            }
        }
        return entropy / this.config.dimensions;
    }
    computeNoveltyScore(patternHash) {
        const seen = this.seenPatterns.get(patternHash);
        if (!seen)
            return 1;
        const timeSinceLastSeen = Date.now() - seen.lastSeen;
        const recencyFactor = Math.exp(-timeSinceLastSeen / this.config.noveltyWindow);
        const frequencyPenalty = Math.min(1, seen.frequency / 10);
        return Math.max(0, 1 - recencyFactor * frequencyPenalty);
    }
    recordPattern(patternHash, novelty) {
        const existing = this.seenPatterns.get(patternHash);
        if (existing) {
            existing.frequency++;
            existing.lastSeen = Date.now();
            existing.novelty = novelty;
        }
        else {
            this.seenPatterns.set(patternHash, {
                hash: patternHash,
                frequency: 1,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
                novelty,
            });
        }
    }
    hashVector(vector) {
        let hash = 0;
        for (let i = 0; i < vector.length; i++) {
            const val = Math.round(vector[i] * 10000);
            hash = ((hash << 5) - hash) + val;
            hash = hash & hash;
        }
        return `hd_${hash}`;
    }
}
