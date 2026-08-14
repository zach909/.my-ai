/**
 * Long-Term Memory & Retrieval (Spec Section 7).
 *
 * Section 7 distinguishes several kinds of context and requires the system to
 * define how context is received, stored, updated, **retrieved**, compressed,
 * removed when necessary, and preserved when important. The existing
 * `ZipIOSystem` (core/zip-io.ts) covers *active working context* — a FIFO/
 * compressed ring buffer. It has no relevance-based retrieval.
 *
 * This module is the complementary piece: a persistent, content-addressed
 * **long-term memory** you retrieve by relevance, not recency. Each memory has
 * a token-level bag-of-words embedding (so cosine reflects shared vocabulary —
 * unlike the whole-string `embedText` fingerprint), a timestamp, and an
 * `importance` value in [0,1] that behaves like the neuron Value System (§3.1):
 * important
 * memories resist eviction, unimportant ones are removed first when capacity is
 * exceeded. Retrieval ranks by semantic similarity, then modulates by
 * importance and recency, and reinforces what it returns (accessed memories
 * become slightly more important — a light promotion signal).
 *
 * This is deliberately *not* the working buffer and *not* the temporary neuron
 * state — it is the "information intentionally retained for future use" the
 * spec calls out. No external APIs; embeddings and storage are local.
 */
