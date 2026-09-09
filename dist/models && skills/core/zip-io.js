/**
 * NeuroClaw - Infinite Zip I/O Loop
 *
 * Implements Section 1.10: Zip I/O Loop (Context & Output)
 * "The AI takes inputs as zips and emits outputs as zips, both running as loops.
 * When space runs out, it starts again at the beginning until everything is consumed."
 *
 * Features:
 * - Circular buffer logic (Head/Tail pointers)
 * - Compression ("Zipping") of context data
 * - Infinite looping overwrite strategy
 * - Supports massive context (theoretical 200,000 GB via streaming)
 */
import { createGzip, createGunzip } from 'zlib';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DoorwayLock } from './doorway-lock.js';
export class InfiniteZipLoop {
    constructor(capacity = 10000, useDiskSpill = true, checkpointInterval = 500, diskSpillPath) {
        this.head = 0; // Next write position
        this.tail = 0; // Next read position (oldest valid)
        this.size = 0; // Current number of items
        this.diskSpillPath = '';
        this.writesSinceCheckpoint = 0;
        this.capacity = capacity;
        this.buffer = new Array(capacity).fill(null);
        this.checkpointInterval = checkpointInterval;
        if (useDiskSpill) {
            this.diskSpillPath = diskSpillPath ?? join(tmpdir(), `prometheus-zip-${randomUUID()}.json`);
        }
    }
    /**
     * "Zip" an input: Compresses data and injects it into the circular loop.
     * If full, overwrites the oldest data (tail), moving the tail forward.
     */
    async zipInput(data) {
        const rawData = Buffer.isBuffer(data) ? data : Buffer.from(data);
        // Compress (Zip)
        const compressed = await this.compressBuffer(rawData);
        const chunk = {
            id: randomUUID(),
            timestamp: Date.now(),
            data: compressed,
            originalSize: rawData.length,
            compressedSize: compressed.length,
        };
        // Circular Write Logic
        if (this.size === this.capacity) {
            // Buffer full: Overwrite oldest (tail), move tail forward
            console.log(`[ZipLoop] Capacity reached. Overwriting oldest context at index ${this.tail}.`);
            this.tail = (this.tail + 1) % this.capacity;
        }
        else {
            this.size++;
        }
        this.buffer[this.head] = chunk;
        this.head = (this.head + 1) % this.capacity;
        this.writesSinceCheckpoint++;
        if (this.diskSpillPath && this.writesSinceCheckpoint >= this.checkpointInterval) {
            this.writesSinceCheckpoint = 0;
            // Fire-and-forget: a failed checkpoint should never block ingestion,
            // the ring buffer itself is still the live source of truth.
            this.snapshotToDisk().catch(err => {
                console.error(`[ZipLoop] Checkpoint failed: ${err.message}`);
            });
        }
        return chunk;
    }
    /**
     * Serialize the current window (oldest to newest, already-compressed
     * chunks) to disk so it survives past the ring buffer's live window /
     * process lifetime. Called automatically every `checkpointInterval`
     * writes, and can be called directly for an on-demand snapshot.
     */
    async snapshotToDisk(filePath) {
        const path = filePath ?? this.diskSpillPath;
        if (!path)
            throw new Error('No disk spill path configured for this loop');
        const chunks = [];
        for (let count = 0; count < this.size; count++) {
            const physicalIndex = (this.tail + count) % this.capacity;
            const chunk = this.buffer[physicalIndex];
            if (chunk) {
                chunks.push({
                    id: chunk.id,
                    timestamp: chunk.timestamp,
                    data: chunk.data.toString('base64'),
                    originalSize: chunk.originalSize,
                    compressedSize: chunk.compressedSize,
                });
            }
        }
        await mkdir(join(path, '..'), { recursive: true });
        await writeFile(path, JSON.stringify({ capacity: this.capacity, chunks }), 'utf-8');
        return path;
    }
    /**
     * Reload a previously snapshotted window from disk, replacing the current
     * in-memory buffer. Chunks are replayed oldest-to-newest, preserving loop
     * order; if the snapshot's capacity differs the buffer is resized to fit.
     */
    async loadFromDisk(filePath) {
        const path = filePath ?? this.diskSpillPath;
        if (!path)
            throw new Error('No disk spill path configured for this loop');
        const raw = await readFile(path, 'utf-8');
        const parsed = JSON.parse(raw);
        this.capacity = Math.max(parsed.capacity, parsed.chunks.length);
        this.buffer = new Array(this.capacity).fill(null);
        this.head = 0;
        this.tail = 0;
        this.size = 0;
        for (const c of parsed.chunks) {
            const chunk = {
                id: c.id,
                timestamp: c.timestamp,
                data: Buffer.from(c.data, 'base64'),
                originalSize: c.originalSize,
                compressedSize: c.compressedSize,
            };
            this.buffer[this.head] = chunk;
            this.head = (this.head + 1) % this.capacity;
            this.size++;
        }
    }
    /** Whether this loop has a disk checkpoint available to restore from. */
    getDiskSpillPath() {
        return this.diskSpillPath;
    }
    /**
     * Unzip and retrieve a specific chunk by index (logical index, not physical).
     * Handles the circular wrap-around math.
     */
    async unzipAt(logicalIndex) {
        if (logicalIndex < 0 || logicalIndex >= this.size) {
            return null;
        }
        // Calculate physical index considering the tail offset
        const physicalIndex = (this.tail + logicalIndex) % this.capacity;
        const chunk = this.buffer[physicalIndex];
        if (!chunk)
            return null;
        const decompressed = await this.decompressBuffer(chunk.data);
        return decompressed.toString();
    }
    /**
     * Iterate through the entire current context loop.
     * Starts from oldest (tail) to newest (head-1).
     * "When space runs out, it starts again at the beginning..."
     */
    async *iterateContext() {
        let count = 0;
        while (count < this.size) {
            const physicalIndex = (this.tail + count) % this.capacity;
            const chunk = this.buffer[physicalIndex];
            if (chunk) {
                const content = await this.decompressBuffer(chunk.data);
                yield content.toString();
            }
            count++;
        }
    }
    /**
     * Get the total uncompressed size of the current context window. Walks
     * `size` logical slots from `tail`, the same tail/head-agnostic pattern
     * `unzipAt()`/`iterateContext()`/`snapshotToDisk()` already use — a
     * head/tail-range comparison (the previous implementation) is ambiguous
     * exactly when the loop is full: `tail === head` then, same as when it's
     * empty, so a direct `tail <= head` comparison silently reported the
     * full-buffer case as containing nothing.
     */
    getTotalContextSize() {
        let total = 0;
        for (let count = 0; count < this.size; count++) {
            const physicalIndex = (this.tail + count) % this.capacity;
            const chunk = this.buffer[physicalIndex];
            if (chunk)
                total += chunk.originalSize;
        }
        return total;
    }
    async compressBuffer(buf) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            const gzip = createGzip({ level: 9 }); // Max compression for "Zip"
            gzip.on('data', chunk => chunks.push(chunk));
            gzip.on('end', () => resolve(Buffer.concat(chunks)));
            gzip.on('error', reject);
            gzip.write(buf);
            gzip.end();
        });
    }
    async decompressBuffer(buf) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            const gunzip = createGunzip();
            gunzip.on('data', chunk => chunks.push(chunk));
            gunzip.on('end', () => resolve(Buffer.concat(chunks)));
            gunzip.on('error', reject);
            gunzip.write(buf);
            gunzip.end();
        });
    }
    /**
     * Reset the loop (Clear all context)
     */
    reset() {
        this.buffer.fill(null);
        this.head = 0;
        this.tail = 0;
        this.size = 0;
    }
}
/**
 * Dual Loop System: One for Input Context, One for Output Generation
 */
