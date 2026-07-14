/**
 * Prometheus Elastic Core — Mesh Engine
 *
 * The core computation engine. Every neuron connects to every other neuron
 * non-linearly, all the time. Each tick, every neuron's state vector is
 * computed from all other neurons' current states, weighted by connection
 * weights, summed, biased, and activated. This propagates until the mesh
 * "settles" (state stops changing meaningfully).
 *
 * Vale system: zero-sum plasticity resistance. Total vale is fixed across all
 * neurons. High-vale neurons resist change; low-vale neurons learn readily.
 * When a neuron's meaning is verified, its vale rises — locking in knowledge
 * as a natural consequence of correctness, not a separate freeze mechanism.
 */

import type {
  Neuron,
  ConnectionWeights,
  MeshState,
  MeshConfig,
  MeshStats,
  DEFAULT_CONFIG,
} from './types';

// ─── Math Utilities ────────────────────────────────────────────────────────

/** Clamped sigmoid activation — bounds [-1, 1] to avoid explosion. */
function sigmoid(x: number): number {
  return 2.0 / (1.0 + Math.exp(-x)) - 1.0;
}

/** Seeded pseudo-random generator (mulberry32). */
function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Neuron & Connection Initialization ─────────────────────────────────────

function createNeuron(id: string, dims: number, vale: number, rng: () => number): Neuron {
  const state: number[] = [];
  for (let d = 0; d < dims; d++) {
    // Initialize small random values centered at 0
    state.push((rng() - 0.5) * 0.2);
  }
  return { id, state, vale, inputFlag: 0 };
}

function createConnectionWeights(dims: number, rng: () => number): ConnectionWeights {
  const weights: number[][] = [];
  for (let row = 0; row < dims; row++) {
    const rowWeights: number[] = [];
    for (let col = 0; col < dims; col++) {
      // Small random weights, scaled by 1/dims for stability
      rowWeights.push((rng() - 0.5) * (2.0 / dims));
    }
    weights.push(rowWeights);
  }
  return { weights };
}

// ─── Vale Normalization ─────────────────────────────────────────────────────

/**
 * Ensure total vale across all neurons exactly equals totalVale.
 * Distributes the delta proportionally so ratios are preserved.
 */
function normalizeVale(neurons: Neuron[], totalVale: number): void {
  const current = neurons.reduce((s, n) => s + n.vale, 0);
  if (current === 0 || current === totalVale) return;

  const scale = totalVale / current;
  neurons.forEach((n) => {
    n.vale = Math.max(1, Math.round(n.vale * scale));
  });

  // Fix rounding errors — add/subtract from largest-vale neuron
  const newTotal = neurons.reduce((s, n) => s + n.vale, 0);
  const delta = totalVale - newTotal;
  if (delta !== 0) {
    const sorted = [...neurons].sort((a, b) => b.vale - a.vale);
    sorted[0].vale += delta;
  }
}

// ─── Propagation — One Tick ─────────────────────────────────────────────────

/**
 * Compute one full tick of the mesh. Every neuron's next state is computed
 * from every other neuron's current state, via all-to-all non-linear
 * communication.
 *
 * For each target neuron j:
 *   nextState[j] = activate( Σ_i≠j (W_ij · state[i]) - bias_j )
 *
 * where W_ij is a D×D weight block, · is matrix-vector product,
 * and bias = Σ_{i≠j} ||W_ij||_F (Frobenius norm as a connectivity bias).
 */
