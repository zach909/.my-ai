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
    signature: number;
    height: number;
    phase: number;
    probability: number;
}
export interface QuantumNeuron {
    id: string;
    inputExclusive: boolean;
    state: QuantumState;
    superposition: QuantumState[];
}
export declare class QuantumNeuralNet {
    private neurons;
    private planckConstant;
    constructor();
    /**
     * Register a neuron with exclusive input capability
     */
    addNeuron(id: string, inputValue: number): QuantumNeuron;
    /**
     * Calculate the wave signature based on neuron ID and input
     * Example: Neuron 2 with input -> signature 4.5
     */
    private calculateSignature;
    /**
     * Input defines the wave height
     */
    private calculateWaveHeight;
    /**
     * Create superposition of states for a neuron
     */
    createSuperposition(neuronId: string, possibleInputs: number[]): void;
    /**
     * Apply quantum interference between two neurons
     * Constructive or destructive based on phase difference
     */
    interfere(neuronIdA: string, neuronIdB: string): number;
    /**
     * Phase-consensus across a group of neurons — true destructive interference.
     * Sums each neuron's amplitude as a complex phasor (height at its phase angle);
     * phasors that disagree in phase cancel toward zero, phasors that agree
     * reinforce toward the sum of their heights. Returns the resultant magnitude.
     */
    phaseConsensus(neuronIds: string[]): number;
    /**
     * Grover-style amplitude amplification: flips the sign of the target
     * neuron's amplitude (oracle), then reflects every amplitude in the group
     * about their mean (diffuser). Iterating this grows the target's share of
     * total probability mass at the expense of the rest of the group.
     */
    groverAmplify(neuronIds: string[], targetId: string): void;
    /**
     * Collapse the wave function to a single state, sampling from the
     * amplitude-weighted (Born rule) probability distribution built by
     * createSuperposition / groverAmplify — not a plain uniform draw.
     */
    collapse(neuronId: string): number;
    /**
     * Evolve the phase of a neuron over time (simulation step)
     */
    evolvePhase(neuronId: string, deltaTime: number): void;
    /**
     * Get the current quantum state of a neuron
     */
    getState(neuronId: string): QuantumState | null;
    /**
     * Check if a neuron has exclusive input (prerequisite for quantum behavior)
     */
    isExclusiveInput(neuronId: string): boolean;
}
export declare const quantumNet: QuantumNeuralNet;
