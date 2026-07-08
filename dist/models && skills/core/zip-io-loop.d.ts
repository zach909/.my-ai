/**
 * Zip I/O Loop Module
 *
 * Purpose: Extended context and output capacity through circular buffer system
 * Mechanism:
 *   - AI takes inputs as zips and emits outputs as zips
 *   - Both run as loops (circular buffers)
 *   - When space runs out, starts at beginning until everything is consumed
 * Why: AI can hold more context and produce more output
 * Example: The 200,000 GB worked with the model
 */
export interface ZipChunk {
    id: string;
    data: Buffer;
    timestamp: number;
    compressed: boolean;
    size: number;
}
export interface LoopConfig {
    maxCapacityGB: number;
    chunkSizeMB: number;
    compressionLevel: number;
    autoCompress: boolean;
    strategy: 'circular' | 'expandable' | 'sliding';
}
export interface IOLoopStats {
    totalChunks: number;
    usedCapacityGB: number;
    availableCapacityGB: number;
    compressionRatio: number;
    readCount: number;
    writeCount: number;
    loopCount: number;
}
export declare class ZipIOLoop {
    private config;
    private inputLoop;
    private outputLoop;
    private inputPosition;
    private outputPosition;
    private stats;
    private maxChunks;
    constructor(config?: Partial<LoopConfig>);
    /**
     * Write data to the input loop as a compressed zip chunk
     */
    writeInput(data: string | Buffer): Promise<string>;
    /**
     * Read data from the input loop, decompressing if needed
     */
    readInput(chunkId?: string): Promise<Buffer | null>;
    /**
     * Write data to the output loop as a compressed zip chunk
     */
    writeOutput(data: string | Buffer): Promise<string>;
    /**
     * Read data from the output loop, decompressing if needed
     */
    readOutput(chunkId?: string): Promise<Buffer | null>;
    /**
     * Read all chunks from input loop in sequence
     */
    readAllInput(): Promise<Buffer[]>;
    /**
     * Read all chunks from output loop in sequence
     */
    readAllOutput(): Promise<Buffer[]>;
    /**
     * Concatenate all input chunks into a single buffer
     */
    concatenateInput(): Promise<Buffer>;
    /**
     * Concatenate all output chunks into a single buffer
     */
    concatenateOutput(): Promise<Buffer>;
    /**
     * Decompress a chunk if it's compressed
     */
    private decompressChunk;
    /**
     * Update statistics
     */
    private updateStats;
    /**
     * Get current statistics
     */
    getStats(): IOLoopStats;
    /**
     * Clear all data from loops
     */
    clear(): void;
    /**
     * Reset read positions to beginning
     */
    resetReadPositions(): void;
    /**
     * Get chunk by ID from input loop
     */
    getInputChunk(chunkId: string): ZipChunk | undefined;
    /**
     * Get chunk by ID from output loop
     */
    getOutputChunk(chunkId: string): ZipChunk | undefined;
    /**
     * Get all chunk IDs from input loop
     */
    getInputChunkIds(): string[];
    /**
     * Get all chunk IDs from output loop
     */
    getOutputChunkIds(): string[];
    /**
     * Resize the loop configuration
     */
    resizeConfig(newConfig: Partial<LoopConfig>): void;
}
export declare const zipIOLoop: ZipIOLoop;
