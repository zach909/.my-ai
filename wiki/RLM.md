# RLM (Reinforcement Learning Module)

RLM is how NeuroClaw evaluates multiple possible reasoning steps before committing to one, and remembers what it has already tried so it stops repeating itself — the design notes' "Reinforcement Learning" background system.

## Overview

**Purpose**: Guide autonomous, multi-step reasoning during training and generation without an external reward model or API.

**Key Principle**: The system records completed reasoning steps and discounts candidates that repeat them, instead of relying purely on a single forward pass's confidence.

There are two real, independent implementations — one per layer of the project — that solve this the same way in different languages:

| Layer | File | What it is |
|---|---|---|
| TypeScript runtime backend | `models && skills/core/rlm.ts` — `RLMTrainer` | A small Q-learning trainer: experience replay, TD-error policy updates, exploration decay, and loop detection over the mesh's own hidden state |
| Python training core | `model && skills manager/tinygpt/rl.py` — `ReasoningLedger` | A lightweight ledger that scores and discounts repeated candidate replies during generation (`core.py`'s `--select` sampling) |

## `RLMTrainer` (TypeScript)

```typescript
import { RLMTrainer } from './models && skills/core/rlm.js';

const rlm = new RLMTrainer({ /* config */ });
const { action, thinkingSteps } = rlm.selectAction(state, availableActions);
rlm.addExperience({ state, action, reward, nextState, done });
const result = await rlm.train();
```

- **`selectAction`** — picks an action from the current hidden state, tracking how many "thinking steps" it took to settle on one.
- **`addExperience` / `train`** — standard experience-replay reinforcement learning: a replay buffer is sampled, TD-error drives a policy update, and a target policy is periodically synced (`syncTargetPolicy`).
- **`detectLoop`** — the concrete mechanism behind "records completed reasoning steps so they are not repeated unnecessarily": if the trainer keeps selecting the same action without making progress, it recognizes the loop and lets `selectAction` route around it instead of grinding on the same dead end.
- **Quantization-aware**: `getQuantizationDrift()` reports how far the policy's quantized forward pass has drifted from full precision, consistent with the rest of the mesh's §8 quantization-aware training.

## `ReasoningLedger` (Python)

```python
from tinygpt.rl import ReasoningLedger

ledger = ReasoningLedger(capacity=1000, repeat_penalty=0.35)
ledger.record("hello there")               # note that this reply was produced
ledger.penalty("hello there")               # -> nonzero: seen before, discount it
ranked = ledger.rescore(candidates)         # apply the discount across candidates
ledger.save()  /  ledger.load()             # persists to --ledger (local JSON, no external API)
```

`core.py` wires this into both selection strategies:

- `best_of_n` (confidence ranking) and `select_by_interference` (§5 quantum-interference selection, `tinygpt/selection.py`) both call `ledger.rescore()` before picking a winner, so a candidate that matches something already said recently is discounted regardless of which selection strategy is active.
- The penalty scales with `times_seen()` — the more often a reply has recurred, the harder it's discounted, so the model is pushed toward genuinely new phrasing rather than looping on a comfortable answer.
- State round-trips through `--ledger <path>` exactly like the empathy state and memory buffer, so a restarted session remembers what it already tried.

## Why two implementations

The TypeScript and Python halves of the project are two connected but independently-runnable systems (see [[Home]]); each needed its own reasoning-repetition guard rather than a shared network call, since **no external APIs** are used anywhere. `RLMTrainer` operates on the mesh's continuous hidden state during training; `ReasoningLedger` operates on the *text* a completed generation produced. They solve the same design-notes requirement — "helps autonomous reasoning remain focused and prevents repetitive mistakes" — at the two different points in the pipeline where repetition actually shows up.

## Verifying it

- `python main.py demo` (`test_integration.py`, §5) drives a real `core.py` session through a scripted conversation and confirms `reasoning.json` (the ledger) persists to disk from that session.
- `python test_core.py` includes `test_rl_ledger` and `test_reinforce_step`, covering repeat-penalty scaling and rescoring directly.
- `npm test` (`test/smoke.mjs`) includes `testRLM`, covering `RLMTrainer`'s experience replay and policy update in isolation.

## See Also

- [[Home]] - Main wiki page
- [[Elastic-Value-Budget]] - The other learning-without-forgetting mechanism reasoning steps interact with
- [[Quantum-Net]] - `select_by_interference`, the other selection strategy the ledger discounts
- [[Skills]] - How the coding/plugin-builder/skill-builder skills use guided reasoning

---

*RLM is what keeps multi-step reasoning from grinding on the same mistake twice — in both languages this project speaks.*