function tick(
  neurons: Neuron[],
  connections: ConnectionWeights[][],
  config: MeshConfig,
): { nextStates: number[][]; maxDelta: number } {
  const n = neurons.length;
  const dims = config.dimensions;
  const nextStates: number[][] = Array.from({ length: n }, () => new Array(dims).fill(0));
  let maxDelta = 0;

  for (let j = 0; j < n; j++) {
    const targetState = nextStates[j];
    const connsToJ = connections[j]; // [i][row][col] = influence from neuron i

    for (let d = 0; d < dims; d++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        if (i === j) continue; // skip self
        const src = neurons[i].state;
        const w = connsToJ[i].weights[d]; // row d = influence on target dim d
        for (let k = 0; k < dims; k++) {
          sum += w[k] * src[k];
        }
      }
      // Bias: once per neuron (after summing all incoming products), not per-connection.
      // Using a learned bias: small constant scaled by number of inputs.
      const bias = (n - 1) * 0.01;
      targetState[d] = sigmoid(sum - bias);
    }

    // Compute delta for this neuron
    let neuronDelta = 0;
    for (let d = 0; d < dims; d++) {
      const dVal = targetState[d] - neurons[j].state[d];
      neuronDelta += dVal * dVal;
    }
    maxDelta = Math.max(maxDelta, Math.sqrt(neuronDelta));
  }

  return { nextStates, maxDelta };
}

// ─── Mesh Class ─────────────────────────────────────────────────────────────

export class ElasticMesh {
  neurons: Neuron[];
  connections: ConnectionWeights[][];
  config: MeshConfig;
  tickCount = 0;
  settledTicks = 0;
  lastMaxDelta = Infinity;
  isSettled = false;

  /** Latest external input vector (null if none). */
  inputVector: number[] | null = null;

  /** Pending vale redistribution — applied on next tick. */
  private pendingValeAdjustments: Map<string, number> = new Map();

