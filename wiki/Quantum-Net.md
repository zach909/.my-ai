# Quantum Neural Net

Every neuron carries a unique wave signature; a neuron's input determines its wave amplitude, and the signature identifies it during interference calculations — the design notes' example is literal: "Neuron 2 has a wave signature of 4.5 and an amplitude of 10." This is §5 / the Quantum Neural Network background system, and it runs on ordinary hardware today while leaving a natural path to real quantum backends later.

## Overview

**Purpose**: Let phase-aligned neurons reinforce each other and discordant ones cancel — a genuine complex-arithmetic consensus mechanism, not a metaphor — used both as an answer-selection strategy and (in the TypeScript mesh) as a gate inside the forward pass itself.

| Layer | File | What it is |
|---|---|---|
| TypeScript runtime backend | `models && skills/core/quantum-net.ts` — `QuantumNeuralNet` | Signature/phase computation, pairwise and group interference, Born-rule (`amplitude²`) probabilistic collapse |
| Python training core | `tinygpt/interference.py` + `tinygpt/selection.py`'s `select_by_interference` | Interference-based *answer selection* among several generated candidates, sharing the [[RLM]] ledger's repeat-discounting |

## `QuantumNeuralNet` (TypeScript)

```typescript
const signature = qnn.calculateSignature(neuronId, inputValue);   // Neuron 2 -> 4.5, per the design example
const state = qnn.encode(neuronId, inputValue);                    // { signature, amplitude, phase }
const combined = qnn.interfere(stateA, stateB);                    // genuine complex addition: |zA + zB|
const collapsed = qnn.collapse(states);                            // Born rule: P ∝ amplitude², not uniform
```

Interference is implemented as real complex arithmetic (`zA + zB`, magnitude of the sum), not a cosine-similarity approximation — a corrected bug in this project's history was `phaseDiff` always being `0`, which made every interference computation destructive by default regardless of actual phase alignment. `collapse()` samples proportional to amplitude², matching the Born rule rather than a flat average across candidates.

## `select_by_interference` (Python)

```python
from tinygpt.selection import select_by_interference

winner = select_by_interference(
    model, tokenizer, prompt_ids, n=5, max_new_tokens=40,
    temperature=0.8, top_k=40, top_p=0.95, repetition_penalty=1.1,
    eos_id=tokenizer.eos_id, device="cpu", ledger=ledger,
)
```

Each of the `n` generated candidates gets an amplitude (its rescaled confidence) and a phase (`model.state_phase()` — the mesh's own settled-state phase right after generating that candidate, from `tinygpt/mesh.py`'s `_last_settled`). Candidates whose settled state agrees in phase with the group's consensus reinforce each other; a lone outlier phase gets cancelled toward zero even if its raw confidence looked good — Grover-style amplification of a rare-but-correct answer over several confident-but-wrong ones. This only activates for `arch="mesh"` models (it falls back to plain confidence ranking otherwise), and it shares the [[RLM]] ledger's repeat-discounting with `best_of_n`.

**A previously-hidden bug** in this project's history: `NeuronMesh._last_settled` was declared but never actually assigned during `forward()`, so `state_phase()` always returned phase `0.0` for every candidate — silently degrading interference selection down to plain amplitude weighting with no real phase consensus happening at all. Fixed at the source in `mesh.py`; `select_by_interference` has worked as designed since.

## Using it

```bash
python core.py --ckpt checkpoints/gpt.pt --select interference
```

`core.py`'s session banner confirms which strategy is active ("§5 interference" vs. plain confidence), and it's one of the mechanisms `python main.py demo` (`test_integration.py`, §5) verifies is genuinely active in a real scripted session, not just parsed and ignored.

## See Also

- [[Home]] - Main wiki page
- [[Neuron-Mesh]] - Where the wave signatures and settled-state phase actually come from
- [[RLM]] - The repeat-discounting ledger shared with confidence-based selection
- [[Elastic-Value-Budget]] - How a neuron's amplitude interacts with its vale during learning

---

*The quantum layer runs in the canonical mesh today, on classical hardware, with no external dependency — a bridge to future quantum backends, not a requirement for one.*
