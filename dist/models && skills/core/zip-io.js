/**
 * Prometheus Elastic Core - Infinite Zip I/O Loop
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
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
export class InfiniteZipLoop {
    capacity; // Max chunks before loop overwrite
    buffer;
    head = 0; // Next write position
    tail = 0; // Next read position (oldest valid)
    size = 0; // Current number of items
    diskSpillPath = '';
    constructor(capacity = 10000, useDiskSpill = true) {
        this.capacity = capacity;
        this.buffer = new Array(capacity).fill(null);
        if (useDiskSpill) {
            this.diskSpillPath = join(tmpdir(), `prometheus-zip-${randomUUID()}`);
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
        return chunk;
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
     * Get the total uncompressed size of the current context window.
     */
    getTotalContextSize() {
        let total = 0;
        for (let i = 0; i < this.capacity; i++) {
            const chunk = this.buffer[i];
            if (chunk && this.isValidChunk(i)) {
                total += chunk.originalSize;
            }
        }
        return total;
    }
    /**
     * Helper to check if a physical index is within the valid logical range.
     */
    isValidChunk(physicalIndex) {
        if (this.size === 0)
            return false;
        // Handle wrap-around cases
        if (this.tail <= this.head) {
            // Normal case: [tail, head)
            return physicalIndex >= this.tail && physicalIndex < this.head;
        }
        else {
            // Wrapped case: [tail, capacity) U [0, head)
            return physicalIndex >= this.tail || physicalIndex < this.head;
        }
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
    inputLoop;
    outputLoop;
    constructor(contextSize = 50000) {
        // Input loop holds the context history
        this.inputLoop = new InfiniteZipLoop(contextSize);
        // Output loop holds the generated response stream
        this.outputLoop = new InfiniteZipLoop(contextSize / 2);
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
