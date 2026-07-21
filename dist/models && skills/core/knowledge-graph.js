/**
 * Knowledge Integration (ASI §4).
 *
 * Long-term memory stores *episodes* (conversation turns, task results) keyed by
 * relevance. This is the complementary *semantic* structure the spec asks for:
 * memory as an interconnected knowledge graph — concepts (nodes) joined by typed
 * relations (edges) — that the system can search by meaning, follow along
 * relationships, combine across nodes, and check for contradictions.
 *
 * Deterministic and local: concept embeddings are token bag-of-words (cosine
 * search), relations are explicit typed edges, and contradiction detection uses
 * a small set of negation pairs.
 */
/** Relation types that assert the opposite of one another (for contradictions). */
const NEGATION_PAIRS = [
    ["is", "is-not"],
    ["can", "cannot"],
    ["causes", "prevents"],
    ["true", "false"],
    ["increases", "decreases"],
    ["requires", "excludes"],
];
export class KnowledgeGraph {
    constructor(dim = 256) {
        this.concepts = new Map();
        this.relations = [];
        this.dim = dim;
    }
    /** Add or update a concept (keyed by normalized name). */
    addConcept(name, definition = "") {
        const id = normalize(name);
        const existing = this.concepts.get(id);
        if (existing) {
            if (definition) {
                existing.definition = definition;
                existing.embedding = this.embed(`${name} ${definition}`);
            }
            return existing;
        }
        const concept = { id, name, definition, embedding: this.embed(`${name} ${definition}`), createdAt: Date.now() };
        this.concepts.set(id, concept);
        return concept;
    }
    getConcept(name) {
        return this.concepts.get(normalize(name));
    }
    conceptCount() {
        return this.concepts.size;
    }
    /** Assert a typed relation between two concepts (creating them if needed). */
    relate(from, type, to, opts = {}) {
        this.addConcept(from);
        this.addConcept(to);
        const rel = {
            from: normalize(from),
            type: normalize(type),
            to: normalize(to),
            weight: opts.weight ?? 1,
            confidence: opts.confidence ?? 1,
        };
        this.relations.push(rel);
        return rel;
    }
    /** Immediate neighbours of a concept, optionally filtered by relation type. */
    neighbors(name, relType) {
        const id = normalize(name);
        const rt = relType ? normalize(relType) : undefined;
        const out = [];
        for (const r of this.relations) {
            if (r.from === id && (!rt || r.type === rt)) {
                const c = this.concepts.get(r.to);
                if (c)
                    out.push({ relation: r, concept: c });
            }
        }
        return out;
    }
    /**
     * Follow relations outward from a concept up to `depth` hops (optionally only
     * along the given relation types) — combining information across the graph.
     */
    follow(name, relTypes = [], depth = 2) {
        const rts = new Set(relTypes.map(normalize));
        const start = normalize(name);
        const visited = new Set([start]);
        let frontier = [start];
        const reached = [];
        for (let d = 0; d < depth; d++) {
            const next = [];
            for (const node of frontier) {
                for (const r of this.relations) {
                    if (r.from !== node)
                        continue;
                    if (rts.size > 0 && !rts.has(r.type))
                        continue;
                    if (!visited.has(r.to)) {
                        visited.add(r.to);
                        const c = this.concepts.get(r.to);
                        if (c) {
                            reached.push(c);
                            next.push(r.to);
                        }
                    }
                }
            }
            frontier = next;
            if (frontier.length === 0)
                break;
        }
        return reached;
    }
    /** Semantic search over concepts (cosine on name+definition embeddings). */
    search(query, topK = 5) {
        const q = this.embed(query);
        const hits = [];
        for (const c of this.concepts.values()) {
            const score = cosine(q, c.embedding);
            if (score > 0)
                hits.push({ concept: c, score });
        }
        hits.sort((a, b) => b.score - a.score);
        return hits.slice(0, topK);
    }
    /**
     * Detect contradictions: the same (from,to) pair asserted with a relation and
     * its negation (e.g. `A is B` and `A is-not B`).
     */
    findContradictions() {
        const negOf = new Map();
        for (const [x, y] of NEGATION_PAIRS) {
            negOf.set(x, y);
            negOf.set(y, x);
        }
        const out = [];
        for (let i = 0; i < this.relations.length; i++) {
            const a = this.relations[i];
            const opp = negOf.get(a.type);
            if (!opp)
                continue;
            for (let j = i + 1; j < this.relations.length; j++) {
                const b = this.relations[j];
                if (b.from === a.from && b.to === a.to && b.type === opp)
                    out.push({ a, b });
            }
        }
        return out;
    }
    /**
     * Auto-link a concept to its semantically nearest existing concepts (above a
     * similarity floor) with a `related-to` edge — so new knowledge attaches to
     * related existing knowledge instead of sitting isolated.
     */
    integrate(name, definition = "", opts = {}) {
        const concept = this.addConcept(name, definition);
        const topK = opts.topK ?? 3;
        const minScore = opts.minScore ?? 0.15;
        const added = [];
        for (const hit of this.search(`${name} ${definition}`, topK + 1)) {
            if (hit.concept.id === concept.id)
                continue;
            if (hit.score < minScore)
                continue;
            added.push(this.relate(name, "related-to", hit.concept.name, { weight: Number(hit.score.toFixed(3)) }));
            if (added.length >= topK)
                break;
        }
        return added;
    }
    embed(text) {
        const v = new Array(this.dim).fill(0);
        for (const t of tokenize(text)) {
            let h = 2166136261;
            for (let i = 0; i < t.length; i++) {
                h ^= t.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
            const idx = (h >>> 0) % this.dim;
            v[idx] += (h & 1) === 0 ? 1 : -1;
        }
        return v;
    }
}
function normalize(text) {
    return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}
function tokenize(text) {
    return (text || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
}
function cosine(a, b) {
    const n = Math.min(a.length, b.length);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < n; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom > 0 ? dot / denom : 0;
}
