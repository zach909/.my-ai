export interface NeuronNode {
  id: number;
  activation: number;
  bias: number;
  connections: Map<number, number>;
  layer: number;
  activationHistory: number[];
}

export interface MeshTopology {
  nodes: NeuronNode[];
  edges: [number, number, number][];
  density: number;
  averagePathLength: number;
  clusteringCoefficient: number;
  nodeCount: number;
  edgeCount: number;
}

export interface PropagationResult {
  finalStates: Map<number, number>;
  iterations: number;
  converged: boolean;
  residual: number;
  nodeHistory: Map<number, number[]>;
  /**
   * Input-flag dimension (Section 3): 1.0 for each node that received
   * external activation this tick, 0.0 for all others. Propagates through
   * the mesh so every node can observe the full input topography.
   */
  inputFlags: Map<number, number>;
}

export interface MeshConfig {
  initialNodeCount: number;
  nodeCount?: number;
  connectionDensity: number;
  initialConnectionWeight?: number;
  maxIterations: number;
  propagationSteps?: number;
  convergenceThreshold: number;
  activationFunction: 'relu' | 'tanh' | 'sigmoid' | 'swish';
  activationFn?: 'relu' | 'tanh' | 'sigmoid' | 'swish';
  learningRate: number;
  dampingFactor?: number;
  seed: number;
  /**
   * Section 8: per-connection dimension count. When > 1, each connection stores
   * D per-dimension weights (diagonal of the D×D block) and each node gets a
   * bias vector of length D. Use propagateMulti() with Float32Array inputs.
   * Defaults to 1 (scalar, backward-compatible).
   */
  stateDim?: number;
}

export interface MultiPropagationResult {
  states: Map<number, Float32Array>;
  iterations: number;
  converged: boolean;
}

export class NeuronMesh {
  private config: MeshConfig;
  private nodes: Map<number, NeuronNode>;
  private nextId: number = 0;
  // Section 8: per-connection dimension weights (from-id → to-id → Float32Array(D)).
  // Only populated when config.stateDim > 1.
  private dimWeights: Map<number, Map<number, Float32Array>> = new Map();
  // Per-node bias vectors for multi-dimensional propagation.
  private biasVecs: Map<number, Float32Array> = new Map();

  constructor(config: Partial<MeshConfig> = {}) {
    const nodeCount = config.nodeCount || config.initialNodeCount || 10;
    const actFn = config.activationFn || config.activationFunction || 'relu';
    this.config = {
      initialNodeCount: nodeCount,
      connectionDensity: 1.0,
      maxIterations: config.propagationSteps || config.maxIterations || 100,
      convergenceThreshold: config.convergenceThreshold ?? 0.001,
      activationFunction: actFn as 'relu' | 'tanh' | 'sigmoid' | 'swish',
      learningRate: config.learningRate ?? 0.01,
      seed: config.seed ?? 42,
    };
    this.nodes = new Map();
    const tempIds: number[] = [];
    for (let i = 0; i < this.config.initialNodeCount; i++) {
      const id = this.nextId++;
      const node: NeuronNode = {
        id,
        activation: 0,
        bias: (Math.random() * 2 - 1) * 0.1,
        connections: new Map(),
        layer: 0,
        activationHistory: [],
      };
      this.nodes.set(id, node);
      tempIds.push(id);
    }
    for (let i = 0; i < tempIds.length; i++) {
      for (let j = 0; j < tempIds.length; j++) {
        if (i === j) continue;
        const from = tempIds[i]!;
        const to = tempIds[j]!;
        const weight = (Math.random() * 2 - 1) * Math.sqrt(1 / tempIds.length);
        this.nodes.get(from)!.connections.set(to, weight);
      }
    }

    // Section 8: initialize per-dimension weights when stateDim > 1.
    const D = this.config.stateDim ?? 1;
    if (D > 1) {
      for (const fromId of tempIds) {
        const fromMap = new Map<number, Float32Array>();
        for (const toId of tempIds) {
          if (fromId === toId) continue;
          // Diagonal weights: each dimension d maps to itself with a small
          // random scale. Cross-terms omitted for Pi-class hardware.
          const diagW = new Float32Array(D);
          for (let d = 0; d < D; d++) diagW[d] = (Math.random() * 0.4 - 0.2) * Math.sqrt(1 / tempIds.length);
          fromMap.set(toId!, diagW);
        }
        this.dimWeights.set(fromId!, fromMap);
        this.biasVecs.set(fromId!, new Float32Array(D));
      }
    }
  }

