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
        const item = {
            id,
            content,
            embedding: this.embed(content),
            timestamp: now,
            importance: clamp01(opts.importance ?? 0.5),
            tags: opts.tags ?? [],
            accessCount: 0,
            lastAccess: now,
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
        const q = this.embed(query);
        const now = Date.now();
        const hits = [];
        for (const item of this.items.values()) {
            if (opts.tag && !item.tags.includes(opts.tag))
                continue;
            const similarity = cosine(q, item.embedding);
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
        for (const it of data.items)
            mem.items.set(it.id, it);
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
function tokenize(text) {
    return (text || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
}
function cosine(a, b) {
    const n = Math.min(a.length, b.length);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom > 0 ? dot / denom : 0;
}
