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
}

export class NeuronMesh {
  private config: MeshConfig;
  private nodes: Map<number, NeuronNode>;
  private nextId: number = 0;
  /**
   * Section 2.1: a skill/expert "group" is purely a label used by the MoE
   * router for gating which neurons compute on a given tick — it has zero
   * effect on wiring. A grouped node is still created (and wired all-to-all,
   * same as any other node) by addNode(); the group only matters to
   * propagate() when an activeGroups set is passed in.
   */
  private nodeGroups: Map<number, string> = new Map();

  constructor(config: Partial<MeshConfig> = {}) {
    const nodeCount = config.nodeCount ?? config.initialNodeCount ?? 10;
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
        const from = tempIds[i];
        const to = tempIds[j];
        const weight = (Math.random() * 2 - 1) * Math.sqrt(1 / tempIds.length);
        this.nodes.get(from)!.connections.set(to, weight);
      }
    }
  }

  /**
   * @param vale Optional per-node vale fraction in [0,1] from the elastic
   *   value budget. Gates the state-transition itself (not just weight
   *   learning): new_state = vale*old_state + (1-vale)*computed_state, so a
   *   high-vale node resists moving to its freshly computed activation while
   *   a low-vale node adopts it almost entirely. Nodes absent from the map
   *   are ungated (vale=0, i.e. fully adopt the computed state).
   * @param activeGroups Section 2.1: when provided, only ungrouped (core)
   *   nodes and nodes whose group is in this set get their activation
   *   recomputed this tick — everyone else holds their last value (frozen,
   *   not disconnected). Frozen nodes are still read as neighbors by active
   *   nodes' weighted sums, and still hold live connections both directions,
   *   so the topology stays total while per-tick compute stays sparse.
   *   Omit to compute every node (the pre-2.1 behavior).
   */
  propagate(
    inputActivations: Map<number, number> | Map<string, number>,
    vale?: Map<number, number>,
    activeGroups?: Set<string>
  ): PropagationResult {
    const nodes = Array.from(this.nodes.values());
    const nodeHistory = new Map(nodes.map(n => [n.id, [] as number[]]));
    const histories = nodes.map(n => nodeHistory.get(n.id)!);

    for (const [id, val] of inputActivations) {
      const nId = typeof id === 'string' ? parseInt(id.replace('neuron_', ''), 10) : id;
      const node = this.nodes.get(nId);
      if (node) { node.activation = val; node.activationHistory = [val]; }
    }

    const N = nodes.length, idIdx = new Map(nodes.map((n, i) => [n.id, i]));
    const curr = new Float32Array(nodes.map(n => n.activation));
    const next = new Float32Array(N), gates = new Uint8Array(N), vs = new Float32Array(N), hasV = new Uint8Array(N);

    nodes.forEach((n, i) => {
      const g = this.nodeGroups.get(n.id);
      gates[i] = (activeGroups && g !== undefined && !activeGroups.has(g)) ? 1 : 0;
      const v = vale?.get(n.id);
      if (v !== undefined) { vs[i] = v; hasV[i] = 1; }
    });

    let totalEdges = 0;
    for (const n of nodes) totalEdges += n.connections.size;
    const flatWeights = new Float32Array(totalEdges), flatIndices = new Int32Array(totalEdges), rowStarts = new Int32Array(N + 1);
    let edgePtr = 0;
    nodes.forEach((n, i) => {
      rowStarts[i] = edgePtr;
      for (const [neighborId, weight] of n.connections) {
        const j = idIdx.get(neighborId);
        if (j !== undefined) { flatIndices[edgePtr] = j; flatWeights[edgePtr] = weight; edgePtr++; }
      }
    });
    rowStarts[N] = edgePtr;

    let iteration = 0, converged = false, residual = 0;
    for (; iteration < this.config.maxIterations; iteration++) {
      for (let i = 0; i < N; i++) {
        if (gates[i]) next[i] = curr[i];
        else {
          let sum = nodes[i].bias;
          const start = rowStarts[i], end = rowStarts[i + 1];
          for (let k = start; k < end; k++) sum += curr[flatIndices[k]] * flatWeights[k];
          const comp = this.activate(sum);
          next[i] = hasV[i] ? vs[i] * curr[i] + (1 - vs[i]) * comp : comp;
        }
        histories[i].push(next[i]);
      }

      residual = 0;
      for (let i = 0; i < N; i++) {
        residual += Math.abs(next[i] - curr[i]);
        curr[i] = next[i];
        nodes[i].activation = next[i];
        nodes[i].activationHistory.push(next[i]);
      }
      if (this.checkConvergence(residual)) { converged = true; break; }
    }

    return {
      finalStates: new Map(nodes.map(n => [n.id, n.activation])),
      iterations: iteration + 1, converged, residual, nodeHistory
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
   * @param group Section 2.1: optional skill/expert label. Purely a router
   *   gating tag — the node is wired all-to-all at connectionDensity exactly
   *   like any ungrouped node, with zero effect on topology.
   */
  addNode(layer: number, group?: string): number {
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
    if (group !== undefined) this.nodeGroups.set(id, group);

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
    this.nodeGroups.delete(id);
    return true;
  }

  /** Section 2.1: node ids labeled with the given skill/expert group. */
  getGroupNodeIds(group: string): number[] {
    const ids: number[] = [];
    for (const [id, g] of this.nodeGroups) {
      if (g === group) ids.push(id);
    }
    return ids;
  }

  /** The skill/expert group a node was registered under, if any. */
  getNodeGroup(id: number): string | undefined {
    return this.nodeGroups.get(id);
  }

  /** All distinct skill/expert groups currently registered in the mesh. */
  getGroups(): string[] {
    return Array.from(new Set(this.nodeGroups.values()));
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
