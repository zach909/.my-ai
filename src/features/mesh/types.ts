/**
 * Corona — Core Type Definitions
 *
 * Every type in the mesh engine. Neurons hold multi-dimensional state vectors
 * (each component is a "multiple"). Connections are small weight blocks letting
 * any dimension of a source neuron influence any dimension of a target neuron.
 * Vale is zero-sum plasticity resistance — high = stable, low = plastic.
 */

/** A single neuron in the all-to-all mesh. */
export interface Neuron {
  id: string;
  /** D-dimensional state vector — each component is a "multiple." */
  state: number[];
  /**
   * Plasticity resistance (0–100). Total vale across the network is fixed
   * (zero-sum). High-vale neurons resist change; low-vale neurons learn readily.
   */
  vale: number;
  /** Optional human-readable label (NeuroLang name). */
  label?: string;
  /**
   * Optional NeuroLang definition — "if this neuron alone receives input,
   * the network's output must be X." Used for contract-based training.
   */
  definition?: string;
  /**
   * Input-source flag. Reserved dimension (last one) — hot when externally
   * driven this tick, off otherwise. Lets every neuron see the input topography.
   */
  inputFlag: number;
}

/**
 * Connection weights from one neuron to another.
 * Given source neuron with D dimensions and target neuron with D dimensions,
 * this is a D×D matrix: weights[row][col] = how source dimension 'col'
 * influences target dimension 'row'.
 */
export interface ConnectionWeights {
  weights: number[][];
}

/** Complete state snapshot of the mesh. */
export interface MeshState {
  neurons: Neuron[];
  connections: ConnectionWeights[][];
  totalVale: number;
  tickCount: number;
  settledTicks: number;
  /** Maximum state change across all neurons in the most recent tick. */
  lastMaxDelta: number;
}

/** Configuration for initializing an ElasticMesh. */
export interface MeshConfig {
  /** Number of neurons in the mesh. */
  neuronCount: number;
  /** Dimensionality of each neuron's state vector. */
  dimensions: number;
  /** Total vale budget across all neurons (zero-sum). */
  totalVale: number;
  /** State-change threshold for considering the mesh "settled." */
  settlementThreshold: number;
  /** Maximum ticks before forced settlement (safety limit). */
  maxTicks: number;
  /** Propagation speed (ticks per animation frame). */
  ticksPerFrame: number;
}

/** A candidate "thought" for quantum-interference-based selection. */
export interface ThoughtCandidate {
  /** The settled mesh state for this candidate. */
  state: MeshState;
  /** Complex amplitude (real + imaginary parts). */
  amplitude: [number, number];
  /** Phase angle in radians. */
  phase: number;
}

/** Statistics about the mesh's current state. */
export interface MeshStats {
  tickCount: number;
  settledTicks: number;
  lastMaxDelta: number;
  isSettled: boolean;
  activeNeurons: number;
  meanActivation: number;
  meanVale: number;
  valeEntropy: number;
}

/** Default mesh configuration — balanced for browser performance. */
export const DEFAULT_CONFIG: MeshConfig = {
  neuronCount: 64,
  dimensions: 4,
  totalVale: 3200, // 64 neurons * 50 avg
  settlementThreshold: 0.001,
  maxTicks: 200,
  ticksPerFrame: 4,
};
