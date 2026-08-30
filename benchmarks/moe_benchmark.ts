import { MoERouter } from '../models && skills/core/onebrain.js';

function benchmark() {
  const cfg = {
    numExperts: 16,
    topK: 4,
    inputDim: 768,
    outputDim: 768,
    expertHiddenDim: 512,
  };

  const router = new MoERouter(cfg);
  // OPTIMIZATION: Use Float32Array for input to match internal representation and improve memory locality
  const input = new Float32Array(cfg.inputDim);
  for (let i = 0; i < cfg.inputDim; i++) {
    input[i] = Math.random() * 2 - 1;
  }

  // Warmup - ensure JIT compilation and cache warming
  for (let i = 0; i < 20; i++) {
    router.route(input);
  }

  const start = performance.now();
  const iterations = 500;
  for (let i = 0; i < iterations; i++) {
    router.route(input);
  }
  const end = performance.now();

  const avgTime = (end - start) / iterations;
  const opsPerSec = 1000 / avgTime;
  console.log(`MoE Router Benchmark:`);
  console.log(`  Config: ${cfg.numExperts} experts, input/output dim: ${cfg.inputDim}, top-K: ${cfg.topK}`);
  console.log(`  Average route execution time: ${avgTime.toFixed(4)}ms`);
  console.log(`  Operations per second: ${opsPerSec.toFixed(2)}`);
  console.log(`  Total iterations: ${iterations}`);
}

benchmark();
