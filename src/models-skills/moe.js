import { MoERouter as CoreMoERouter } from './core/moe-router.js';
export { CoreMoERouter as MoERouter };
export class MixtureOfExperts {
    experts;
    activeExperts;
    topK;
    router;
    constructor(topK = 2) {
        this.experts = new Map();
        this.activeExperts = new Set();
        this.topK = topK;
        this.router = new CoreMoERouter({ numExperts: 4, topK, inputDim: 768, outputDim: 768, expertHiddenDim: 512 });
    }
    addExpert(id, name, specialization) {
        const expert = {
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
    getExpert(id) { return this.experts.get(id); }
    listExperts() { return Array.from(this.experts.values()); }
    getActiveExperts() { return Array.from(this.activeExperts).map(id => this.experts.get(id)).filter(Boolean); }
    getRouter() { return this.router; }
    getExpertCount() { return this.experts.size; }
}
