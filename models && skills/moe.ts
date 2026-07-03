import { MoERouter as CoreMoERouter } from './core/moe-router.js';
import type { Neuron } from './neuron.js';

export { CoreMoERouter as MoERouter };

export interface Expert {
  id: string;
  name: string;
  neurons: Map<string, Neuron>;
  specialization: string;
  activationThreshold: number;
  lastUsed: number;
  usageCount: number;
}

export class MixtureOfExperts {
  private experts: Map<string, Expert>;
  private activeExperts: Set<string>;
  private topK: number;
  private router: CoreMoERouter;

  constructor(topK: number = 2) {
    this.experts = new Map();
    this.activeExperts = new Set();
    this.topK = topK;
    this.router = new CoreMoERouter({ numExperts: 4, topK, inputDim: 768, outputDim: 768, expertHiddenDim: 512 });
  }

  addExpert(id: string, name: string, specialization: string): Expert {
    const expert: Expert = {
      id, name,
      neurons: new Map(),
      specialization,
      activationThreshold: 0.3,
      lastUsed: Date.now(),
      usageCount: 0,
    };
    this.experts.set(id, expert);
    this.router.addExpert({ id, name, specialization });
    return expert;
  }

  getExpert(id: string): Expert | undefined { return this.experts.get(id); }
  listExperts(): Expert[] { return Array.from(this.experts.values()); }
  getActiveExperts(): Expert[] { return Array.from(this.activeExperts).map(id => this.experts.get(id)!).filter(Boolean); }
  getRouter(): CoreMoERouter { return this.router; }
  getExpertCount(): number { return this.experts.size; }
}
