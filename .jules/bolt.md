# Bolt's Journal - Critical Learnings

## 2025-05-14 - MoE Router Cache Locality Optimization
**Learning:** The `MoERouter` implementation used a strided memory access pattern in its matrix-vector multiplications for both router scoring and expert computation. This caused significant performance overhead due to cache misses. Swapping the nested loops to ensure row-major (sequential) access to `Float32Array` weights improved `moe-router` performance by ~52% and overall pipeline throughput by ~22%.
**Action:** Always verify loop ordering for matrix operations in performance-critical paths to ensure cache-friendly sequential access.
## 2025-05-14 - MoE Router Loop Reordering
**Learning:** Matrix-vector multiplication was implemented with strided access (column-major) in TypeScript, leading to poor cache locality. Swapping loops to iterate over the weight matrix sequentially (row-major) resulted in a ~3x performance improvement (from 19.6ms to 6.1ms for a typical 1024-dim layer).
**Action:** Always verify loop nesting order for matrix operations in neural logic to ensure sequential memory access on large TypedArrays.

## 2025-05-14 - HyperDimensionalEngine Data Layout Optimization
**Learning:** Organizing neural engine data (weights and states) in a flattened layout specifically tailored for sequential access in hot loops (row-major for weights, dimension-major for states) significantly improves performance by maximizing CPU cache locality. Moving from nested objects/arrays to flattened `Float32Array` buffers with interleaved/sequential access reduced `hyper-dimensional` processing time by ~28% (from 38.35ms to 27.60ms).
**Action:** In numerical or neural engines, prioritize flattened data layouts and loop ordering that ensures sequential memory access on large TypedArrays.
