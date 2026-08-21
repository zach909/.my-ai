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
/**
 * A real, small feedforward network trained by actual backpropagation --
 * not a heuristic stand-in. Scores how well a query embedding matches a
 * structure embedding: input is their element-wise product (dim), one
 * ReLU hidden layer, one sigmoid output (a relevance score in [0,1]).
 * Every weight update below is a genuine gradient-descent step derived
 * from binary cross-entropy loss, computed and applied here, not faked.
 */
class RelevanceNet {
    constructor(dim, hiddenDim = 16, seed = 42) {
        /**
         * Strong negative prior: an untrained network must default to "no match"
         * (sigmoid(-4) ~= 0.018), not the ~0.5 a zero-initialized output bias
         * would give every input regardless of relevance. Real training on a
         * positive pair pushes this up for that pair specifically; it never
         * fabricates confidence for anything it hasn't actually seen evidence for.
         */
        this.b2 = -4;
        this.dim = dim;
        this.hiddenDim = hiddenDim;
        let s = seed >>> 0;
        // Deterministic PRNG (no Math.random dependency) so training is
        // reproducible run to run given the same pairs/order.
        const rand = () => {
            s = (Math.imul(s, 1103515245) + 12345) >>> 0;
            return (s / 0xffffffff) * 2 - 1;
        };
        this.w1 = new Float32Array(hiddenDim * dim);
        for (let i = 0; i < this.w1.length; i++)
            this.w1[i] = rand() * Math.sqrt(2 / dim);
        this.b1 = new Float32Array(hiddenDim);
        this.w2 = new Float32Array(hiddenDim);
        for (let i = 0; i < hiddenDim; i++)
            this.w2[i] = rand() * Math.sqrt(2 / hiddenDim);
        this.hScratch = new Float32Array(hiddenDim);
    }
    hiddenActivations(x) {
        const h = this.hScratch;
        for (let i = 0; i < this.hiddenDim; i++) {
            let sum = this.b1[i];
            const row = i * this.dim;
            for (let j = 0; j < this.dim; j++)
                sum += this.w1[row + j] * x[j];
            h[i] = Math.max(0, sum); // ReLU
        }
        return h;
    }
    /** Forward pass: real relevance score in [0,1]. Zero allocations. */
    score(x) {
        let z2 = this.b2;
        for (let i = 0; i < this.hiddenDim; i++) {
            let sum = this.b1[i];
            const row = i * this.dim;
            for (let j = 0; j < this.dim; j++)
                sum += this.w1[row + j] * x[j];
            if (sum > 0)
                z2 += this.w2[i] * sum; // ReLU inline
        }
        return 1 / (1 + Math.exp(-z2));
    }
    /**
     * BOLT OPTIMIZATION: Zero-allocation forward pass over element-wise vector product (a[j] * b[j]).
     * Completely bypasses allocating intermediate elementwise product arrays and hidden activation arrays.
     */
    scoreProduct(a, b) {
        let z2 = this.b2;
        for (let i = 0; i < this.hiddenDim; i++) {
            let sum = this.b1[i];
            const row = i * this.dim;
            for (let j = 0; j < this.dim; j++) {
                sum += this.w1[row + j] * (a[j] * b[j]);
            }
            if (sum > 0)
                z2 += this.w2[i] * sum; // ReLU inline
        }
        return 1 / (1 + Math.exp(-z2));
    }
    /** One real backprop step (binary cross-entropy loss) toward `target` for input `x`. */
    trainStep(x, target, lr = 0.05) {
        const h = this.hiddenActivations(x);
        let z2 = this.b2;
        for (let i = 0; i < this.hiddenDim; i++)
            z2 += this.w2[i] * h[i];
        const yPred = 1 / (1 + Math.exp(-z2));
        // d(BCE)/d(z2) simplifies to (yPred - target) for a sigmoid output.
        const dz2 = yPred - target;
        for (let i = 0; i < this.hiddenDim; i++)
            this.w2[i] -= lr * dz2 * h[i];
        this.b2 -= lr * dz2;
        for (let i = 0; i < this.hiddenDim; i++) {
            if (h[i] <= 0)
                continue; // ReLU gradient is 0 where the unit didn't fire
            const dh = dz2 * this.w2[i];
            const row = i * this.dim;
            for (let j = 0; j < this.dim; j++)
                this.w1[row + j] -= lr * dh * x[j];
            this.b1[i] -= lr * dh;
        }
    }
}
export class NetSearchEngine {
    constructor(dim = 64) {
        this.index = new Map();
        // BOLT OPTIMIZATION: Cache tokenized representations, sets, and embeddings to eliminate redundant string parsing and memory allocations on search.
        this.cached = new Map();
        /** Learned associations for neural mode: token → (structure name → weight). Also drives reverseSearch(). */
        this.assoc = new Map();
        /** Named external corpora bound via `"netsearch"@net="location"`. */
        this.corpora = new Map();
        this.dim = dim;
        this.relevanceNet = new RelevanceNet(dim);
    }
    addStructure(s) {
        this.index.set(s.name, s);
        const tokens = tokenize(`${s.name} ${s.definition ?? ""}`);
        const tokenSet = new Set(tokens);
        const embedding = this.embed(tokens);
        this.cached.set(s.name, {
            s,
            tokens,
            tokenSet,
            embedding,
            lowerName: s.name.toLowerCase(),
            lowerDef: (s.definition ?? "").toLowerCase(),
        });
    }
    addMany(list) {
        for (const s of list)
            this.addStructure(s);
    }
    clear() {
        this.index.clear();
        this.cached.clear();
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
     * Learn query→structure associations (neural mode): both the interpretable
     * token→structure co-occurrence table (used by reverseSearch()) AND real
     * gradient-descent training of `relevanceNet` on (query, structure)
     * pairs -- a positive example for the named structure, plus a couple of
     * negative examples sampled from whatever else is indexed, so the network
     * learns to discriminate rather than just drift toward "everything
     * matches". This is genuine backprop, not a heuristic stand-in.
     */
    train(pairs, rate = 1) {
        const lr = Math.min(0.2, Math.max(0.001, rate * 0.05));
        const allNames = Array.from(this.index.keys());
        for (const { query, name } of pairs) {
            const qTokens = tokenize(query);
            for (const t of qTokens) {
                let row = this.assoc.get(t);
                if (!row) {
                    row = new Map();
                    this.assoc.set(t, row);
                }
                row.set(name, (row.get(name) ?? 0) + rate);
            }
            const target = this.index.get(name);
            if (!target || qTokens.length === 0)
                continue;
            const qEmb = this.embed(qTokens);
            const posEmb = this.cached.get(name)?.embedding ?? this.embed(tokenize(`${target.name} ${target.definition ?? ""}`));
            this.relevanceNet.trainStep(elementwiseProduct(qEmb, posEmb), 1, lr);
            // Negative sampling: a couple of other indexed structures, if any exist.
            let sampled = 0;
            for (const otherName of allNames) {
                if (otherName === name)
                    continue;
                const other = this.index.get(otherName);
                if (!other)
                    continue;
                const negEmb = this.cached.get(otherName)?.embedding ?? this.embed(tokenize(`${other.name} ${other.definition ?? ""}`));
                this.relevanceNet.trainStep(elementwiseProduct(qEmb, negEmb), 0, lr);
                if (++sampled >= 2)
                    break;
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
        for (const item of this.cached.values()) {
            if (item.lowerName.includes(q))
                out.push({ name: item.s.name, score: 1, mode: "exact", matchedOn: "name" });
            else if (item.lowerDef.includes(q))
                out.push({ name: item.s.name, score: 0.8, mode: "exact", matchedOn: "definition" });
        }
        return out;
    }
    semanticSearch(query) {
        const q = tokenize(query);
        if (q.length === 0)
            return [];
        const qSet = new Set(q);
        const qNorm = Math.sqrt(qSet.size);
        const out = [];
        for (const item of this.cached.values()) {
            if (item.tokenSet.size === 0)
                continue;
            let overlap = 0;
            for (const t of qSet) {
                if (item.tokenSet.has(t))
                    overlap++;
            }
            const score = overlap / (qNorm * Math.sqrt(item.tokenSet.size));
            if (score > 0)
                out.push({ name: item.s.name, score, mode: "semantic", matchedOn: "name+definition" });
        }
        return out;
    }
    neuralSearch(query) {
        const q = tokenize(query);
        if (q.length === 0)
            return [];
        const qSet = new Set(q);
        const qNorm = Math.sqrt(qSet.size);
        const qEmb = this.embed(q);
        const out = [];
        for (const item of this.cached.values()) {
            // BOLT OPTIMIZATION: Zero-allocation cosine calculation using pre-cached token sets
            let overlap = 0;
            if (qNorm > 0 && item.tokenSet.size > 0) {
                for (const t of qSet) {
                    if (item.tokenSet.has(t))
                        overlap++;
                }
            }
            const embSim = (qNorm === 0 || item.tokenSet.size === 0) ? 0 : overlap / (qNorm * Math.sqrt(item.tokenSet.size));
            // BOLT OPTIMIZATION: Zero-allocation scoreProduct using pre-cached embeddings
            const trained = this.relevanceNet.scoreProduct(qEmb, item.embedding);
            let assocBoost = 0;
            for (const t of q)
                assocBoost += this.assoc.get(t)?.get(item.s.name) ?? 0;
            const score = 0.5 * embSim + 0.5 * trained + assocBoost;
            if (score > 0.05) {
                const matchedOn = assocBoost > 0 ? "trained+co-occurrence" : embSim > 0 ? "trained+embedding" : "trained";
                out.push({ name: item.s.name, score, mode: "neural", matchedOn });
            }
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
function elementwiseProduct(a, b) {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++)
        out[i] = a[i] * b[i];
    return out;
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
