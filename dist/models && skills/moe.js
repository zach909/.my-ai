import { MoERouter as CoreMoERouter } from './core/moe-router.js';
import { NeuronMesh } from './core/mesh.js';
export { CoreMoERouter as MoERouter };
export class MixtureOfExperts {
    experts;
    activeExperts;
    topK;
    router;
    mesh;
    /** Router's numeric expert index <-> our string expert id. */
    routerIndexToId = new Map();
    constructor(topK = 2, mesh) {
        this.experts = new Map();
        this.activeExperts = new Set();
        this.topK = topK;
        // numExperts: 0 — every expert in the router must be a real, named
        // skill registered via addExpert(). Pre-seeding anonymous experts here
        // would let them win top-K selection and make tick()'s activeExperts
        // silently drop ticks (an anonymous winner has no group/id to map back to).
        this.router = new CoreMoERouter({ numExperts: 0, topK, inputDim: 768, outputDim: 768, expertHiddenDim: 512 });
        // Shared, all-to-all mesh: every expert's neurons live here alongside
        // everyone else's, wired at connectionDensity 1.0 by addNode() below —
        // grouping is a label, not a wiring restriction.
        this.mesh = mesh ?? new NeuronMesh({ nodeCount: 0, connectionDensity: 1.0 });
    }
    /** The shared mesh every expert's neurons are registered into. */
    getMesh() {
        return this.mesh;
    }
    /**
     * Registers `neuronCount` new mesh neurons under this expert's group label
     * (wired all-to-all into the shared mesh, same as any other neuron) and
     * registers the expert with the MoE router for scoring/gating.
     */
    addExpert(id, name, specialization, neuronCount = 4) {
        const neuronIds = [];
        for (let i = 0; i < neuronCount; i++) {
            neuronIds.push(this.mesh.addNode(0, id));
        }
        const expert = {
            id, name,
            neuronIds,
            specialization,
            activationThreshold: 0.3,
            lastUsed: Date.now(),
            usageCount: 0,
        };
        this.experts.set(id, expert);
        const routerIndex = this.router.addExpert({ id, name, specialization });
        this.routerIndexToId.set(routerIndex, id);
        return expert;
    }
    /**
     * Register additional neurons under an already-registered expert's group
     * label (e.g. a variable number of neurons per sub-skill within one
     * expert). Wired all-to-all into the shared mesh exactly like addExpert's
     * initial neurons. Returns the new node ids; no-op (empty array) if the
     * expert id isn't registered.
     */
    addNeuronsToExpert(expertId, count, layer = 0) {
        const expert = this.experts.get(expertId);
        if (!expert)
            return [];
        const newIds = [];
        for (let i = 0; i < count; i++) {
            const id = this.mesh.addNode(layer, expertId);
            newIds.push(id);
        }
        expert.neuronIds.push(...newIds);
        return newIds;
    }
    /**
     * Section 2.1: score all registered experts against `routingInput`, select
     * top-K, and propagate the shared mesh with only those experts' (plus any
     * ungrouped/core) neurons computing this tick — everyone else holds their
     * last value but stays fully wired. `meshInputs` are the externally-driven
     * mesh node activations for this tick (same shape `propagate()` expects).
     */
    tick(routingInput, meshInputs, vale) {
        const decision = this.router.route(routingInput);
        const activeExperts = decision.expertIndices
            .map(i => this.routerIndexToId.get(i))
            .filter((id) => id !== undefined);
        this.activeExperts = new Set(activeExperts);
        const now = Date.now();
        for (const id of activeExperts) {
            const expert = this.experts.get(id);
            if (expert) {
                expert.lastUsed = now;
                expert.usageCount++;
            }
        }
        const propagation = this.mesh.propagate(meshInputs, vale, new Set(activeExperts));
        return { activeExperts, propagation };
    }
    getExpert(id) { return this.experts.get(id); }
    listExperts() { return Array.from(this.experts.values()); }
    getActiveExperts() { return Array.from(this.activeExperts).map(id => this.experts.get(id)).filter(Boolean); }
    getRouter() { return this.router; }
    getExpertCount() { return this.experts.size; }
}
