/**
 * NetSkillMesh: named skill regions in a shared all-to-all NeuronMesh, with
 * net-skill routing deciding which regions compute each tick.
 *
 * This is what MixtureOfExperts was, minus the Mixture-of-Experts router. A
 * skill's neurons were always ordinary mesh neurons wired all-to-all with
 * everything else; the "expert" part was only the gate -- a separate,
 * randomly initialised MoERouter picking which groups ran. That gate is now
 * NetSkillRouter (net-skill-router.ts): a region is selected because what it
 * means is close to the input, not because a second network's random weights
 * scored it highly.
 */
import { NeuronMesh } from "./onebrain.js";
import { NetSkillRouter } from "./net-skill-router.js";
export class NetSkillMesh {
    constructor(topK = 2, mesh) {
        this.skills = new Map();
        this.activeSkills = new Set();
        this.router = new NetSkillRouter(topK);
        // Shared, all-to-all mesh: every region's neurons live here alongside
        // everyone else's, wired at connectionDensity 1.0 by addNode() -- a
        // region is a label, not a wiring boundary.
        this.mesh = mesh ?? new NeuronMesh({ nodeCount: 0, connectionDensity: 1.0 });
    }
    /** The shared mesh every region's neurons are registered into. */
    getMesh() { return this.mesh; }
    /**
     * Registers `neuronCount` new mesh neurons under this region's group label
     * (wired all-to-all into the shared mesh like any other neuron) and makes
     * the region routable by what it means.
     */
    addSkill(id, name, specialization, neuronCount = 4) {
        const neuronIds = [];
        for (let i = 0; i < neuronCount; i++)
            neuronIds.push(this.mesh.addNode(0, id));
        const skill = {
            id, name, neuronIds, specialization,
            activationThreshold: 0.3,
            lastUsed: Date.now(),
            usageCount: 0,
        };
        this.skills.set(id, skill);
        this.router.register({ id, name, meaning: specialization });
        return skill;
    }
    /**
     * More neurons under an already-registered region's label, wired
     * all-to-all exactly like its first ones. Empty when the id is unknown.
     */
    addNeuronsToSkill(skillId, count, layer = 0) {
        const skill = this.skills.get(skillId);
        if (!skill)
            return [];
        const newIds = [];
        for (let i = 0; i < count; i++)
            newIds.push(this.mesh.addNode(layer, skillId));
        skill.neuronIds.push(...newIds);
        return newIds;
    }
    /**
     * Route `routingInput` (text, or a vector) to the regions it is about, then
     * propagate the shared mesh with only those regions' (plus ungrouped core)
     * neurons computing this tick. Everyone else holds its last value but stays
     * fully wired. `meshInputs` are the externally driven node activations.
     */
    tick(routingInput, meshInputs, vale) {
        const activeSkills = this.router.select(routingInput).ids;
        this.activeSkills = new Set(activeSkills);
        const now = Date.now();
        for (const id of activeSkills) {
            const skill = this.skills.get(id);
            if (skill) {
                skill.lastUsed = now;
                skill.usageCount++;
            }
        }
        const propagation = this.mesh.propagate(meshInputs, vale, new Set(activeSkills));
        return { activeSkills, propagation };
    }
    getSkill(id) { return this.skills.get(id); }
    listSkills() { return Array.from(this.skills.values()); }
    getActiveSkills() {
        return Array.from(this.activeSkills).map((id) => this.skills.get(id)).filter(Boolean);
    }
    getRouter() { return this.router; }
    getSkillCount() { return this.skills.size; }
}
