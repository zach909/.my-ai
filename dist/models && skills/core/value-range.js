export class ValueRangeAllocator {
    config;
    /** Map of neuron string-id → current value points */
    allocations;
    stepCount;
    constructor(config) {
        this.config = { ...config };
        this.allocations = new Map();
        this.stepCount = 0;
    }
    /**
     * Distribute totalPoints equally across all provided neurons.
     */
    initializeNeurons(neuronStates) {
        this.allocations.clear();
        if (neuronStates.length === 0)
            return;
        const pointsEach = this.config.totalPoints / neuronStates.length;
        for (const ns of neuronStates) {
            this.allocations.set(ns.id, pointsEach);
        }
    }
    /**
     * Zero-sum update: apply delta*0.1 to target neuron; redistribute
     * the opposite amount proportionally across all other neurons.
     */
    updateNeuronValue(id, delta) {
        if (this.allocations.size === 0)
            return;
        const current = this.allocations.get(id) ?? 0;
        const change = delta * 0.1;
        const newVal = Math.max(0, current + change);
        const actualChange = newVal - current;
        this.allocations.set(id, newVal);
        // Redistribute the opposite change across others
        const otherIds = Array.from(this.allocations.keys()).filter(k => k !== id);
        if (otherIds.length === 0)
            return;
        const oppositePerOther = -actualChange / otherIds.length;
        for (const otherId of otherIds) {
            const otherVal = this.allocations.get(otherId) ?? 0;
            this.allocations.set(otherId, Math.max(0, otherVal + oppositePerOther));
        }
        // Re-normalise to keep the sum exactly at totalPoints
        this._normalise();
    }
    /**
     * Decay step: runs every redistributionInterval steps internally.
     * Each call is one step; when count reaches interval, decay fires.
     */
    applyDecay() {
        this.stepCount++;
        if (this.stepCount % this.config.redistributionInterval !== 0)
            return;
        // Decay each neuron by decayFactor, pool the reclaimed points
        let reclaimed = 0;
        for (const [id, pts] of this.allocations) {
            const loss = pts * this.config.decayFactor;
            this.allocations.set(id, pts - loss);
            reclaimed += loss;
        }
        // Redistribute equally
        if (this.allocations.size > 0) {
            const share = reclaimed / this.allocations.size;
            for (const [id, pts] of this.allocations) {
                this.allocations.set(id, pts + share);
            }
        }
        this._normalise();
    }
    /**
     * Returns current distribution.
     * neuronAllocations shape matches NeuronAllocation interface.
     */
    getDistribution() {
        const neuronAllocations = [];
        for (const [id, pts] of this.allocations) {
            neuronAllocations.push({
                id,
                valuePoints: pts,
                learningRate: this._pointsToLearningRate(pts),
            });
        }
        return { totalPoints: this.config.totalPoints, neuronAllocations };
    }
    /**
     * Vale as a [0,1] fraction of totalPoints per neuron — the value consulted
     * by state-transition gating (new_state = vale*old_state + (1-vale)*computed),
     * as opposed to getDistribution()'s learningRate (which gates weight
     * plasticity). Both read the same underlying zero-sum points; a
     * high-points neuron is simultaneously slow to re-weight *and* resistant
     * to having its state overwritten this tick.
     */
    getValeFractions() {
        const fractions = new Map();
        const maxPts = this.config.totalPoints;
        for (const [id, pts] of this.allocations) {
            fractions.set(id, maxPts > 0 ? Math.min(1, Math.max(0, pts / maxPts)) : 0);
        }
        return fractions;
    }
    /**
     * Demotion: takes 50% of neuron's points and gives them to others equally.
     */
    demoteNeuron(id) {
        const current = this.allocations.get(id) ?? 0;
        const taken = current * 0.5;
        this.allocations.set(id, current - taken);
        const otherIds = Array.from(this.allocations.keys()).filter(k => k !== id);
        if (otherIds.length === 0)
            return;
        const share = taken / otherIds.length;
        for (const otherId of otherIds) {
            const val = this.allocations.get(otherId) ?? 0;
            this.allocations.set(otherId, val + share);
        }
        this._normalise();
    }
    /** Convert value points to learning rate via linear interpolation.
     * More points → minLearningRate (stable). Fewer points → maxLearningRate (plastic).
     */
    _pointsToLearningRate(pts) {
        const maxPts = this.config.totalPoints;
        if (maxPts <= 0)
            return this.config.maxLearningRate;
        // fraction ∈ [0,1] where 1 = all points (most stable)
        const fraction = Math.min(1, Math.max(0, pts / maxPts));
        return this.config.maxLearningRate + fraction * (this.config.minLearningRate - this.config.maxLearningRate);
    }
    /** Rescale all allocations so they sum exactly to totalPoints. */
    _normalise() {
        let total = 0;
        for (const pts of this.allocations.values())
            total += pts;
        if (total <= 0 || this.allocations.size === 0)
            return;
        const scale = this.config.totalPoints / total;
        for (const [id, pts] of this.allocations) {
            this.allocations.set(id, Math.max(0, pts * scale));
        }
    }
}
