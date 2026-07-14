import { MoERouter as CoreMoERouter } from './core/moe-router.js';
import { NeuronMesh, type PropagationResult } from './core/mesh.js';
export { CoreMoERouter as MoERouter };
/**
 * Section 2.1: a skill's neurons are ordinary mesh neurons, wired all-to-all
 * into the same shared NeuronMesh as everything else — "expert" is purely a
 * router-gating label (Expert.neuronIds), not a separate wiring boundary.
 */
export interface Expert {
    id: string;
    name: string;
    /** Node ids in the shared mesh registered under this expert's group label. */
    neuronIds: number[];
    specialization: string;
    activationThreshold: number;
    lastUsed: number;
    usageCount: number;
}
export interface MoETickResult {
    /** Expert ids the router selected (top-K) for this tick. */
    activeExperts: string[];
    propagation: PropagationResult;
}
export declare class MixtureOfExperts {
    private experts;
    private activeExperts;
    private topK;
    private router;
    private mesh;
    /** Router's numeric expert index <-> our string expert id. */
    private routerIndexToId;
    constructor(topK?: number, mesh?: NeuronMesh);
    /** The shared mesh every expert's neurons are registered into. */
    getMesh(): NeuronMesh;
    /**
     * Registers `neuronCount` new mesh neurons under this expert's group label
     * (wired all-to-all into the shared mesh, same as any other neuron) and
     * registers the expert with the MoE router for scoring/gating.
     */
    addExpert(id: string, name: string, specialization: string, neuronCount?: number): Expert;
    /**
     * Register additional neurons under an already-registered expert's group
     * label (e.g. a variable number of neurons per sub-skill within one
     * expert). Wired all-to-all into the shared mesh exactly like addExpert's
     * initial neurons. Returns the new node ids; no-op (empty array) if the
     * expert id isn't registered.
     */
    addNeuronsToExpert(expertId: string, count: number, layer?: number): number[];
    /**
     * Section 2.1: score all registered experts against `routingInput`, select
     * top-K, and propagate the shared mesh with only those experts' (plus any
     * ungrouped/core) neurons computing this tick — everyone else holds their
     * last value but stays fully wired. `meshInputs` are the externally-driven
     * mesh node activations for this tick (same shape `propagate()` expects).
     */
    tick(routingInput: Float32Array, meshInputs: Map<number, number>, vale?: Map<number, number>): MoETickResult;
    getExpert(id: string): Expert | undefined;
    listExperts(): Expert[];
    getActiveExperts(): Expert[];
    getRouter(): CoreMoERouter;
    getExpertCount(): number;
}
