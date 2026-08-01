# Background Value (Vale) System — Complete Specification

Reference implementation: `asi_core/vale_system.py`
Tests: `asi_core/test_vale_system.py`

This document is the full design spec for **vale**: a strictly zero-sum
scalar assigned to every neuron that governs how fast that neuron is
allowed to change. High-vale neurons are stable/consolidated; low-vale
neurons are plastic/raw. Section headers below match the module's
docstrings section-for-section so the two stay easy to cross-check.

---

## 1. Concept

Every neuron `i` in a population of size `n` holds a scalar `v_i` called
its **vale**. Vale is:

- **Bounded**: `v_min <= v_i <= v_max` for every neuron, always.
- **Zero-sum (conserved)**: `sum(v_i) == V_total` for a constant `V_total`,
  at every point in time, for every operation defined in this document.
- **Inversely related to plasticity**: a neuron's effective learning rate is
  a decreasing function of its vale.

Zero-sum is the load-bearing property of the whole system: a neuron cannot
become more stable except by some other neuron(s) becoming more plastic,
in exactly equal measure. This makes "protecting" a piece of knowledge an
explicit, accounted-for trade-off against the system's remaining capacity
to learn — never a free action.

---

## 2. Mathematics

### 2.1 State

```
v ∈ R^n,        v_min <= v_i <= v_max            (bounds)
sum(v_i) = V_total                                (conservation)
```

Feasibility requires `n * v_min <= V_total <= n * v_max`; this is checked
once at construction (`ValeConfig.__post_init__`) and after every
population change.

### 2.2 Plasticity function

```
plasticity(v_i) = ((v_max - v_i) / (v_max - v_min)) ^ gamma,   gamma > 0
```

`plasticity(v_min) = 1` (fully plastic), `plasticity(v_max) = 0` (fully
stable/frozen). `gamma` shapes the curve: `gamma < 1` keeps most neurons
plastic until vale is very high (a "cliff" near v_max); `gamma > 1` makes
neurons lose plasticity quickly as soon as they accumulate any vale at all.

### 2.3 Effective learning rate

For any base learning rate `η_base` used by a Hebbian, STDP, gradient, or
reinforcement rule (see `asi_core/neural_states.py`):

```
η_eff(i) = η_base * plasticity(v_i)
```

This is the single point where vale gates every other learning rule in the
codebase — `ValeSystem.effective_learning_rate` is meant to wrap the
`learning_rate` argument passed into `Synapse.update_weight_*` /
`SynapticState.apply_*`.

### 2.4 The learning equation (continuous redistribution)

Every neuron accumulates a smoothed **utility** signal `u_i` — an estimate
of how valuable/well-behaved its recent activity has been (see §4). Vale
is redistributed each tick by a **mean-centered** update:

```
ū = mean(u)
Δv_i = η_v * dt * (u_i - ū)
```

This is the central trick of the whole design: because `Δv_i` is a
deviation from the population mean, `sum(Δv_i) = 0` **exactly**, by
construction, regardless of the values of `u`. No explicit normalization
step is needed for the *unbounded* part of the update — conservation falls
out of the mean-subtraction for free. The only place conservation can be
disturbed is boundary clipping (§2.5), which is handled separately.

Interpretation: neurons that are more useful than average pull vale away
from neurons that are less useful than average, every tick, in proportion
to how far each is from the mean.

### 2.5 Bounded conservation (water-filling)

Any per-neuron delta, once clipped to `[v_min, v_max]`, can leave a
nonzero leftover ("overflow") that must go somewhere or the invariant
breaks. The reconciliation algorithm (`ValeSystem._apply_conserving`) is a
water-filling scheme:

```
for each participant i with a pending delta d_i:
    v_i_new = clip(v_i + d_i, v_min, v_max)
    applied_i = v_i_new - v_i
    overflow += d_i - applied_i
    v_i = v_i_new

while |overflow| > ε:
    candidates = participants with remaining headroom in overflow's direction
    if no candidates: return shortfall = overflow   # infeasible, see §11
    headroom_i = (v_max - v_i)  if overflow > 0 else (v_i - v_min)
    redistribute overflow across candidates proportional to headroom_i
    (repeat clip/overflow accounting on this smaller pending set)
```

