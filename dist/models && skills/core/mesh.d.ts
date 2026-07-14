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
    /**
     * Section 2.1: a skill/expert "group" is purely a label used by the MoE
     * router for gating which neurons compute on a given tick — it has zero
     * effect on wiring. A grouped node is still created (and wired all-to-all,
     * same as any other node) by addNode(); the group only matters to
     * propagate() when an activeGroups set is passed in.
     */
    private nodeGroups;
    constructor(config?: Partial<MeshConfig>);
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
    propagate(inputActivations: Map<number, number> | Map<string, number>, vale?: Map<number, number>, activeGroups?: Set<string>): PropagationResult;
    /**
     * Hebbian weight update gated per-node by an externally supplied learning
     * rate (from the elastic value budget: high-value nodes get a low rate and
     * barely move, low-value nodes get a high rate and adapt quickly). Returns
     * the total absolute weight change applied from each node, so the caller
     * can feed it back into the value budget as a "how much did this node just
     * change" signal.
     */
    applyValueWeightedLearning(learningRates: Map<number, number>): Map<number, number>;
    /**
     * @param group Section 2.1: optional skill/expert label. Purely a router
     *   gating tag — the node is wired all-to-all at connectionDensity exactly
     *   like any ungrouped node, with zero effect on topology.
     */
    addNode(layer: number, group?: string): number;
    removeNode(id: number): boolean;
    /** Section 2.1: node ids labeled with the given skill/expert group. */
    getGroupNodeIds(group: string): number[];
    /** The skill/expert group a node was registered under, if any. */
    getNodeGroup(id: number): string | undefined;
    /** All distinct skill/expert groups currently registered in the mesh. */
    getGroups(): string[];
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
