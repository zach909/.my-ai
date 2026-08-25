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
        /** Cached sparse vector representations for stored memory items. */
        this.sparseMap = new Map();
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
        // Built, used, and dropped: the dense vector is a step on the way to the
        // sparse one, not something worth keeping 512 slots of when 13 are used.
        const sparse = embedSparseFromDense(this.embed(content));
        const item = {
            id,
            content,
            sparse: { indices: Array.from(sparse.indices), values: Array.from(sparse.values), norm: sparse.norm },
            timestamp: now,
            importance: clamp01(opts.importance ?? 0.5),
            tags: opts.tags ?? [],
            accessCount: 0,
            lastAccess: now,
            ...(opts.payload !== undefined ? { payload: opts.payload } : {}),
            ...(opts.pinned ? { pinned: true } : {}),
        };
        this.items.set(id, item);
        // Cache precomputed sparse vector for fast $O(\text{nonZeros})$ retrieval
        this.sparseMap.set(id, sparse);
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
        const qDense = this.embed(query);
        const qSparse = embedSparseFromDense(qDense);
        if (qSparse.norm === 0)
            return [];
        const now = Date.now();
        const hits = [];
        for (const item of this.items.values()) {
            if (opts.tag && !item.tags.includes(opts.tag))
                continue;
            let itemSparse = this.sparseMap.get(item.id);
            if (!itemSparse) {
                // Three sources, in order of preference: the item's own sparse form,
                // a legacy dense array from an older save, or -- failing both -- the
                // content re-embedded. The last is what makes a hand-edited or
                // partially-written save still searchable instead of silently
                // scoring zero against every query.
                itemSparse = sparseOf(item) ?? embedSparseFromDense(this.embed(item.content));
                this.sparseMap.set(item.id, itemSparse);
            }
            // Fast $O(\text{nonZeros})$ two-pointer sparse vector cosine similarity
            const similarity = cosineSparse(qSparse, itemSparse);
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
        this.sparseMap.delete(id);
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
            mem.items.set(it.id, it);
            // Warmed here rather than lazily in recall(): deserialize knows it is
            // about to hold every item, and rebuilding during the first search made
            // that one search pay for all of them.
            const sparse = sparseOf(it);
            if (sparse)
                mem.sparseMap.set(it.id, sparse);
        }
        return mem;
    }
    /**
     * Enforce capacity by removing the lowest-retention memories. Retention
     * combines importance, recency and how often the memory has been recalled —
     * so important, recent, frequently-used memories are preserved and stale,
     * unimportant ones are removed first.
     */
    /** Token-level hashed bag-of-words embedding: cosine reflects shared words. */
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
    evictIfNeeded() {
        if (this.items.size <= this.capacity)
            return;
        const now = Date.now();
        // Pinned memories are installed knowledge, not observations, so they
        // are never candidates. Capacity therefore bounds what the system
        // picked up on its own -- which is the thing that grows without limit
        // -- and never silently deletes something the user installed.
        const evictable = this.all().filter(item => !item.pinned);
        const ranked = evictable.map(item => {
            const recency = Math.exp(-(now - item.lastAccess) / (1000 * 60 * 60 * 24));
            const retention = item.importance * 0.6 + recency * 0.25 + Math.min(1, item.accessCount / 10) * 0.15;
            return { item, retention };
        });
        ranked.sort((a, b) => a.retention - b.retention);
        // Capped at what is actually evictable: when pinned items alone reach
        // capacity the store is allowed to exceed it rather than start
        // deleting them.
        const toRemove = Math.min(this.items.size - this.capacity, ranked.length);
        for (let i = 0; i < toRemove; i++) {
            const removeId = ranked[i].item.id;
            this.items.delete(removeId);
            this.sparseMap.delete(removeId);
        }
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
/**
 * The sparse vector for an item, from whichever representation it carries.
 * Returns null when it has neither, so the caller can decide what to do
 * rather than being handed a zero vector that silently matches nothing.
 */
function sparseOf(item) {
    if (item.sparse && Array.isArray(item.sparse.indices) && Array.isArray(item.sparse.values)) {
        return {
            indices: Int32Array.from(item.sparse.indices),
            values: Float32Array.from(item.sparse.values),
            norm: Number(item.sparse.norm) || 0,
        };
    }
    if (Array.isArray(item.embedding))
        return embedSparseFromDense(item.embedding);
    return null;
}
/**
 * Converts a dense bag-of-words embedding vector into a sorted sparse vector representation with precomputed L2 norm.
 */
function embedSparseFromDense(v) {
    let count = 0;
    let sumSq = 0;
    for (let i = 0; i < v.length; i++) {
        if (v[i] !== 0) {
            count++;
            sumSq += v[i] * v[i];
        }
    }
    const indices = new Int32Array(count);
    const values = new Float32Array(count);
    let pos = 0;
    for (let i = 0; i < v.length; i++) {
        if (v[i] !== 0) {
            indices[pos] = i;
            values[pos] = v[i];
            pos++;
        }
    }
    return { indices, values, norm: Math.sqrt(sumSq) };
}
/**
 * Computes cosine similarity between two sorted sparse vectors in $O(\text{nonZeros}_a + \text{nonZeros}_b)$ time
 * using a fast two-pointer intersection scan.
 */
function cosineSparse(a, b) {
    if (a.norm === 0 || b.norm === 0)
        return 0;
    let dot = 0;
    let i = 0;
    let j = 0;
    const aLen = a.indices.length;
    const bLen = b.indices.length;
    const aIdx = a.indices;
    const bIdx = b.indices;
    const aVal = a.values;
    const bVal = b.values;
    while (i < aLen && j < bLen) {
        const diff = aIdx[i] - bIdx[j];
        if (diff === 0) {
            dot += aVal[i] * bVal[j];
            i++;
            j++;
        }
        else if (diff < 0) {
            i++;
        }
        else {
            j++;
        }
    }
    const denom = a.norm * b.norm;
    return denom > 0 ? dot / denom : 0;
}
