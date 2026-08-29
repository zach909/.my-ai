# Hyper-Dimensional Thinking

Each neuron maintains multiple temporary internal states that change according to both its own input and the state of every other neuron — the design notes' "Higher-Dimensional Thinking": recognizing previous reasoning, avoiding repeated mistakes, and understanding how earlier thoughts influence future decisions.

## Overview

**Purpose**: Nonlinear, multi-dimensional communication across the mesh, so the system can examine and reason about its own internal thought process rather than only ever seeing a flattened scalar per neuron.

| Layer | File | What it is |
|---|---|---|
| TypeScript runtime backend | `models && skills/core/hyperdimensional.ts` — `HyperDimensionalEngine` | A dedicated multi-ball neuron-state engine with novelty detection and live correction |

## `HyperDimensionalEngine` (TypeScript)

```typescript
const engine = new HyperDimensionalEngine({ neuronCount, dimensions, propagationSteps });
const result = engine.process(input);
engine.hasSeenPattern(patternHash);      // has this exact state pattern occurred before?
engine.getPatternNovelty(patternHash);   // how novel is it relative to history?
engine.isExclusiveInput(0.9);            // is one neuron dominating the input topography?
engine.traceNeuron(...);                 // inspect one neuron's own reasoning trace
```

`hasSeenPattern` / `getPatternNovelty` are the concrete mechanism behind "recognize previous reasoning, avoid repeating mistakes" — a state pattern the engine has already seen contributes less novelty-driven change than a genuinely new one. `traceNeuron` is the literal "the model can examine and reason about its own internal thought process": a single neuron's contribution across the propagation history can be inspected directly, not just its final output.

Engineering note: this is one of the hottest paths in the live pipeline, and its performance history is logged concretely in `.jules/bolt.md` — flattening from nested objects to interleaved `Float32Array` buffers with sequential (not strided) access cut processing time from ~38ms to ~28ms for a typical configuration, and pre-fetching `.subarray()` views outside the hot loop reduced GC pressure further.

## The Python mesh's native multi-dimensional state

The Python trainable mesh (see [[Neuron-Mesh]]) doesn't wrap this in a separate engine class — every neuron's state is natively `mesh_dims`-dimensional from the ground up (`ModelConfig(mesh_dims=4, ...)`), and `_last_settled` (once correctly populated — see [[Quantum-Net]] for the bug history) carries the full per-dimension state, not a flattened scalar. The design notes' "every neuron stores variables describing its relationship with every other neuron" is the mesh's D×D connection block per neuron pair (see [[Neuron-Mesh]]), applied natively rather than as an add-on layer.

## Verifying it

`npm test` (`test/smoke.mjs`)'s `testHyperdimensional` and `testInputFlagSelfModelLiveCorrection` cover novelty detection, the self-input flag, and live correction directly. `benchmarks/hyper_benchmark.ts` measures the engine's `process()` throughput (`npx tsx benchmarks/hyper_benchmark.ts`).

## See Also

- [[Home]] - Main wiki page
- [[Neuron-Mesh]] - The substrate this multi-dimensional state runs on
- [[RLM]] - How recognizing a repeated pattern feeds back into avoiding it
- [[Quantum-Net]] - The settled state this reasoning trace is read from

---

*Higher-dimensional thinking is what turns "the mesh produced an answer" into "the mesh can tell you which of its own prior states led there."*
