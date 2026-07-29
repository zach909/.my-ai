# Empathy Engine

The Empathy Engine tracks the user's emotional state and intent so the rest of the system can stay aligned with what the user actually wants, without needing to be told the same preference twice — the design notes' "Empathy" system.

## Overview

**Purpose**: Read the user's emotional trend from their own words (no external sentiment API), and use it to adjust generation and decision-making.

**Model**: Valence / Arousal / Dominance (VAD) — the same three-axis model both implementations use:

- **Valence**: how positive or negative (-1 to +1)
- **Arousal**: how calm or excited (0 to 1)
- **Dominance**: how submissive or assertive/in-control (0 to 1)

As with [[RLM]], there are two real, independent implementations:

| Layer | File | What it is |
|---|---|---|
| TypeScript runtime backend | `models && skills/core/empathy.ts` — `EmpathyEngine` | Tracks the model's own emotional mirroring plus a running user-context average; exposes an alignment score and autonomous-decision gating |
| Python training core | `model && skills manager/tinygpt/empathy.py` — `EmpathyEngine` | A lightweight local VAD reader (`read_mood`) with EMA smoothing, wired directly into `core.py`'s sampling parameters |

## `EmpathyEngine` (TypeScript)

```typescript
import { EmpathyEngine } from './models && skills/core/empathy.js';

const empathy = new EmpathyEngine();
const userEmotion = empathy.analyzeEmotion(input);   // VAD reading of the raw text
empathy.updateUserContext(input);                    // rolling average of the user's state
const modelEmotion = empathy.getModelEmotion();       // the model's own mirrored state
const aligned = empathy.canMakeAutonomousDecision();  // gates §3 autonomous action on alignment
const tuned = empathy.adjustDecision(decision, context);
```

- **`analyzeEmotion`** reads VAD straight from text (keyword/punctuation cues — capitalization, exclamation density, negative/positive vocabulary — no external model).
- **`syncEmotion`** blends the model's own emotional state toward the user's, so responses aren't emotionally tone-deaf, without fully mirroring (a frustrated user gets a calmer, not an equally-agitated, reply).
- **`canMakeAutonomousDecision`** / **`getAlignmentScore`** are the concrete mechanism behind "the model independently makes decisions that match the user's preferences without requiring repeated instructions" — low alignment routes a decision back to the user instead of acting alone.
- **`recordDecisionPreference`** / **`getDecisionPreference`** let a specific class of decision (e.g. "how verbose to be") accumulate feedback over time, independent of momentary mood.

## `EmpathyEngine` (Python)

```python
from tinygpt.empathy import EmpathyEngine, read_mood

empathy = EmpathyEngine(smoothing=0.35, history=50)
reading = empathy.observe("this is broken and terrible, please fix it now!!!")
print(empathy.describe())            # "(neutral, calm, assertive (valence -0.12, arousal 0.37, ...))"
adj = empathy.sampling_adjustment()  # {"temperature_scale": ..., ...}
empathy.save()  /  empathy.load()    # persists to --empathy-state (local JSON, no external API)
```

`core.py` calls `observe()` on every turn and feeds `sampling_adjustment()` straight into generation — an aroused or negative reading nudges temperature/sampling toward more careful, less exploratory completions. Because the reading is EMA-smoothed (`smoothing=0.35` by default), one noisy or sarcastic line doesn't swing the mood label outright; it shifts the *blended* valence/arousal proportionally, reflecting the conversation's trend rather than any single message.

## Verifying it

`python main.py demo` (`test_integration.py`, §5) drives a real `core.py` session through a positive message, then a frustrated one, and asserts on the *actual numeric* valence/arousal shift between the two `mood` readings — not just a label crossing, since EMA smoothing means a single message won't always flip the label (e.g. `+0.35 → -0.12` valence, `0.05 → 0.37` arousal was one observed run). `test_core.py`'s `test_empathy` covers the reader and sampling adjustment directly; `npm test` (`test/smoke.mjs`)'s empathy checks cover the TypeScript side, including the alignment score staying bounded (`Extension catalog fully active` section).

## See Also

- [[Home]] - Main wiki page
- [[RLM]] - The other autonomous-reasoning guard, applied to repeated text rather than mood
- [[Skills]] - Skills whose autonomous actions are gated by `canMakeAutonomousDecision`
- [[Privacy]] - VAD state is local JSON, encryptable at rest, never sent anywhere

---

*The Empathy Engine is what lets the system read "this is broken and terrible!!!" as a shift in urgency, not just a string to complete.*
