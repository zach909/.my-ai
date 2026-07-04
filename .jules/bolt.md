# Bolt's Journal - Critical Learnings

## 2025-05-14 - MoE Router Cache Locality Optimization
**Learning:** The `MoERouter` implementation used a strided memory access pattern in its matrix-vector multiplications for both router scoring and expert computation. This caused significant performance overhead due to cache misses. Swapping the nested loops to ensure row-major (sequential) access to `Float32Array` weights improved `moe-router` performance by ~52% and overall pipeline throughput by ~22%.
**Action:** Always verify loop ordering for matrix operations in performance-critical paths to ensure cache-friendly sequential access.
