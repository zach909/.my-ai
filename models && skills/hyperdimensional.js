import { HyperDimensionalEngine as CoreHyperDimensionalEngine } from './core/hyperdimensional.js';
export { CoreHyperDimensionalEngine as HyperDimensionalEngine };
export class HyperDimensionalNetwork {
    neurons;
    core;
    contextWindow;
    maxDimensions;
    constructor(contextWindow = 100, maxDimensions = 512) {
        this.neurons = new Map();
        this.contextWindow = contextWindow;
        this.maxDimensions = maxDimensions;
        this.core = new CoreHyperDimensionalEngine({
            neuronCount: 100, dimensions: maxDimensions, ballStates: 8,
            stateTransitionThreshold: 0.5, noveltyDecay: 0.01, historyLength: contextWindow,
        });
    }
    addNeuron(neuron) { this.neurons.set(neuron.name || neuron.id, neuron); }
    getNeuron(id) { return this.neurons.get(id); }
    process(input) {
        const result = this.core.process(input);
        return result.outputVector;
    }
    getCore() { return this.core; }
    getSeenPatternCount() { return this.core.getSeenPatternCount(); }
}
