/**
 * Net-skill routing: which skill regions of the ONE mesh are asked this tick.
 *
 * This replaces the Mixture-of-Experts router (MoERouter). That router was a
 * separate learned gate in front of the mesh: a randomly initialised
 * inputDim x numExperts matrix whose top-k scores picked "experts", each of
 * which also carried its own (lazily allocated) weight matrix. It was a second
 * network deciding for the first one, and the experts it picked were named
 * after skills without being scored by anything the skills actually meant.
 *
 * A net skill is a REGION of the mesh -- a named neuron group grafted in by
 * net-skill-graft.ts and tuned to what the skill means (embedText of its
 * definition). So routing is just asking which regions this input is about:
 * each region's meaning is embedded the same way the graft tuned its neurons,
 * scored by cosine against the input, and the best `topK` become the tick's
 * `activeGroups`. No second network, no random weights, and a region is
 * chosen for exactly the reason it exists.
 */
import { embedText } from "./neuro-lang.js";
/** Below this similarity a region is not about the input at all and is never selected. */
const MIN_SCORE = 0.05;
function cosine(a, b) {
    const n = Math.min(a.length, b.length);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < n; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
export class NetSkillRouter {
    constructor(topK = 2, dims = 64) {
        this.topK = topK;
        this.dims = dims;
        this.regions = new Map();
        /** Embedded meanings, per dimension count (inputs arrive at more than one size). */
        this.meaningVectors = new Map();
        this.usage = new Map();
        this.totalSelections = 0;
    }
    /** Add (or redescribe) a region. Returns how many regions there are. */
    register(region) {
        this.regions.set(region.id, region);
        for (const byId of this.meaningVectors.values())
            byId.delete(region.id);
        if (!this.usage.has(region.id))
            this.usage.set(region.id, 0);
        return this.regions.size;
    }
    unregister(id) {
        for (const byId of this.meaningVectors.values())
            byId.delete(id);
        this.usage.delete(id);
        return this.regions.delete(id);
    }
    has(id) { return this.regions.has(id); }
    getRegion(id) { return this.regions.get(id); }
    listRegions() { return Array.from(this.regions.values()); }
    getRegionCount() { return this.regions.size; }
    meaningVector(id, dims) {
        let byId = this.meaningVectors.get(dims);
        if (!byId) {
            byId = new Map();
            this.meaningVectors.set(dims, byId);
        }
        let vec = byId.get(id);
        if (!vec) {
            const r = this.regions.get(id);
            vec = embedText(`${r.name} ${r.meaning}`, dims);
            byId.set(id, vec);
        }
        return vec;
    }
    /** Every region's similarity to `input`, best first. Does not count as a selection. */
    score(input) {
        const vec = typeof input === "string" ? embedText(input, this.dims) : input;
        const dims = vec.length;
        return Array.from(this.regions.keys())
            .map((id) => ({ id, score: cosine(vec, this.meaningVector(id, dims)) }))
            .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    }
    /**
     * The regions to ask this tick: the `k` whose meaning is closest to the
     * input, excluding any that are not related to it at all. Empty when
     * nothing is -- the caller then runs the mesh ungated.
     */
    select(input, k = this.topK) {
        const chosen = this.score(input).filter((s) => s.score >= MIN_SCORE).slice(0, Math.max(0, k));
        const scores = new Map(chosen.map((s) => [s.id, s.score]));
        for (const { id } of chosen)
            this.usage.set(id, (this.usage.get(id) ?? 0) + 1);
        this.totalSelections += chosen.length;
        return { ids: chosen.map((s) => s.id), scores };
    }
    /** How often each region has been selected: the load-balance view the MoE used to report. */
    getUsage() {
        return Array.from(this.regions.values()).map((r) => {
            const selected = this.usage.get(r.id) ?? 0;
            return { id: r.id, name: r.name, selected, share: this.totalSelections ? selected / this.totalSelections : 0 };
        });
    }
}
