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
## 2025-05-14 - HyperDimensionalEngine Settle & Learning Optimization
**Learning:** In high-dimensional neural engines, pre-fetching TypedArray views (via .subarray()) outside of hot loops significantly reduces object creation and garbage collection pressure. Additionally, integrating auxiliary tasks like input clamping and energy calculation into the main state iteration loop, and leveraging the distributive property to reduce multiplications (e.g., sum + dotDiag + dotShift * strength), can yield substantial performance gains.
**Action:** Always seek to combine multiple passes over large buffers and pre-calculate invariant views or constants before entering deep nested loops.

## 2025-05-15 - NeuronMesh CSR Caching Optimization
**Learning:** Re-building the Compressed Sparse Row (CSR) structure and auxiliary TypedArrays from scratch on every tick in `NeuronMesh.propagate` caused significant overhead due to thousands of `Map` lookups and frequent allocations. Implementing a lazy `cacheValid` invalidation pattern and updating `flatWeights` directly during Hebbian learning improves propagate time by ~2.8x (~14.1ms to ~4.9ms for 200 nodes) while maintaining system correctness and history tracking.
**Action:** Use lazy caching for graph-to-array conversions in neural components, and prioritize direct buffer updates in training loops to avoid full cache invalidation.