  propagate(inputActivations: Map<number, number> | Map<string, number>): PropagationResult {
    const nodeHistory = new Map<number, number[]>();
    const state = this.captureState();

    // Input-flag dimension: track which node ids are externally driven this tick.
    const inputFlags = new Map<number, number>();
    for (const [id] of this.nodes) inputFlags.set(id, 0);

    for (const [id, val] of inputActivations) {
      const numericId = typeof id === 'string' ? parseInt(id.replace('neuron_', ''), 10) : id;
      const node = this.nodes.get(numericId);
      if (node) {
        node.activation = val;
        node.activationHistory = [val];
        inputFlags.set(numericId, 1.0);
      }
    }

    // Propagate the input-flag signal through the all-to-all mesh so every
    // node can observe which nodes are externally driven (Section 3).
    const flagNodes = Array.from(inputFlags.entries()).filter(([, f]) => f > 0).map(([id]) => id);
    if (flagNodes.length > 0) {
      for (const [id] of this.nodes) {
        if (inputFlags.get(id)) continue;
        let flagSum = 0;
        const node = this.nodes.get(id)!;
        for (const [neighborId, weight] of node.connections) {
          flagSum += (inputFlags.get(neighborId) ?? 0) * Math.abs(weight);
        }
        inputFlags.set(id, Math.min(1, flagSum));
      }
    }

    let iteration = 0;
    let converged = false;
    let residual = 0;

    for (; iteration < this.config.maxIterations; iteration++) {
      const newState = new Map<number, number>();

      for (const [id, node] of this.nodes) {
        let sum = node.bias;
        for (const [neighborId, weight] of node.connections) {
          const neighbor = this.nodes.get(neighborId);
          if (neighbor) {
            sum += neighbor.activation * weight;
          }
        }
        const activated = this.activate(sum);
        newState.set(id, activated);

        if (!nodeHistory.has(id)) nodeHistory.set(id, []);
        nodeHistory.get(id)!.push(activated);
      }

      residual = 0;
      for (const [id, val] of newState) {
        const node = this.nodes.get(id)!;
        const diff = Math.abs(val - node.activation);
        residual += diff;
        node.activation = val;
        node.activationHistory.push(val);
      }

      if (this.checkConvergence(residual)) {
        converged = true;
        break;
      }
    }

    const finalStates = new Map<number, number>();
    for (const [id, node] of this.nodes) {
      finalStates.set(id, node.activation);
    }

    return {
      finalStates,
      iterations: iteration + 1,
      converged,
      residual,
      nodeHistory,
      inputFlags,
    };
  }

  /**
   * Hebbian weight update gated per-node by an externally supplied learning
   * rate (from the elastic value budget: high-value nodes get a low rate and
   * barely move, low-value nodes get a high rate and adapt quickly). Returns
   * the total absolute weight change applied from each node, so the caller
   * can feed it back into the value budget as a "how much did this node just
   * change" signal.
   */
  applyValueWeightedLearning(learningRates: Map<number, number>): Map<number, number> {
    const deltaByNode = new Map<number, number>();
    for (const [id, node] of this.nodes) {
      const rate = learningRates.get(id) ?? this.config.learningRate;
      let totalDelta = 0;
      for (const [neighborId, weight] of node.connections) {
        const neighbor = this.nodes.get(neighborId);
        if (!neighbor) continue;
        const hebbian = rate * node.activation * neighbor.activation;
        const newWeight = Math.max(-2, Math.min(2, weight + hebbian));
        node.connections.set(neighborId, newWeight);
        totalDelta += Math.abs(newWeight - weight);
      }
      deltaByNode.set(id, totalDelta);
    }
    return deltaByNode;
  }

