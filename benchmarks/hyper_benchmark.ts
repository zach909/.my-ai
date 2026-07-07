import { HyperDimensionalEngine } from '../models && skills/core/hyperdimensional.js';

function benchmark() {
  const config = {
    neuronCount: 100,
    dimensions: 128,
    propagationSteps: 10,
  };

  const engine = new HyperDimensionalEngine(config);
  const input = new Array(config.dimensions).fill(0).map(() => Math.random() * 2 - 1);

  // Warmup
  for (let i = 0; i < 5; i++) {
    engine.process(input);
  }

  const start = performance.now();
  const iterations = 50;
  for (let i = 0; i < iterations; i++) {
    engine.process(input);
  }
  const end = performance.now();

  console.log(`Average execution time: ${((end - start) / iterations).toFixed(2)}ms`);
}

benchmark();