export class ZipIOSystem {
    constructor(contextSize = 50000, persistDir, checkpointInterval = 500) {
        this.persistDir = persistDir ?? null;
        // Input loop holds the context history
        this.inputLoop = new InfiniteZipLoop(contextSize, true, checkpointInterval, this.persistDir ? join(this.persistDir, 'input-loop.json') : undefined);
        // Output loop holds the generated response stream
        this.outputLoop = new InfiniteZipLoop(Math.floor(contextSize / 2), true, checkpointInterval, this.persistDir ? join(this.persistDir, 'output-loop.json') : undefined);
    }
    /** Snapshot both loops to disk immediately (in addition to their automatic periodic checkpoints). */
    async persist() {
        await Promise.all([this.inputLoop.snapshotToDisk(), this.outputLoop.snapshotToDisk()]);
    }
    /**
     * Reload both loops from their last disk checkpoint, restoring context
     * beyond the ring buffer's live in-memory window (e.g. after a restart).
     * No-ops per loop if no checkpoint file exists yet.
     */
    async restore() {
        await Promise.all([
            this.inputLoop.loadFromDisk().catch(() => undefined),
            this.outputLoop.loadFromDisk().catch(() => undefined),
        ]);
    }
    async ingest(input) {
        await this.inputLoop.zipInput(input);
    }
    async emit(output) {
        await this.outputLoop.zipInput(output);
    }
    async *getFullContext() {
        yield* this.inputLoop.iterateContext();
    }
    async *getGeneratedHistory() {
        yield* this.outputLoop.iterateContext();
    }
}
/**
 * Put everything said through the REAL Zip Loop, packed as a file.
 *
 * ZipIOSystem above is a compressed ring buffer of text -- it is the working
 * context, and it is what "zip loop" means everywhere in this file up to this
 * point. It is NOT the doorway into the mesh. The doorway is
 * ZipLoopInterface: two input neurons meaning 1 and 0, one settle per bit.
 * Text going into the ring buffer never touched a neuron.
 *
 * This closes that. A prompt is packed into an archive -- an actual file,
 * gzipped, exactly the form /api/zip-loop/run streams -- and the bytes go
 * through the doorway, so what the network is asked is something it hears
 * bit by bit rather than a string appended to a buffer beside it.
 *
 * ── Why this never blocks the caller ────────────────────────────────────
 *
 * Measured on the live mesh at 336 neurons x 64 dimensions: 1192 ms per
 * input byte. The two-character prompt "hi" packs to 51 bytes, so feeding it
 * synchronously would take about a minute, and the settle loop is
 * synchronous -- it would take the whole server with it. That exact failure
 * has already happened once here: learning on every bit put 522 seconds
 * between a question arriving and the network finishing hearing it, and
 * health checks got nothing while it ran.
 *
 * So feed() returns immediately and the streaming happens between
 * macrotasks, one byte at a time, with a yield after each. The answer the
 * user gets does not wait for the mesh; the mesh hears the prompt regardless.
 *
 * ── Why the queue is one deep ───────────────────────────────────────────
 *
 * Prompts arrive faster than 1192 ms/byte can absorb them, so an unbounded
 * queue is a memory leak with extra steps -- it would fall further behind
 * forever and eventually be feeding the network questions from an hour ago.
 * One slot, newest wins: whatever was waiting is dropped for whatever just
 * arrived, and dropped() counts it so falling behind is visible rather than
 * silent.
 */
