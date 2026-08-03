/**
 * Net Search (Spec Section 22).
 *
 * A search system over the project's *neural structures* (neurons, their
 * definitions, connections and flags), distinct from the project-scoped
 * substring search in the extension-builder. It implements the four search
 * kinds the spec names and keeps them clearly separated:
 *
 *   - exact       — substring / token-exact match on name or definition.
 *   - semantic    — bag-of-words cosine over name+definition tokens.
 *   - neural      — dense hashed embeddings PLUS a *learned* query→structure
 *                   association table, so the engine can retrieve a structure
 *                   for a query that shares no literal tokens with it.
 *   - structural  — graph queries over connectivity/flags
 *                   (`connects:NAME`, `flag:FLAG`, `degree:>N`, or a seed name
 *                   whose neighbourhood is returned).
 *
 * NeuroLang binds a search to a corpus through `"netsearch"@net="location"`.
 * "location" names the structure collection the search network operates over;
 * the reserved values `"self"` / `"mesh"` mean "the current NeuroLang neuron
 * map" (see NeuroLangInterpreter.netSearch). Any other value names an external
 * index to be registered via `registerCorpus(location, structures)` — the
 * interface for loading a network from elsewhere without external APIs.
 */
export class NetSearchEngine {
    constructor(dim = 64) {
        this.index = new Map();
        /** Learned associations for neural mode: token → (structure name → weight). */
        this.assoc = new Map();
        /** Named external corpora bound via `"netsearch"@net="location"`. */
        this.corpora = new Map();
        this.dim = dim;
    }
    addStructure(s) {
        this.index.set(s.name, s);
    }
    addMany(list) {
        for (const s of list)
            this.addStructure(s);
    }
    clear() {
        this.index.clear();
    }
    size() {
        return this.index.size;
    }
    /** Register an external corpus that a `@net="location"` can load. */
    registerCorpus(location, structures) {
        this.corpora.set(location, structures.slice());
    }
    loadCorpus(location) {
        const c = this.corpora.get(location);
        if (!c)
            return false;
        this.addMany(c);
        return true;
    }
    /**
     * Learn query→structure associations (neural mode). Each pair reinforces the
     * link between the query's tokens and the named structure.
     */
    train(pairs, rate = 1) {
        for (const { query, name } of pairs) {
            for (const t of tokenize(query)) {
                let row = this.assoc.get(t);
                if (!row) {
                    row = new Map();
                    this.assoc.set(t, row);
                }
                row.set(name, (row.get(name) ?? 0) + rate);
            }
        }
    }
    /**
     * Reverse search: given an output (a structure name already in the index),
     * return the query tokens most strongly associated with producing it --
     * the inverse of neuralSearch()'s query->structure direction. Reads the
     * same learned `assoc` table train() builds, just inverted.
     */
    reverseSearch(name, topK = 5) {
        const out = [];
        for (const [token, row] of this.assoc) {
            const w = row.get(name);
            if (w !== undefined && w > 0)
                out.push({ token, weight: w });
        }
        out.sort((a, b) => b.weight - a.weight);
        return out.slice(0, topK);
    }
    /** Dispatch a search by mode (default: semantic). */
    search(query, opts = {}) {
        const mode = opts.mode ?? "semantic";
        const topK = opts.topK ?? 5;
        let results;
        switch (mode) {
            case "exact":
                results = this.exactSearch(query);
                break;
            case "neural":
                results = this.neuralSearch(query);
                break;
            case "structural":
                results = this.structuralSearch(query);
                break;
            case "semantic":
            default:
                results = this.semanticSearch(query);
                break;
        }
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }
    // ── modes ────────────────────────────────────────────────────────────────
    exactSearch(query) {
        const q = query.toLowerCase().trim();
        if (!q)
            return [];
        const out = [];
        for (const s of this.index.values()) {
            if (s.name.toLowerCase().includes(q))
                out.push({ name: s.name, score: 1, mode: "exact", matchedOn: "name" });
            else if ((s.definition ?? "").toLowerCase().includes(q))
                out.push({ name: s.name, score: 0.8, mode: "exact", matchedOn: "definition" });
        }
        return out;
    }
    semanticSearch(query) {
        const q = tokenize(query);
        if (q.length === 0)
            return [];
        const out = [];
        for (const s of this.index.values()) {
            const text = tokenize(`${s.name} ${s.definition ?? ""}`);
            const score = cosineTokens(q, text);
            if (score > 0)
                out.push({ name: s.name, score, mode: "semantic", matchedOn: "name+definition" });
        }
        return out;
    }
    neuralSearch(query) {
        const q = tokenize(query);
        if (q.length === 0)
            return [];
        const qEmb = this.embed(q);
        const out = [];
        for (const s of this.index.values()) {
            const sEmb = this.embed(tokenize(`${s.name} ${s.definition ?? ""}`));
            const embSim = cosineVec(qEmb, sEmb);
            // Learned association boost: how strongly the query's tokens point here.
            let assocBoost = 0;
            for (const t of q)
                assocBoost += this.assoc.get(t)?.get(s.name) ?? 0;
            const score = 0.3 * embSim + assocBoost;
            if (score > 0)
                out.push({ name: s.name, score, mode: "neural", matchedOn: assocBoost > 0 ? "learned+embedding" : "embedding" });
        }
        return out;
    }
    structuralSearch(query) {
        const q = query.trim();
        const out = [];
        // connects:NAME — structures whose connections include NAME.
        let m = q.match(/^connects:\s*(.+)$/i);
        if (m) {
            const target = m[1].trim();
            for (const s of this.index.values()) {
                if ((s.connections ?? []).includes(target))
                    out.push({ name: s.name, score: 1, mode: "structural", matchedOn: `connects→${target}` });
            }
            return out;
        }
        // flag:FLAG — structures carrying a flag.
        m = q.match(/^flag:\s*(.+)$/i);
        if (m) {
            const flag = m[1].trim().toLowerCase();
            for (const s of this.index.values()) {
                if ((s.flags ?? []).some(f => f.toLowerCase() === flag))
                    out.push({ name: s.name, score: 1, mode: "structural", matchedOn: `flag:${flag}` });
            }
            return out;
        }
        // degree:>N / degree:>=N — by connection count.
        m = q.match(/^degree:\s*(>=|>|<=|<|=)?\s*(\d+)$/i);
        if (m) {
            const op = m[1] ?? ">=";
            const n = parseInt(m[2], 10);
            for (const s of this.index.values()) {
                const d = (s.connections ?? []).length;
                if (compare(d, op, n))
                    out.push({ name: s.name, score: d, mode: "structural", matchedOn: `degree ${op}${n} (=${d})` });
            }
            return out;
        }
        // Default: treat the query as a seed name and return its neighbourhood —
        // the seed plus everything it connects to and everything connecting to it.
        const seedTokens = tokenize(q);
        const seeds = Array.from(this.index.values()).filter(s => tokenize(s.name).some(t => seedTokens.includes(t)));
        const seedNames = new Set(seeds.map(s => s.name));
        for (const s of seeds)
            out.push({ name: s.name, score: 1, mode: "structural", matchedOn: "seed" });
        for (const s of this.index.values()) {
            if (seedNames.has(s.name))
                continue;
            const outgoing = (s.connections ?? []).some(c => seedNames.has(c));
            const incoming = seeds.some(seed => (seed.connections ?? []).includes(s.name));
            if (outgoing || incoming)
                out.push({ name: s.name, score: 0.5, mode: "structural", matchedOn: "neighbour" });
        }
        return out;
    }
    // ── helpers ────────────────────────────────────────────────────────────────
    /** Deterministic hashed bag-of-words embedding. */
    embed(tokens) {
        const v = new Float32Array(this.dim);
        for (const t of tokens) {
            let h = 2166136261;
            for (let i = 0; i < t.length; i++) {
                h ^= t.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
            const idx = (h >>> 0) % this.dim;
            const sign = (h & 1) === 0 ? 1 : -1;
            v[idx] += sign;
        }
        return v;
    }
}
function tokenize(text) {
    return (text || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
}
function cosineTokens(a, b) {
    if (a.length === 0 || b.length === 0)
        return 0;
    const setB = new Set(b);
    const seen = new Set();
    let overlap = 0;
    for (const t of a) {
        if (setB.has(t) && !seen.has(t)) {
            overlap++;
            seen.add(t);
        }
    }
    return overlap / Math.sqrt(new Set(a).size * new Set(b).size);
}
function cosineVec(a, b) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom > 0 ? dot / denom : 0;
}
function compare(x, op, n) {
    switch (op) {
        case ">": return x > n;
        case ">=": return x >= n;
        case "<": return x < n;
        case "<=": return x <= n;
        case "=": return x === n;
        default: return x >= n;
    }
}
