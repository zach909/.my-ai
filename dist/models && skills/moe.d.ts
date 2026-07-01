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
export declare class MixtureOfExperts {
    private experts;
    private activeExperts;
    private topK;
    private router;
    constructor(topK?: number);
    addExpert(id: string, name: string, specialization: string): Expert;
    getExpert(id: string): Expert | undefined;
    listExperts(): Expert[];
    getActiveExperts(): Expert[];
    getRouter(): CoreMoERouter;
    getExpertCount(): number;
}
