/**
 * Worker-thread entry point for MeshWorkerPool (mesh-worker-pool.ts).
 *
 * Deliberately plain and self-contained: it does NOT import onebrain.ts
 * (whose dense-propagate loop is duplicated here, not shared) so a
 * worker's dependency surface and startup cost stay minimal -- this file
 * only needs the exact per-row kernel, not the whole mesh/quantization/
 * MoE surface onebrain.ts also exports.
 *
 * Protocol: the main thread (MeshWorkerPool) sends exactly one 'attach'
 * message carrying this worker's row range and the mesh's
 * SharedArrayBuffers, then signals every subsequent settle iteration via
 * Atomics on a small shared control array instead of further messages --
 * see the CTRL_* constants, which must stay in sync with
 * mesh-worker-pool.ts's copies of the same layout.
 */

import { parentPort } from 'node:worker_threads';

if (!parentPort) {
  throw new Error('mesh-worker-thread.ts must be run as a worker_threads Worker');
}

// Control array layout (Int32Array over a SharedArrayBuffer). Must match
// mesh-worker-pool.ts exactly.
const CTRL_GENERATION = 0;
const CTRL_ACTIVATION = 1;
const CTRL_ROLE = 2; // 0: curr is bufferA/next is bufferB. 1: swapped.
const CTRL_DONE_BASE = 3;

function activate(x: number, code: number): number {
  switch (code) {
    case 0: return x > 0 ? x : 0; // relu
    case 1: return Math.tanh(x);
    case 2: return 1 / (1 + Math.exp(-x)); // sigmoid
    case 3: return x / (1 + Math.exp(-x)); // swish
    default: return x > 0 ? x : 0;
  }
}

interface AttachMessage {
  type: 'attach';
  n: number;
  weightsBuffer: SharedArrayBuffer;
  biasesBuffer: SharedArrayBuffer;
  bufferA: SharedArrayBuffer;
  bufferB: SharedArrayBuffer;
  control: SharedArrayBuffer;
  residual: SharedArrayBuffer;
  workerIndex: number;
  rowStart: number;
  rowEnd: number;
}

parentPort.once('message', (msg: AttachMessage) => {
  if (!msg || msg.type !== 'attach') {
    throw new Error(`mesh-worker-thread: expected an 'attach' message first, got ${msg && (msg as { type?: string }).type}`);
  }

  const { n, rowStart, rowEnd, workerIndex } = msg;
  const weights = new Float32Array(msg.weightsBuffer);
  const biases = new Float32Array(msg.biasesBuffer);
  const viewA = new Float32Array(msg.bufferA);
  const viewB = new Float32Array(msg.bufferB);
  const control = new Int32Array(msg.control);
  const residual = new Float64Array(msg.residual);

  parentPort!.postMessage({ type: 'attached' });

  // Blocks this worker thread between ticks -- intentional: this thread
  // has nothing else to do. Uses a short-timeout Atomics.wait rather than
  // an indefinite one: an indefinite wait relies entirely on this worker's
  // matching Atomics.notify() call actually landing, and a from-scratch
  // stress test of this exact protocol (many workers, many generations)
  // found that assumption doesn't hold reliably in practice -- an
  // indefinite Atomics.wait()/notify() pair intermittently missed a
  // wakeup, leaving a worker computing against a stale curr[] for one
  // generation (confirmed by comparing worker output against an
  // independent same-inputs recomputation; replacing the wait with a
  // busy-spin on Atomics.load made the mismatch disappear across
  // thousands of calls, isolating it to wait/notify specifically rather
  // than the SharedArrayBuffer data-sharing itself). A short timeout
  // makes this self-healing instead of relying on that guarantee: on a
  // timeout this loop just re-checks and waits again, so a missed notify
  // costs at most one timeout's latency rather than a wrong answer.
  const POLL_TIMEOUT_MS = 2;
  let lastGen = 0;
  for (;;) {
    Atomics.wait(control, CTRL_GENERATION, lastGen, POLL_TIMEOUT_MS);
    const gen = Atomics.load(control, CTRL_GENERATION);
    if (gen === lastGen) continue; // timed out or spurious wake -- re-check
    if (gen === -1) break; // shutdown sentinel from MeshWorkerPool.terminate()
    lastGen = gen;

    const role = Atomics.load(control, CTRL_ROLE);
    const curr = role === 0 ? viewA : viewB;
    const next = role === 0 ? viewB : viewA;
    const activationCode = Atomics.load(control, CTRL_ACTIVATION);

    // Exactly the same arithmetic, in the exact same order, as
    // NeuronMesh.propagate()'s serial dense-layout loop in onebrain.ts --
    // same IEEE754 double ops in the same sequence produce bit-identical
    // results regardless of which thread runs them, so this row range's
    // output matches what the serial loop would have computed for it.
    //
    // `residual` is one Float64 slot per ROW (not one partial sum per
    // worker): floating-point addition is not associative, so summing
    // each worker's own chunk first and then combining those partial
    // sums -- a different grouping than the serial loop's single running
    // total over rows 0..N-1 -- can differ from the serial residual in
    // the last bit. That's normally harmless, but a last-bit difference
    // can occasionally flip which side of `residual < convergenceThreshold`
    // an iteration lands on, letting one path stop one iteration before
    // the other and permanently diverge from there. Writing every row's
    // own |diff| into its own slot lets the caller (MeshWorkerPool)
    // re-sum them in the exact same row order the serial loop uses,
    // closing that gap.
    for (let i = rowStart; i < rowEnd; i++) {
      let sum = biases[i];
      const base = i * n;
      const limit = n - 7;
      let j = 0;
      for (; j < limit; j += 8) {
        sum += curr[j] * weights[base + j]
             + curr[j + 1] * weights[base + j + 1]
             + curr[j + 2] * weights[base + j + 2]
             + curr[j + 3] * weights[base + j + 3]
             + curr[j + 4] * weights[base + j + 4]
             + curr[j + 5] * weights[base + j + 5]
             + curr[j + 6] * weights[base + j + 6]
             + curr[j + 7] * weights[base + j + 7];
      }
      for (; j < n; j++) sum += curr[j] * weights[base + j];
      const nextVal = activate(sum, activationCode);
      next[i] = nextVal;
      const diff = nextVal - curr[i];
      residual[i] = diff < 0 ? -diff : diff;
    }

    // Plain (non-atomic) writes above (next[] and residual[]) become
    // visible to the main thread once it observes this Atomics.store via
    // its own Atomics.wait -- SharedArrayBuffer semantics guarantee
    // everything sequenced before a release (this store+notify) is
    // visible after the matching acquire.
    Atomics.store(control, CTRL_DONE_BASE + workerIndex, 1);
    Atomics.notify(control, CTRL_DONE_BASE + workerIndex);
  }
});