  constructor(config: MeshConfig = DEFAULT_CONFIG, seed = 42) {
    this.config = config;
    const rng = createRng(seed);
    const n = config.neuronCount;
    const dims = config.dimensions;

    // Initialize neurons with equal vale
    const perNeuronVale = Math.floor(config.totalVale / n);
    this.neurons = Array.from({ length: n }, (_, i) =>
      createNeuron(`n${i}`, dims, perNeuronVale, rng),
    );
    // Fix rounding
    normalizeVale(this.neurons, config.totalVale);

    // All-to-all connections: n×n matrix of D×D weight blocks
    this.connections = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => createConnectionWeights(dims, rng)),
    );
  }

  // ─── State Snapshot ────────────────────────────────────────────────────

  getState(): MeshState {
    return {
      neurons: this.neurons.map((n) => ({
        id: n.id,
        state: [...n.state],
        vale: n.vale,
        label: n.label,
        definition: n.definition,
        inputFlag: n.inputFlag,
      })),
      connections: this.connections.map((row) =>
        row.map((cw) => ({ weights: cw.weights.map((r) => [...r]) })),
      ),
      totalVale: this.config.totalVale,
      tickCount: this.tickCount,
      settledTicks: this.settledTicks,
      lastMaxDelta: this.lastMaxDelta,
    };
  }

  // ─── Stats ─────────────────────────────────────────────────────────────

  getStats(): MeshStats {
    const meanActivation =
      this.neurons.reduce((s, n) => {
        const mag = Math.sqrt(n.state.reduce((ss, v) => ss + v * v, 0));
        return s + mag;
      }, 0) / this.neurons.length;

    const meanVale =
      this.neurons.reduce((s, n) => s + n.vale, 0) / this.neurons.length;

    // Entropy of vale distribution
    const totalVale = this.config.totalVale;
    const valeEntropy =
      -this.neurons.reduce((s, n) => {
        const p = n.vale / totalVale;
        return s + (p > 0 ? p * Math.log2(p) : 0);
      }, 0);

    const activeNeurons = this.neurons.filter(
      (n) => Math.sqrt(n.state.reduce((ss, v) => ss + v * v, 0)) > 0.01,
    ).length;

    return {
      tickCount: this.tickCount,
      settledTicks: this.settledTicks,
      lastMaxDelta: this.lastMaxDelta,
      isSettled: this.isSettled,
      activeNeurons,
      meanActivation,
      meanVale,
      valeEntropy,
    };
  }

  // ─── Inject Input ─────────────────────────────────────────────────────

  /**
   * Inject an external input vector. Drives selected neurons' states toward
   * the input values. The inputFlag dimension is set hot for externally-driven
   * neurons.
   *
   * Injection strength is inversely proportional to vale — low-vale neurons
   * accept more input, high-vale neurons resist.
   */
  injectInput(input: number[], strength = 0.5): void {
    this.inputVector = input;
    const dims = this.config.dimensions;

    // Normalize input to neuron count
    const chunks = Math.min(input.length, this.neurons.length);
    const maxVale = Math.max(...this.neurons.map((n) => n.vale));

    for (let i = 0; i < chunks; i++) {
      const neuron = this.neurons[i];
      // Vale-adjusted strength: low-vale neurons accept more input
      const valeFactor = 1 - neuron.vale / maxVale;
      const adjustedStrength = strength * (0.1 + 0.9 * valeFactor);

      // Distribute input value across state dimensions
      const inputVal = input[i] ?? 0;
      for (let d = 0; d < dims - 1; d++) {
        const target = Math.tanh(inputVal) * adjustedStrength;
        neuron.state[d] = neuron.state[d] * (1 - adjustedStrength) + target * adjustedStrength;
      }
      // Last dimension = input flag (hot when externally driven)
      neuron.inputFlag = inputVal !== 0 ? 1 : 0;
      neuron.state[dims - 1] = neuron.state[dims - 1] * 0.9 + neuron.inputFlag * 0.1;
    }
  }

  // ─── Propagation Loop ─────────────────────────────────────────────────

  /**
   * Run one tick of the mesh. Returns false if the mesh has settled
   * (stopped changing meaningfully).
   */
  propagateOne(): boolean {
    if (this.isSettled) return false;

    // Apply pending vale adjustments
    this.applyValeAdjustments();

    // External input persistence: slowly decay input flag
    for (const neuron of this.neurons) {
      neuron.inputFlag *= 0.95;
      if (neuron.inputFlag < 0.01) neuron.inputFlag = 0;
    }

    // Compute one tick
    const { nextStates, maxDelta } = tick(this.neurons, this.connections, this.config);

    // Apply new states
    for (let i = 0; i < this.neurons.length; i++) {
      this.neurons[i].state = nextStates[i];
    }

    this.tickCount++;
    this.lastMaxDelta = maxDelta;

    // Settlement check: sustained low delta across consecutive ticks
    if (maxDelta < this.config.settlementThreshold) {
      this.settledTicks++;
      if (this.settledTicks >= 3) {
        this.isSettled = true;
        return false;
      }
    } else {
      this.settledTicks = 0;
    }

    // Force settlement at max ticks
    if (this.tickCount >= this.config.maxTicks) {
      this.isSettled = true;
      return false;
    }

    return true;
  }

  /**
   * Run multiple ticks. Returns number of ticks actually run before settling.
   */
  propagate(ticks: number = this.config.ticksPerFrame): number {
    let ran = 0;
    for (let i = 0; i < ticks; i++) {
      if (!this.propagateOne()) break;
      ran++;
    }
    return ran;
  }

  /**
   * Reset the mesh to its initial (randomized) state, preserving neuron count
   * and structure. Equivalent to a fresh initialization.
   */
  reset(): void {
    const rng = createRng(Math.floor(Math.random() * 65536));
    const n = this.config.neuronCount;
    const dims = this.config.dimensions;

    const perNeuronVale = Math.floor(this.config.totalVale / n);
    this.neurons = Array.from({ length: n }, (_, i) =>
      createNeuron(`n${i}`, dims, perNeuronVale, rng),
    );
    normalizeVale(this.neurons, this.config.totalVale);

    this.connections = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => createConnectionWeights(dims, rng)),
    );

    this.tickCount = 0;
    this.settledTicks = 0;
    this.lastMaxDelta = Infinity;
    this.isSettled = false;
    this.inputVector = null;
    this.pendingValeAdjustments.clear();
  }

  // ─── Vale System ──────────────────────────────────────────────────────

  /**
   * Move vale from one neuron to another. Total vale is conserved.
   * Called when knowledge is verified (rise in vale) or deprecated (vale decay).
   *
   * @param fromId - neuron losing vale (becomes more plastic)
   * @param toId - neuron gaining vale (becomes more stable)
   * @param amount - amount of vale to transfer
   */
  transferVale(fromId: string, toId: string, amount: number): void {
    const from = this.neurons.find((n) => n.id === fromId);
    const to = this.neurons.find((n) => n.id === toId);
    if (!from || !to) return;

    const actual = Math.min(amount, from.vale - 1);
    if (actual <= 0) return;

    from.vale -= actual;
    to.vale += actual;
  }

  /**
   * Adjust a neuron's vale by delta. The zero-sum constraint is maintained
   * by proportionally redistributing the opposite delta across all other neurons.
   */
  adjustVale(neuronId: string, delta: number): void {
    const target = this.neurons.find((n) => n.id === neuronId);
    if (!target) return;

    // Can't go below 1
    const actual = Math.max(delta, 1 - target.vale);
    if (actual === 0) return;

    target.vale += actual;

    // Redistribute the opposite across all other neurons proportionally
    const others = this.neurons.filter((n) => n.id !== neuronId);
    const otherTotal = others.reduce((s, n) => s + n.vale, 0);
    if (otherTotal === 0) {
      normalizeVale(this.neurons, this.config.totalVale);
      return;
    }

    const redistribute = -actual;
    for (const n of others) {
      const share = Math.round(redistribute * (n.vale / otherTotal));
      n.vale = Math.max(1, n.vale + share);
    }

    normalizeVale(this.neurons, this.config.totalVale);
  }

  /**
   * Queue a vale adjustment to be applied on the next tick (during propagation,
   * to avoid mid-tick structural changes).
   */
  queueValeAdjustment(neuronId: string, delta: number): void {
    const existing = this.pendingValeAdjustments.get(neuronId) ?? 0;
    this.pendingValeAdjustments.set(neuronId, existing + delta);
  }

  private applyValeAdjustments(): void {
    if (this.pendingValeAdjustments.size === 0) return;

    for (const [id, delta] of this.pendingValeAdjustments) {
      this.adjustVale(id, delta);
    }
    this.pendingValeAdjustments.clear();
  }

  // ─── NeuroLang: Label Neurons ─────────────────────────────────────────

  /**
   * Give a neuron a human-readable label and optional definition contract.
   * The definition is a string describing the expected output when this neuron
   * alone receives input (used for contract-based training).
   */
  labelNeuron(id: string, label: string, definition?: string): void {
    const neuron = this.neurons.find((n) => n.id === id);
    if (!neuron) return;
    neuron.label = label;
    if (definition) neuron.definition = definition;
  }

  // ─── Learning: Adjust Connection Weights ──────────────────────────────

  /**
   * Simple Hebbian update: "neurons that fire together, wire together."
   * Strengthens connections between co-active neurons, weakened by vale
   * (stable neurons change less).
   *
   * @param learningRate - how strongly to reinforce co-activation patterns
   */
  learnHebbian(learningRate = 0.01): void {
    const n = this.neurons.length;
    const dims = this.config.dimensions;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;

        const src = this.neurons[i];
        const tgt = this.neurons[j];
        const srcMag = Math.sqrt(src.state.reduce((s, v) => s + v * v, 0));
        const tgtMag = Math.sqrt(tgt.state.reduce((s, v) => s + v * v, 0));

        // Co-activation strength
        const coactivation = srcMag * tgtMag;

        // Vale-adjusted learning: high-vale neurons resist weight changes
        const valeFactor = 1 / (1 + (src.vale + tgt.vale) / 100);
        const lr = learningRate * valeFactor;

        const w = this.connections[j][i].weights;
        for (let row = 0; row < dims; row++) {
          for (let col = 0; col < dims; col++) {
            w[row][col] += lr * coactivation * src.state[col] * tgt.state[row];
            // Soft clipping to prevent runaway weights
            w[row][col] = Math.tanh(w[row][col]);
          }
        }
      }
    }
  }
}
