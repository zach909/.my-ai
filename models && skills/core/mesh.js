export class NeuronMesh {
    config;
    nodes;
    nextId = 0;
    constructor(config = {}) {
        const nodeCount = config.nodeCount || config.initialNodeCount || 10;
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
    }
    propagate(inputActivations) {
        const nodeHistory = new Map();
        const state = this.captureState();
        for (const [id, val] of inputActivations) {
            const numericId = typeof id === 'string' ? parseInt(id.replace('neuron_', ''), 10) : id;
            const node = this.nodes.get(numericId);
            if (node) {
                node.activation = val;
                node.activationHistory = [val];
            }
        }
        let iteration = 0;
        let converged = false;
        let residual = 0;
        for (; iteration < this.config.maxIterations; iteration++) {
            const newState = new Map();
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
                if (!nodeHistory.has(id))
                    nodeHistory.set(id, []);
                nodeHistory.get(id).push(activated);
            }
            residual = 0;
            for (const [id, val] of newState) {
                const node = this.nodes.get(id);
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
        const finalStates = new Map();
        for (const [id, node] of this.nodes) {
            finalStates.set(id, node.activation);
        }
        return {
            finalStates,
            iterations: iteration + 1,
            converged,
            residual,
            nodeHistory,
        };
    }
    addNode(layer) {
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
        for (const [, other] of this.nodes) {
            if (other.id !== id && Math.random() < this.config.connectionDensity) {
                const weight = (Math.random() * 2 - 1) * Math.sqrt(1 / this.nodes.size);
                node.connections.set(other.id, weight);
                other.connections.set(id, weight);
            }
        }
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
        return true;
    }
    updateConnection(fromId, toId, newWeight) {
        const from = this.nodes.get(fromId);
        const to = this.nodes.get(toId);
        if (from && to) {
            from.connections.set(toId, newWeight);
            to.connections.set(fromId, newWeight);
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
