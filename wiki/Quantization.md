# Quantization

After training or building, a behaviour is quantized for deployment — the design notes' "Background — Quantization": faster execution, lower memory, and reduced power, applied automatically once an extension is completed.

## Overview

**Purpose**: Compress trained weights for deployment without a second, separate compression pass bolted on afterward — quantization is trained *for*, not just applied *at* the end.

**Key principle**: "Save projects without quantization. Install projects using quantization." (see [[Builder]]) — a project stays exact and editable until you deploy it.

## Quantization-aware training (Python mesh)

The Python mesh did not quantize only at export time; it trained *with* quantization already in the loop (this track has been removed — see [[Platforms]]):

```python
def _fake_quant(self, w):
    """Symmetric fake-quantization with a straight-through estimator: the
    returned tensor equals the quantized weights numerically but carries
    the full-precision gradient."""
    ...

def quantization_error(self) -> float:
    """Mean abs difference between W and its quantized form — the drift
    QAT is training the mesh to already expect."""
```

Because every forward pass already sees a fake-quantized version of its own weights (gradients flow through via a straight-through estimator), the mesh learns weights that are robust to the precision loss quantization will eventually introduce — `quantization_error()` should shrink over training as the mesh converges toward values that round cleanly.

## Install-time quantization ([[Builder]])

```python
eb.install("greeter.install.ext", contracts, bits=8)   # quantized, smaller on disk
```

```typescript
builder.installWithQuantization(projectId, { bits: 8, ... });
```

Both the Python `ExtensionBuilder.install()` and the TypeScript `ExtensionBuilder.installWithQuantization()` compress a saved project's weights to the requested bit width at install time — the exact, un-quantized project (from `save_project` / `saveWithoutQuantization`) is left untouched, so you can always go back and re-edit before installing again.

## Verified behaviour

`python main.py demo` (`test_integration.py`, §3) checks this concretely, not just conceptually: it saves a real trained contract un-quantized, installs it at 8 bits, confirms the installed file is measurably smaller on disk than the saved one, and — the important part — reloads the *installed, quantized* extension into a completely fresh model object and confirms it still reproduces the exact trained reply. Quantization here is lossy in principle (bit-width reduction) but the QAT training loop keeps it from being lossy in practice for the behaviours that were actually trained.

## Background Quantization system

The full implementation-level design — architecture, algorithms (dynamic
vs. static, symmetric/asymmetric/mixed, mixed precision), data structures,
the background job scheduler, hardware-aware estimation, configuration,
and edge cases — lives in
[`docs/architecture/BACKGROUND_QUANTIZATION.md`](../docs/architecture/BACKGROUND_QUANTIZATION.md).
Implementation: `models && skills/core/quantizer.ts`,
`quantization-hardware.ts`, `quantization-scheduler.ts`,
`quantization-config.ts`.

## See Also

- [[Home]] - Main wiki page
- [[Builder]] - Save (exact) vs. install (quantized), and where `bits=` is set
- [[Neuron-Mesh]] - The quantization-aware training loop this all builds on
- [[Elastic-Value-Budget]] - Why quantization doesn't erase a verified behaviour: vale locks it in first

---

*Quantization here isn't a lossy afterthought bolted onto a finished model — the mesh trains against its own quantized reflection the whole time.*
