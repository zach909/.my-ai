# Code-to-Net

Imports source or binary code and converts it into an equivalent neural network — the [[Builder]]'s "Code-to-Net imports binary or source code and converts it into an equivalent neural network."

## Overview

**Purpose**: Turn existing code into a neuron the mesh can call like any other — either by genuinely *learning the function* the code computes, or, when that's not possible, by embedding the code's identity into the mesh.

| Layer | File | What it is |
|---|---|---|
| TypeScript runtime backend (structural) | `extension-builder/builder.js` (JS-only module; no `.ts` source has ever existed here) — `importCodeToNet(projectId, name, binaryCode)` → `core/thorns.js` `CodeToNet` (also JS-only; no `.ts` source has ever existed here) | Imports binary code into a new `codenet`-type neuron chain (topology) |
| TypeScript runtime backend (behavioral) | `models && skills/core/code-to-net.ts` — `CodeToNetCompiler` / `CodeNet` | Trains a real network that approximates a numeric function, or embeds it — the same two modes as Python, wired into the NeuroLang `@code` directive |
| Python training core | `neurolang.py` (package root, not under `tinygpt/`) — `train_codenet(name, code, ...)` | Trains a real network against the code, with two distinct modes |

## Two real modes (Python)

```python
from neurolang import train_codenet

meta = train_codenet("doubler", source_code, save_dir=".")
# meta = {"name", "mode", "in_dim", "out_dim", "loss", "hash"}
```

`train_codenet` first tries to **probe the code as a numeric function** (`_probe_python`): if it can extract input/output sample pairs (e.g. the code defines something like `def doubler(x): return x * 2`), it trains a small `CodeNet` with real gradient descent (Adam, MSE loss) until it genuinely approximates that function — `mode: "function_approximation"`. If the code isn't a probeable numeric function, it falls back to `mode: "embedding"`: the code's own structure is embedded and the network is trained to reproduce that embedding, so the neuron still has a stable, content-addressed identity (`hash` is the code's own SHA-256 prefix) even when it can't literally learn what the code *computes*.

## Two real modes (TypeScript)

The TypeScript backend now has behavioral parity with Python via `models && skills/core/code-to-net.ts`:

```ts
const c = new CodeToNetCompiler();
const net = c.compile("doubler", "(x) => x * 2");   // → mode: "function"
net.evaluate([3]);                                   // ≈ [6]
c.testAgainst(net, "(x) => x * 2");                  // { passed: true, meanAbsError, ... }
```

`compile` first tries to build a **safe numeric function** from the code (arrow/`function`/bare expression over a small variable set, arithmetic + `Math.*` only; unsafe tokens are denied). If it can, it samples the function and fits a 1-hidden-layer MLP by SGD — `mode: "function"` — and `testAgainst` re-samples fresh inputs to confirm the network reproduces the original within tolerance. Anything else (I/O, loops, strings, external state) falls back to `mode: "embedding"`: a deterministic content signature that identifies the code without claiming to reproduce it. Limitations are explicit — arbitrary software is *not* converted to behaviour.

## The NeuroLang directive form

```text
code@name="doubler"
"doubler"@code="return x * 2"
```

Attaching code with `@code` now compiles it into a real, testable `CodeNet` behind the scenes. Retrieve/run it via the interpreter: `interp.getCodeNet("doubler")`, `interp.evaluateCodeNet("doubler", [3])`, `interp.testCodeNet("doubler")`. See [[NeuroLang]] for the full directive reference.

## Verifying it

`python test_core.py`'s `test_code_to_net` builds a real function (`doubler`) and confirms it lands in `function_approximation` mode with a real, converging loss curve. `npm test` (`test/smoke.mjs`) covers both the TypeScript sides: `importCodeToNet` producing a `codenet`-type `NeuronData` entry (structural), and the **Behavioral Code-to-Net (Section 21)** suite — function-mode approximation, test-against-original, embedding fallback, serialization round-trip, and the NeuroLang `@code` integration.

## See Also

- [[Home]] - Main wiki page
- [[Builder]] - Where Code-to-Net sits alongside Net Search and the visual editor
- [[NeuroLang]] - The `code@`/`@code=` directive syntax
- [[Extensions]] - How an imported function becomes a permanently-registered capability

---

*Code-to-Net tries to actually learn what your code does — and only falls back to remembering that it exists when it genuinely can't.*
