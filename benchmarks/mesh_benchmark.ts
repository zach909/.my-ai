import { NeuronMesh } from '../models && skills/core/onebrain.js';

function benchmark() {
  const nodeCount = 200;
  const mesh = new NeuronMesh({
    nodeCount,
    connectionDensity: 1.0,
    maxIterations: 50,
    convergenceThreshold: 0.0001
  });

  // OPTIMIZATION: Use Map<number, number> with pre-allocated numeric keys for faster lookup
  const inputs = new Map<number, number>();
  for (let i = 0; i < 10; i++) {
    inputs.set(i, Math.random());
  }

  // Warmup - ensure JIT compilation and cache warming
  for (let i = 0; i < 5; i++) {
    mesh.propagate(inputs);
  }

  const start = performance.now();
  const iterations = 20;
  for (let i = 0; i < iterations; i++) {
    mesh.propagate(inputs);
  }
  const end = performance.now();

  const avgTime = (end - start) / iterations;
  const opsPerSec = 1000 / avgTime;
  console.log(`NeuronMesh Benchmark:`);
  console.log(`  Mesh size: ${nodeCount} nodes, all-to-all connectivity`);
  console.log(`  Average propagate execution time: ${avgTime.toFixed(2)}ms`);
  console.log(`  Operations per second: ${opsPerSec.toFixed(2)}`);
  console.log(`  Total iterations: ${iterations}`);
}

benchmark();
