# Pipeline Flow

How input actually moves through the TypeScript runtime backend, end to end — every stage below is a real, timed step in `NeuroPipeline.run()`, not a conceptual diagram.

## Overview

**File**: `models && skills/core/pipeline.ts` — `NeuroPipeline`

```typescript
const pipeline = new NeuroPipeline(config);
const result = await pipeline.run(embedding, inputText);
pipeline.getStats();   // avgDurationMs, per-step breakdown, run count
```

Every call to `run()` records real per-step timing (`steps.push({ name, inputShape, outputShape, durationMs })`), so `getStats()`'s step breakdown reflects genuine measured latency, not an estimate.

## The real stage sequence

1. **`zip-io` ingest** (§9, optional) — if raw input text was given, it's compressed into the [[Zip-IO]] circular buffer before anything else runs.
2. **`moe-router`** — [[MoE]] routing over the input embedding selects which experts/plugins fire this tick, and which neurons in the mesh should be driven.
3. **`elastic-core`** — the [[Neuron-Mesh]] forward pass, gated by vale ([[Elastic-Value-Budget]]) and the active expert groups from step 2. State deltas from this step feed back into the value budget (`feedbackToValueBudget`).
4. **`mesh-propagation`** — settle ticks across the full all-to-all mesh.
5. **`hyper-dimensional`** — the [[Hyperdimensional]] engine's multi-ball state update and novelty check run on the settled mesh state.
6. **`quantum-interference`** — [[Quantum-Net]]'s wave-signature interference/collapse over the candidate outputs.
7. **`rlm-decision`** — [[RLM]]'s `RLMTrainer` selects an action from the settled state, with loop detection against repeated reasoning steps.
8. **`alignment-veto`** — the decision from step 7 is checked against the alignment veto (resource constraints, file access, irreversible-action gating) before anything executes.
9. **`token-generation`** — the final output is produced from whatever survived the veto.

Each stage is a real, separately-timed unit — `getStats()`'s breakdown is how the project's own performance-tuning history (`.jules/bolt.md`) identifies which specific stage needs optimization rather than treating the pipeline as one opaque black box.

## See Also

- [[Home]] - Main wiki page
- [[MoE]] - Stage 2
- [[Neuron-Mesh]] - Stages 3-4
- [[Hyperdimensional]] - Stage 5
- [[Quantum-Net]] - Stage 6
- [[RLM]] - Stage 7
- [[Privacy]] - The alignment veto at stage 8
- [[Zip-IO]] - Input ingest and output persistence

---

*Nine design-notes systems, one measured, timed pipeline — not nine separate features bolted together.*
