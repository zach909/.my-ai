/**
 * Live content and pre-need content.
 *
 * LIVE: the mesh makes something faster than it is used. A film that takes four
 * minutes to make and runs five can be watched from the first second, because
 * the part being watched is always already made. If the mesh is slower than the
 * content plays, a short head start is worked out so playing never catches up
 * with what has been made.
 *
 * PRE-NEED: things the person is likely to want are made before they ask and
 * held aside. Preparing one changes nothing: it is only a copy waiting. It is
 * handed over when asked for, and thrown away if what it was made from has
 * since changed (the context version moved on).
 *
 * Nothing here makes content itself. A LiveSource is whatever the mesh puts out
 * (a doorway, usually) and a preparer is whatever function the caller gives.
 */
/**
 * How long to wait before starting to play, for content `totalSeconds` long that
 * is being made at `rate` content-seconds per second. If it is made at least as
 * fast as it plays there is nothing to wait for; otherwise play can start when
 * the remaining making time equals what is left to play.
 */
export function startDelay(totalSeconds, rate) {
    if (!(totalSeconds > 0))
        return 0;
    if (!(rate > 0))
        return Infinity;
    if (rate >= 1)
        return 0;
    return totalSeconds / rate - totalSeconds;
}
export class LiveStream {
    constructor(id, source, opts) {
        this.id = id;
        this.source = source;
        this.opts = opts;
        this.chunks = [];
        this.produced = 0;
        this.startedAt = 0;
        this.endedAt = null;
        this.done = false;
        this.error = null;
        this.stopped = false;
        this.running = null;
        if (!(opts.bytesPerSecond > 0))
            throw new Error("bytesPerSecond must be positive");
        this.now = opts.now ?? Date.now;
        this.yieldTo = opts.yieldTo ?? (() => new Promise(r => setImmediate(r)));
        this.maxBytes = opts.maxBytes ?? 256 * 1024 * 1024;
    }
    /** Begin making. Returns at once; call `finished()` to wait for the end. */
    start() {
        if (this.running)
            return;
        this.startedAt = this.now();
        this.running = this.pump();
    }
    finished() {
        return this.running ?? Promise.resolve();
    }
    stop() {
        this.stopped = true;
    }
    async pump() {
        try {
            while (!this.stopped) {
                const piece = await this.source.pull();
                if (piece === null)
                    break;
                if (piece.length > 0) {
                    this.chunks.push(piece);
                    this.produced += piece.length;
                    if (this.produced > this.maxBytes)
                        throw new Error("stream reached its size limit");
                }
                await this.yieldTo();
            }
        }
        catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
        }
        finally {
            this.done = true;
            this.endedAt = this.now();
        }
    }
    /** Everything made from `offset` on (up to `limit` bytes). Playing reads from here. */
    read(offset, limit = 1 << 20) {
        if (offset >= this.produced || limit <= 0)
            return new Uint8Array(0);
        const out = new Uint8Array(Math.min(limit, this.produced - offset));
        let skipped = 0, written = 0;
        for (const c of this.chunks) {
            if (written >= out.length)
                break;
            if (skipped + c.length <= offset) {
                skipped += c.length;
                continue;
            }
            const from = Math.max(0, offset - skipped);
            const take = Math.min(c.length - from, out.length - written);
            out.set(c.subarray(from, from + take), written);
            written += take;
            skipped += c.length;
        }
        return out;
    }
    status() {
        const end = this.endedAt ?? this.now();
        const elapsed = Math.max(0, (end - this.startedAt) / 1000);
        const producedSeconds = this.produced / this.opts.bytesPerSecond;
        const rate = elapsed > 0 ? producedSeconds / elapsed : 0;
        const total = this.opts.totalSeconds;
        let delay = null;
        if (this.done && !this.error)
            delay = 0;
        else if (total && elapsed > 0 && producedSeconds > 0)
            delay = Math.max(0, startDelay(total, rate) - elapsed);
        const playableNow = (this.done && !this.error && this.produced > 0) || (delay === 0 && this.produced > 0);
        return {
            id: this.id,
            producedBytes: this.produced,
            producedSeconds,
            elapsedSeconds: elapsed,
            rate,
            finished: this.done,
            failed: this.error,
            startDelaySeconds: delay,
            playableNow,
        };
    }
}
export const MAX_LIVE_STREAMS = 8;
/** The streams currently being made; the oldest finished one makes room for a new one. */
export class LiveStreams {
    constructor() {
        this.streams = new Map();
        this.counter = 0;
    }
    open(source, opts) {
        if (this.streams.size >= MAX_LIVE_STREAMS) {
            const old = [...this.streams.values()].find(s => s.status().finished);
            if (!old)
                throw new Error(`at most ${MAX_LIVE_STREAMS} live streams at once`);
            this.streams.delete(old.id);
        }
        const stream = new LiveStream(`live-${Date.now().toString(36)}-${++this.counter}`, source, opts);
        this.streams.set(stream.id, stream);
        stream.start();
        return stream;
    }
    get(id) {
        return this.streams.get(id) ?? null;
    }
    stop(id) {
        const s = this.streams.get(id);
        if (!s)
            return false;
        s.stop();
        this.streams.delete(id);
        return true;
    }
    list() {
        return [...this.streams.values()].map(s => s.status());
    }
}
/**
 * Prepared things held aside. `version` is the state of the conversation or
 * context they were made from; moving it on (`invalidate()`) makes everything
 * held stale, and stale things are never handed over.
 */
