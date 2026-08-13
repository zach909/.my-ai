import { packLevels, unpackLevels } from '../models && skills/core/quantizer.js';

function runBenchmarkForBits(bits: number) {
  const size = 100000;
  const levels = new Uint32Array(size);
  const max = (1 << bits) - 1;
  for (let i = 0; i < size; i++) {
    levels[i] = Math.floor(Math.random() * (max + 1));
  }

  // Warmup
  for (let i = 0; i < 5; i++) {
    const packed = packLevels(levels, bits);
    const unpacked = unpackLevels(packed, size, bits);
  }

  const iterations = 50;

  // Benchmark packLevels
  const startPack = performance.now();
  let packed: Uint8Array = new Uint8Array(0);
  for (let i = 0; i < iterations; i++) {
    packed = packLevels(levels, bits);
  }
  const endPack = performance.now();
  const avgPack = (endPack - startPack) / iterations;

  // Benchmark unpackLevels
  const startUnpack = performance.now();
  let unpacked: Uint32Array = new Uint32Array(0);
  for (let i = 0; i < iterations; i++) {
    unpacked = unpackLevels(packed, size, bits);
  }
  const endUnpack = performance.now();
  const avgUnpack = (endUnpack - startUnpack) / iterations;

  // Verify correctness
  const testPacked = packLevels(levels, bits);
  const testUnpacked = unpackLevels(testPacked, size, bits);
  let correct = true;
  for (let i = 0; i < size; i++) {
    if (testUnpacked[i] !== levels[i]) {
      correct = false;
      break;
    }
  }

  console.log(`Quantizer Primitives Benchmark (size: ${size}, bits: ${bits}):`);
  console.log(`  Average packLevels_${bits} execution time: ${avgPack.toFixed(4)}ms`);
  console.log(`  Average unpackLevels_${bits} execution time: ${avgUnpack.toFixed(4)}ms`);
  console.log(`  Total round-trip time: ${(avgPack + avgUnpack).toFixed(4)}ms`);
  console.log(`  Correctness: ${correct ? 'PASSED' : 'FAILED'}`);
  console.log('---');
}

function main() {
  const bitConfigs = [8, 4, 16];
  for (const bits of bitConfigs) {
    runBenchmarkForBits(bits);
  }
}

main();
function benchmark() {
  runBenchmarkForBits(4);
  runBenchmarkForBits(8);
  runBenchmarkForBits(16);
}

benchmark();
