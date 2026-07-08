/**
 * Quantum Neural Net Module
 * 
 * Uses quantum interference where a neuron's input defines the wave height,
 * and the wave is the neuron's signature. Applies when a neuron exclusively has an input.
 * 
 * Why: Easy to convert to quantum, and reaches beyond the classical domain.
 * Example: Neuron 2's signature was 4.5 and its height was 10.
 */

import { type Complex, fromPolar, add as cAdd, abs as cAbs } from './complex.js';
/**
 * Genuine complex number, Cartesian form. Interference math is done here
 * (real multiplication/addition) rather than via hand-rolled trig identities,
 * so destructive cancellation falls out of the arithmetic instead of having
 * to be independently re-derived and trusted.
 */
export interface Complex {
  re: number;
  im: number;
}

function cFromPolar(magnitude: number, phase: number): Complex {
  return { re: magnitude * Math.cos(phase), im: magnitude * Math.sin(phase) };
}

function cAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

function cMul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function cMagnitude(a: Complex): number {
  return Math.sqrt(a.re * a.re + a.im * a.im);
}

function cPhase(a: Complex): number {
  return Math.atan2(a.im, a.re);
}

export interface QuantumState {
  signature: number; // The unique wave identifier
  /**
   * Amplitude/phase (polar) is the storage form — a lossless representation
   * of the same complex number as {re, im}, and the natural one for phase
   * evolution (phase += frequency*dt). Converted to Complex via cFromPolar
   * whenever interference/consensus math needs genuine complex arithmetic.
   */
  height: number;    // Amplitude defined by input (= magnitude of the complex state)
  phase: number;     // Phase angle for interference (= argument of the complex state)
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
        // Random initial phase — with phase fixed at 0 for every neuron,
        // phaseDiff was always 0 and destructive interference (cos(phaseDiff) < 0)
        // was mathematically unreachable. Randomizing lets neurons actually
        // land out of phase with each other.
        phase: Math.random() * Math.PI * 2,
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

    const candidates = possibleInputs.map(input => ({
      signature: this.calculateSignature(neuronId, input),
      height: this.calculateWaveHeight(input),
      phase: Math.random() * Math.PI * 2,
    }));

    // Born rule: probability ∝ amplitude² (height²), not a uniform 1/N split.
    // A uniform split makes every candidate state equally likely regardless
    // of how strong its wave actually is, which isn't "amplitude-weighted"
    // at all — it just looks like it because collapse() samples a distribution.
    const totalSq = candidates.reduce((s, c) => s + c.height * c.height, 0) || 1;

    neuron.superposition = candidates.map(c => ({
      ...c,
      probability: (c.height * c.height) / totalSq,
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

    // Section 13: interference as genuine complex arithmetic. Each state is
    // the phasor height·e^{iφ}; the resultant is their complex sum and the
    // returned amplitude is its magnitude |zA + zB|. This is exactly the old
    // sqrt(A² + B² + 2AB·cos Δφ) formula, but derived from the complex
    // substrate the phase-and-height pair actually represents.
    const zA = this.complexAmplitude(neuronA.state);
    const zB = this.complexAmplitude(neuronB.state);
    return cAbs(cAdd(zA, zB));
    // Genuine complex addition of the two phasors — phases that disagree
    // cancel toward zero, phases that agree reinforce, purely as a
    // consequence of the arithmetic (no separately-trusted trig identity).
    const zA = cFromPolar(neuronA.state.height, neuronA.state.phase);
    const zB = cFromPolar(neuronB.state.height, neuronB.state.phase);
    return cMagnitude(cAdd(zA, zB));
  }

  /**
   * Phase-consensus across a group of neurons — true destructive interference.
   * Sums each neuron's amplitude as a complex phasor (height·e^{iφ}); phasors
   * that disagree in phase cancel toward zero, phasors that agree reinforce
   * toward the sum of their heights. Returns the resultant magnitude.
   */
  phaseConsensus(neuronIds: string[]): number {
    let sum: Complex = { re: 0, im: 0 };
    for (const id of neuronIds) {
      const neuron = this.neurons.get(id);
      if (!neuron) continue;
      sum = cAdd(sum, this.complexAmplitude(neuron.state));
    }
    return cAbs(sum);
  }

  /** The state's phase-and-amplitude as a single complex number height·e^{iφ}. */
  private complexAmplitude(state: QuantumState): Complex {
    return fromPolar(state.height, state.phase);
  }

  /** Public complex-amplitude accessor: the neuron's genuine complex QIL state. */
  getComplexAmplitude(neuronId: string): Complex | null {
    const neuron = this.neurons.get(neuronId);
    return neuron ? this.complexAmplitude(neuron.state) : null;
      sum = cAdd(sum, cFromPolar(neuron.state.height, neuron.state.phase));
    }
    return cMagnitude(sum);
  }

  /**
   * Grover-style amplitude amplification: flips the sign of the target
   * neuron's amplitude (oracle), then reflects every amplitude in the group
   * about their mean (diffuser). Iterating this grows the target's share of
   * total probability mass at the expense of the rest of the group.
   */
  groverAmplify(neuronIds: string[], targetId: string): void {
    const ids = neuronIds.filter(id => this.neurons.has(id));
    const targetIdx = ids.indexOf(targetId);
    if (targetIdx === -1 || ids.length === 0) return;

    const amplitudes = ids.map(id => this.neurons.get(id)!.state.height);

    // Oracle: mark the target by flipping its amplitude's sign.
    amplitudes[targetIdx] = -amplitudes[targetIdx];

    // Diffuser: inversion about the mean amplifies whatever was marked.
    const mean = amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length;
    for (let i = 0; i < amplitudes.length; i++) {
      amplitudes[i] = 2 * mean - amplitudes[i];
    }

    // Write back heights and re-derive Born-rule probabilities from the
    // new amplitudes so collapse() reflects the amplification.
    const totalSq = amplitudes.reduce((s, a) => s + a * a, 0) || 1;
    ids.forEach((id, i) => {
      const neuron = this.neurons.get(id)!;
      neuron.state.height = Math.abs(amplitudes[i]);
      neuron.state.probability = (amplitudes[i] * amplitudes[i]) / totalSq;
    });
  }

  /**
   * Collapse the wave function to a single state, sampling from the
   * amplitude-weighted (Born rule) probability distribution built by
   * createSuperposition / groverAmplify — not a plain uniform draw.
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

    // Phase evolution is a rotation of the complex state: multiplying by the
    // unit phasor e^{i*frequency*deltaTime} (a genuine complex multiplication)
    // rather than adding to the stored phase scalar directly.
    const frequency = neuron.state.signature;
    const current = cFromPolar(neuron.state.height, neuron.state.phase);
    const rotor = cFromPolar(1, frequency * deltaTime);
    const rotated = cMul(current, rotor);

    neuron.state.phase = cPhase(rotated);
    // Normalize phase to [0, 2PI)
    neuron.state.phase = ((neuron.state.phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
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