export class LongTermMemory {
    constructor(opts) {
        this.items = new Map();
        this.seq = 0;
        // A large sparse dimension keeps hash collisions rare, so cosine tracks
        // real shared vocabulary rather than collision noise.
        this.dim = opts?.dim ?? 512;
        this.capacity = opts?.capacity ?? 2000;
    }
    size() {
        return this.items.size;
    }
    get(id) {
        return this.items.get(id);
    }
    all() {
        return Array.from(this.items.values());
    }
    /** Store a memory (encodes it, enforces capacity). Returns the stored item. */
    remember(content, opts = {}) {
        const id = opts.id ?? `mem-${Date.now()}-${++this.seq}`;
        const now = Date.now();
        const sparseEmbedding = this.embedSparse(content);
        const item = {
            id,
            content,
            embedding: this.sparseToDense(sparseEmbedding),
            sparseEmbedding,
        const denseEmb = this.embed(content);
        const item = {
            id,
            content,
            embedding: denseEmb,
            sparseEmbedding: toSparse(denseEmb),
            timestamp: now,
            importance: clamp01(opts.importance ?? 0.5),
            tags: opts.tags ?? [],
            accessCount: 0,
            lastAccess: now,
            ...(opts.payload !== undefined ? { payload: opts.payload } : {}),
        };
        this.items.set(id, item);
        this.evictIfNeeded();
        return item;
    }
    /**
     * Retrieve the most relevant memories for a query. Ranks by semantic
     * similarity, then boosts by importance and recency. Retrieved memories are
     * reinforced (accessCount++, importance nudged up) — the more a memory is
     * usefully recalled, the more it is protected.
     */
    retrieve(query, opts = {}) {
        const topK = opts.topK ?? 5;
        const iw = opts.importanceWeight ?? 0.3;
        const rw = opts.recencyWeight ?? 0.15;
        const minScore = opts.minScore ?? 0;
        const q = this.embedSparse(query);
        // OPTIMIZATION: Convert query embedding to sparse vector with pre-calculated norm
        const qSparse = toSparse(this.embed(query));
        const now = Date.now();
        const hits = [];
        for (const item of this.items.values()) {
            if (opts.tag && !item.tags.includes(opts.tag))
                continue;
            const itemSparse = item.sparseEmbedding ?? (item.sparseEmbedding = this.denseToSparse(item.embedding));
            const similarity = cosineSparse(q, itemSparse);
            if (!item.sparseEmbedding || !(item.sparseEmbedding.indices instanceof Int32Array)) {
                item.sparseEmbedding = toSparse(item.embedding);
            }
            // OPTIMIZATION: Use fast two-pointer dot product over sorted non-zero indices
            const similarity = cosineSparse(qSparse, item.sparseEmbedding);
            if (similarity <= 0)
                continue;
            // Recency in [0,1]: decays over ~1 day since last access.
            const ageMs = now - item.lastAccess;
            const recency = Math.exp(-ageMs / (1000 * 60 * 60 * 24));
            const score = similarity * (1 + iw * item.importance + rw * recency);
            if (score >= minScore)
                hits.push({ item, score, similarity });
        }
        hits.sort((a, b) => b.score - a.score);
        const top = hits.slice(0, topK);
        // Reinforce what we returned.
        for (const h of top) {
            h.item.accessCount++;
            h.item.lastAccess = now;
            h.item.importance = clamp01(h.item.importance + 0.02);
        }
        return top;
    }
    /**
     * Exact-match search: literal, case-insensitive substring matching against
     * stored content — distinct from `retrieve()`'s semantic similarity ranking
     * (Section 4/7 explicitly separates "search memory by meaning" from
     * "search memory by exact information"; only the former existed). Returns
     * every match (most recent first), not a top-K relevance ranking, since
     * exact search is about precision, not fuzzy relevance.
     */
    findExact(query) {
        const q = (query || "").toLowerCase().trim();
        if (!q)
            return [];
        return this.all()
            .filter(item => item.content.toLowerCase().includes(q))
            .sort((a, b) => b.timestamp - a.timestamp);
    }
    /** Explicit promotion/demotion of a memory's retention value. */
    reinforce(id, delta) {
        const item = this.items.get(id);
        if (item)
            item.importance = clamp01(item.importance + delta);
    }
    forget(id) {
        return this.items.delete(id);
    }
    /**
     * Consolidate working-context snippets (e.g. drained from the ZipIO buffer)
     * into long-term memory — the "preserved when important" transfer from
     * active context to durable memory.
     */
    consolidateFrom(texts, opts = {}) {
        return texts.filter(t => t && t.trim()).map(t => this.remember(t, opts));
    }
    serialize() {
        return JSON.stringify({ dim: this.dim, capacity: this.capacity, items: this.all() });
    }
    static deserialize(json) {
        const data = JSON.parse(json);
        const mem = new LongTermMemory({ dim: data.dim, capacity: data.capacity });
        for (const it of data.items) {
            if (it.sparseEmbedding) {
                const ind = it.sparseEmbedding.indices;
                const val = it.sparseEmbedding.values;
                it.sparseEmbedding = {
                    indices: ind instanceof Int32Array ? ind : new Int32Array(Object.values(ind)),
                    values: val instanceof Float32Array ? val : new Float32Array(Object.values(val)),
                    norm: it.sparseEmbedding.norm,
                };
            }
            else if (it.embedding) {
                it.sparseEmbedding = mem.denseToSparse(it.embedding);
            if (it.embedding) {
                it.sparseEmbedding = toSparse(it.embedding);
            }
            mem.items.set(it.id, it);
        }
        return mem;
    }
    /** Token-level hashed bag-of-words sparse embedding: cosine reflects shared words. */
    embedSparse(text) {
        const map = new Map();
        for (const t of tokenize(text)) {
            let h = 2166136261;
            for (let i = 0; i < t.length; i++) {
                h ^= t.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
            const idx = (h >>> 0) % this.dim;
            const val = (h & 1) === 0 ? 1 : -1;
            map.set(idx, (map.get(idx) || 0) + val);
        }
        const keys = Array.from(map.keys()).filter(k => map.get(k) !== 0).sort((a, b) => a - b);
        const len = keys.length;
        const indices = new Int32Array(len);
        const values = new Float32Array(len);
        let normSq = 0;
        for (let i = 0; i < len; i++) {
            const k = keys[i];
            const val = map.get(k);
            indices[i] = k;
            values[i] = val;
            normSq += val * val;
        }
        return { indices, values, norm: Math.sqrt(normSq) };
    }
    denseToSparse(dense) {
        const indices = [];
        const values = [];
        let normSq = 0;
        for (let i = 0; i < dense.length; i++) {
            const val = dense[i];
            if (val !== 0) {
                indices.push(i);
                values.push(val);
                normSq += val * val;
            }
        }
        return {
            indices: new Int32Array(indices),
            values: new Float32Array(values),
            norm: Math.sqrt(normSq),
        };
    }
    sparseToDense(sparse) {
        const v = new Array(this.dim).fill(0);
        for (let i = 0; i < sparse.indices.length; i++) {
            v[sparse.indices[i]] = sparse.values[i];
        }
        return v;
    }
    embed(text) {
        return this.sparseToDense(this.embedSparse(text));
    }
    evictIfNeeded() {
        if (this.items.size <= this.capacity)
            return;
        const now = Date.now();
        const ranked = this.all().map(item => {
            const recency = Math.exp(-(now - item.lastAccess) / (1000 * 60 * 60 * 24));
            const retention = item.importance * 0.6 + recency * 0.25 + Math.min(1, item.accessCount / 10) * 0.15;
            return { item, retention };
        });
        ranked.sort((a, b) => a.retention - b.retention);
        const toRemove = this.items.size - this.capacity;
        for (let i = 0; i < toRemove; i++)
            this.items.delete(ranked[i].item.id);
    }
}
function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}
/** Common function words that carry no retrieval signal. */
const STOPWORDS = new Set([
    "the", "and", "for", "are", "was", "were", "been", "being", "you", "your", "our", "their",
    "this", "that", "these", "those", "with", "from", "into", "than", "then", "they", "them",
    "did", "does", "done", "how", "what", "which", "who", "when", "where", "why", "can", "could",
    "should", "would", "will", "shall", "may", "might", "about", "over", "under", "just", "also",
    "not", "yes", "out", "off", "its", "his", "her", "him", "she", "have", "has", "had",
]);
function tokenize(text) {
    return (text || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(w => w.length > 1 && !STOPWORDS.has(w));
}
function cosineSparse(q, item) {
    if (q.norm === 0 || item.norm === 0)
/** Converts a dense vector into a sparse representation with non-zero indices and pre-calculated L2 norm. */
function toSparse(v) {
    let count = 0;
    for (let i = 0; i < v.length; i++) {
        if (v[i] !== 0)
            count++;
    }
    const indices = new Int32Array(count);
    const values = new Float32Array(count);
    let sqSum = 0;
    let idx = 0;
    for (let i = 0; i < v.length; i++) {
        const val = v[i];
        if (val !== 0) {
            indices[idx] = i;
            values[idx] = val;
            sqSum += val * val;
            idx++;
        }
    }
    return { indices, values, norm: Math.sqrt(sqSum) };
}
/** Computes cosine similarity between two sparse vectors using two-pointer sorted index matching. */
function cosineSparse(q, target) {
    if (q.norm === 0 || target.norm === 0)
        return 0;
    let dot = 0;
    let i = 0;
    let j = 0;
    const qInd = q.indices;
    const qVal = q.values;
    const itInd = item.indices;
    const itVal = item.values;
    const qLen = qInd.length;
    const itLen = itInd.length;
    while (i < qLen && j < itLen) {
        const qi = qInd[i];
        const itj = itInd[j];
        if (qi === itj) {
            dot += qVal[i] * itVal[j];
            i++;
            j++;
        }
        else if (qi < itj) {
    const tInd = target.indices;
    const tVal = target.values;
    const qLen = qInd.length;
    const tLen = tInd.length;
    while (i < qLen && j < tLen) {
        const qi = qInd[i];
        const tj = tInd[j];
        if (qi === tj) {
            dot += qVal[i] * tVal[j];
            i++;
            j++;
        }
        else if (qi < tj) {
            i++;
        }
        else {
            j++;
        }
    }
    return dot / (q.norm * item.norm);
    return dot / (q.norm * target.norm);
}