  /**
   * Section 8 — multi-dimensional propagation with per-connection dimension
   * weights (diagonal of the D×D block) and per-neuron bias vector.
   *
   * Formula for target node i at each propagation step:
   *   stateVec_i[d] = activate( Σ_j (stateVec_j[d] × dimWeights[j→i][d]) + biasVec_i[d] )
   *
   * Single bias per neuron (not per connection) — added once after the full
   * summed product, so it doesn't scale with connection count (Section 8 fix).
   *
   * Falls back to scalar propagate() if stateDim ≤ 1 or no dimWeights exist.
   */
  propagateMulti(inputActivations: Map<number, Float32Array>): MultiPropagationResult {
    const D = this.config.stateDim ?? 1;
    if (D <= 1 || this.dimWeights.size === 0) {
      // Scalar fallback: extract first dimension or zero.
      const scalarInputs = new Map<number, number>();
      for (const [id, vec] of inputActivations) scalarInputs.set(id, vec[0] ?? 0);
      const scalar = this.propagate(scalarInputs);
      const states = new Map<number, Float32Array>();
      for (const [id, v] of scalar.finalStates) {
        const vec = new Float32Array(1);
        vec[0] = v;
        states.set(id, vec);
      }
      return { states, iterations: scalar.iterations, converged: scalar.converged };
    }

    const nodeIds = Array.from(this.nodes.keys());

    // Initialise state vectors: external input or zeros.
    const stateVecs = new Map<number, Float32Array>();
    for (const id of nodeIds) {
      const ext = inputActivations.get(id);
      stateVecs.set(id, ext ? new Float32Array(ext) : new Float32Array(D));
    }

    let iterations = 0;
    let converged = false;

    for (; iterations < this.config.maxIterations; iterations++) {
      const nextVecs = new Map<number, Float32Array>();
      let maxDelta = 0;

      for (const toId of nodeIds) {
        const newVec = new Float32Array(this.biasVecs.get(toId) ?? new Float32Array(D));
        for (const fromId of nodeIds) {
          if (fromId === toId) continue;
          const diagW = this.dimWeights.get(fromId)?.get(toId);
          if (!diagW) continue;
          const srcVec = stateVecs.get(fromId)!;
          for (let d = 0; d < D; d++) {
            newVec[d] += srcVec[d]! * diagW[d]!;
          }
        }
        // Activate per dimension
        for (let d = 0; d < D; d++) newVec[d] = this.activate(newVec[d]!);

        // Measure convergence (L1 across all dims)
        const prev = stateVecs.get(toId)!;
        for (let d = 0; d < D; d++) maxDelta = Math.max(maxDelta, Math.abs(newVec[d]! - prev[d]!));
        nextVecs.set(toId, newVec);
      }

      for (const [id, vec] of nextVecs) stateVecs.set(id, vec);

      if (maxDelta < this.config.convergenceThreshold) {
        converged = true;
        iterations++;
        break;
      }
    }

    return { states: stateVecs, iterations, converged };
  }

  addNode(layer: number): number {
    const id = this.nextId++;
    const node: NeuronNode = {
      id,
      activation: 0,
      bias: (Math.random() * 2 - 1) * 0.1,
      connections: new Map(),
      layer,
      activationHistory: [],
    };
    this.nodes.set(id, node);

    for (const [, other] of this.nodes) {
      if (other.id !== id && Math.random() < this.config.connectionDensity) {
        const weight = (Math.random() * 2 - 1) * Math.sqrt(1 / this.nodes.size);
        node.connections.set(other.id, weight);
        other.connections.set(id, weight);
      }
    }

    return id;
  }

