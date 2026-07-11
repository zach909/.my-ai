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
    state;
    bias;
    weights;
    inputProjection;
    outputProjection;
    groups = new Map();
    rngState;
    constructor(config = {}) {
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
        for (const n of driven)
            if (n >= 0 && n < this.neuronCount)
                this.inject(n, input, true);
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
                    next.set(this.state.subarray(t * this.stateDim, (t + 1) * this.stateDim), t * this.stateDim);
                    continue;
                }
                for (let od = 0; od < this.stateDim; od++) {
                    let sum = this.bias[t * this.stateDim + od];
                    for (let s = 0; s < this.neuronCount; s++) {
                        if (s === t)
                            continue;
                        for (let id = 0; id < this.stateDim; id++)
                            sum += this.state[s * this.stateDim + id] * this.weights[this.weightIndex(t, s, od, id)];
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
            for (const n of driven)
                if (n >= 0 && n < this.neuronCount)
                    this.state[n * this.stateDim + this.inputFlagDim] = 1;
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
        };
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
            topography.set(n, this.state[n * this.stateDim + this.inputFlagDim]);
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
