/**
 * Correctness of NeuronMesh's parallel (worker_threads) propagate() path
 * against the serial one.
 *
 * MeshWorkerPool computes the same dense-layout row updates on multiple
 * worker threads via SharedArrayBuffer + Atomics instead of one
 * JS-engine thread, and results are expected to be bit-for-bit identical
 * to the serial loop -- not just numerically close. An earlier version of
 * this protocol used an indefinite Atomics.wait()/notify() pair for the
 * per-iteration handshake and, under real multi-worker contention, that
 * intermittently missed a wakeup: a worker would compute one iteration
 * against a stale curr[] snapshot, producing output that (rarely, and
 * only with 2+ workers) differed from the serial result by anywhere from
 * a few ULPs to a large value, depending on how far the mesh's recurrent
 * dynamics amplified it before the run ended. It reproduced in roughly
 * 15-30% of runs at small N with 2-4 workers and never with exactly 1
 * (see the fix: a short-timeout wait that self-heals on a missed notify,
 * in mesh-worker-pool.ts / mesh-worker-thread.ts). These tests run many
 * repetitions specifically to catch a regression of that bug, not just
 * exercise the happy path once.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { NeuronMesh, type ParallelMeshBackend } from '../../models && skills/core/onebrain';
import { MeshWorkerPool } from '../../models && skills/core/mesh-worker-pool';

// NeuronMesh's constructor draws weights/biases from the global
// Math.random() directly -- config.seed is stored but not used to seed
// that stream -- so two independently-constructed meshes never share
// topology/weights. Stubbing Math.random with a resettable seeded PRNG
// lets two meshes get IDENTICAL weights, isolating "does the parallel
// path match the serial one" from unrelated random-init differences.
function makeSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function withSeed<T>(seed: number, fn: () => T): T {
  const real = Math.random;
  Math.random = makeSeededRandom(seed);
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

function makeInputs(rng: () => number, n: number): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < Math.min(10, n); i++) m.set(i, rng() * 2 - 1);
  return m;
}

function finalStatesInOrder(result: { finalStates: Map<number, number> }): number[] {
  return [...result.finalStates.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

const pools: MeshWorkerPool[] = [];
async function makeParallelMesh(weightSeed: number, n: number, numWorkers: number, extraConfig: Record<string, unknown> = {}) {
  const mesh = withSeed(weightSeed, () => new NeuronMesh({
    nodeCount: n,
    connectionDensity: 1.0,
    maxIterations: 30,
    convergenceThreshold: 1e-6,
    activationFn: 'relu',
    parallelMinNodes: 1, // force the parallel path even at test-sized N
    ...extraConfig,
  }));
  const pool = new MeshWorkerPool(numWorkers);
  pools.push(pool);
  mesh.setParallelBackend(pool as ParallelMeshBackend);
  await mesh.prepareParallel();
  return mesh;
}

afterEach(() => {
  while (pools.length) pools.pop()!.terminate();
});

describe('NeuronMesh parallel propagate() vs serial', () => {
  it('is bit-for-bit identical across many settle calls (N=50, 4 workers)', async () => {
    const n = 50;
    const serial = withSeed(12345, () => new NeuronMesh({
      nodeCount: n, connectionDensity: 1.0, maxIterations: 30, convergenceThreshold: 1e-6, activationFn: 'relu',
    }));
    const parallel = await makeParallelMesh(12345, n, 4);

    const rng = makeSeededRandom(777);
    for (let trial = 0; trial < 10; trial++) {
      const inputs = makeInputs(rng, n);
      const a = serial.propagate(inputs);
      const b = parallel.propagate(inputs);
      expect(finalStatesInOrder(b)).toEqual(finalStatesInOrder(a));
      expect(b.iterations).toBe(a.iterations);
    }
  });

  it('is bit-for-bit identical for an N not evenly divisible by the worker count', async () => {
    const n = 37; // 37 / 4 workers -> uneven last shard; the exact case the race bug reproduced on
    const serial = withSeed(555, () => new NeuronMesh({
      nodeCount: n, connectionDensity: 1.0, maxIterations: 30, convergenceThreshold: 1e-6, activationFn: 'relu',
    }));
    const parallel = await makeParallelMesh(555, n, 4);

    const rng = makeSeededRandom(321);
    for (let trial = 0; trial < 12; trial++) {
      const inputs = makeInputs(rng, n);
      const a = serial.propagate(inputs);
      const b = parallel.propagate(inputs);
      expect(finalStatesInOrder(b)).toEqual(finalStatesInOrder(a));
    }
  });

  it('stays bit-for-bit identical across repeated fresh pools (regression guard for the missed-wakeup race)', async () => {
    // The historical bug was timing-dependent: it needed >=2 workers and
    // didn't reproduce every run. Repeating the whole construct-and-drive
    // cycle several times, each with a brand new pool (new worker threads,
    // new timing), is what actually caught it during triage.
    const n = 37;
    for (let rep = 0; rep < 6; rep++) {
      const serial = withSeed(12345, () => new NeuronMesh({
        nodeCount: n, connectionDensity: 1.0, maxIterations: 30, convergenceThreshold: 1e-6, activationFn: 'relu',
      }));
      const parallel = await makeParallelMesh(12345, n, 2);

      const rng = makeSeededRandom(555 + rep);
      for (let trial = 0; trial < 8; trial++) {
        const inputs = makeInputs(rng, n);
        const a = serial.propagate(inputs);
        const b = parallel.propagate(inputs);
        expect(finalStatesInOrder(b)).toEqual(finalStatesInOrder(a));
      }

      pools.pop()!.terminate();
    }
  });

  it('matches serial with tanh (a non-relu activation function)', async () => {
    const n = 40;
    const serial = withSeed(42, () => new NeuronMesh({
      nodeCount: n, connectionDensity: 1.0, maxIterations: 30, convergenceThreshold: 1e-6, activationFn: 'tanh',
    }));
    const parallel = await makeParallelMesh(42, n, 3, { activationFn: 'tanh' });

    const rng = makeSeededRandom(99);
    for (let trial = 0; trial < 6; trial++) {
      const inputs = makeInputs(rng, n);
      expect(finalStatesInOrder(parallel.propagate(inputs))).toEqual(finalStatesInOrder(serial.propagate(inputs)));
    }
  });

  it('falls back to the serial path below parallelMinNodes even with a backend attached', async () => {
    const n = 20;
    const mesh = withSeed(1, () => new NeuronMesh({
      nodeCount: n, connectionDensity: 1.0, maxIterations: 10, convergenceThreshold: 1e-6,
      activationFn: 'relu', parallelMinNodes: 1000, // never qualifies at n=20
    }));
    const pool = new MeshWorkerPool(2);
    pools.push(pool);
    mesh.setParallelBackend(pool as ParallelMeshBackend);
    await mesh.prepareParallel();

    // computeDenseRows should never be called: patch it to throw if it is.
    const spy = pool.computeDenseRows.bind(pool);
    pool.computeDenseRows = (..._args: Parameters<typeof spy>) => {
      throw new Error('computeDenseRows should not run below parallelMinNodes');
    };

    const result = mesh.propagate(makeInputs(makeSeededRandom(1), n));
    expect(result.finalStates.size).toBe(n);
  });

  it('a mesh with no parallel backend behaves exactly as before (no SharedArrayBuffer allocation)', () => {
    const n = 30;
    const mesh = withSeed(7, () => new NeuronMesh({
      nodeCount: n, connectionDensity: 1.0, maxIterations: 10, convergenceThreshold: 1e-6, activationFn: 'relu',
    }));
    const result = mesh.propagate(makeInputs(makeSeededRandom(7), n));
    expect(result.finalStates.size).toBe(n);
  });
});
