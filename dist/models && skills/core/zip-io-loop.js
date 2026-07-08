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
import * as zlib from 'zlib';
import { promisify } from 'util';
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
export class ZipIOLoop {
    config;
    inputLoop;
    outputLoop;
    inputPosition;
    outputPosition;
    stats;
    maxChunks;
    constructor(config = {}) {
        this.config = {
            maxCapacityGB: config.maxCapacityGB ?? 200000, // 200,000 GB as specified
            chunkSizeMB: config.chunkSizeMB ?? 10,
            compressionLevel: config.compressionLevel ?? 6,
            autoCompress: config.autoCompress ?? true,
            strategy: config.strategy ?? 'circular',
        };
        // Calculate max chunks based on capacity
        const chunkSizeBytes = this.config.chunkSizeMB * 1024 * 1024;
        const maxCapacityBytes = this.config.maxCapacityGB * 1024 * 1024 * 1024;
        this.maxChunks = Math.floor(maxCapacityBytes / chunkSizeBytes);
        this.inputLoop = [];
        this.outputLoop = [];
        this.inputPosition = 0;
        this.outputPosition = 0;
        this.stats = {
            totalChunks: 0,
            usedCapacityGB: 0,
            availableCapacityGB: this.config.maxCapacityGB,
            compressionRatio: 1.0,
            readCount: 0,
            writeCount: 0,
            loopCount: 0,
        };
    }
    /**
     * Write data to the input loop as a compressed zip chunk
     */
    async writeInput(data) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const id = `input_${Date.now()}_${this.stats.writeCount}`;
        let compressedData;
        let compressed;
        if (this.config.autoCompress) {
            compressedData = await gzip(buffer, { level: this.config.compressionLevel });
            compressed = true;
        }
        else {
            compressedData = buffer;
            compressed = false;
        }
        const chunk = {
            id,
            data: compressedData,
            timestamp: Date.now(),
            compressed,
            size: compressedData.length,
        };
        // Add to loop based on strategy
        if (this.config.strategy === 'circular') {
            if (this.inputLoop.length >= this.maxChunks) {
                // Loop back to beginning
                this.inputLoop[this.inputPosition] = chunk;
                this.inputPosition = (this.inputPosition + 1) % this.maxChunks;
                this.stats.loopCount++;
            }
            else {
                this.inputLoop.push(chunk);
            }
        }
        else if (this.config.strategy === 'sliding') {
            this.inputLoop.push(chunk);
            if (this.inputLoop.length > this.maxChunks) {
                this.inputLoop.shift(); // Remove oldest
            }
        }
        else {
            // expandable - just add (will be limited by system memory)
            this.inputLoop.push(chunk);
        }
        this.stats.writeCount++;
        this.updateStats();
        return id;
    }
    /**
     * Read data from the input loop, decompressing if needed
     */
    async readInput(chunkId) {
        this.stats.readCount++;
        if (chunkId) {
            // Read specific chunk by ID
            const chunk = this.inputLoop.find(c => c.id === chunkId);
            if (!chunk)
                return null;
            return this.decompressChunk(chunk);
        }
        else {
            // Read current position
            if (this.inputLoop.length === 0)
                return null;
            const chunk = this.inputLoop[this.inputPosition];
            this.inputPosition = (this.inputPosition + 1) % this.inputLoop.length;
            return this.decompressChunk(chunk);
        }
    }
    /**
     * Write data to the output loop as a compressed zip chunk
     */
    async writeOutput(data) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const id = `output_${Date.now()}_${this.stats.writeCount}`;
        let compressedData;
        let compressed;
        if (this.config.autoCompress) {
            compressedData = await gzip(buffer, { level: this.config.compressionLevel });
            compressed = true;
        }
        else {
            compressedData = buffer;
            compressed = false;
        }
        const chunk = {
            id,
            data: compressedData,
            timestamp: Date.now(),
            compressed,
            size: compressedData.length,
        };
        // Add to loop based on strategy
        if (this.config.strategy === 'circular') {
            if (this.outputLoop.length >= this.maxChunks) {
                // Loop back to beginning
                this.outputLoop[this.outputPosition] = chunk;
                this.outputPosition = (this.outputPosition + 1) % this.maxChunks;
                this.stats.loopCount++;
            }
            else {
                this.outputLoop.push(chunk);
            }
        }
        else if (this.config.strategy === 'sliding') {
            this.outputLoop.push(chunk);
            if (this.outputLoop.length > this.maxChunks) {
                this.outputLoop.shift(); // Remove oldest
            }
        }
        else {
            // expandable
            this.outputLoop.push(chunk);
        }
        this.stats.writeCount++;
        this.updateStats();
        return id;
    }
    /**
     * Read data from the output loop, decompressing if needed
     */
    async readOutput(chunkId) {
        this.stats.readCount++;
        if (chunkId) {
            // Read specific chunk by ID
            const chunk = this.outputLoop.find(c => c.id === chunkId);
            if (!chunk)
                return null;
            return this.decompressChunk(chunk);
        }
        else {
            // Read current position
            if (this.outputLoop.length === 0)
                return null;
            const chunk = this.outputLoop[this.outputPosition];
            this.outputPosition = (this.outputPosition + 1) % this.outputLoop.length;
            return this.decompressChunk(chunk);
        }
    }
    /**
     * Read all chunks from input loop in sequence
     */
    async readAllInput() {
        const results = [];
        for (const chunk of this.inputLoop) {
            const data = await this.decompressChunk(chunk);
            if (data)
                results.push(data);
        }
        return results;
    }
    /**
     * Read all chunks from output loop in sequence
     */
    async readAllOutput() {
        const results = [];
        for (const chunk of this.outputLoop) {
            const data = await this.decompressChunk(chunk);
            if (data)
                results.push(data);
        }
        return results;
    }
    /**
     * Concatenate all input chunks into a single buffer
     */
    async concatenateInput() {
        const chunks = await this.readAllInput();
        return Buffer.concat(chunks);
    }
    /**
     * Concatenate all output chunks into a single buffer
     */
    async concatenateOutput() {
        const chunks = await this.readAllOutput();
        return Buffer.concat(chunks);
    }
    /**
     * Decompress a chunk if it's compressed
     */
    async decompressChunk(chunk) {
        if (chunk.compressed) {
            return await gunzip(chunk.data);
        }
        return chunk.data;
    }
    /**
     * Update statistics
     */
    updateStats() {
        const totalChunks = this.inputLoop.length + this.outputLoop.length;
        this.stats.totalChunks = totalChunks;
        const totalBytes = this.inputLoop.reduce((sum, c) => sum + c.size, 0) +
            this.outputLoop.reduce((sum, c) => sum + c.size, 0);
        this.stats.usedCapacityGB = totalBytes / (1024 * 1024 * 1024);
        this.stats.availableCapacityGB = Math.max(0, this.config.maxCapacityGB - this.stats.usedCapacityGB);
        // Calculate compression ratio
        const compressedChunks = [...this.inputLoop, ...this.outputLoop].filter(c => c.compressed);
        if (compressedChunks.length > 0) {
            const totalCompressed = compressedChunks.reduce((sum, c) => sum + c.size, 0);
            const totalUncompressed = totalCompressed; // Approximation - we'd need to track original sizes
            this.stats.compressionRatio = totalUncompressed / totalCompressed;
        }
    }
    /**
     * Get current statistics
     */
    getStats() {
        this.updateStats();
        return { ...this.stats };
    }
    /**
     * Clear all data from loops
     */
    clear() {
        this.inputLoop = [];
        this.outputLoop = [];
        this.inputPosition = 0;
        this.outputPosition = 0;
        this.stats = {
            totalChunks: 0,
            usedCapacityGB: 0,
            availableCapacityGB: this.config.maxCapacityGB,
            compressionRatio: 1.0,
            readCount: 0,
            writeCount: 0,
            loopCount: 0,
        };
    }
    /**
     * Reset read positions to beginning
     */
    resetReadPositions() {
        this.inputPosition = 0;
        this.outputPosition = 0;
    }
    /**
     * Get chunk by ID from input loop
     */
    getInputChunk(chunkId) {
        return this.inputLoop.find(c => c.id === chunkId);
    }
    /**
     * Get chunk by ID from output loop
     */
    getOutputChunk(chunkId) {
        return this.outputLoop.find(c => c.id === chunkId);
    }
    /**
     * Get all chunk IDs from input loop
     */
    getInputChunkIds() {
        return this.inputLoop.map(c => c.id);
    }
    /**
     * Get all chunk IDs from output loop
     */
    getOutputChunkIds() {
        return this.outputLoop.map(c => c.id);
    }
    /**
     * Resize the loop configuration
     */
    resizeConfig(newConfig) {
        const oldMaxChunks = this.maxChunks;
        this.config = { ...this.config, ...newConfig };
        const chunkSizeBytes = this.config.chunkSizeMB * 1024 * 1024;
        const maxCapacityBytes = this.config.maxCapacityGB * 1024 * 1024 * 1024;
        this.maxChunks = Math.floor(maxCapacityBytes / chunkSizeBytes);
        // If we reduced capacity, trim the loops
        if (this.maxChunks < oldMaxChunks) {
            if (this.inputLoop.length > this.maxChunks) {
                this.inputLoop = this.inputLoop.slice(-this.maxChunks);
            }
            if (this.outputLoop.length > this.maxChunks) {
                this.outputLoop = this.outputLoop.slice(-this.maxChunks);
            }
        }
        this.updateStats();
    }
}
// Export singleton instance for easy integration
export const zipIOLoop = new ZipIOLoop();
