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

export interface ZipChunk {
  id: string;
  timestamp: number;
  data: Buffer; // Compressed data
  originalSize: number;
  compressedSize: number;
}

export class InfiniteZipLoop {
  private capacity: number; // Max chunks before loop overwrite
  private buffer: (ZipChunk | null)[];
  private head: number = 0; // Next write position
  private tail: number = 0; // Next read position (oldest valid)
  private size: number = 0; // Current number of items
  private diskSpillPath: string = '';
  // Long-term persistence beyond the ring buffer's live window: every
  // `checkpointInterval` writes, the whole current window is snapshotted to
  // disk so it can be reloaded after the process restarts, independent of
  // whether any individual chunk has since been overwritten in-memory.
  private checkpointInterval: number;
  private writesSinceCheckpoint: number = 0;

  constructor(
    capacity: number = 10000,
    useDiskSpill: boolean = true,
    checkpointInterval: number = 500,
    diskSpillPath?: string
  ) {
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
  async zipInput(data: string | Buffer): Promise<ZipChunk> {
    const rawData = Buffer.isBuffer(data) ? data : Buffer.from(data);
    
    // Compress (Zip)
    const compressed = await this.compressBuffer(rawData);
    
    const chunk: ZipChunk = {
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
    } else {
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
        console.error(`[ZipLoop] Checkpoint failed: ${(err as Error).message}`);
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
  async snapshotToDisk(filePath?: string): Promise<string> {
    const path = filePath ?? this.diskSpillPath;
    if (!path) throw new Error('No disk spill path configured for this loop');

    const chunks: Array<{ id: string; timestamp: number; data: string; originalSize: number; compressedSize: number }> = [];
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
  async loadFromDisk(filePath?: string): Promise<void> {
    const path = filePath ?? this.diskSpillPath;
    if (!path) throw new Error('No disk spill path configured for this loop');

    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as {
      capacity: number;
      chunks: Array<{ id: string; timestamp: number; data: string; originalSize: number; compressedSize: number }>;
    };

    this.capacity = Math.max(parsed.capacity, parsed.chunks.length);
    this.buffer = new Array(this.capacity).fill(null);
    this.head = 0;
    this.tail = 0;
    this.size = 0;

    for (const c of parsed.chunks) {
      const chunk: ZipChunk = {
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
  getDiskSpillPath(): string {
    return this.diskSpillPath;
  }

  /**
   * Unzip and retrieve a specific chunk by index (logical index, not physical).
   * Handles the circular wrap-around math.
   */
  async unzipAt(logicalIndex: number): Promise<string | null> {
    if (logicalIndex < 0 || logicalIndex >= this.size) {
      return null;
    }

    // Calculate physical index considering the tail offset
    const physicalIndex = (this.tail + logicalIndex) % this.capacity;
    const chunk = this.buffer[physicalIndex];

    if (!chunk) return null;

    const decompressed = await this.decompressBuffer(chunk.data);
    return decompressed.toString();
  }

  /**
   * Iterate through the entire current context loop.
   * Starts from oldest (tail) to newest (head-1).
   * "When space runs out, it starts again at the beginning..."
   */
  async *iterateContext(): AsyncGenerator<string, void, unknown> {
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
  getTotalContextSize(): number {
    let total = 0;
    for (let count = 0; count < this.size; count++) {
      const physicalIndex = (this.tail + count) % this.capacity;
      const chunk = this.buffer[physicalIndex];
      if (chunk) total += chunk.originalSize;
    }
    return total;
  }

  private async compressBuffer(buf: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const gzip = createGzip({ level: 9 }); // Max compression for "Zip"
      
      gzip.on('data', chunk => chunks.push(chunk));
      gzip.on('end', () => resolve(Buffer.concat(chunks)));
      gzip.on('error', reject);
      
      gzip.write(buf);
      gzip.end();
    });
  }

  private async decompressBuffer(buf: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
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
  public inputLoop: InfiniteZipLoop;
  public outputLoop: InfiniteZipLoop;
  private persistDir: string | null;

  constructor(contextSize: number = 50000, persistDir?: string, checkpointInterval: number = 500) {
    this.persistDir = persistDir ?? null;
    // Input loop holds the context history
    this.inputLoop = new InfiniteZipLoop(
      contextSize,
      true,
      checkpointInterval,
      this.persistDir ? join(this.persistDir, 'input-loop.json') : undefined,
    );
    // Output loop holds the generated response stream
    this.outputLoop = new InfiniteZipLoop(
      Math.floor(contextSize / 2),
      true,
      checkpointInterval,
      this.persistDir ? join(this.persistDir, 'output-loop.json') : undefined,
    );
  }

  /** Snapshot both loops to disk immediately (in addition to their automatic periodic checkpoints). */
  async persist(): Promise<void> {
    await Promise.all([this.inputLoop.snapshotToDisk(), this.outputLoop.snapshotToDisk()]);
  }

  /**
   * Reload both loops from their last disk checkpoint, restoring context
   * beyond the ring buffer's live in-memory window (e.g. after a restart).
   * No-ops per loop if no checkpoint file exists yet.
   */
  async restore(): Promise<void> {
    await Promise.all([
      this.inputLoop.loadFromDisk().catch(() => undefined),
      this.outputLoop.loadFromDisk().catch(() => undefined),
    ]);
  }

  async ingest(input: string): Promise<void> {
    await this.inputLoop.zipInput(input);
  }

  async emit(output: string): Promise<void> {
    await this.outputLoop.zipInput(output);
  }

  async *getFullContext(): AsyncGenerator<string> {
    yield* this.inputLoop.iterateContext();
  }

  async *getGeneratedHistory(): AsyncGenerator<string> {
    yield* this.outputLoop.iterateContext();
  }
}