**Convergence proof sketch.** At each round, the redistributed share for
candidate `i` is `overflow * headroom_i / Σheadroom`. Because
`overflow <= Σheadroom` whenever the *global* system has enough spare
capacity (guaranteed at the whole-population level by the feasibility
check in §2.1), each share is `<= headroom_i`, so no candidate can be
clipped a second time in the same direction. In practice this means the
loop resolves in at most 2 rounds; the implementation still bounds the
loop at `n + 3` rounds purely as a safety net against floating-point edge
cases. When the water-fill is restricted to a strict subset of neurons
(e.g. a single donor with no headroom left — a *transfer*, not the global
step), convergence to zero overflow is **not** guaranteed, and the
function returns the unresolved amount as a shortfall instead of forcing
it elsewhere. Silently pulling a shortfall from neurons outside the
requested set would violate the "explicit trade-off" property from §1.

### 2.6 Relaxation (long-term stability term)

To prevent the population from drifting into a bimodal
all-frozen/all-plastic split, a slow relaxation term pulls every neuron
toward a target distribution `v*` (default: uniform, `V_total / n`):

```
r_i = η_r * dt * (v*_i - v_i)
r_i := r_i - mean(r)          # mean-center: zero-sum regardless of Σv*
Δv_i += r_i
```

`v*` can be any shape (e.g. a power law favoring a few highly stable
"anchor" neurons) via `ValeConfig.target_distribution`; it is always
mean-centered before application so custom targets can never leak net
vale into or out of the system even if they don't sum to `V_total`
exactly.

---

## 3. Algorithms (operational summary)

| Operation | Purpose | Conservation strategy |
|---|---|---|
| `step()` | per-tick runtime update | mean-centered utility delta + mean-centered relaxation, both water-filled |
| `promote(ids, amount)` | raise stability of specific neurons | two-leg transfer: withdraw `T` from donors, deposit same `T` into targets |
| `demote(ids, amount)` | lower stability of specific neurons | same two-leg transfer, reversed roles |
| `protect(ids)` | consolidate (push near `v_max`) | `promote` to `freeze_threshold * v_max` |
| `release(ids)` | de-consolidate (return to `v_init`) | `demote` back to `v_init` |
| `transfer(from, to, amount)` | generic explicit reallocation | two independently-conserving water-fills of the same amount `T` |
| `add_neurons(n)` | neurogenesis | `policy="rescale"` funds new neurons from existing pool; `policy="grow"` adds fresh capital (documented exception) |
| `remove_neurons(ids)` | pruning | freed vale redistributed to survivors by headroom |

### 3.1 Two-leg transfer algorithm

`transfer(from_ids, to_ids, amount, donor_policy, recipient_policy)`:

```
donor_capacity  = Σ_{i in from_ids} (v_i - v_min)
recip_capacity  = Σ_{i in to_ids}   (v_max - v_i)
T = min(amount, donor_capacity, recip_capacity)
if T ~ 0: return 0

take_i  = -T * donor_weight_i     for i in from_ids   (water-filled within from_ids)
give_i  = +T * recipient_weight_i for i in to_ids     (water-filled within to_ids)

return T
```

Running the withdrawal and the deposit as two *separate* conserving
water-fills (rather than one big system that includes both sides) is
deliberate: it guarantees a donor is never asked to give back vale it just
received as a recipient in the same call, and a partially-unmet donor-side
shortfall never gets silently absorbed by shrinking the recipients' gain
below what their own headroom could otherwise support. Both legs move
exactly `T`, so the system-wide sum is invariant regardless of how each
side internally distributes its half.

Donor/recipient weighting policies (`DonorPolicy` / `RecipientPolicy`):

- **PROPORTIONAL** (donors): richer neurons give more — a "wealth tax".
- **PROPORTIONAL_HEADROOM** (recipients, default): neurons with more room
  to grow receive more, which naturally avoids repeated clipping.
