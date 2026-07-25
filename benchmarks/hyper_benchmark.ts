import { HyperDimensionalEngine } from '../models && skills/core/hyperdimensional.js';

function benchmark() {
  const config = {
    neuronCount: 100,
    dimensions: 128,
    propagationSteps: 10,
  };

  const engine = new HyperDimensionalEngine(config);
  // OPTIMIZATION: Use Float32Array instead of regular array for better memory locality and SIMD potential
  const input = new Float32Array(config.dimensions);
  for (let i = 0; i < config.dimensions; i++) {
    input[i] = Math.random() * 2 - 1;
  }

  // Warmup - ensure JIT compilation and cache warming
  for (let i = 0; i < 5; i++) {
    engine.process(input);
  }

  const start = performance.now();
  const iterations = 50;
  for (let i = 0; i < iterations; i++) {
    engine.process(input);
  }
  const end = performance.now();

  const avgTime = (end - start) / iterations;
  const opsPerSec = 1000 / avgTime;
  console.log(`HyperDimensional Engine Benchmark:`);
  console.log(`  Config: ${config.neuronCount} neurons, ${config.dimensions} dimensions, ${config.propagationSteps} steps`);
  console.log(`  Average execution time: ${avgTime.toFixed(2)}ms`);
  console.log(`  Operations per second: ${opsPerSec.toFixed(2)}`);
  console.log(`  Total iterations: ${iterations}`);
}

benchmark();
