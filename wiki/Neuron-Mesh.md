# Neuron Mesh (All-to-All Connectivity)

The neuron mesh is the substrate that replaces a transformer's fixed layer structure: every neuron connects to every other neuron, and a "reasoning step" is many settle ticks of propagation rather than one attention pass — the design notes' "Fully Connected Neural Communication."

## Overview

**Purpose**: Autonomous reasoning with effectively unlimited contextual awareness — no neuron is more than one hop from any other.

**Key property**: connectivity is genuinely all-to-all, not sparse-with-a-large-fan-out. Each connection is a full D×D weight block (any source dimension can influence any target dimension), settling to convergence rather than running a fixed number of layers.

| Layer | File | What it is |
|---|---|---|
| TypeScript runtime backend | `models && skills/core/mesh.ts` — `NeuronMesh` | The live pipeline's mesh: `propagate()` runs settle ticks with lazy CSR caching for performance (see the `.jules/bolt.md` engineering log for the specific cache-locality work) |
| TypeScript extension mesh | `models && skills/core/elastic-core.ts` — `ElasticCoreBlock` | The extension-builder-editable, growable mesh: `addNeuron` preserves full density; `applyGradients` scales high-vale neuron updates down |
| Python training core | `models && skills/tinygpt/mesh.py` — `NeuronMesh` (`MeshLM`) | The *trainable* mesh: a real `nn.Module` with backprop, quantization-aware training, and the zero-sum vale system |

## The Python trainable mesh

```python
from tinygpt.model import build_model
from tinygpt.config import ModelConfig

cfg = ModelConfig(arch="mesh", mesh_neurons=64, mesh_dims=4, mesh_input=8, settle_ticks=3)
mesh = build_model(cfg)          # MeshLM: an nn.Module, trainable end to end
out = mesh.generate(ids, max_new_tokens=20)
```

- **Settle loop**: `forward()` runs `settle_ticks` propagation steps and records the final state as `_last_settled` — the mesh's "committed thought" for that input. `search_neurons`, `neuron_waves`, and `state_phase` all read from `_last_settled`, which is why it has to be populated on every forward pass, not just the last one (a real bug fixed in this project's history: it was declared but never assigned, silently zeroing out every §5 quantum-interference-based selection).
- **Vale-gated learning**: every neuron's plasticity is governed by the zero-sum [[Elastic-Value-Budget]] — `raise_vale()` locks in a verified behaviour, `demote_vale()` frees a poor-performing neuron to be repurposed (the self-healing mechanism, see [[Skills]]).
- **Quantization-aware training**: the forward pass includes a straight-through-estimator fake-quantization (`quantization_error()`), so the mesh already expects the drift that installing a quantized extension will introduce — see [[Quantization]].
- **Wave signature**: each neuron carries a unique wave signature and amplitude used for [[Quantum-Net]]'s interference-based answer selection.

## The TypeScript live pipeline mesh

`NeuronMesh.propagate()` is the hot path the whole live pipeline routes through — `ElasticCoreBlock` (in `elastic-core.ts`) builds on it for the extension-builder-editable, growable mesh, with `addNeuron` and `applyGradients` mirroring the Python side's vale gating in a from-scratch TypeScript implementation. Performance work on this path (loop reordering for cache locality, lazy CSR invalidation, fast-path allocation avoidance) is logged with before/after measurements in `.jules/bolt.md`.

## Verifying it

- `python main.py demo` (`test_integration.py`) trains a real mesh via NeuroLang, checks it reproduces the taught behaviour, then carries that *same* mesh through self-healing, extension install, and live skill-building — proof the mesh is one continuous, stateful object across all of those, not a fresh throwaway each time.
- `python test_elastic_mesh.py` is a dedicated mesh + expert-core smoke suite (gradient flow, shape preservation, no NaN/Inf).
- `npm test` (`test/smoke.mjs`)'s `ElasticCoreBlock` section covers all-to-all density, bidirectional wiring on `addNeuron`, vale-gated movement, and QAT residual tracking on the TypeScript side.
- `benchmarks/mesh_benchmark.ts` measures `propagate()` throughput directly (`npx tsx benchmarks/mesh_benchmark.ts`).

## See Also

- [[Home]] - Main wiki page
- [[Elastic-Value-Budget]] - The zero-sum plasticity system gating every neuron's learning rate
- [[Quantum-Net]] - Wave signatures and interference, computed from the mesh's settled state
- [[Hyperdimensional]] - The multi-ball per-neuron state layered on top of the mesh
- [[Quantization]] - How a trained mesh is compressed for installation

---

*The mesh is the one substrate both the Python trainer and the TypeScript runtime build on — an unproven but real, trainable alternative to the transformer.*
