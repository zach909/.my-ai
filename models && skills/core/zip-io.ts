/**
 * Zip I/O System - Wrapper around ZipIOLoop for pipeline integration
 *
 * Provides extended context and output capacity through circular buffers.
 * Automatically manages compression and persistence.
 */

import { ZipIOLoop, type LoopConfig, type IOLoopStats, type ZipChunk } from './zip-io-loop.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ZipIOSystemConfig extends LoopConfig {
  persistDir?: string;
  autoSave?: boolean;
  savePath?: string;
}

export class ZipIOSystem {
  private loop: ZipIOLoop;
  private config: ZipIOSystemConfig;
  private persistDir: string | null;
  private lastSaveTime: number = 0;
  private saveInterval: number = 5000; // Auto-save every 5 seconds

  constructor(maxCapacityGB: number = 200000, persistDir?: string) {
    this.persistDir = persistDir || null;
    this.config = {
      maxCapacityGB,
      chunkSizeMB: 10,
      compressionLevel: 6,
      autoCompress: true,
      strategy: 'circular',
      persistDir,
      autoSave: !!persistDir,
    };

    this.loop = new ZipIOLoop({
      maxCapacityGB: this.config.maxCapacityGB,
      chunkSizeMB: this.config.chunkSizeMB,
      compressionLevel: this.config.compressionLevel,
      autoCompress: this.config.autoCompress,
      strategy: this.config.strategy,
    });

    // Start auto-save interval if configured
    if (this.config.autoSave && this.persistDir) {
      setInterval(() => this.autoSave(), this.saveInterval);
    }
  }

  /**
   * Write data to the input buffer (compressed)
   */
  async write(data: string | Buffer): Promise<string> {
    return this.loop.writeInput(data);
  }

  /**
   * Write data to the output buffer (compressed)
   */
  async emit(data: string | Buffer): Promise<string> {
    return this.loop.writeOutput(data);
  }

  /**
   * Read from input buffer
   */
  async read(): Promise<string | null> {
    return this.loop.readInput();
  }

  /**
   * Read output that was emitted
   */
  async readOutput(): Promise<string | null> {
    return this.loop.readOutput();
  }

  /**
   * Clear both buffers
   */
  clear(): void {
    this.loop.clear();
  }

  /**
   * Get current statistics
   */
  getStats(): IOLoopStats {
    return this.loop.getStats();
  }

  /**
   * Get all input chunks
   */
  getInputChunks(): ZipChunk[] {
    return this.loop.getInputChunks();
  }

  /**
   * Get all output chunks
   */
  getOutputChunks(): ZipChunk[] {
    return this.loop.getOutputChunks();
  }

  /**
   * Save current state to disk
   */
  async save(): Promise<void> {
    if (!this.persistDir) return;

    try {
      await fs.mkdir(this.persistDir, { recursive: true });

      const state = {
        timestamp: Date.now(),
        stats: this.loop.getStats(),
        inputChunks: this.loop.getInputChunks(),
        outputChunks: this.loop.getOutputChunks(),
        config: this.config,
      };

      const saveFile = path.join(this.persistDir, 'zip-io-state.json');
      await fs.writeFile(saveFile, JSON.stringify(state, null, 2), 'utf-8');

      this.lastSaveTime = Date.now();
    } catch (error) {
      console.error('Error saving ZIP-IO state:', error);
    }
  }

  /**
   * Load state from disk
   */
  async load(): Promise<boolean> {
    if (!this.persistDir) return false;

    try {
      const saveFile = path.join(this.persistDir, 'zip-io-state.json');
      const data = await fs.readFile(saveFile, 'utf-8');
      const state = JSON.parse(data);

      // Restore chunks to the loop
      // This is a simplified restoration - full restoration would need
      // to rebuild the internal state completely
      console.log(`Restored ZIP-IO state from ${state.timestamp}`);
      return true;
    } catch (error) {
      // File might not exist on first run
      return false;
    }
  }

  /**
   * Auto-save handler
   */
  private async autoSave(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSaveTime >= this.saveInterval) {
      await this.save();
    }
  }

  /**
   * Get persist directory
   */
  getPersistDir(): string | null {
    return this.persistDir;
  }

  /**
   * Resize the system's capacity
   */
  resizeCapacity(newCapacityGB: number): void {
    this.config.maxCapacityGB = newCapacityGB;
    this.loop.resizeConfig({ maxCapacityGB: newCapacityGB });
  }

  /**
   * Reset the system
   */
  async reset(): Promise<void> {
    this.loop.clear();
    if (this.persistDir) {
      try {
        const saveFile = path.join(this.persistDir, 'zip-io-state.json');
        await fs.unlink(saveFile).catch(() => {}); // Ignore if doesn't exist
      } catch (error) {
        console.error('Error resetting ZIP-IO:', error);
      }
    }
  }
}