  removeNode(id: number): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;
    for (const [, other] of this.nodes) {
      other.connections.delete(id);
    }
    this.nodes.delete(id);
    return true;
  }

  updateConnection(fromId: number, toId: number, newWeight: number): void {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (from && to) {
      from.connections.set(toId, newWeight);
      to.connections.set(fromId, newWeight);
    }
  }

  getTopology(): MeshTopology {
    const nodes = Array.from(this.nodes.values());
    const edges: [number, number, number][] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      for (const [neighborId, weight] of node.connections) {
        const key = Math.min(node.id, neighborId) + '_' + Math.max(node.id, neighborId);
        if (!seen.has(key)) {
          seen.add(key);
          edges.push([node.id, neighborId, weight]);
        }
      }
    }

    return {
      nodes,
      edges,
      density: this.nodes.size > 1 ? (2 * edges.length) / (this.nodes.size * (this.nodes.size - 1)) : 0,
      averagePathLength: this.computeAveragePathLength(),
      clusteringCoefficient: this.computeClusteringCoefficient(),
      nodeCount: this.nodes.size,
      edgeCount: edges.length,
    };
  }

  getNode(id: number): NeuronNode | undefined {
    return this.nodes.get(id);
  }

  getNodeCount(): number {
    return this.nodes.size;
  }

  private activate(x: number): number {
    switch (this.config.activationFunction) {
      case 'relu':
        return Math.max(0, x);
      case 'tanh':
        return Math.tanh(x);
      case 'sigmoid':
        return 1 / (1 + Math.exp(-x));
      case 'swish':
        return x / (1 + Math.exp(-x));
      default:
        return Math.max(0, x);
    }
  }

  private captureState(): Map<number, number> {
    const state = new Map<number, number>();
    for (const [id, node] of this.nodes) {
      state.set(id, node.activation);
    }
    return state;
  }

  private checkConvergence(residual: number): boolean {
    return residual < this.config.convergenceThreshold;
  }

  private computeAveragePathLength(): number {
    const nodeIds = Array.from(this.nodes.keys());
    let totalLength = 0;
    let pairs = 0;

    for (let i = 0; i < nodeIds.length; i++) {
      const distances = this.BFS(nodeIds[i]);
      for (let j = i + 1; j < nodeIds.length; j++) {
        const d = distances.get(nodeIds[j]);
        if (d !== undefined && d > 0) {
          totalLength += d;
          pairs++;
        }
      }
    }

    return pairs > 0 ? totalLength / pairs : 0;
  }

  private BFS(startId: number): Map<number, number> {
    const distances = new Map<number, number>();
    const queue: number[] = [startId];
    distances.set(startId, 0);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.nodes.get(current);
      if (!node) continue;
      const currentDist = distances.get(current) || 0;

      for (const [neighborId] of node.connections) {
        if (!distances.has(neighborId)) {
          distances.set(neighborId, currentDist + 1);
          queue.push(neighborId);
        }
      }
    }

    return distances;
  }

  private computeClusteringCoefficient(): number {
    let totalCoeff = 0;
    let nodeCount = 0;

    for (const [, node] of this.nodes) {
      const neighbors = Array.from(node.connections.keys());
      if (neighbors.length < 2) continue;

      let connectedPairs = 0;
      const totalPairs = (neighbors.length * (neighbors.length - 1)) / 2;

      for (let i = 0; i < neighbors.length; i++) {
        const neighborA = this.nodes.get(neighbors[i]);
        if (!neighborA) continue;
        for (let j = i + 1; j < neighbors.length; j++) {
          if (neighborA.connections.has(neighbors[j])) {
            connectedPairs++;
          }
        }
      }

      totalCoeff += connectedPairs / totalPairs;
      nodeCount++;
    }

    return nodeCount > 0 ? totalCoeff / nodeCount : 0;
  }
}
