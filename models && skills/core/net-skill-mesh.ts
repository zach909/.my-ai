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
import { NeuronMesh, type PropagationResult } from "./onebrain.js";
import { NetSkillRouter } from "./net-skill-router.js";

/** One skill region: a named group of neurons in the shared mesh. */
export interface SkillRegion {
  id: string;
  name: string;
  /** Node ids in the shared mesh registered under this region's group label. */
  neuronIds: number[];
  /** What the region is for; this is what routing compares input against. */
  specialization: string;
  activationThreshold: number;
  lastUsed: number;
  usageCount: number;
}

export interface SkillTickResult {
  /** Region ids routing selected for this tick, best first. */
  activeSkills: string[];
  propagation: PropagationResult;
}

export class NetSkillMesh {
  private readonly skills = new Map<string, SkillRegion>();
  private activeSkills = new Set<string>();
  private readonly router: NetSkillRouter;
  private readonly mesh: NeuronMesh;

  constructor(topK: number = 2, mesh?: NeuronMesh) {
    this.router = new NetSkillRouter(topK);
    // Shared, all-to-all mesh: every region's neurons live here alongside
    // everyone else's, wired at connectionDensity 1.0 by addNode() -- a
    // region is a label, not a wiring boundary.
    this.mesh = mesh ?? new NeuronMesh({ nodeCount: 0, connectionDensity: 1.0 });
  }

  /** The shared mesh every region's neurons are registered into. */
  getMesh(): NeuronMesh { return this.mesh; }

  /**
   * Registers `neuronCount` new mesh neurons under this region's group label
   * (wired all-to-all into the shared mesh like any other neuron) and makes
   * the region routable by what it means.
   */
  addSkill(id: string, name: string, specialization: string, neuronCount: number = 4): SkillRegion {
    const neuronIds: number[] = [];
    for (let i = 0; i < neuronCount; i++) neuronIds.push(this.mesh.addNode(0, id));
    const skill: SkillRegion = {
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
  addNeuronsToSkill(skillId: string, count: number, layer: number = 0): number[] {
    const skill = this.skills.get(skillId);
    if (!skill) return [];
    const newIds: number[] = [];
    for (let i = 0; i < count; i++) newIds.push(this.mesh.addNode(layer, skillId));
    skill.neuronIds.push(...newIds);
    return newIds;
  }

  /**
   * Route `routingInput` (text, or a vector) to the regions it is about, then
   * propagate the shared mesh with only those regions' (plus ungrouped core)
   * neurons computing this tick. Everyone else holds its last value but stays
   * fully wired. `meshInputs` are the externally driven node activations.
   */
  tick(
    routingInput: string | ArrayLike<number>,
    meshInputs: Map<number, number>,
    vale?: Map<number, number>,
  ): SkillTickResult {
    const activeSkills = this.router.select(routingInput).ids;
    this.activeSkills = new Set(activeSkills);
    const now = Date.now();
    for (const id of activeSkills) {
      const skill = this.skills.get(id);
      if (skill) { skill.lastUsed = now; skill.usageCount++; }
    }
    const propagation = this.mesh.propagate(meshInputs, vale, new Set(activeSkills));
    return { activeSkills, propagation };
  }

  getSkill(id: string): SkillRegion | undefined { return this.skills.get(id); }
  listSkills(): SkillRegion[] { return Array.from(this.skills.values()); }
  getActiveSkills(): SkillRegion[] {
    return Array.from(this.activeSkills).map((id) => this.skills.get(id)!).filter(Boolean);
  }
  getRouter(): NetSkillRouter { return this.router; }
  getSkillCount(): number { return this.skills.size; }
}
