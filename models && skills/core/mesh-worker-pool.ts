/**
 * Node-only multi-core backend for NeuronMesh's dense propagate() fast
 * path (see ParallelMeshBackend in onebrain.ts). Uses node:worker_threads
 * with SharedArrayBuffer-backed activation/weight arrays and a hand-rolled
 * Atomics barrier, so a single computeDenseRows() call blocks the calling
 * thread only until every worker has finished its row range -- letting
 * NeuronMesh.propagate() stay fully synchronous while the actual
 * arithmetic runs on multiple OS threads.
 *
 * Deliberately NOT imported by onebrain.ts itself: that file is bundled
 * for the browser too (see its own header comment about node:fs/node:os
 * having broken client bundling here before), and node:worker_threads is
 * a Node built-in that would do the same if statically imported there.
 * A caller that knows it's running in Node constructs a MeshWorkerPool
 * and wires it in via `mesh.setParallelBackend(pool)` /
 * `await mesh.prepareParallel()`.
 */

import { Worker } from 'node:worker_threads';
import * as os from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ParallelMeshBackend } from './onebrain.js';

/**
 * The compiled sibling (`mesh-worker-thread.js`, built by tsconfig.backend.json
 * into dist/) when it exists -- the production case. Falls back to the
 * `.ts` source sibling otherwise: running this file straight from source
 * (vitest importing onebrain.ts/mesh-worker-pool.ts directly, or `tsx`)
 * has no compiled `.js` next to it, and Node's worker_threads.Worker can
 * load a `.ts` entry point directly (Node 22+'s built-in TypeScript
 * support strips types for both the main thread and worker threads).
 */
function resolveWorkerEntry(): string {
  const compiled = fileURLToPath(new URL('./mesh-worker-thread.js', import.meta.url));
  if (existsSync(compiled)) return compiled;
  return fileURLToPath(new URL('./mesh-worker-thread.ts', import.meta.url));
}
const WORKER_ENTRY = resolveWorkerEntry();

// Control array layout (Int32Array over a SharedArrayBuffer). Must match
// mesh-worker-thread.ts's copy of the same layout.
const CTRL_GENERATION = 0;
const CTRL_ACTIVATION = 1;
const CTRL_ROLE = 2; // 0: curr is bufferA/next is bufferB. 1: swapped.
const CTRL_DONE_BASE = 3;

// See the matching constant/comment in mesh-worker-thread.ts: a bounded
// wait that self-heals on a missed notify, rather than an indefinite one.
const POLL_TIMEOUT_MS = 2;

const ACTIVATION_CODES: Record<'relu' | 'tanh' | 'sigmoid' | 'swish', number> = {
  relu: 0,
  tanh: 1,
  sigmoid: 2,
  swish: 3,
};

interface Attachment {
  n: number;
  weightsBuffer: SharedArrayBuffer;
  bufferA: SharedArrayBuffer;
  bufferB: SharedArrayBuffer;
  control: Int32Array;
  residual: Float64Array;
}

export class MeshWorkerPool implements ParallelMeshBackend {
  private readonly numWorkers: number;
  private workers: Worker[] = [];
  private attachment: Attachment | null = null;
  private generation = 0;
  private terminated = false;

  /**
   * @param numWorkers Defaults to `os.cpus().length - 1` (reserving one
   *   core for the event loop/main thread's own work), clamped to at
   *   least 1 so a single/dual-core box still gets a working pool.
   */
  constructor(numWorkers?: number) {
    this.numWorkers = Math.max(1, numWorkers ?? Math.max(1, os.cpus().length - 1));
  }

