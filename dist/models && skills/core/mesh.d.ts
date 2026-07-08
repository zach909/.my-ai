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
export declare class NeuronMesh {
    private config;
    private nodes;
    private nextId;
    constructor(config?: Partial<MeshConfig>);
    /**
     * @param vale Optional per-node vale fraction in [0,1] from the elastic
     *   value budget. Gates the state-transition itself (not just weight
     *   learning): new_state = vale*old_state + (1-vale)*computed_state, so a
     *   high-vale node resists moving to its freshly computed activation while
     *   a low-vale node adopts it almost entirely. Nodes absent from the map
     *   are ungated (vale=0, i.e. fully adopt the computed state).
     */
    propagate(inputActivations: Map<number, number> | Map<string, number>, vale?: Map<number, number>): PropagationResult;
    /**
     * Hebbian weight update gated per-node by an externally supplied learning
     * rate (from the elastic value budget: high-value nodes get a low rate and
     * barely move, low-value nodes get a high rate and adapt quickly). Returns
     * the total absolute weight change applied from each node, so the caller
     * can feed it back into the value budget as a "how much did this node just
     * change" signal.
     */
    applyValueWeightedLearning(learningRates: Map<number, number>): Map<number, number>;
    addNode(layer: number): number;
    removeNode(id: number): boolean;
    updateConnection(fromId: number, toId: number, newWeight: number): void;
    getTopology(): MeshTopology;
    getNode(id: number): NeuronNode | undefined;
    getNodeCount(): number;
    private activate;
    private captureState;
    private checkConvergence;
    private computeAveragePathLength;
    private BFS;
    private computeClusteringCoefficient;
}
