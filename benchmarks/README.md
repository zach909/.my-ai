# Performance Benchmarks

This directory contains performance benchmarks for the core neural network components.

## Running Benchmarks

### All Benchmarks
```bash
bun run bench
```

### Individual Benchmarks

#### HyperDimensional Engine
```bash
bun run bench:hyper
```
Benchmarks the hyperdimensional neural engine with configurable neuron count, dimensions, and propagation steps.

#### NeuronMesh
```bash
bun run bench:mesh
```
Benchmarks the neuron mesh propagation with all-to-all connectivity.

#### NeuronMesh — parallel (worker_threads)
```bash
bun run bench:mesh-parallel
```
Compares the same dense propagate() step run serially against
`MeshWorkerPool`, a multi-core `node:worker_threads` backend that shards
the O(n²) weighted-sum across threads via `SharedArrayBuffer` + `Atomics`
(see `mesh-worker-pool.ts` / `mesh-worker-thread.ts`, wired in through
`NeuronMesh.setParallelBackend()`). Node-only (Bun works too, since both
support `worker_threads` + shared memory); not available in a browser
bundle. Uses a 1,000–2,000 node mesh rather than `bench:mesh`'s 200,
because that's the range where the parallel win actually shows up —
below `parallelMinNodes` the coordination overhead exceeds what
parallelizing saves, which `bench:mesh`'s smaller mesh deliberately
stays under.

#### MoE Router
```bash
bun run bench:moe
```
Benchmarks the Mixture-of-Experts router with configurable expert count and dimensions.

## Optimization Techniques Applied

The codebase implements several performance optimizations:

1. **Typed Arrays**: Using `Float32Array` instead of regular arrays for better memory locality and SIMD potential
2. **Loop Unrolling**: Manual 4x-8x loop unrolling in hot paths to reduce branch overhead
3. **Cache-Friendly Memory Layout**: Row-major storage for weight matrices to enable sequential memory access
4. **Pre-allocated Buffers**: Reusing scratch buffers instead of allocating on every iteration
5. **Branchless Operations**: Using ternary operators instead of `Math.abs()` for performance
6. **JIT Warmup**: Including warmup iterations to ensure optimal JIT compilation
7. **Sparse Computation Fast-paths**: Skipping zero-value multiplications in sparse operations
8. **Specialized Code Paths**: Different optimized loops for common configurations (e.g., top-K=1,2,4)

## Metrics Reported

Each benchmark reports:
- Average execution time per operation (ms)
- Operations per second (throughput)
- Configuration details
- Total iterations run
