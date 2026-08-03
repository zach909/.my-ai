import { packLevels, unpackLevels } from '../models && skills/core/quantizer.js';

function benchmark() {
  const size = 100000;
  const bits = 8;
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

  console.log(`Quantizer Primitives Benchmark (size: ${size}, bits: ${bits}):`);
  console.log(`  Average packLevels execution time: ${avgPack.toFixed(4)}ms`);
  console.log(`  Average unpackLevels execution time: ${avgUnpack.toFixed(4)}ms`);
  console.log(`  Total round-trip time: ${(avgPack + avgUnpack).toFixed(4)}ms`);
}

benchmark();
