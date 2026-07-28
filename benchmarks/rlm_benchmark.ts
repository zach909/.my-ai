import { RLMTrainer, Experience } from '../models && skills/core/rlm.js';

function generateRandomExperience(stateDim: number, actionDim: number): Experience {
  const state = new Float32Array(stateDim);
  const nextState = new Float32Array(stateDim);
  for (let i = 0; i < stateDim; i++) {
    state[i] = Math.random();
    nextState[i] = Math.random();
  }
  return {
    state,
    action: Math.floor(Math.random() * actionDim),
    reward: Math.random() * 2 - 1,
    nextState,
    done: Math.random() > 0.95,
    priority: Math.random() * 5 + 0.1,
    timestamp: Date.now()
  };
}

async function benchmark() {
  const config = {
    stateDim: 64,
    actionDim: 10,
    replayBufferSize: 10000,
    batchSize: 64,
    quantizationEnabled: true,
  };

  const trainer = new RLMTrainer(config);

  console.log("Populating replay buffer...");
  for (let i = 0; i < config.replayBufferSize; i++) {
    trainer.addExperience(generateRandomExperience(config.stateDim, config.actionDim));
  }

  // Warmup - ensure JIT compilation
  for (let i = 0; i < 50; i++) {
    await trainer.train();
  }

  const start = performance.now();
  const iterations = 500;
  for (let i = 0; i < iterations; i++) {
    await trainer.train();
  }
  const end = performance.now();

  const avgTime = (end - start) / iterations;
  const opsPerSec = 1000 / avgTime;
  console.log(`RLMTrainer Benchmark:`);
  console.log(`  Buffer size: ${trainer.getBufferSize()}`);
  console.log(`  Average train execution time: ${avgTime.toFixed(4)}ms`);
  console.log(`  Operations per second: ${opsPerSec.toFixed(2)}`);
  console.log(`  Total iterations: ${iterations}`);
}

benchmark();
