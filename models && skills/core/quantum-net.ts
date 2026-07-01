/**
 * Quantum Neural Net Module
 * 
 * Uses quantum interference where a neuron's input defines the wave height,
 * and the wave is the neuron's signature. Applies when a neuron exclusively has an input.
 * 
 * Why: Easy to convert to quantum, and reaches beyond the classical domain.
 * Example: Neuron 2's signature was 4.5 and its height was 10.
 */

export interface QuantumState {
  signature: number; // The unique wave identifier
  height: number;    // Amplitude defined by input
  phase: number;     // Phase angle for interference
  probability: number; // Collapsed probability
}

export interface QuantumNeuron {
  id: string;
  inputExclusive: boolean;
  state: QuantumState;
  superposition: QuantumState[]; // Holds multiple potential states
}

export class QuantumNeuralNet {
  private neurons: Map<string, QuantumNeuron>;
  private planckConstant: number = 6.626e-34; // Scaled for simulation

  constructor() {
    this.neurons = new Map();
  }

  /**
   * Register a neuron with exclusive input capability
   */
  addNeuron(id: string, inputValue: number): QuantumNeuron {
    const signature = this.calculateSignature(id, inputValue);
    const height = this.calculateWaveHeight(inputValue);
    
    const neuron: QuantumNeuron = {
      id,
      inputExclusive: true,
      state: {
        signature,
        height,
        phase: 0,
        probability: 1.0
      },
      superposition: []
    };

    this.neurons.set(id, neuron);
    return neuron;
  }

  /**
   * Calculate the wave signature based on neuron ID and input
   * Example: Neuron 2 with input -> signature 4.5
   */
  private calculateSignature(id: string, input: number): number {
    // Hash the ID to a base value, modulated by input
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash % 100) / 10 + (input * 0.1);
  }

  /**
   * Input defines the wave height
   */
  private calculateWaveHeight(input: number): number {
    return Math.abs(input) * 10; // Scale factor for visibility
  }

  /**
   * Create superposition of states for a neuron
   */
  createSuperposition(neuronId: string, possibleInputs: number[]): void {
    const neuron = this.neurons.get(neuronId);
    if (!neuron) throw new Error(`Neuron ${neuronId} not found`);

    neuron.superposition = possibleInputs.map(input => ({
      signature: this.calculateSignature(neuronId, input),
      height: this.calculateWaveHeight(input),
      phase: Math.random() * Math.PI * 2,
      probability: 1 / possibleInputs.length
    }));
  }

  /**
   * Apply quantum interference between two neurons
   * Constructive or destructive based on phase difference
   */
  interfere(neuronIdA: string, neuronIdB: string): number {
    const neuronA = this.neurons.get(neuronIdA);
    const neuronB = this.neurons.get(neuronIdB);

    if (!neuronA || !neuronB) throw new Error('One or both neurons not found');

    const stateA = neuronA.state;
    const stateB = neuronB.state;

    // Phase difference determines interference type
    const phaseDiff = Math.abs(stateA.phase - stateB.phase);
    const interferenceFactor = Math.cos(phaseDiff);

    // Resulting amplitude from interference
    const amplitudeA = stateA.height;
    const amplitudeB = stateB.height;

    // Interference formula: A^2 + B^2 + 2AB*cos(theta)
    const resultantIntensity = 
      (amplitudeA * amplitudeA) + 
      (amplitudeB * amplitudeB) + 
      (2 * amplitudeA * amplitudeB * interferenceFactor);

    return Math.sqrt(Math.max(0, resultantIntensity));
  }

  /**
   * Collapse the wave function to a single state based on probabilities
   */
  collapse(neuronId: string): number {
    const neuron = this.neurons.get(neuronId);
    if (!neuron) throw new Error(`Neuron ${neuronId} not found`);

    if (neuron.superposition.length === 0) {
      return neuron.state.height;
    }

    // Simple weighted random selection based on probability
    const rand = Math.random();
    let cumulative = 0;
    
    for (const state of neuron.superposition) {
      cumulative += state.probability;
      if (rand <= cumulative) {
        // Update main state to collapsed state
        neuron.state = { ...state, probability: 1.0 };
        neuron.superposition = [];
        return state.height;
      }
    }

    return neuron.state.height;
  }

  /**
   * Evolve the phase of a neuron over time (simulation step)
   */
  evolvePhase(neuronId: string, deltaTime: number): void {
    const neuron = this.neurons.get(neuronId);
    if (!neuron) return;

    // Phase evolution based on signature (frequency)
    const frequency = neuron.state.signature;
    neuron.state.phase += frequency * deltaTime;
    
    // Normalize phase to 0-2PI
    neuron.state.phase %= (Math.PI * 2);
  }

  /**
   * Get the current quantum state of a neuron
   */
  getState(neuronId: string): QuantumState | null {
    const neuron = this.neurons.get(neuronId);
    return neuron ? neuron.state : null;
  }

  /**
   * Check if a neuron has exclusive input (prerequisite for quantum behavior)
   */
  isExclusiveInput(neuronId: string): boolean {
    const neuron = this.neurons.get(neuronId);
    return neuron ? neuron.inputExclusive : false;
  }
}

// Export singleton instance for easy integration
export const quantumNet = new QuantumNeuralNet();