  async prepare(params: {
    n: number;
    weightsBuffer: SharedArrayBuffer;
    biasesBuffer: SharedArrayBuffer;
    bufferA: SharedArrayBuffer;
    bufferB: SharedArrayBuffer;
  }): Promise<void> {
    if (this.terminated) throw new Error('MeshWorkerPool: prepare() called after terminate()');

    // Re-attaching (the mesh resized, or this pool is being reused by a
    // second mesh) tears down the previous generation of worker threads
    // rather than trying to update them in place. This only happens when
    // the mesh's node count actually changes, not once per tick, so
    // simplicity wins over reusing the OS threads across generations.
    if (this.workers.length > 0) this.terminateWorkers();

    const numWorkers = Math.min(this.numWorkers, Math.max(1, params.n));
    const control = new Int32Array(new SharedArrayBuffer((CTRL_DONE_BASE + numWorkers) * Int32Array.BYTES_PER_ELEMENT));
    // One Float64 slot per ROW, not per worker -- see the matching
    // comment in mesh-worker-thread.ts for why a per-worker partial-sum
    // grouping isn't safe to use here.
    const residual = new Float64Array(new SharedArrayBuffer(params.n * Float64Array.BYTES_PER_ELEMENT));

    const shardSize = Math.ceil(params.n / numWorkers);
    const readyPromises: Promise<void>[] = [];

    for (let i = 0; i < numWorkers; i++) {
      const rowStart = i * shardSize;
      const rowEnd = Math.min(params.n, rowStart + shardSize);
      const worker = new Worker(WORKER_ENTRY);
      this.workers.push(worker);

      readyPromises.push(new Promise<void>((resolve, reject) => {
        const onMessage = (msg: { type?: string }) => {
          if (msg && msg.type === 'attached') {
            worker.off('message', onMessage);
            worker.off('error', onError);
            resolve();
          }
        };
        const onError = (err: Error) => {
          worker.off('message', onMessage);
          reject(err);
        };
        worker.on('message', onMessage);
        worker.once('error', onError);
      }));

      worker.postMessage({
        type: 'attach',
        n: params.n,
        weightsBuffer: params.weightsBuffer,
        biasesBuffer: params.biasesBuffer,
        bufferA: params.bufferA,
        bufferB: params.bufferB,
        // Send the raw SharedArrayBuffers, not the Int32Array/Float64Array
        // *views* over them -- `new Int32Array(someTypedArray)` on the
        // receiving end copies values into a fresh, unshared buffer
        // instead of viewing the original memory, which would silently
        // break the Atomics barrier (each side would signal on its own
        // private copy). mesh-worker-thread.ts reconstructs the views
        // from these buffers itself.
        control: control.buffer,
        residual: residual.buffer,
        workerIndex: i,
        rowStart,
        rowEnd,
      });
    }

    await Promise.all(readyPromises);

    this.attachment = { n: params.n, weightsBuffer: params.weightsBuffer, bufferA: params.bufferA, bufferB: params.bufferB, control, residual };
    this.generation = 0;
  }

  isReady(n: number, weightsBuffer: SharedArrayBuffer, bufferA: SharedArrayBuffer, bufferB: SharedArrayBuffer): boolean {
    const a = this.attachment;
    return !!a
      && !this.terminated
      && a.n === n
      && a.weightsBuffer === weightsBuffer
      && a.bufferA === bufferA
      && a.bufferB === bufferB;
  }

  computeDenseRows(
    curr: Float32Array,
    _weights: Float32Array,
    _biases: Float32Array,
    next: Float32Array,
    activation: 'relu' | 'tanh' | 'sigmoid' | 'swish',
  ): number {
    const a = this.attachment;
    if (!a) throw new Error('MeshWorkerPool.computeDenseRows called before a successful prepare()');

    const role = curr.buffer === a.bufferA ? 0 : 1;
    const expectedCurr = role === 0 ? a.bufferA : a.bufferB;
    const expectedNext = role === 0 ? a.bufferB : a.bufferA;
    if (curr.buffer !== expectedCurr || next.buffer !== expectedNext) {
      throw new Error('MeshWorkerPool.computeDenseRows: curr/next are not the buffers this pool was prepare()d with');
    }

    const { control, residual } = a;

    for (let i = 0; i < this.workers.length; i++) Atomics.store(control, CTRL_DONE_BASE + i, 0);
    Atomics.store(control, CTRL_ACTIVATION, ACTIVATION_CODES[activation]);
    Atomics.store(control, CTRL_ROLE, role);
    this.generation++;
    Atomics.store(control, CTRL_GENERATION, this.generation);
    Atomics.notify(control, CTRL_GENERATION, this.workers.length);

    // Short-timeout wait, not indefinite -- see the matching comment in
    // mesh-worker-thread.ts for why: an indefinite Atomics.wait/notify
    // pair on this exact protocol was found, empirically, to
    // intermittently miss a wakeup under real multi-worker contention.
    for (let i = 0; i < this.workers.length; i++) {
      while (Atomics.load(control, CTRL_DONE_BASE + i) === 0) {
        Atomics.wait(control, CTRL_DONE_BASE + i, 0, POLL_TIMEOUT_MS);
      }
    }

    // Row order 0..N-1, matching the serial loop's single running total --
    // see the comment on `residual`'s allocation above.
    let total = 0;
    for (let i = 0; i < residual.length; i++) total += residual[i];
    return total;
  }

  private terminateWorkers(): void {
    // worker.terminate() interrupts a worker even mid-Atomics.wait (V8
    // supports terminating a synchronously-blocked agent), so no separate
    // wake-then-terminate handshake is needed here.
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.attachment = null;
  }

  /** Terminate every worker thread. Safe to call more than once. The pool
   *  cannot be prepare()'d again afterward -- construct a new one. */
  terminate(): void {
    this.terminateWorkers();
    this.terminated = true;
  }
}
