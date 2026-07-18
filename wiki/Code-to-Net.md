# Code-to-Net

Imports source or binary code and converts it into an equivalent neural network — the [[Builder]]'s "Code-to-Net imports binary or source code and converts it into an equivalent neural network."

## Overview

**Purpose**: Turn existing code into a neuron the mesh can call like any other — either by genuinely *learning the function* the code computes, or, when that's not possible, by embedding the code's identity into the mesh.

| Layer | File | What it is |
|---|---|---|
| TypeScript runtime backend | `extension-builder/builder.ts` — `importCodeToNet(projectId, name, binaryCode)` | Imports binary code into a new `codenet`-type neuron |
| Python training core | `tinygpt/neurolang.py` — `train_codenet(name, code, ...)` | Actually trains a real network against the code, with two distinct modes |

## Two real modes (Python)

```python
from neurolang import train_codenet

meta = train_codenet("doubler", source_code, save_dir=".")
# meta = {"name", "mode", "in_dim", "out_dim", "loss", "hash"}
```

`train_codenet` first tries to **probe the code as a numeric function** (`_probe_python`): if it can extract input/output sample pairs (e.g. the code defines something like `def doubler(x): return x * 2`), it trains a small `CodeNet` with real gradient descent (Adam, MSE loss) until it genuinely approximates that function — `mode: "function_approximation"`. If the code isn't a probeable numeric function, it falls back to `mode: "embedding"`: the code's own structure is embedded and the network is trained to reproduce that embedding, so the neuron still has a stable, content-addressed identity (`hash` is the code's own SHA-256 prefix) even when it can't literally learn what the code *computes*.

## The NeuroLang directive form

```text
code@name="doubler"
"doubler"@code="def doubler(x): return x * 2"
```

This is the DSL surface for the same mechanism — see [[NeuroLang]] for the full directive reference.

## Verifying it

`python test_core.py`'s `test_code_to_net` builds a real function (`doubler`) and confirms it lands in `function_approximation` mode with a real, converging loss curve. `npm test` (`test/smoke.mjs`) covers `importCodeToNet` producing a real `codenet`-type `NeuronData` entry on the TypeScript side.

## See Also

- [[Home]] - Main wiki page
- [[Builder]] - Where Code-to-Net sits alongside Net Search and the visual editor
- [[NeuroLang]] - The `code@`/`@code=` directive syntax
- [[Extensions]] - How an imported function becomes a permanently-registered capability

---

*Code-to-Net tries to actually learn what your code does — and only falls back to remembering that it exists when it genuinely can't.*
