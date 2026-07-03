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
export interface ZipChunk {
    id: string;
    timestamp: number;
    data: Buffer;
    originalSize: number;
    compressedSize: number;
}
export declare class InfiniteZipLoop {
    private capacity;
    private buffer;
    private head;
    private tail;
    private size;
    private diskSpillPath;
    constructor(capacity?: number, useDiskSpill?: boolean);
    /**
     * "Zip" an input: Compresses data and injects it into the circular loop.
     * If full, overwrites the oldest data (tail), moving the tail forward.
     */
    zipInput(data: string | Buffer): Promise<ZipChunk>;
    /**
     * Unzip and retrieve a specific chunk by index (logical index, not physical).
     * Handles the circular wrap-around math.
     */
    unzipAt(logicalIndex: number): Promise<string | null>;
    /**
     * Iterate through the entire current context loop.
     * Starts from oldest (tail) to newest (head-1).
     * "When space runs out, it starts again at the beginning..."
     */
    iterateContext(): AsyncGenerator<string, void, unknown>;
    /**
     * Get the total uncompressed size of the current context window.
     */
    getTotalContextSize(): number;
    /**
     * Helper to check if a physical index is within the valid logical range.
     */
    private isValidChunk;
    private compressBuffer;
    private decompressBuffer;
    /**
     * Reset the loop (Clear all context)
     */
    reset(): void;
}
/**
 * Dual Loop System: One for Input Context, One for Output Generation
 */
export declare class ZipIOSystem {
    inputLoop: InfiniteZipLoop;
    outputLoop: InfiniteZipLoop;
    constructor(contextSize?: number);
    ingest(input: string): Promise<void>;
    emit(output: string): Promise<void>;
    getFullContext(): AsyncGenerator<string>;
    getGeneratedHistory(): AsyncGenerator<string>;
}