export class PreNeedCache {
    constructor(maxEntries = 64, ttlMs = 10 * 60000, now = Date.now) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
        this.now = now;
        this.held = new Map();
        this.inFlight = new Map();
        this.version = 0;
        this.hits = 0;
        this.misses = 0;
        this.discarded = 0;
    }
    k(kind, key) {
        return `${kind}\u0000${key}`;
    }
    /** The context changed: whatever was prepared for the old one is no longer right. */
    invalidate() {
        this.discarded += this.held.size;
        this.held.clear();
        return ++this.version;
    }
    /**
     * Prepare ahead. `make` must not change anything (no installing, no
     * learning, no writes); it only produces a copy. Safe to call again for the
     * same thing: a preparation already under way, or already held, is not repeated.
     */
    prepare(kind, key, make) {
        const id = this.k(kind, key);
        if (this.has(kind, key))
            return Promise.resolve();
        const running = this.inFlight.get(id);
        if (running)
            return running;
        const madeFor = this.version;
        const job = (async () => {
            try {
                const value = await make();
                if (madeFor !== this.version) {
                    this.discarded++;
                    return;
                } // the context moved while it was being made
                this.held.set(id, { value, version: madeFor, at: this.now() });
                while (this.held.size > this.maxEntries) {
                    const oldest = this.held.keys().next().value;
                    this.held.delete(oldest);
                    this.discarded++;
                }
            }
            catch {
                // A failed preparation is simply not there when asked; asking makes it the normal way.
            }
            finally {
                this.inFlight.delete(id);
            }
        })();
        this.inFlight.set(id, job);
        return job;
    }
    has(kind, key) {
        const h = this.held.get(this.k(kind, key));
        if (!h)
            return false;
        if (h.version !== this.version || this.now() - h.at > this.ttlMs) {
            this.held.delete(this.k(kind, key));
            this.discarded++;
            return false;
        }
        return true;
    }
    /** Hand over what was prepared, once. Undefined when nothing current is held. */
    take(kind, key) {
        if (!this.has(kind, key)) {
            this.misses++;
            return undefined;
        }
        const id = this.k(kind, key);
        const h = this.held.get(id);
        this.held.delete(id);
        this.hits++;
        return h.value;
    }
    stats() {
        return { held: this.held.size, version: this.version, hits: this.hits, misses: this.misses, discarded: this.discarded };
    }
}