export class PromptMeshFeed {
    /**
     * @param doorway  How to get a doorway into the current mesh, or null when
     *                 there is no engine yet. Called per feed rather than held,
     *                 because the engine is built lazily and can grow neurons.
     * @param yieldTo  How to give the event loop a turn between bytes.
     *                 Injectable so a test can run it to completion without
     *                 waiting in real time.
     * @param lock     Shared with any other caller of the same engine's
     *                 doorway. Defaults to a fresh, private lock so existing
     *                 callers that only ever touch one engine through this one
     *                 feed keep working unchanged.
     */
    constructor(doorway, yieldTo = () => new Promise(r => setImmediate(r)), lock = new DoorwayLock()) {
        this.doorway = doorway;
        this.yieldTo = yieldTo;
        this.running = false;
        this.pending = null;
        this.fedCount = 0;
        this.droppedCount = 0;
        this.bytesFed = 0;
        this.lastError = null;
        this.doorwayLock = lock;
    }
    /** The lock guarding this feed's doorway, to share with another caller of the same engine. */
    lock() {
        return this.doorwayLock;
    }
    /** Prompts streamed into the mesh in full. */
    fed() { return this.fedCount; }
    /** Prompts dropped because a newer one arrived while the feed was busy. */
    dropped() { return this.droppedCount; }
    /** Total archive bytes that have gone through the doorway. */
    bytes() { return this.bytesFed; }
    /** Whatever went wrong last, or null. A feed that fails must not be silent. */
    error() { return this.lastError; }
    /** Whether a feed is in flight right now. */
    busy() { return this.running; }
    /**
     * Pack `text` as a file and stream it into the mesh. Returns at once.
     *
     * Never throws: a prompt failing to reach the mesh is not a reason to fail
     * the message it came from. It is recorded in error() instead.
     */
    feed(text, label = "prompt.txt") {
        void this.feedNow(text, label).catch(() => undefined);
    }
    /**
     * The same, awaitable, so a test can assert on what actually went in
     * rather than on a timer.
     */
    async feedNow(text, label = "prompt.txt") {
        const started = Date.now();
        if (this.running) {
            // Newest wins. Whatever was waiting never happened.
            if (this.pending)
                this.droppedCount++;
            this.pending = { text, label };
            return { bytes: 0, superseded: true, ms: Date.now() - started };
        }
        this.running = true;
        let bytes = 0;
        try {
            let job = { text, label };
            while (job) {
                bytes += await this.streamOne(job.text, job.label);
                job = this.pending;
                this.pending = null;
            }
        }
        finally {
            this.running = false;
        }
        return { bytes, superseded: false, ms: Date.now() - started };
    }
    async streamOne(text, label) {
        const door = this.doorway();
        if (!door) {
            // No engine yet. Not an error -- the network is built lazily and a
            // prompt arriving before it exists is ordinary.
            return 0;
        }
        const { packZip } = await import("./zip-halt.js");
        const packed = packZip({ files: { [label]: text } });
        // Held for the whole stream, not just the final learnFromEvent(): a
        // predict/learn call landing mid-stream would settle() the same engine
        // this loop is still driving, which is exactly the interleaving the lock
        // exists to rule out.
        return this.doorwayLock.run(async () => {
            try {
                for (const byte of packed) {
                    door.sendByte(byte);
                    // One byte is eight settles. Yielding per byte rather than per bit
                    // keeps the cost of yielding off the hot path while still giving the
                    // server a turn roughly every ten seconds of mesh work.
                    await this.yieldTo();
                }
                // The whole message has arrived: THIS is the event the elastic core
                // learns from, which is why it is one call here and not one per byte.
                door.learnFromEvent();
                this.fedCount++;
                this.bytesFed += packed.length;
                this.lastError = null;
                return packed.length;
            }
            catch (err) {
                this.lastError = err instanceof Error ? err.message : String(err);
                return 0;
            }
        });
    }
}
