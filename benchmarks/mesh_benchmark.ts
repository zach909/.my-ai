import { NeuronMesh } from '../models && skills/core/mesh.js';

function benchmark() {
  const nodeCount = 200;
  const mesh = new NeuronMesh({
    nodeCount,
    connectionDensity: 1.0,
    maxIterations: 50,
    convergenceThreshold: 0.0001
  });

  const inputs = new Map<number, number>();
  for (let i = 0; i < 10; i++) {
    inputs.set(i, Math.random());
  }

  // Warmup
  for (let i = 0; i < 5; i++) {
    mesh.propagate(inputs);
  }

  const start = performance.now();
  const iterations = 20;
  for (let i = 0; i < iterations; i++) {
    mesh.propagate(inputs);
  }
  const end = performance.now();

  console.log(`Mesh size: ${nodeCount} nodes, all-to-all`);
  console.log(`Average propagate execution time: ${((end - start) / iterations).toFixed(2)}ms`);
}

benchmark();
