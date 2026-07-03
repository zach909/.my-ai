export class HyperDimensionalEngine {
    config;
    neurons;
    seenPatterns;
    history;
    iteration = 0;
    constructor(config = {}) {
        this.config = {
            neuronCount: config.neuronCount ?? config.neuronCount ?? 100,
            dimensions: config.dimensions ?? config.hyperDimensions ?? 64,
            stateBits: config.stateBits ?? config.ballStates ?? 8,
            learningRate: config.learningRate ?? 0.1,
            influenceDecay: config.influenceDecay ?? config.noveltyDecay ?? 0.9,
            energyThreshold: config.stateTransitionThreshold ?? config.energyThreshold ?? 0.5,
            noveltyWindow: config.historyLength ?? config.noveltyWindow ?? 1000,
            crossInfluenceStrength: config.crossInfluenceStrength ?? 0.3,
        };
        this.neurons = [];
        this.seenPatterns = new Map();
        this.history = [];
        this.initializeNeurons();
    }
    process(inputVector, learningRates) {
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
        const transitions = [];
        const stateDeltas = new Map();
        for (const neuron of this.neurons) {
            const prevState = [...neuron.state];
            const rate = learningRates?.get(neuron.id) ?? this.config.learningRate;
            this.updateNeuronState(neuron, resolvedInput, rate);
            let delta = 0;
            for (let d = 0; d < neuron.state.length; d++) {
                delta += Math.abs(neuron.state[d] - prevState[d]);
            }
            stateDeltas.set(neuron.id, delta);
            const energy = this.computeStateEnergy(neuron.state);
            if (energy !== neuron.energy) {
                transitions.push({
                    fromState: prevState,
                    toState: [...neuron.state],
                    energy: energy - neuron.energy,
                    timestamp: Date.now(),
                    cause: 'input_update',
                });
            }
            neuron.energy = energy;
        }
        this.crossInfluence();
        const resolvedTransitions = this.resolveStateTransitions();
        const activeStates = this.getActiveStates();
        const outputVector = this.computeOutputVector(activeStates);
        const totalEnergy = this.neurons.reduce((s, n) => s + n.energy, 0);
        const dimensionalEntropy = this.computeDimensionalEntropy();
        const patternHash = this.hashVector(outputVector);
        const noveltyScore = this.computeNoveltyScore(patternHash);
        this.recordPattern(patternHash, noveltyScore);
        this.history.push(...resolvedTransitions);
        this.iteration++;
        return {
            outputVector,
            activeStates,
            totalEnergy,
            dimensionalEntropy,
            noveltyScore,
            transitionCount: resolvedTransitions.length,
            stateDeltas,
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
    initializeNeurons() {
        for (let i = 0; i < this.config.neuronCount; i++) {
            const state = [];
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
    updateNeuronState(neuron, input, learningRate) {
        for (let d = 0; d < this.config.dimensions; d++) {
            const inputVal = input[d] || 0;
            const delta = (inputVal - neuron.state[d]) * learningRate;
            neuron.state[d] += delta;
            neuron.state[d] = Math.max(-1, Math.min(1, neuron.state[d]));
        }
    }
    crossInfluence() {
        for (let i = 0; i < this.neurons.length; i++) {
            for (let j = i + 1; j < this.neurons.length; j++) {
                const ni = this.neurons[i];
                const nj = this.neurons[j];
                let similarity = 0;
                for (let d = 0; d < this.config.dimensions; d++) {
                    similarity += ni.state[d] * nj.state[d];
                }
                similarity /= this.config.dimensions;
                const influence = similarity * this.config.crossInfluenceStrength;
                const decayedInfluence = influence * Math.pow(this.config.influenceDecay, this.iteration);
                for (let d = 0; d < this.config.dimensions; d++) {
                    const peerInfluence = nj.state[d] * decayedInfluence;
                    ni.state[d] += peerInfluence;
                    ni.state[d] = Math.max(-1, Math.min(1, ni.state[d]));
                    const reverseInfluence = ni.state[d] * decayedInfluence;
                    nj.state[d] += reverseInfluence;
                    nj.state[d] = Math.max(-1, Math.min(1, nj.state[d]));
                }
            }
        }
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
    computeStateEnergy(state) {
        let energy = 0;
        for (let d = 0; d < state.length; d++) {
            energy += state[d] * state[d];
        }
        return energy / state.length;
    }
    computeOutputVector(activeStates) {
        const output = new Array(this.config.dimensions).fill(0);
        if (activeStates.length === 0)
            return output;
        for (const neuron of activeStates) {
            for (let d = 0; d < this.config.dimensions; d++) {
                output[d] += neuron.state[d] * neuron.energy;
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
            const values = this.neurons.map(n => n.state[d]);
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
