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
    private checkpointInterval;
    private writesSinceCheckpoint;
    constructor(capacity?: number, useDiskSpill?: boolean, checkpointInterval?: number, diskSpillPath?: string);
    /**
     * "Zip" an input: Compresses data and injects it into the circular loop.
     * If full, overwrites the oldest data (tail), moving the tail forward.
     */
    zipInput(data: string | Buffer): Promise<ZipChunk>;
    /**
     * Serialize the current window (oldest to newest, already-compressed
     * chunks) to disk so it survives past the ring buffer's live window /
     * process lifetime. Called automatically every `checkpointInterval`
     * writes, and can be called directly for an on-demand snapshot.
     */
    snapshotToDisk(filePath?: string): Promise<string>;
    /**
     * Reload a previously snapshotted window from disk, replacing the current
     * in-memory buffer. Chunks are replayed oldest-to-newest, preserving loop
     * order; if the snapshot's capacity differs the buffer is resized to fit.
     */
    loadFromDisk(filePath?: string): Promise<void>;
    /** Whether this loop has a disk checkpoint available to restore from. */
    getDiskSpillPath(): string;
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
    private persistDir;
    constructor(contextSize?: number, persistDir?: string, checkpointInterval?: number);
    /** Snapshot both loops to disk immediately (in addition to their automatic periodic checkpoints). */
    persist(): Promise<void>;
    /**
     * Reload both loops from their last disk checkpoint, restoring context
     * beyond the ring buffer's live in-memory window (e.g. after a restart).
     * No-ops per loop if no checkpoint file exists yet.
     */
    restore(): Promise<void>;
    ingest(input: string): Promise<void>;
    emit(output: string): Promise<void>;
    getFullContext(): AsyncGenerator<string>;
    getGeneratedHistory(): AsyncGenerator<string>;
}
