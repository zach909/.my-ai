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
    neuronCount;
    stateDim;
    inputDim;
    outputDim;
    maxTicks;
    convergenceThreshold;
    inputFlagDim;
    quantizationAware;
    quantizationBits;
    quantizationResidual;
    state;
    bias;
    weights;
    inputProjection;
    outputProjection;
    directInputFlags;
    groups = new Map();
    definitionTargets = new Map();
    rngState;
    quantizationAware;
    quantizationBits;
    quantizationResidual;
    constructor(config = {}) {
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
        this.quantizationAware = config.quantizationAware ?? false;
        this.quantizationBits = Math.max(2, Math.min(16, config.quantizationBits ?? 8));
        this.state = new Float32Array(this.neuronCount * this.stateDim);
        this.quantizationResidual = new Float32Array(this.state.length);
        this.bias = new Float32Array(this.neuronCount * this.stateDim);
        this.weights = new Float32Array(this.neuronCount * this.neuronCount * this.stateDim * this.stateDim);
        this.inputProjection = new Float32Array(this.inputDim * this.stateDim);
        this.outputProjection = new Float32Array(this.stateDim * this.outputDim);
        this.directInputFlags = new Float32Array(this.neuronCount);
        this.quantizationResidual = new Float32Array(this.state.length);
        const scale = config.weightScale ?? Math.sqrt(1 / Math.max(1, this.neuronCount * this.stateDim));
        for (let i = 0; i < this.bias.length; i++)
            this.bias[i] = (this.rand() * 2 - 1) * 0.05;
        for (let t = 0; t < this.neuronCount; t++) {
            for (let s = 0; s < this.neuronCount; s++) {
                if (t === s)
                    continue;
                for (let od = 0; od < this.stateDim; od++) {
                    for (let id = 0; id < this.stateDim; id++) {
                        this.weights[this.weightIndex(t, s, od, id)] = (this.rand() * 2 - 1) * scale;
                    }
                }
            }
        }
        for (let i = 0; i < this.inputProjection.length; i++)
            this.inputProjection[i] = (this.rand() * 2 - 1) * scale;
        for (let i = 0; i < this.outputProjection.length; i++)
            this.outputProjection[i] = (this.rand() * 2 - 1) * scale;
    }
    setNeuronGroup(neuronId, group) {
        this.assertNeuron(neuronId);
        this.groups.set(neuronId, group);
    }
    addNeuron(group) {
        const newId = this.neuronCount;
        const oldCount = this.neuronCount;
        const oldState = this.state;
        const oldBias = this.bias;
        const oldWeights = this.weights;
        const scale = Math.sqrt(1 / Math.max(1, (oldCount + 1) * this.stateDim));
        this.neuronCount = oldCount + 1;
        this.state = new Float32Array(this.neuronCount * this.stateDim);
        this.bias = new Float32Array(this.neuronCount * this.stateDim);
        this.weights = new Float32Array(this.neuronCount * this.neuronCount * this.stateDim * this.stateDim);
        this.state.set(oldState);
        this.bias.set(oldBias);
        for (let t = 0; t < oldCount; t++) {
            for (let s = 0; s < oldCount; s++) {
                for (let od = 0; od < this.stateDim; od++) {
                    for (let id = 0; id < this.stateDim; id++) {
                        const oldIndex = (((t * oldCount + s) * this.stateDim + od) * this.stateDim + id);
                        this.weights[this.weightIndex(t, s, od, id)] = oldWeights[oldIndex];
                    }
                }
            }
        }
        for (let d = 0; d < this.stateDim; d++) {
            this.bias[newId * this.stateDim + d] = (this.rand() * 2 - 1) * 0.05;
        }
        for (let t = 0; t < this.neuronCount; t++) {
            for (let s = 0; s < this.neuronCount; s++) {
                if (t === s || (t < oldCount && s < oldCount))
                    continue;
                for (let od = 0; od < this.stateDim; od++) {
                    for (let id = 0; id < this.stateDim; id++) {
                        this.weights[this.weightIndex(t, s, od, id)] = (this.rand() * 2 - 1) * scale;
                    }
                }
            }
        }
        if (group !== undefined)
            this.groups.set(newId, group);
        return newId;
    getNeuronCount() {
        return this.neuronCount;
    }
    getStateDim() {
        return this.stateDim;
    }
    addNeuron(group) {
        const id = this.neuronCount;
        this.neuronCount++;
        const nextState = new Float32Array(this.neuronCount * this.stateDim);
        nextState.set(this.state);
        this.state = nextState;
        const nextBias = new Float32Array(this.neuronCount * this.stateDim);
        nextBias.set(this.bias);
        this.bias = nextBias;
        const oldN = this.neuronCount - 1;
        const nextWeights = new Float32Array(this.neuronCount * this.neuronCount * this.stateDim * this.stateDim);
        for (let t = 0; t < oldN; t++) {
            for (let s = 0; s < oldN; s++) {
                for (let od = 0; od < this.stateDim; od++) {
                    for (let idim = 0; idim < this.stateDim; idim++) {
                        nextWeights[(((t * this.neuronCount + s) * this.stateDim + od) * this.stateDim + idim)] =
                            this.weights[(((t * oldN + s) * this.stateDim + od) * this.stateDim + idim)];
                    }
                }
            }
        }
        this.weights = nextWeights;
        if (group)
            this.groups.set(id, group);
        return id;
    }
    setConnectionScalar(target, source, weight) {
        this.assertNeuron(target);
        this.assertNeuron(source);
        const clamped = Math.max(-2, Math.min(2, weight));
        for (let d = 0; d < this.stateDim; d++)
            this.weights[this.weightIndex(target, source, d, d)] = clamped;
    }
    setConnectionBlock(target, source, block) {
        this.assertNeuron(target);
        this.assertNeuron(source);
        if (block.length !== this.stateDim * this.stateDim) {
            throw new Error(`connection block length ${block.length} does not match ${this.stateDim * this.stateDim}`);
        }
        for (let od = 0; od < this.stateDim; od++)
            for (let id = 0; id < this.stateDim; id++) {
                this.weights[this.weightIndex(target, source, od, id)] = Math.max(-2, Math.min(2, block[od * this.stateDim + id] ?? 0));
            }
    }
    setDefinitionTarget(neuronId, target) {
        this.assertNeuron(neuronId);
        const v = new Float32Array(this.stateDim);
        for (let i = 0; i < this.stateDim; i++)
            v[i] = target[i] ?? 0;
        this.definitionTargets.set(neuronId, v);
    }
    checkDefinition(neuronId, tolerance = 0.25) {
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
    /**
     * Add a live neuron to the core and wire it all-to-all with every existing
     * neuron. This is the Elastic Core side of the extension-builder story:
     * newly materialized NeuroLang/skill neurons become ordinary mesh neurons,
     * not a side table or separate adapter layer. Existing weights are preserved.
     */
    addNeuron(group) {
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
        const newIndex = (target, source, outDim, inDim) => (((target * newCount + source) * this.stateDim + outDim) * this.stateDim + inDim);
        const oldIndex = (target, source, outDim, inDim) => (((target * oldCount + source) * this.stateDim + outDim) * this.stateDim + inDim);
        for (let t = 0; t < newCount; t++) {
            for (let src = 0; src < newCount; src++) {
                if (t === src)
                    continue;
                for (let od = 0; od < this.stateDim; od++) {
                    for (let id = 0; id < this.stateDim; id++) {
                        if (t < oldCount && src < oldCount) {
                            newWeights[newIndex(t, src, od, id)] = oldWeights[oldIndex(t, src, od, id)];
                        }
                        else {
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
        if (group !== undefined)
            this.groups.set(oldCount, group);
        return oldCount;
    }
    getNeuronCount() {
        return this.neuronCount;
    }
    connectionDensity() {
        return this.neuronCount <= 1 ? 0 : 1.0;
    }
    /**
     * Program an explicit dense source->target block. This is how extension
     * builder definitions can install cross-dimensional links directly: every
     * output dimension of the target can read every input dimension of the source.
     */
    setConnectionBlock(target, source, block) {
        this.assertNeuron(target);
        this.assertNeuron(source);
        if (target === source)
            throw new Error('self-connections are not part of the all-to-all core');
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
    setConnectionScalar(target, source, weight) {
        this.setConnectionBlock(target, source, new Float32Array(this.stateDim * this.stateDim).fill(weight));
    }
    connectionDensity() {
        return this.neuronCount <= 1 ? 0 : 1.0;
    }
    connectionBlock(target, source) {
        this.assertNeuron(target);
        this.assertNeuron(source);
        const block = new Float32Array(this.stateDim * this.stateDim);
        for (let od = 0; od < this.stateDim; od++)
            for (let id = 0; id < this.stateDim; id++) {
                block[od * this.stateDim + id] = this.weights[this.weightIndex(target, source, od, id)];
            }
        return block;
    }
    /**
     * Optimizer-facing structured parameter view. The returned typed arrays are
     * live references, so AdamW-style trainers can keep moments keyed to these
     * arrays and mutate them directly when needed.
     */
    getParameters() {
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
    applyGradients(gradients, options = {}) {
        const lr = options.learningRate ?? 1;
        const decay = options.weightDecay ?? 0;
        const scale = options.scale ?? 1;
        const summary = { weightsL1: 0, biasesL1: 0, inputProjectionL1: 0, outputProjectionL1: 0 };
        if (gradients.weights) {
            this.assertGradientLength('weights', gradients.weights, this.weights.length);
            for (let t = 0; t < this.neuronCount; t++) {
                const tScale = this.updateScaleForNeuron(t, options.vale) * scale;
                for (let s = 0; s < this.neuronCount; s++)
                    for (let od = 0; od < this.stateDim; od++)
                        for (let id = 0; id < this.stateDim; id++) {
                            const i = this.weightIndex(t, s, od, id);
                            const update = lr * tScale * (gradients.weights[i] + decay * this.weights[i]);
                            if (Number.isFinite(update)) {
                                this.weights[i] -= update;
                                summary.weightsL1 += Math.abs(update);
                            }
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
                    if (Number.isFinite(update)) {
                        this.bias[i] -= update;
                        summary.biasesL1 += Math.abs(update);
                    }
                }
            }
        }
        if (gradients.inputProjection) {
            this.assertGradientLength('inputProjection', gradients.inputProjection, this.inputProjection.length);
            for (let i = 0; i < this.inputProjection.length; i++) {
                const update = lr * scale * (gradients.inputProjection[i] + decay * this.inputProjection[i]);
                if (Number.isFinite(update)) {
                    this.inputProjection[i] -= update;
                    summary.inputProjectionL1 += Math.abs(update);
                }
            }
        }
        if (gradients.outputProjection) {
            this.assertGradientLength('outputProjection', gradients.outputProjection, this.outputProjection.length);
            for (let d = 0; d < this.stateDim; d++) {
                let dimScale = 0;
                for (let n = 0; n < this.neuronCount; n++)
                    dimScale += this.updateScaleForNeuron(n, options.vale);
                dimScale = (dimScale / this.neuronCount) * scale;
                for (let o = 0; o < this.outputDim; o++) {
                    const i = d * this.outputDim + o;
                    const update = lr * dimScale * (gradients.outputProjection[i] + decay * this.outputProjection[i]);
                    if (Number.isFinite(update)) {
                        this.outputProjection[i] -= update;
                        summary.outputProjectionL1 += Math.abs(update);
                    }
                }
            }
        }
        return summary;
    }
    forward(input, options = {}) {
        const driven = options.drivenNeurons ?? new Set([0]);
        this.clearDirectInputFlags();
        for (const n of driven) {
            if (n >= 0 && n < this.neuronCount) {
                this.directInputFlags[n] = 1;
                this.inject(n, input, true);
            }
        }
        const startState = new Float32Array(this.state);
        let ticks = 0, residual = 0, converged = false;
        for (; ticks < this.maxTicks; ticks++) {
            const oldState = this.state;
            const next = new Float32Array(oldState.length);
            for (let t = 0; t < this.neuronCount; t++) {
                const group = this.groups.get(t);
                const externallyDriven = driven.has(t);
                const frozen = !externallyDriven && options.activeGroups !== undefined && group !== undefined && !options.activeGroups.has(group);
                if (frozen) {
                    next.set(oldState.subarray(t * this.stateDim, (t + 1) * this.stateDim), t * this.stateDim);
                    continue;
                }
                for (let od = 0; od < this.stateDim; od++) {
                    let sum = this.bias[t * this.stateDim + od];
                    for (let s = 0; s < this.neuronCount; s++) {
                        if (s === t)
                            continue;
                        for (let id = 0; id < this.stateDim; id++)
                            sum += oldState[s * this.stateDim + id] * this.weights[this.weightIndex(t, s, od, id)];
                    }
                    const computed = Math.tanh(sum);
                    const v = Math.min(1, Math.max(0, options.vale?.get(t) ?? 0));
                    const old = oldState[t * this.stateDim + od];
                    next[t * this.stateDim + od] = v * old + (1 - v) * computed;
                }
            }
            const finalState = this.quantizeWithResidual(next);
            const quantized = this.quantizeWithResidual(next);
            this.state = quantized.state;
            this.state = next;
            for (const n of driven)
                if (n >= 0 && n < this.neuronCount)
                    finalState[n * this.stateDim + this.inputFlagDim] = 1;
            residual = 0;
            for (let i = 0; i < finalState.length; i++)
                residual += Math.abs(finalState[i] - oldState[i]);
            this.state = finalState;
            if (residual < this.convergenceThreshold) {
                converged = true;
                ticks++;
                break;
            }
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
    clearDirectInputFlags() {
        for (let n = 0; n < this.neuronCount; n++) {
            this.state[n * this.stateDim + this.inputFlagDim] = 0;
            this.directInputFlags[n] = 0;
        }
    }
    inject(neuronId, input, flag) {
        const off = neuronId * this.stateDim;
        for (let od = 0; od < this.stateDim; od++) {
            let sum = 0;
            for (let i = 0; i < Math.min(input.length, this.inputDim); i++)
                sum += input[i] * this.inputProjection[i * this.stateDim + od];
            this.state[off + od] = Math.tanh(sum);
        }
        if (flag)
            this.state[off + this.inputFlagDim] = 1;
    }
    quantizeWithResidual(next) {
        if (!this.quantizationAware)
            return next;
        const quantized = new Float32Array(next.length);
        const levels = (1 << this.quantizationBits) - 1;
        for (let i = 0; i < next.length; i++) {
            const adjusted = Math.max(-1, Math.min(1, next[i] + this.quantizationResidual[i]));
            const q = Math.round(((adjusted + 1) / 2) * levels);
            const value = (q / levels) * 2 - 1;
            quantized[i] = value;
            this.quantizationResidual[i] = adjusted - value;
        }
        return quantized;
    }
    readout() {
        const mean = new Float32Array(this.stateDim);
        for (let n = 0; n < this.neuronCount; n++)
            for (let d = 0; d < this.stateDim; d++)
                mean[d] += this.state[n * this.stateDim + d] / this.neuronCount;
        const out = new Float32Array(this.outputDim);
        for (let o = 0; o < this.outputDim; o++)
            for (let d = 0; d < this.stateDim; d++)
                out[o] += mean[d] * this.outputProjection[d * this.outputDim + o];
        return out;
    }
    quantizeWithResidual(next) {
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
    meanAbs(values) {
        let sum = 0;
        for (const value of values)
            sum += Math.abs(value);
        return sum / Math.max(1, values.length);
    }
    stateDeltas(startState) {
        const deltas = new Map();
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
    inputTopography() {
        const topography = new Map();
        for (let n = 0; n < this.neuronCount; n++)
            topography.set(n, this.directInputFlags[n]);
        return topography;
    }
    weightIndex(target, source, outDim, inDim) {
        return (((target * this.neuronCount + source) * this.stateDim + outDim) * this.stateDim + inDim);
    }
    updateScaleForNeuron(neuronId, vale) {
        const v = Math.min(1, Math.max(0, vale?.get(neuronId) ?? 0));
        return 1 - v;
    }
    assertGradientLength(name, gradient, expected) {
        if (gradient.length !== expected)
            throw new Error(`${name} gradient length ${gradient.length} !== ${expected}`);
    }
    rand() {
        this.rngState = (1664525 * this.rngState + 1013904223) >>> 0;
        return this.rngState / 0x100000000;
    }
    assertNeuron(id) {
        if (!Number.isInteger(id) || id < 0 || id >= this.neuronCount)
            throw new Error(`neuron id out of range: ${id}`);
    }
}
