import { HyperDimensionalEngine as CoreHyperDimensionalEngine } from './core/hyperdimensional.js';
import type { Neuron } from './neuron.js';

export { CoreHyperDimensionalEngine as HyperDimensionalEngine };

export interface HyperDimensionalState {
  neuronId: string;
  dimensionalVector: Map<string, number>;
  contextWindow: Array<{ timestamp: number; state: Map<string, number> }>;
  attentionWeights: Map<string, number>;
}

export class HyperDimensionalNetwork {
  private neurons: Map<string, Neuron>;
  private core: CoreHyperDimensionalEngine;
  private contextWindow: number;
  private maxDimensions: number;

  constructor(contextWindow: number = 100, maxDimensions: number = 512) {
    this.neurons = new Map();
    this.contextWindow = contextWindow;
    this.maxDimensions = maxDimensions;
    this.core = new CoreHyperDimensionalEngine({
      neuronCount: 100, dimensions: maxDimensions, ballStates: 8,
      stateTransitionThreshold: 0.5, noveltyDecay: 0.01, historyLength: contextWindow,
    });
  }

  addNeuron(neuron: Neuron): void { this.neurons.set(neuron.name || neuron.id, neuron); }
  getNeuron(id: string): Neuron | undefined { return this.neurons.get(id); }

  process(input: number[]): number[] {
    const result = this.core.process(input);
    return result.outputVector;
  }

  getCore(): CoreHyperDimensionalEngine { return this.core; }
  getSeenPatternCount(): number { return this.core.getSeenPatternCount(); }
}