- **UNIFORM**: equal absolute share regardless of current vale.
- **INVERSE_UTILITY** / **UTILITY_WEIGHTED**: donations/receipts driven by
  the utility EMA — least-useful neurons pay first; most-useful neurons
  are rewarded first.

---

## 4. Promotion

**Definition.** Promotion is any operation that increases a neuron's vale,
whether explicit (`promote`, `protect`) or implicit (a positive
`u_i - ū` term in `step()`).

**When promotion should be triggered (policy, not enforced by the module —
callers decide):**

1. A memory/consolidation system judges a neuron's current representation
   worth protecting (e.g. it participates in a stable, frequently
   recalled memory trace) → call `protect(ids)`.
2. A neuron's `utility_ema` is persistently above the population mean
   (handled automatically every `step()`).
3. External reward attribution (e.g. a `LearningSystem`'s reinforcement
   signal) credits a neuron via `record_activity(id, activation,
   contribution=+reward_share)`.

**Effect.** `plasticity(i)` decreases, `η_eff(i)` shrinks, and (per §6) the
neuron's synaptic weights become increasingly anchored against further
change via `consolidation_penalty`.

---

## 5. Demotion

**Definition.** The inverse of promotion: an operation that decreases a
neuron's vale, freeing plasticity capacity back into the pool.

**When demotion should be triggered:**

1. Explicit `demote`/`release` from a memory system that no longer needs a
   representation protected (e.g. superseded by a consolidated version).
2. Persistently below-average utility, handled automatically by `step()`.
3. The frozen-fraction safety valve (§9.2) force-demotes the
   least-useful frozen neurons when too much of the population has locked
   up.
4. Pruning (`remove_neurons`) implicitly demotes-to-zero and redistributes.

**Effect.** `plasticity(i)` increases; the neuron becomes available again
as "raw capacity" for new information.

---

## 6. Redistribution & zero-sum balancing

Two distinct redistribution mechanisms coexist, matching two different
use cases:

1. **Continuous / implicit** (`step()`): every tick, ongoing utility
   differences produce small, mean-centered nudges across the *entire*
   population. This is the system's default, "ambient" behavior and needs
   no caller intervention.
2. **Discrete / explicit** (`transfer`/`promote`/`demote`): a caller names
   specific donor and recipient sets and an amount. Used for deliberate,
   attributable decisions (e.g. "consolidate this specific memory now").

Both funnel through the same primitive, `_apply_conserving`, so both
obey identical bound-respecting, water-filling semantics — there is only
one way vale ever moves in this system, just two different call patterns
into it.

**Invariant testing.** `ValeSystem.validate_invariant()` /
`_validate(strict=True)` check `|sum(v) - V_total| < ε` and
`v_min <= v_i <= v_max` for all `i`. Tests assert this after every
operation category (see §12).

---

## 7. Initialization

```
v_init = V_total / n                     (default: uniform)
v_i = v_init  for all i                  (deterministic default)
```

Optional Gaussian jitter (`ValeConfig.init_jitter > 0`) draws
`ε_i ~ N(0, σ)`, mean-centers it (`ε_i := ε_i - mean(ε)`), and applies it
through `_apply_conserving` — so jittered initialization is exactly
conserving and bound-respecting from tick zero, not just "close".

`ValeConfig.__post_init__` performs feasibility validation
(`n*v_min <= V_total <= n*v_max`) before any neuron is created; an
infeasible configuration raises `ValeConfigError` immediately rather than
producing a silently-broken system.

A `seed` may be passed to `ValeSystem(config, seed=...)` for fully
deterministic initialization and (if utility is externally driven
deterministically) fully deterministic runs — required for reproducible
tests.

---

## 8. Runtime updates

Each tick, a caller (typically the owning `NeuralMesh`/`LearningSystem`)
should:

1. Call `record_activity(neuron_id, activation, contribution)` for each
   neuron as activity is observed during the tick (optional — feeds the
   fallback utility path and gives `step()` a signal even when the caller
   doesn't compute an explicit utility vector).
2. Call `vale_system.step(utility=<optional externally computed vector>)`
   once per tick. If `utility` is omitted, the fallback
   `_fallback_utility()` rewards neurons whose smoothed activation is close
   to a homeostatic target (`0.3` by default, matching
   `Neuron.homeostatic_target` in `neural_core.py`) and penalizes both
   silent and saturated neurons.
3. Use `effective_learning_rate(neuron_id, base_lr)` wherever a synapse
   would otherwise use a flat learning rate.

`step()` internally performs, in order: utility EMA update → mean-centered
utility redistribution → mean-centered relaxation → frozen-fraction
enforcement → age increment → periodic drift renormalization → history
snapshot.

---

## 9. Long-term stability

Three independent mechanisms guard against degenerate long-run behavior:

### 9.1 Relaxation toward a target distribution (§2.6)

Prevents winner-take-all collapse where a small clique of neurons
monopolizes all the vale while the rest sit permanently at `v_min` (or the
reverse — a nearly-uniform population is usually desirable baseline
behavior, punctuated by deliberate promotions).

### 9.2 Frozen-fraction safety valve

```
frozen_i = 1[v_i >= freeze_threshold * v_max]
if count(frozen) > max_frozen_fraction * n:
    excess = frozen neurons sorted by utility_ema ascending,
             trimmed to the first (count(frozen) - max_frozen_fraction*n)
    demote(excess, amount = Σ (v_i - v_init) for i in excess)
```

This guarantees the system can never lock up more than
`max_frozen_fraction` of its capacity, no matter how aggressively callers
promote — a hard ceiling on "amount of the network that has stopped
learning", independent of the softer relaxation pull.

### 9.3 Periodic renormalization

Floating-point arithmetic accumulates drift over very long runs. Every
`renormalize_every` ticks, `_renormalize()` computes
`drift = V_total - sum(v)` and applies `drift/n` to every neuron through
the same conserving primitive — the one place a *non*-mean-centered
(deliberately net-nonzero) delta is applied, specifically because its
entire purpose is restoring the invariant exactly.

---

## 10. Forgetting prevention & memory interaction

Vale's plasticity gating (§2.3) already slows learning for high-vale
neurons. For a stronger consolidation guarantee — resisting not just slow
drift but any single large update from clobbering a consolidated
representation — pair it with weight anchoring:

```
consolidation_penalty(i, w, anchor, λ) = λ * v_i * (w - anchor)
```

`anchor` is the weight's value captured at the moment the owning neuron
was last `protect()`-ed (a memory system's responsibility to record).
Subtracting this term from a weight's gradient/Hebbian update is a
vale-scaled analogue of Elastic Weight Consolidation (EWC): the higher a
neuron's vale, the more strongly its weights are pulled back toward the
consolidated anchor whenever they try to move.

**Recommended integration with a memory system:**

- **Encoding a new memory** → newly recruited neurons start near `v_init`
  (fully plastic) so they can rapidly fit the new pattern.
- **Consolidation** (e.g. after spaced repetition / replay confirms the
  memory is stable and worth keeping) → memory system calls
  `protect(neuron_ids)` and snapshots current weights as anchors.
- **Retrieval-induced updates** (the memory is recalled and reinforced) →
  `record_activity(id, activation, contribution=+reward)` nudges utility
  upward, reinforcing vale gradually rather than requiring another
  explicit `protect`.
- **Forgetting / obsolescence** (the memory system decides a
  representation is stale or superseded) → `release(neuron_ids)` returns
  capacity to the pool for reuse, explicitly and all at once rather than
  waiting for utility to drift down on its own.

This gives the vale system a clean "two knobs" interaction surface for any
higher-level memory architecture: a fast, continuous signal
(`record_activity` → utility EMA) and a slow, deliberate one
(`protect`/`release`).

---

## 11. Neural plasticity

Plasticity is entirely mediated through `plasticity(i)` and
`effective_learning_rate(i, base_lr)` (§2.2–2.3). This is intentionally
the *only* place vale touches learning-rate math — every existing rule in
`neural_core.py` / `neural_states.py` (Hebbian, STDP, Oja, BCM,
reinforcement, homeostatic) can be vale-gated by wrapping its
`learning_rate` argument with `effective_learning_rate` before calling it,
with no other changes required. `NeuralMesh.SynapticConnection.
apply_vale_gate` already follows this exact pattern
(`base_learning_rate * (1 - vale)`, i.e. `gamma = 1`); `ValeSystem`
generalizes it with a configurable exponent.

---

## 12. APIs

```python
from asi_core.vale_system import (
    ValeSystem, ValeConfig, DonorPolicy, RecipientPolicy,
    ValeError, ValeConfigError, ValeInvariantError,
)

cfg = ValeConfig(n_neurons=64, v_min=0.01, v_max=0.99,
                  utility_learning_rate=0.02, relax_rate=0.002,
                  freeze_threshold=0.97, max_frozen_fraction=0.25)
vs = ValeSystem(cfg, seed=42)

# runtime
vs.record_activity(neuron_id, activation, contribution=0.0)
stats = vs.step(utility=None, dt=1.0)          # -> dict, see statistics()

# explicit reallocation
vs.promote(neuron_ids, amount)                  -> float actually moved
vs.demote(neuron_ids, amount)                   -> float actually moved
vs.transfer(from_ids, to_ids, amount,
            donor_policy=DonorPolicy.PROPORTIONAL,
            recipient_policy=RecipientPolicy.PROPORTIONAL_HEADROOM)
                                                 -> float actually moved
vs.protect(neuron_ids, target=None)             -> float
vs.release(neuron_ids)                          -> float

# learning-rate interface
vs.plasticity(neuron_id)                        -> float in [0, 1]
vs.effective_learning_rate(neuron_id, base_lr)  -> float
vs.consolidation_penalty(neuron_id, w, anchor, lam) -> float
vs.is_frozen(neuron_id)                         -> bool

# population changes
vs.add_neurons(count, policy="rescale"|"grow")  -> List[int] new ids
vs.remove_neurons(neuron_ids)

# diagnostics / persistence
vs.validate_invariant()                         -> bool
vs.statistics()                                 -> dict
vs.history()                                    -> List[dict]
vs.to_dict() / ValeSystem.from_dict(data)
```

All amount-bearing calls (`promote`, `demote`, `transfer`, `protect`,
`release`) return the amount **actually** moved, which can be less than
requested if bounds prevent full satisfaction (§13.3) — callers that need
to know must check the return value rather than assume success.

---

## 13. Internal data structures

```python
class ValeConfig:            # frozen configuration, validated at construction
    n_neurons: int
    v_min, v_max: float
    v_total, v_init: float
    init_jitter: float
    utility_learning_rate, utility_ema_decay: float
    plasticity_gamma: float
    relax_rate: float
    target_distribution: Optional[Callable[[int], List[float]]]
    freeze_threshold, max_frozen_fraction: float
    renormalize_every: int
    epsilon: float

class ValeSystem:
    cfg: ValeConfig
    v: List[float]              # current vale, index = neuron id
    utility_ema: List[float]    # smoothed utility signal driving redistribution
    activation_ema: List[float] # smoothed |activation|, fallback-utility input
    age: List[int]              # ticks since each neuron was created
    tick: int                   # global step counter
    last_shortfall: float       # most recent unresolved water-fill overflow
    _history: deque[dict]       # bounded ring buffer, snapshot per tick
```

Neuron identity is a dense integer index into `v`/`utility_ema`/etc. —
consistent with `NeuralMesh`'s `neuron_id: int` convention. This keeps
every operation O(1) amortized indexing with O(k) work per water-fill
round where `k` is the number of participants, not the whole population.

---

## 14. Edge cases

| Case | Behavior |
|---|---|
| `n = 1` | The single neuron holds all of `V_total`; `promote`/`demote` targeting it have no donors/recipients and are no-ops (return `0.0`). |
| Promotion target set == entire population | No donors exist outside the target set; `promote` returns `0.0` unless the caller supplies an explicit `donors=` set. |
| Donor(s) already at `v_min` | `transfer` computes `donor_capacity = 0`, returns `0.0` without touching state. |
| Donor(s) partially depleted | `transfer` caps `T = min(amount, donor_capacity, recip_capacity)` and moves exactly that much — a documented partial fill, not a silent violation. |
| `NaN`/`Inf` in an externally supplied utility vector | `_sanitize` maps them to `0.0` before use; `step()` never raises on malformed input. |
| Overlapping `from_ids`/`to_ids` in `transfer` | Each id keeps at most one role per call (`from_ids`/`to_ids` are de-duplicated independently); passing the same id in both sets is caller error and produces a self-transfer whose net effect on that neuron is `donor_share - recipient_share` — not specifically guarded against, since it's still conserving. |
| Negative or zero `amount` | Negative raises `ValueError`; zero is a no-op returning `0.0`. |
| Floating-point drift after long runs | Corrected every `renormalize_every` ticks (§9.3); `validate_invariant()` uses an epsilon tolerance, not exact equality, for this reason. |
| Infeasible `ValeConfig` (`v_total` outside `[n*v_min, n*v_max]`) | Raises `ValeConfigError` at construction — never silently clamped. |
| `add_neurons` / `remove_neurons` at runtime | See §3 table; both re-validate the invariant (`strict=True`) before returning, raising `ValeInvariantError` if something went wrong internally (defense in depth — should be unreachable given the algorithms above, but the check exists because population changes are the riskiest code path). |
| Removing every neuron | `v`, `utility_ema`, etc. become empty lists; `cfg.v_total` is set to `0.0`; `step()` on an empty system is a safe no-op returning `{"n": 0, "tick": ...}`. |
| Population saturated (`sum` at `n*v_max` or `n*v_min`) | The global `step()` water-fill can't fully resolve overflow (all candidates lack headroom); the shortfall is recorded in `last_shortfall` for callers/tests to detect rather than raising, since transient saturation during a single tick is recoverable next tick. Sustained saturation should not occur given the frozen-fraction safety valve (§9.2), which is exactly the mechanism designed to prevent this case in practice. |

---

## 15. Testing

`asi_core/test_vale_system.py`, 35 tests across:

1. **Configuration validation** — feasible/infeasible bounds, `n=0`.
2. **Initialization** — uniform sums to `V_total`; jittered init still
   conserves and respects bounds; `n=1` degenerate case.
3. **Conservation under `step()`** — 300 rounds of random utility vectors
   with an exact-invariant assertion after every round; extreme
   (saturating) utility; `NaN`/`Inf` sanitization; renormalization
   correcting deliberately injected float drift.
4. **Promotion / demotion / transfer** — target increases/donor decreases
   correctly while conserving; promoting the entire population is a
   no-op; a fully-drained single donor yields `moved == 0`; a
   partially-drained donor is capped at its exact remaining capacity;
   `protect`/`release` round-trip back to `v_init`; donor-policy choice
   changes internal distribution but not conservation.
5. **Plasticity** — monotonically decreasing in vale; boundary values
   exactly `1.0`/`0.0`; `effective_learning_rate` scales accordingly;
   `gamma` visibly reshapes the curve.
6. **Long-term stability** — relaxation measurably pulls a promoted
   neuron back down over many ticks; the frozen-fraction safety valve
   caps the frozen count even under aggressive `protect()` calls.
7. **Memory interaction** — consolidation penalty scales with vale; a
   high-vale neuron accumulates measurably less simulated Hebbian drift
   than a low-vale neuron under identical input over many steps.
8. **Population changes** — `add_neurons("rescale")` conserves the
   pre-growth total plus exactly the new floor capital; `add_neurons(
   "grow")` increases `v_total` by exactly the expected amount;
   `remove_neurons` redistributes freed vale and keeps the invariant;
   removing every neuron leaves a valid empty state.
9. **Serialization** — `to_dict`/`from_dict` round-trip reproduces state
   exactly and still validates.
10. **Edge cases** — negative amount raises; empty donor/recipient list
    and zero amount are no-ops; `step()` on an empty (fully-pruned)
    system doesn't raise; identical seeds produce identical trajectories.

Run with:

```bash
python3 -m unittest asi_core.test_vale_system -v
```

All tests are pure-Python (no `numpy`/pytest dependency), consistent with
the rest of `asi_core/`.
