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

## 2025-05-15 - RLMTrainer Performance Optimization
**Learning:** Significant overhead in reinforcement learning loops often comes from redundant array conversions and non-sequential memory access. Reordering loops to ensure row-major access to weight matrices, implementing 4x loop unrolling, and replacing high-level abstractions like `Math.max(...Array.from())` with manual loops over TypedArrays yielded measurable improvements (~10% in Q-value computation, ~7.5% in overall training). Tracking the replay buffer size incrementally also avoided (N)$ scans of the buffer.
**Action:** In all performance-critical neural/RL loops, prioritize raw TypedArray iteration, manual unrolling for hot inner loops, and incremental state tracking to avoid expensive collection scans.

## 2025-07-17 - NeuronMesh Propagation Fast-Path Optimization
**Learning:** In highly dynamic propagation loops, significant performance overhead arises from frequent allocations of short-lived typed arrays and redundant branch checking for features like group gating or vale limits that are inactive in standard workloads. By compiling a fast-path that bypasses these allocations when activeGroups and vale are absent, caching the active activation function as a local closure before the loop to avoid dynamic property lookup and switches, and using direct loop construction instead of intermediate paired mappings, we can achieve substantial speedups.
**Action:** Always inspect hot-path arguments to determine if a specialized fast-path can bypass allocation-heavy operations, and resolve activation/dispatch closures outside critical iteration loops.

## 2025-07-18 - HyperDimensionalEngine Settle and Learning Hot-Path Optimization
**Learning:** In high-dimensional neural/simulation loops, heavy overhead is incurred by: Map/Set operations (`drivenIds.has(i)`, `vale?.get(i)`), arithmetic function call stack overhead (`clamp()`, `Math.abs()`), and diagonal index branch checking (`if (i === j) continue;`). By pre-allocating lookup structures, caching states, inlining clamps, and splitting the diagonal to achieve branch-free inner loops, performance is substantially boosted.
**Action:** Pre-allocate Set/Map lookups into arrays outside of hot nested loops, inline basic math helper functions, and split inner loops to eliminate diagonal branching.

## 2026-07-20 - ElasticCoreBlock forward Hot-Path Optimization
**Learning:** In deep-nested simulation tick loops, substantial execution overhead is caused by subarray allocations (creating short-lived Float32Array views) and index branching in the inner loop (e.g. `s === t`). Additionally, filling the quantization residual with zero on every tick when quantization is inactive creates useless memory writes. By pre-allocating/reusing buffers, splitting the inner loops to bypass index checks, unrolling the innermost dimensions by 4x, and avoiding `Math.abs` overhead via branch-free ternary operators, execution speed improves significantly.
**Action:** Avoid TypedArray subarray allocations in hot inner loops, split outer loops to eliminate nested branching, unroll inner dimensions, and skip redundant initialization sweeps when configurations are inactive.

## 2026-07-21 - MoERouter Hot-Path Optimization
**Learning:** Significant performance bottleneck in `MoERouter` was caused by garbage collection overhead and helper callbacks in `selectTopK` and `softmax` (such as using the spread operator `Math.max(...values)`), along with un-unrolled matrix multiplications and generic fallback loops for Top-K outputs. Utilizing direct index-sorting with `Int32Array`, a single-pass optimized `softmax`, 8x GEMV loop unrolling with zero-value sparsity check, and specialized branch specialization for standard Top-K values (1, 2, 4) achieved a ~6% overall speedup.
**Action:** Eliminate array-helper callbacks, spread operators, and dynamic mapping inside hot neural iteration loops, and prefer specialized code branches for common numeric parameter configurations.
