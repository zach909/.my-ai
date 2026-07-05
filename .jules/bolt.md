## 2025-05-14 - MoE Router Loop Reordering
**Learning:** Matrix-vector multiplication was implemented with strided access (column-major) in TypeScript, leading to poor cache locality. Swapping loops to iterate over the weight matrix sequentially (row-major) resulted in a ~3x performance improvement (from 19.6ms to 6.1ms for a typical 1024-dim layer).
**Action:** Always verify loop nesting order for matrix operations in neural logic to ensure sequential memory access on large TypedArrays.
