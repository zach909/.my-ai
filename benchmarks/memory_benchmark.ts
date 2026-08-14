import { LongTermMemory } from '../models && skills/core/long-term-memory.js';

function benchmark() {
  const mem = new LongTermMemory({ dim: 512, capacity: 2000 });

  // Populate memory with 1000 items
  for (let i = 0; i < 1000; i++) {
    mem.remember(`This is memory item number ${i} containing topic ${i % 20} and details about performance optimization and artificial intelligence`);
  }

  const query = "performance optimization artificial intelligence topic 5";

  // Warmup
  for (let i = 0; i < 10; i++) {
    mem.retrieve(query, { topK: 5 });
  }

  const start = performance.now();
  const iterations = 500;
  for (let i = 0; i < iterations; i++) {
    mem.retrieve(query, { topK: 5 });
  }
  const end = performance.now();

  const avgTime = (end - start) / iterations;
  const opsPerSec = 1000 / avgTime;
  console.log(`LongTermMemory Benchmark:`);
  console.log(`  Items: 1000, Dim: 512`);
  console.log(`  Average retrieve execution time: ${avgTime.toFixed(4)}ms`);
  console.log(`  Operations per second: ${opsPerSec.toFixed(2)}`);
}

benchmark();
