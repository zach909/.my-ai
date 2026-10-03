/**
 * Serial vs. parallel (worker_threads) NeuronMesh.propagate() at a mesh
 * size where the O(n^2) dense weighted-sum actually dominates the fixed
 * cost of coordinating multiple worker threads -- see
 * mesh_benchmark.ts's 200-node mesh for the *unparallelized* baseline;
 * that size is deliberately too small for MeshWorkerPool to help (worker
 * dispatch/Atomics overhead exceeds the compute it would save), which is
 * exactly why parallelMinNodes exists and why this benchmark uses a
 * larger mesh.
 *
 * This is also this repository's find-unreachable.mjs "caller" for
 * MeshWorkerPool: a benchmark that actually constructs and drives one,
 * not just a test asserting it works in isolation.
 */
import { NeuronMesh, type ParallelMeshBackend } from '../models && skills/core/onebrain.js';
import { MeshWorkerPool } from '../models && skills/core/mesh-worker-pool.js';

async function benchmarkAt(nodeCount: number) {
  const config = {
    nodeCount,
    connectionDensity: 1.0,
    maxIterations: 50,
    convergenceThreshold: 0.0001,
    parallelMinNodes: 1, // benchmark the parallel path unconditionally at this size
  };

  const inputs = new Map<number, number>();
  for (let i = 0; i < 10; i++) inputs.set(i, Math.random());

  const serialMesh = new NeuronMesh(config);
  for (let i = 0; i < 3; i++) serialMesh.propagate(inputs); // JIT warmup
  const serialIterations = 15;
  let start = performance.now();
  for (let i = 0; i < serialIterations; i++) serialMesh.propagate(inputs);
  const serialAvgMs = (performance.now() - start) / serialIterations;

  const parallelMesh = new NeuronMesh(config);
  const pool = new MeshWorkerPool(); // defaults to os.cpus().length - 1
  parallelMesh.setParallelBackend(pool as ParallelMeshBackend);
  await parallelMesh.prepareParallel();
  for (let i = 0; i < 3; i++) parallelMesh.propagate(inputs); // JIT + pool warmup
  const parallelIterations = 15;
  start = performance.now();
  for (let i = 0; i < parallelIterations; i++) parallelMesh.propagate(inputs);
  const parallelAvgMs = (performance.now() - start) / parallelIterations;
  pool.terminate();

  console.log(`nodeCount=${nodeCount}:`);
  console.log(`  serial:   ${serialAvgMs.toFixed(2)}ms/propagate (${(1000 / serialAvgMs).toFixed(1)} ops/sec)`);
  console.log(`  parallel: ${parallelAvgMs.toFixed(2)}ms/propagate (${(1000 / parallelAvgMs).toFixed(1)} ops/sec)`);
  console.log(`  speedup:  ${(serialAvgMs / parallelAvgMs).toFixed(2)}x`);
}

async function benchmark() {
  console.log('MeshWorkerPool Benchmark (worker_threads, SharedArrayBuffer + Atomics):');
  await benchmarkAt(1000);
  await benchmarkAt(2000);
}

benchmark();
