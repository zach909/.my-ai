export class NeuronMesh {
    constructor(config = {}) {
        this.nextId = 0;
        /**
         * Section 2.1: a skill/expert "group" is purely a label used by the MoE
         * router for gating which neurons compute on a given tick — it has zero
         * effect on wiring. A grouped node is still created (and wired all-to-all,
         * same as any other node) by addNode(); the group only matters to
         * propagate() when an activeGroups set is passed in.
         */
        this.nodeGroups = new Map();
        // Performance cache for CSR layout
        this.cacheValid = false;
        this.cachedNodes = [];
        this.idToIndex = new Map();
        this.flatWeights = new Float32Array(0);
        this.flatIndices = new Int32Array(0);
        this.rowStarts = new Int32Array(0);
        this.biases = new Float32Array(0);
        this.currActivations = new Float32Array(0);
        this.nextActivations = new Float32Array(0);
        const nodeCount = config.nodeCount ?? config.initialNodeCount ?? 10;
        const actFn = config.activationFn || config.activationFunction || 'relu';
        this.config = {
            initialNodeCount: nodeCount,
            connectionDensity: 1.0,
            maxIterations: config.propagationSteps || config.maxIterations || 100,
            convergenceThreshold: config.convergenceThreshold ?? 0.001,
            activationFunction: actFn,
            learningRate: config.learningRate ?? 0.01,
            seed: config.seed ?? 42,
        };
        this.nodes = new Map();
        const tempIds = [];
        for (let i = 0; i < this.config.initialNodeCount; i++) {
            const id = this.nextId++;
            const node = {
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
                if (i === j)
                    continue;
                const from = tempIds[i];
                const to = tempIds[j];
                const weight = (Math.random() * 2 - 1) * Math.sqrt(1 / tempIds.length);
                this.nodes.get(from).connections.set(to, weight);
            }
        }
        this.refreshCache();
    }
    /**
     * Synchronize the CSR cache with the current nodes Map.
     */
    refreshCache() {
        this.cachedNodes = Array.from(this.nodes.values());
        const N = this.cachedNodes.length;
        this.idToIndex = new Map(this.cachedNodes.map((n, i) => [n.id, i]));
        this.biases = new Float32Array(this.cachedNodes.map(n => n.bias));
        this.currActivations = new Float32Array(this.cachedNodes.map(n => n.activation));
        this.nextActivations = new Float32Array(N);
        let totalEdges = 0;
        for (const n of this.cachedNodes)
            totalEdges += n.connections.size;
        this.flatWeights = new Float32Array(totalEdges);
        this.flatIndices = new Int32Array(totalEdges);
        this.rowStarts = new Int32Array(N + 1);
        let edgePtr = 0;
        for (let i = 0; i < N; i++) {
            const n = this.cachedNodes[i];
            this.rowStarts[i] = edgePtr;
            for (const [neighborId, weight] of n.connections) {
                const j = this.idToIndex.get(neighborId);
                if (j !== undefined) {
                    this.flatIndices[edgePtr] = j;
                    this.flatWeights[edgePtr] = weight;
                    edgePtr++;
                }
            }
        }
        this.rowStarts[N] = edgePtr;
        this.cacheValid = true;
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
    propagate(inputActivations, vale, activeGroups) {
        if (!this.cacheValid)
            this.refreshCache();
        const nodes = this.cachedNodes;
        const N = nodes.length;
        const maxIters = this.config.maxIterations;
        // Bolt's Optimization: Pre-allocate standard arrays of size maxIters
        // to completely avoid memory allocations and garbage collection pressure in hot loops.
        const histories = [];
        const nodeHistory = new Map();
        for (let i = 0; i < N; i++) {
            const arr = new Array(maxIters);
            histories.push(arr);
            nodeHistory.set(nodes[i].id, arr);
        }
        // Synchronize activations from source of truth and inputs
        for (let i = 0; i < N; i++)
            this.currActivations[i] = nodes[i].activation;
        for (const [id, val] of inputActivations) {
            const nId = typeof id === 'string' ? parseInt(id.replace('neuron_', ''), 10) : id;
            const idx = this.idToIndex.get(nId);
            if (idx !== undefined) {
                const node = nodes[idx];
                node.activation = val;
                node.activationHistory = [val];
                this.currActivations[idx] = val;
            }
        }
        const curr = this.currActivations;
        const next = this.nextActivations;
        const flatWeights = this.flatWeights;
        const flatIndices = this.flatIndices;
        const rowStarts = this.rowStarts;
        const biases = this.biases;
        // Resolve the activation function outside the hot loop to avoid dynamic lookup and switches
        const actFn = this.config.activationFunction;
        let activate;
        if (actFn === 'relu') {
            activate = (x) => x > 0 ? x : 0;
        }
        else if (actFn === 'tanh') {
            activate = Math.tanh;
        }
        else if (actFn === 'sigmoid') {
            activate = (x) => 1 / (1 + Math.exp(-x));
        }
        else if (actFn === 'swish') {
            activate = (x) => x / (1 + Math.exp(-x));
        }
        else {
            activate = (x) => x > 0 ? x : 0;
        }
        let iteration = 0, converged = false, residual = 0;
        // Fast-path: When there are no gates and no vale gating (most common case)
        if (!activeGroups && !vale) {
            for (; iteration < maxIters; iteration++) {
                for (let i = 0; i < N; i++) {
                    let sum = biases[i];
                    const start = rowStarts[i], end = rowStarts[i + 1];
                    // Bolt's Optimization: Manual 8x loop unrolling for row-major dot product to reduce branch evaluation overhead.
                    const limit = end - 7;
                    let k = start;
                    for (; k < limit; k += 8) {
                        sum += curr[flatIndices[k]] * flatWeights[k]
                            + curr[flatIndices[k + 1]] * flatWeights[k + 1]
                            + curr[flatIndices[k + 2]] * flatWeights[k + 2]
                            + curr[flatIndices[k + 3]] * flatWeights[k + 3]
                            + curr[flatIndices[k + 4]] * flatWeights[k + 4]
                            + curr[flatIndices[k + 5]] * flatWeights[k + 5]
                            + curr[flatIndices[k + 6]] * flatWeights[k + 6]
                            + curr[flatIndices[k + 7]] * flatWeights[k + 7];
                    }
                    for (; k < end; k++) {
                        sum += curr[flatIndices[k]] * flatWeights[k];
                    }
                    next[i] = activate(sum);
                    histories[i][iteration] = next[i];
                }
                residual = 0;
                for (let i = 0; i < N; i++) {
                    // OPTIMIZATION: Branchless ternary absolute difference to avoid Math.abs call overhead
                    const diff = next[i] - curr[i];
                    residual += diff < 0 ? -diff : diff;
                    curr[i] = next[i];
                    nodes[i].activation = curr[i];
                }
                if (this.checkConvergence(residual)) {
                    converged = true;
                    break;
                }
            }
        }
        else {
            // General path: When either gates or vale gating is active
            const gates = new Uint8Array(N);
            const vs = new Float32Array(N);
            const hasV = new Uint8Array(N);
            for (let i = 0; i < N; i++) {
                const n = nodes[i];
                const g = this.nodeGroups.get(n.id);
                gates[i] = (activeGroups && g !== undefined && !activeGroups.has(g)) ? 1 : 0;
                const v = vale?.get(n.id);
                if (v !== undefined) {
                    vs[i] = v;
                    hasV[i] = 1;
                }
            }
            for (; iteration < maxIters; iteration++) {
                for (let i = 0; i < N; i++) {
                    if (gates[i]) {
                        next[i] = curr[i];
                    }
                    else {
                        let sum = biases[i];
                        const start = rowStarts[i], end = rowStarts[i + 1];
                        // Bolt's Optimization: Manual 8x loop unrolling for row-major dot product to reduce branch evaluation overhead.
                        const limit = end - 7;
                        let k = start;
                        for (; k < limit; k += 8) {
                            sum += curr[flatIndices[k]] * flatWeights[k]
                                + curr[flatIndices[k + 1]] * flatWeights[k + 1]
                                + curr[flatIndices[k + 2]] * flatWeights[k + 2]
                                + curr[flatIndices[k + 3]] * flatWeights[k + 3]
                                + curr[flatIndices[k + 4]] * flatWeights[k + 4]
                                + curr[flatIndices[k + 5]] * flatWeights[k + 5]
                                + curr[flatIndices[k + 6]] * flatWeights[k + 6]
                                + curr[flatIndices[k + 7]] * flatWeights[k + 7];
                        }
                        for (; k < end; k++) {
                            sum += curr[flatIndices[k]] * flatWeights[k];
                        }
                        const comp = activate(sum);
                        next[i] = hasV[i] ? vs[i] * curr[i] + (1 - vs[i]) * comp : comp;
                    }
                    histories[i][iteration] = next[i];
                }
                residual = 0;
                for (let i = 0; i < N; i++) {
                    // OPTIMIZATION: Branchless ternary absolute difference to avoid Math.abs call overhead
                    const diff = next[i] - curr[i];
                    residual += diff < 0 ? -diff : diff;
                    curr[i] = next[i];
                    nodes[i].activation = curr[i];
                }
                if (this.checkConvergence(residual)) {
                    converged = true;
                    break;
                }
            }
        }
        // Bolt's Optimization: Truncate pre-allocated arrays and bulk-append history to node's activationHistory
        const finalIters = converged ? iteration + 1 : iteration;
        for (let i = 0; i < N; i++) {
            const history = histories[i];
            history.length = finalIters;
            nodes[i].activationHistory.push(...history);
        }
        return {
            finalStates: new Map(nodes.map(n => [n.id, n.activation])),
            iterations: finalIters, converged, residual, nodeHistory
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
    applyValueWeightedLearning(learningRates) {
        if (!this.cacheValid)
            this.refreshCache();
        const deltaByNode = new Map();
        const N = this.cachedNodes.length;
        for (let i = 0; i < N; i++) {
            const node = this.cachedNodes[i];
            const rate = learningRates.get(node.id) ?? this.config.learningRate;
            let totalDelta = 0;
            const rowStart = this.rowStarts[i];
            const rowEnd = this.rowStarts[i + 1];
            // Optimization: Iterate over CSR structure directly to update both Map and flatWeights
            for (let k = rowStart; k < rowEnd; k++) {
                const neighborIdx = this.flatIndices[k];
                const neighbor = this.cachedNodes[neighborIdx];
                const weight = this.flatWeights[k];
                const hebbian = rate * node.activation * neighbor.activation;
                const newWeight = Math.max(-2, Math.min(2, weight + hebbian));
                this.flatWeights[k] = newWeight;
                node.connections.set(neighbor.id, newWeight);
                totalDelta += Math.abs(newWeight - weight);
            }
            deltaByNode.set(node.id, totalDelta);
        }
        return deltaByNode;
    }
    /**
     * @param group Section 2.1: optional skill/expert label. Purely a router
     *   gating tag — the node is wired all-to-all at connectionDensity exactly
     *   like any ungrouped node, with zero effect on topology.
     */
    addNode(layer, group) {
        const id = this.nextId++;
        const node = {
            id,
            activation: 0,
            bias: (Math.random() * 2 - 1) * 0.1,
            connections: new Map(),
            layer,
            activationHistory: [],
        };
        this.nodes.set(id, node);
        if (group !== undefined)
            this.nodeGroups.set(id, group);
        for (const [, other] of this.nodes) {
            if (other.id !== id && Math.random() < this.config.connectionDensity) {
                const weight = (Math.random() * 2 - 1) * Math.sqrt(1 / this.nodes.size);
                node.connections.set(other.id, weight);
                other.connections.set(id, weight);
            }
        }
        this.cacheValid = false;
        return id;
    }
    removeNode(id) {
        const node = this.nodes.get(id);
        if (!node)
            return false;
        for (const [, other] of this.nodes) {
            other.connections.delete(id);
        }
        this.nodes.delete(id);
        this.nodeGroups.delete(id);
        this.cacheValid = false;
        return true;
    }
    /** Section 2.1: node ids labeled with the given skill/expert group. */
    getGroupNodeIds(group) {
        const ids = [];
        for (const [id, g] of this.nodeGroups) {
            if (g === group)
                ids.push(id);
        }
        return ids;
    }
    /** The skill/expert group a node was registered under, if any. */
    getNodeGroup(id) {
        return this.nodeGroups.get(id);
    }
    /** All distinct skill/expert groups currently registered in the mesh. */
    getGroups() {
        return Array.from(new Set(this.nodeGroups.values()));
    }
    updateConnection(fromId, toId, newWeight) {
        const from = this.nodes.get(fromId);
        const to = this.nodes.get(toId);
        if (from && to) {
            from.connections.set(toId, newWeight);
            to.connections.set(fromId, newWeight);
            // If cache is valid, try to update it directly to avoid invalidation
            if (this.cacheValid) {
                const fromIdx = this.idToIndex.get(fromId);
                const toIdx = this.idToIndex.get(toId);
                if (fromIdx !== undefined && toIdx !== undefined) {
                    // Update from -> to weight
                    let foundFrom = false;
                    for (let k = this.rowStarts[fromIdx]; k < this.rowStarts[fromIdx + 1]; k++) {
                        if (this.flatIndices[k] === toIdx) {
                            this.flatWeights[k] = newWeight;
                            foundFrom = true;
                            break;
                        }
                    }
                    // Update to -> from weight
                    let foundTo = false;
                    for (let k = this.rowStarts[toIdx]; k < this.rowStarts[toIdx + 1]; k++) {
                        if (this.flatIndices[k] === fromIdx) {
                            this.flatWeights[k] = newWeight;
                            foundTo = true;
                            break;
                        }
                    }
                    if (!foundFrom || !foundTo)
                        this.cacheValid = false;
                }
                else {
                    this.cacheValid = false;
                }
            }
        }
    }
    getTopology() {
        const nodes = Array.from(this.nodes.values());
        const edges = [];
        const seen = new Set();
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
    getNode(id) {
        return this.nodes.get(id);
    }
    getNodeCount() {
        return this.nodes.size;
    }
    activate(x) {
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
    captureState() {
        const state = new Map();
        for (const [id, node] of this.nodes) {
            state.set(id, node.activation);
        }
        return state;
    }
    checkConvergence(residual) {
        return residual < this.config.convergenceThreshold;
    }
    computeAveragePathLength() {
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
    BFS(startId) {
        const distances = new Map();
        const queue = [startId];
        distances.set(startId, 0);
        while (queue.length > 0) {
            const current = queue.shift();
            const node = this.nodes.get(current);
            if (!node)
                continue;
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
    computeClusteringCoefficient() {
        let totalCoeff = 0;
        let nodeCount = 0;
        for (const [, node] of this.nodes) {
            const neighbors = Array.from(node.connections.keys());
            if (neighbors.length < 2)
                continue;
            let connectedPairs = 0;
            const totalPairs = (neighbors.length * (neighbors.length - 1)) / 2;
            for (let i = 0; i < neighbors.length; i++) {
                const neighborA = this.nodes.get(neighbors[i]);
                if (!neighborA)
                    continue;
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
