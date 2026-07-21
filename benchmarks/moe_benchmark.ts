import { MoERouter } from '../models && skills/core/moe-router.js';

function benchmark() {
  const cfg = {
    numExperts: 16,
    topK: 4,
    inputDim: 768,
    outputDim: 768,
    expertHiddenDim: 512,
  };

  const router = new MoERouter(cfg);
  const input = new Float32Array(cfg.inputDim);
  for (let i = 0; i < cfg.inputDim; i++) {
    input[i] = Math.random() * 2 - 1;
  }

  // Warmup
  for (let i = 0; i < 20; i++) {
    router.route(input);
  }

  const start = performance.now();
  const iterations = 500;
  for (let i = 0; i < iterations; i++) {
    router.route(input);
  }
  const end = performance.now();

  console.log(`MoE Router size: ${cfg.numExperts} experts, input/output dim: ${cfg.inputDim}`);
  console.log(`Average route execution time: ${((end - start) / iterations).toFixed(4)}ms`);
}

benchmark();
