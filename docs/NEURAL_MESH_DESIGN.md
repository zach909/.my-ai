# Fully Connected Neural Mesh — Complete Design Specification

Every neuron connects to every other neuron. This document is the full
implementation spec for that substrate: the architecture, the math, how it
scales past the point where literal all-to-all storage is possible, how it's
laid out in memory, how it runs in parallel, how it stays numerically stable,
what the public API surface looks like, and how it's tested.

It formalizes and extends the three existing reference implementations in
this repository rather than inventing a fourth:

| Layer | File | Role |
|---|---|---|
| Python reference | `asi_core/neural_mesh.py` (`NeuralMesh`) | Readable, dependency-free reference implementation used for spec validation |
| Python trainable core | `model && skills manager/tinygpt/mesh.py` (`MeshLM`) | `nn.Module`, backprop, quantization-aware training |
| TypeScript runtime | `models && skills/core/mesh.ts` (`NeuronMesh`) | Hot path production pipeline, CSR-cached `propagate()` |
| TypeScript extension mesh | `models && skills/core/elastic-core.ts` (`ElasticCoreBlock`) | Growable mesh for extension-builder edits |

Where these three diverge, this document defines the canonical behavior and
calls out the divergence explicitly rather than silently picking one.

---

## 1. Architecture

### 1.1 Conceptual model

The mesh replaces a transformer's fixed layer stack with a single flat pool
of **N** neurons and a dense (or effectively dense) connection field between
them. There is no forward/backward direction — "depth" is replaced by
**settle ticks**: repeated rounds of simultaneous propagation until the
system reaches a fixed point or a tick budget is exhausted. A "reasoning
step" is one settle; a "thought" is the converged state at the end of it.

```
              ┌─────────────────────────────────────────┐
              │                MESH  (N neurons)         │
              │                                           │
   input ───► │  INPUT neurons ⇄ HIDDEN neurons ⇄ OUTPUT │ ───► output
   vector     │        ⇅                  ⇅        ⇅     │  vector
              │        └──── all-to-all D×D weights ─────┘│
              └─────────────────────────────────────────┘
                     settle_ticks × simultaneous update
```

### 1.2 Roles

Every neuron has exactly one `NeuronRole`:

- `INPUT` — externally clamped each activation; dimension 0 of its state
  carries an `input_flag` that downstream neurons can read to distinguish
  "told" from "inferred" information.
- `OUTPUT` — read out after settle; not otherwise privileged in the graph
  (it still both sends and receives, unlike a transformer's final layer).
- `HIDDEN` — general computation.
- `EXPERT` — hidden neurons additionally tagged with a `group` id used for
  sparse/MoE-style activation (§6).

Roles are metadata on top of a uniform substrate: the connectivity, weight
shape, and update rule are identical for every role. This is what makes the
mesh "fully connected" rather than "fully connected within a layer" — an
OUTPUT neuron can directly influence an INPUT neuron's neighbors, and vice
versa, within the same settle.

### 1.3 Groups / experts

Neurons partition into `n_groups` non-overlapping groups (round-robin
assignment by default). Groups are the unit of sparse activation (§6) and of
vale-budget bookkeeping (§9) — they do not restrict connectivity itself. The
connection field remains all-to-all regardless of group membership; only
*activity* is gated by group routing.

### 1.4 Composability

A mesh is a single addressable unit. Multiple meshes can be composed by
treating one mesh's OUTPUT neurons as another's INPUT (pipeline
composition), or by merging two meshes' neuron pools into a larger mesh and
re-running `_initialize_connections` over the union (fusion). Both patterns
preserve the invariant that within one mesh, connectivity is total.

---

## 2. Mathematical model

### 2.1 State

Each neuron `i` holds a state vector `s_i ∈ R^D`. Dimension 0 is reserved as
the *input flag* (§1.2); dimensions `1..D-1` are content. The full mesh state
is the matrix `S ∈ R^(N×D)`.

### 2.2 Connections

Every ordered pair `(i, j)`, `i ≠ j`, has a weight **matrix** `W_ij ∈
R^(D×D)`, not a scalar. This is what lets a source neuron's dimension `k`
influence a target neuron's dimension `l` independently for every `(k, l)`
pair — cross-dimensional reasoning rather than a single scalar "synaptic
strength." The full connection tensor is `W ∈ R^(N×N×D×D)` with the diagonal
`W_ii` excluded (no self-connections).

### 2.3 Propagation (one settle tick)

For every target neuron `j` (subject to the activity mask, §6):

```
net_j = b_j + Σ_{i ≠ j, i active}  W_ij · s_i          (D-vector, matrix-vector product)

s_j'[0]   = input_flag_j                                 (dimension 0 is carried, not computed)
s_j'[d]   = tanh(net_j[d])           for d = 1 .. D-1
```

`b_j ∈ R^D` is a per-neuron bias (the reference implementation uses a small
constant `0.01`; production configs may make it learned).

A full settle runs this update **synchronously** (Jacobi-style: all `j` read
the previous tick's `S`, none read partially-updated neighbors) for
`settle_ticks` iterations, or until convergence (§2.4).

### 2.4 Convergence / divergence

Per-neuron divergence at tick `t`:

```
δ_j(t) = || s_j(t) - s_j(t-1) ||_2
```

Mesh-level max divergence `Δ(t) = max_j δ_j(t)`. Convergence is declared
when `Δ(t) < ε` for a configurable `ε` (`divergence_tolerance` doubles as
this threshold from the other side — see §8 for the stability mechanism
that fires when it's exceeded persistently instead).

### 2.5 Output

```
output_k = mean(content_dims(s_j))   for each OUTPUT neuron j, in ascending neuron_id order
```

`content_dims` excludes dimension 0. This mean-pool is the default readout;
alternative readouts (last-dim, learned linear head) are pluggable — see
§13.4.

### 2.6 Learning rule

Three-factor Hebbian, gated by the target neuron's **vale** (§9):

```
Δ W_ij[k][l] = η_eff(j) · pre_i · post_j · R · dt

η_eff(j) = η_base · (1 - vale_j)         // high vale ⇒ resistant to change
```

`pre_i`, `post_j` are pre/post activations, `R` is a scalar reward/reinforcement
signal (can be a TD error, RLHF score, or any external critic output), `dt`
is the integration step. Weights are clamped to `[-1, 1]` after every update.

STDP (`asi_core/neural_core.py: Synapse.update_weight_stdp`) is available as
an alternative time-asymmetric rule for spiking configurations; it is not
mesh-default because the mesh's synchronous settle model has no natural
spike-timing axis — it applies to the scalar-synapse `NeuralCore`/`NeuralLayer`
model, which is architecturally distinct (sparse random layers, not dense
mesh) and is retained for spiking-network experiments, not as the mesh's
learning path.

---

## 3. Scaling

### 3.1 Where dense storage breaks

Storage and per-tick compute are:

```
memory(W)  = N² · D² · sizeof(float)
compute(tick) = O(N² · D²)
```

At `D=4` (fp32): `N=64` → 256 KB, trivial. `N=4,096` → 1 GB. `N=16,384` → 16
GB. `N=65,536` → 268 GB — past single-node memory regardless of compute
budget. **Literal all-to-all storage/compute is only viable up to roughly
low-tens-of-thousands of neurons at small D on a single machine.** Past that
point the mesh must switch representations while preserving the *semantic*
guarantee ("every neuron can reach every other neuron within one settle") —
see §3.3.

### 3.2 Scaling knobs, cheapest to most invasive

1. **Shrink D.** Compute/memory are quadratic in D; halving D quarters both.
2. **fp16 / bf16 / int8 weights.** 2x–4x memory reduction; the mesh already
   assumes quantization noise via `MeshLM`'s straight-through-estimator fake
   quantization, so this is a supported, not experimental, path.
3. **Group-sparse activation (§6).** Reduces *active* compute per tick to
   `O(k² · D²)` where `k` is the number of active neurons, without touching
   storage — good when routing, not memory, is the bottleneck.
4. **Low-rank factorization of W.** Replace each `D×D` block with `U_ij V_ij^T`,
   rank `r < D`, cutting both storage and compute per block to `O(r·D)`.
   Because all blocks share the same `(N, D)` shape, this generalizes to
   factorizing the *whole* tensor: `W_ij ≈ A_i B_j^T` with shared low-rank
   factors `A, B ∈ R^(N × r·D)`. This turns the per-tick update into two
   dense matmuls, `O(N² · r · D)`, and is the standard way to keep "every
   neuron reaches every other" true while dropping the quadratic-in-D² term.
5. **Block-sparse mesh (true sparsification, §4.3).** Store only weight
   blocks above a magnitude/attention threshold; approximate full
   connectivity via multi-hop reachability instead of single-hop density.
   This is the only knob that gives up exact one-hop all-to-all; it trades
   the mesh's headline guarantee for scale and should be an explicit,
   documented config choice (`connectivity_mode="dense" | "low_rank" |
   "block_sparse"`), not a silent fallback.
6. **Sharding across devices (§7.4).** Orthogonal to the above — partitions
   the same dense (or low-rank) tensor across workers rather than shrinking
   it.

### 3.3 Recommended default scaling policy

- `N ≤ 2,048`: dense `W`, fp32, single process. (Covers `create_mesh("large")`
  and beyond with headroom.)
- `2,048 < N ≤ 20,000`: dense `W`, bf16/int8, optionally rank-reduced.
- `N > 20,000`: low-rank factorized `W` (§3.2.4) plus block-sparse pruning of
  factor entries below a magnitude threshold, sharded per §7.4. Document any
  precision loss in `get_statistics()` output (add a `connectivity_mode` and
  `effective_rank` field).

---

## 4. Memory layout

### 4.1 Neuron state — struct-of-arrays

The reference implementation stores neurons as `Dict[int, NeuronState]`
(array-of-structs) for readability. The performance-critical layout is
struct-of-arrays, contiguous per field, so a settle tick is a sequence of
vectorizable passes rather than pointer-chasing:

```
state:        float32[N][D]          // row-major, row i = neuron i's s_i
input_flag:   float32[N]
vale:         float32[N]
role:         uint8[N]
group:        uint16[N]
activation:   float32[N]
```

This is exactly the layout `models && skills/core/mesh.ts` uses for its
`Float32Array`-backed `NeuronMesh`, and is why the TS runtime is the
performance reference even though the Python file is the readability
reference.

### 4.2 Connection tensor — dense case

Row-major `float32[N][N][D][D]`, indexed `W[i][j][k][l]` = influence of
source dim `k` on target dim `l` for the `i → j` edge. The self-diagonal
`i == j` is never allocated (skip it in the index arithmetic rather than
storing and masking zeros — saves `N·D²` elements and avoids a branch in the
hot loop).

For the propagation loop's access pattern (fixed target `j`, iterate all
sources `i`, for each do a `D×D · D` matvec), the **target-major** layout
`W[target][source][k][l]` gives better cache locality than
`W[source][target][k][l]`, because the inner loop over `i` for a fixed `j`
then reads contiguous memory. This is the loop-reordering optimization
documented in the TS engineering log (`.jules/bolt.md`) for
`NeuronMesh.propagate()`.

### 4.3 Connection tensor — sparse/CSR case

When connectivity is pruned (block-sparse mode, §3.2.5) or when group
routing makes most edges inactive most of the time (§6), store per-target
adjacency in **CSR** (compressed sparse row, row = target):

```
row_ptr:   int32[N+1]        // row_ptr[j]..row_ptr[j+1] indexes into col_idx/blocks
col_idx:   int32[nnz]        // source neuron ids, sorted per row
blocks:    float32[nnz][D][D]
```

CSR is rebuilt lazily, not on every mutation: mesh edits (add/remove neuron,
change routing) mark the CSR **dirty**; the next `propagate()` call rebuilds
it once and caches it until the next structural change. This lazy
invalidation is exactly `NeuronMesh`'s existing CSR cache strategy in
`mesh.ts` — the mesh design here standardizes it as the sparse storage
contract rather than a TS-only optimization.

### 4.4 Serialization layout

`save_state()` / `load_state()` (already implemented in
`asi_core/neural_mesh.py`) round-trip the full tensor as nested JSON, which
is adequate for `N ≲ 1,000` but is `O(N²D²)` JSON text for larger meshes. For
larger meshes, serialize dense/low-rank weights as raw binary buffers
(e.g. `.npy`/`safetensors`) with a small JSON sidecar for config, neuron
metadata, and diagnostics — never encode weight matrices as JSON arrays past
that size.

---

## 5. Connection storage

Three representations, selected by `connectivity_mode`, all implementing the
same read interface (`get_block(i, j) -> D×D`, `edges_into(j) -> iterable of
(i, block)`) so the propagation and learning code is representation-agnostic:

| Mode | Storage | `edges_into(j)` cost | When |
|---|---|---|---|
| `dense` | `float32[N][N][D][D]`, diagonal excluded | O(N) | N ≤ ~20k (§3.3) |
| `low_rank` | factors `A[N][r·D]`, `B[N][r·D]` | O(N) amortized via matmul | large N, exact one-hop density preserved |
| `block_sparse` | CSR per §4.3 | O(nnz_row(j)) | N huge, or activity is naturally sparse (routing) |

Adding or removing a neuron (`ElasticCoreBlock.addNeuron` is the existing
TS precedent) means:

- `dense`: reallocate the tensor with the new `N`, copy existing blocks,
  initialize new row/column with the standard init scale (§2.7 in the
  original file, `1/sqrt(N·D)`), never leave a hole — a mesh always has
  contiguous neuron ids `0..N-1` internally even if a stable external id is
  kept in a separate map for callers that hold onto ids across a resize.
- `low_rank`: append a new row to `A` and `B`.
- `block_sparse`: append a new empty row to CSR, mark dirty, defer the
  actual edge population to whatever routing/pruning policy decides which
  edges the new neuron should carry (its default is "fully connected until
  first prune pass," to preserve the invariant at creation time).

---

## 6. Sparse optimization (activity routing)

Storage density and *activation* density are independent. Even a fully
dense `W` benefits from not evaluating most of it every tick when the task
only needs a subset of neurons active — this is the mesh's MoE-equivalent.

### 6.1 Group routing

`active_groups ⊆ {0 .. n_groups-1}`, `skill_top_k = min(k, n_groups)`
groups active per tick. `_get_active_neurons()` returns the neuron-id set for
active groups. Inactive neurons:

- do not compute (`compute_neuron_input` short-circuits to a zero vector),
- do not receive updates (state carried forward unchanged),
- **do still count as edges** for active neurons that would read from them —
  i.e. an active neuron's `net_j` sum still includes `W_ij · s_i` for
  inactive `i`, since `s_i` is a real, currently-frozen value, not absent
  information. Only the source-side compute is skipped when `i` itself is
  inactive as a *target* in some other pass.

### 6.2 Router

A learned or heuristic router selects the top-k groups per tick from input
statistics (content-based gating, à la MoE). The reference implementation's
router is a placeholder that activates all groups
(`_get_active_neurons` docstring: "For now, all groups are active"); this
spec fixes the intended contract so the placeholder can be replaced without
changing any caller:

```
router(input_vector, group_scores_state) -> Set[int]   # returns k group ids
```

`group_scores_state` is router-owned mutable state (e.g. an exponential
moving average of per-group utilization, for load-balancing losses) — it is
not part of `NeuronState` because it's a routing concern, not a neuron
concern.

### 6.3 Magnitude pruning

Independent of routing: after N training steps, blocks with Frobenius norm
below a threshold `τ` are dropped from `dense`/`low_rank` storage into an
implicit-zero CSR entry (never re-densified automatically — pruning is
one-directional per epoch; re-growth, if desired, is a separate explicit
"regrow" pass that reinitializes at small scale, not a magnitude check in
reverse).

---

## 7. Runtime updates / parallel execution

### 7.1 Update semantics: synchronous (Jacobi), not asynchronous (Gauss-Seidel)

All neurons compute `net_j` from the *same* snapshot of `S(t)`, then all
updates are committed together to produce `S(t+1)`. This is required for
determinism and for the mesh's parallelism model (§7.3): synchronous updates
have no order dependence, so tick `t`'s N update computations are
embarrassingly parallel. Asynchronous/Gauss-Seidel updates (reading
in-progress `S(t+1)` values) are explicitly out of scope — they'd converge
faster in some cases but make results order- and thread-count-dependent,
which is unacceptable for reproducible tests (§15) and for the divergence
correction mechanism (§8), which reasons about a single well-defined
`S(t) → S(t+1)` transition.

### 7.2 Structural updates while running

Adding/removing neurons or editing routing must not happen *mid-settle*.
The contract: structural mutation methods (`add_neuron`, `remove_neuron`,
`set_active_groups`) either (a) block until the current settle's
`settle_ticks` loop finishes, or (b) queue the change and apply it at the
start of the next `activate()`/`step_continuous()` call. Implementations
must pick one and document it; queuing (b) is preferred for
latency-sensitive callers (e.g. a live UI slider changing active groups).

### 7.3 Parallel execution within a tick

Per tick, the update `s_j(t) → s_j(t+1)` for different `j` is independent
(§7.1), so it parallelizes over neurons:

- **CPU, moderate N**: partition `0..N-1` into contiguous chunks, one worker
  thread per chunk, each computing `compute_neuron_input` + activation for
  its chunk against the read-only snapshot `S(t)`. No locks needed — workers
  only read `S(t)` and `W`, and only write their own slice of `S(t+1)`.
- **GPU / large N**: the whole tick is two dense matmuls,
  `net = S(t) @ W_flat + b` (with `W_flat` reshaped to `(N·D, N·D)` block
  form, or expressed as batched `(N,D,D)` matmuls against `S(t)`), followed
  by an elementwise `tanh`. This is the natural target for the `low_rank`
  storage mode (§3.2.4): `net = S @ B @ Aᵀ` factors into two `O(N·r·D)`
  matmuls that map directly onto BLAS/cuBLAS.
- **Multi-tick pipelining is not valid**: tick `t+1` depends on all of tick
  `t`'s outputs, so ticks themselves are strictly sequential — the only
  parallelism axis inside one settle is across neurons, not across ticks.

### 7.4 Sharding across processes/devices

For `dense`/`low_rank` at the top of the scaling range (§3.3), partition
neurons into shards `0..P-1`. Each shard owns its rows of `S` and the
corresponding row-block of `W`. Per tick:

1. Each shard computes partial `net_j` contributions from its local source
   neurons for every target `j` (local and remote).
2. Shards exchange partial sums for cross-shard targets (an all-reduce or
   scatter-reduce over the `(shard, target)` partial vectors — this is the
   only network-bound step).
3. Each shard applies `tanh` + bias locally to the targets it owns.

This is standard model-parallel tensor sharding; the mesh's D×D block
structure doesn't change the pattern, it just makes each "element" of the
sharded matrix a `D×D` block instead of a scalar.

### 7.5 Continuous mode concurrency

`step_continuous()` carries state across calls (`_carried_state`). It is
**not** safe to call concurrently on the same mesh instance from multiple
callers — it's a stateful stream, like a file handle. Concurrent access
requires either an external lock per mesh instance or per-caller mesh
instances (cheap, since state is `O(N·D)`, not `O(N²·D²)` — only the weight
tensor is shared and read-only during inference).

---

## 8. Stability

### 8.1 Failure modes

- **Divergence**: settle values grow/oscillate without bound (large `tanh`
  arguments saturate, but pre-activation `net` can still blow up numerically
  in extreme weight configurations, or oscillate at the saturated boundary).
- **Dead mesh**: everything collapses to 0 and stays there (weights too
  small, or vale starves learning everywhere).
- **NaN/Inf propagation**: a single NaN spreads to the whole mesh within one
  tick, since every neuron reads every other.

### 8.2 Live correction (existing mechanism, formalized)

Track `consecutive_high_divergence`: ticks in a row where mesh-level
`Δ(t) > divergence_tolerance`. When it reaches `sustained_divergence_ticks`,
apply damping to the *about-to-commit* new state, blending it back toward
the previous tick:

```
S_corrected(t+1) = α · S(t) + (1-α) · S(t+1)      // α = damping_factor, default 0.5
```

then reset the counter. This is a circuit breaker, not a per-tick
regularizer — it only engages on sustained divergence, so it doesn't damp
normal settling dynamics. Every correction increments a diagnostic counter
(`_live_corrections`) surfaced via `get_statistics()`; a mesh that corrects
frequently in production is a signal to lower learning rate or `vale`
distribution, not something to silently tolerate.

### 8.3 Numerical guards

- `tanh` bounds activations to `(-1, 1)` unconditionally — the nonlinearity
  itself is the primary stability mechanism; `net` can be arbitrarily large
  without producing an invalid state.
- Weight clamps `[-1, 1]` after every learning update (§2.6) prevent runaway
  weight growth independent of activation saturation.
- NaN/Inf check: `get_statistics()` / the settle loop should assert
  finiteness of `S(t)` after each tick in debug builds; a NaN target dies
  fast rather than silently corrupting the mesh (a mesh, once NaN, cannot
  self-heal — every neuron reads every other, so isolate-and-reset is not
  possible without a full reinitialize of the affected neuron's
  connections).
- `vale` and weight values are bounded ranges (`[0,1]`, `[-1,1]`) — bound
  every persistent scalar the mesh maintains, not just activations.

### 8.4 Zero-sum vale as a stability mechanism, not just a plasticity control

Because `Σ vale_i` is conserved (§9), the mesh cannot globally freeze
(`vale → 1` everywhere) or globally destabilize into runaway plasticity
(`vale → 0` everywhere) without an explicit, visible redistribution call —
global stability drift is structurally excluded by the invariant, not just
discouraged by defaults.

---

## 9. Synchronization (the vale system)

"Synchronization" here means keeping the mesh's *global invariants*
consistent under concurrent/iterative mutation — the zero-sum vale budget
being the primary one requiring active enforcement (not thread
synchronization, which is covered in §7).

### 9.1 Invariant

```
Σ_i vale_i = vale_total = vale_init · N     (conserved across the mesh's lifetime)
```

### 9.2 Redistribution algorithm

`redistribute_vale(changes: {neuron_id: Δvale})`:

1. Apply each `Δvale` directly, clamping each `vale_i` to `[0, 1]`.
2. Recompute `current_total = Σ vale_i`.
3. If `|current_total - vale_total| > ε`, rescale **all** neurons
   proportionally: `vale_i *= vale_total / current_total`, then re-clamp.

Step 3's proportional correction, not a targeted correction on only the
neurons that changed, is deliberate: it spreads the zero-sum cost/benefit
across the whole population, matching the intended semantics of "raising
some neurons' stability lowers everyone else's, proportionally" rather than
"...lowers an arbitrary neuron's."

### 9.3 Clamping interacts with conservation — documented, not silently accepted

Because individual `vale_i` are clamped to `[0,1]` both before and after the
proportional rescale, repeated extreme redistribution requests (e.g.
`raise_vale` on the same neuron past where the rest of the population can
absorb the loss down to `vale=0`) can leave the *actual* achieved total
slightly off from `vale_total` — this is expected saturation behavior, not a
bug, and `get_statistics()` should expose `Σ vale_i` alongside
`vale_total` so callers can detect saturation rather than assuming exact
conservation always holds at the extremes.

### 9.4 `raise_vale` / `demote_vale`

Thin wrappers over `redistribute_vale` with a uniform `+amount`/`-amount`
per listed neuron id — these are the public API surface (§13); callers
should not call `redistribute_vale` directly with hand-rolled per-neuron
deltas unless implementing a new policy, to keep the "uniform push/pull"
semantics discoverable.

---

## 10. Signal propagation

Already specified mathematically in §2.3; this section covers the
*procedural* contract an implementation must satisfy.

### 10.1 `activate(input_vector)` contract

1. If not `continuous`: reset all non-`INPUT` neuron states to the
   zero vector deterministically (no RNG in the reset path — determinism
   here is required for reproducible tests, §15).
2. Clamp `input_vector` onto `INPUT` neurons (`clamp_input_neurons`),
   setting `input_flag = 1` for driven neurons and their content
   dimensions from the input.
3. Run the settle loop (§2.3/§10.2) for up to `settle_ticks`.
4. Read output via `_read_output()` (§2.5).
5. Return the output vector; the mesh's internal `S` is left at its final
   settled value for diagnostics/inspection, but is *not* implicitly reused
   by the next `activate()` call unless `continuous=True`.

### 10.2 Settle loop contract

Per tick: compute the active mask (§6.1) once for the whole tick, compute
every active neuron's `net_j` and next-state from the *previous* tick's full
`S` (§7.1 — no partial updates observed mid-tick), track per-neuron and
mesh-level divergence, apply live correction if triggered (§8.2), then
commit `S(t+1)`.

### 10.3 `step_continuous(input_vector)` contract

1. If `_carried_state` is set, restore it into `S` before running.
2. Delegate to `activate()` (which skips the reset step in continuous mode
   per §10.1.1).
3. Save the post-settle `S` into `_carried_state` for the next call.

This makes continuous mode a thin stateful wrapper around the same settle
mechanics, not a different propagation algorithm — there is exactly one
propagation rule in the mesh; "continuous" only changes what state the
settle loop starts from.

---

## 11. Edge cases

Explicit handling required, with the behavior each must have:

| Case | Required behavior |
|---|---|
| `N = 2` (minimum with `n_input < N`) | Every neuron connects to exactly one other; degenerates to a 2-node system but must not special-case the math — `N·(N-1) = 2` connections, loop bodies unchanged. |
| `n_input == N - 1` (max allowed) | Exactly one non-input neuron must exist to serve as output; assert this rather than silently producing zero output neurons. |
| `D = 2` (minimum) | Exactly one content dimension; `get_content_state()` returns a length-1 vector, still valid for `tanh`/output-mean logic (mean of one element = itself). |
| Input vector longer than `n_input` | `clamp_input_neurons` truncates via `input_pattern[:self.n_input]` — extra values are silently dropped; this must be documented as intentional truncation, not silently-correct behavior a caller should rely on. |
| Input vector shorter than `n_input` | Unfilled input neurons keep `input_flag=1` (still marked as "driven") but their un-supplied content dimensions retain whatever value was there before the clamp call — callers must not assume unset dims reset to 0 unless they reset the mesh first (`activate()`'s non-continuous reset handles this for the common path; `clamp_input_neurons` called standalone does not). |
| All neurons in one group (`n_groups = 1`) | `_get_active_neurons()` returns `None` (meaning "all active"), not a set containing every id — callers checking `active_mask is not None` must treat `None` as the fast-path "everyone active," not iterate a full-membership set. |
| `active_groups` set to empty | Every neuron is dormant; a full settle produces no change and output is whatever `S` already held (zeros, on first call). Not an error — a valid "mesh paused" state. |
| Divergence correction fires on tick 0 | Only possible if `sustained_divergence_ticks == 0`; must be handled without indexing `prev_state` from a nonexistent tick -1 (tick 0's `prev_state` is the pre-settle initial `S`, established before the loop starts, per §10.1). |
| NaN/Inf enters via external input or a corrupted `load_state` | Since every neuron reads every other, one NaN neuron poisons the whole mesh within one tick. `load_state` must validate finiteness of loaded weights/state before accepting them (reject and raise, don't silently load garbage). |
| `load_state` config mismatch | Must raise (`n_neurons`/`n_dimensions` mismatch), never partially load — a half-applied load leaves an inconsistent `N` between `neurons` and `connections` dicts, which corrupts every subsequent settle silently. Already correctly implemented via early `ValueError`. |
| Resize (`add_neuron`) mid-settle | Disallowed per §7.2; must be queued or blocked, never applied to a `W` tensor mid-tick. |
| Removing a neuron other structures reference by id | External ids that pointed at the removed neuron must be invalidated, not silently reassigned to a different neuron at the same slot — a stale id must error on next use, not resolve to the wrong neuron (this matters for `ElasticCoreBlock`, which is externally editable). |
| `vale_total` saturation | Covered in §9.3 — statistics must expose the discrepancy rather than asserting exact conservation always holds. |
| Concurrent `step_continuous` calls on one instance | Undefined/unsafe per §7.5 — must be documented, not silently "mostly working." |

---

## 12. Algorithms (summary reference)

1. **Initialization** — `O(N²D²)` weight init (Gaussian, scale
   `1/sqrt(N·D)`), `O(N)` neuron init.
2. **Settle** — `settle_ticks ×` [`O(active²·D²)` propagation +
   `O(active·D)` activation + `O(active·D)` divergence check].
3. **Live correction** — `O(N·D)` blend, applied at most once per
   `sustained_divergence_ticks` window.
4. **Hebbian update** — `O(E·D²)` over active connections `E` (dense: `E =
   N²-N`; sparse: `E = nnz`).
5. **Vale redistribution** — `O(N)` per call.
6. **Save/load** — `O(N²D²)` for dense weights (§4.4 notes the binary
   format for large N).
7. **Routing (§6.2)** — `O(n_groups)` scoring + `O(N)` mask construction,
   independent of `N²`.

---

## 13. APIs

### 13.1 Core lifecycle (mirrors `asi_core/neural_mesh.py`, canonical signatures)

```python
class NeuralMesh:
    def __init__(self, n_neurons: int, n_dimensions: int, n_input: int,
                 n_groups: int = 1, settle_ticks: int = 4,
                 vale_init: float = 0.1, divergence_tolerance: float = 0.5,
                 sustained_divergence_ticks: int = 3, continuous: bool = False,
                 connectivity_mode: str = "dense"): ...

    def activate(self, input_vector: List[float]) -> List[float]: ...
    def step_continuous(self, input_vector: List[float]) -> List[float]: ...

    def raise_vale(self, neuron_ids: List[int], amount: float = 0.3) -> None: ...
    def demote_vale(self, neuron_ids: List[int], amount: float = 0.3) -> None: ...

    def apply_hebbian_learning(self, pre_activations: Dict[int, float],
                                post_activations: Dict[int, float],
                                reward_signal: float = 1.0, dt: float = 0.001) -> None: ...

    def get_statistics(self) -> Dict: ...
    def save_state(self) -> Dict: ...
    def load_state(self, state: Dict) -> None: ...
```

### 13.2 Structural editing (extends the reference impl to match `ElasticCoreBlock`'s capability)

```python
    def add_neuron(self, role: NeuronRole = NeuronRole.HIDDEN,
                   group: int = 0) -> int:                     # returns new neuron_id
    def remove_neuron(self, neuron_id: int) -> None:            # invalidates the id (§11)
    def set_active_groups(self, groups: Set[int]) -> None:      # queued per §7.2
```

### 13.3 Introspection

```python
    def get_block(self, source_id: int, target_id: int) -> List[List[float]]: ...
    def edges_into(self, target_id: int) -> Iterable[Tuple[int, List[List[float]]]]: ...
    def last_settled_state(self) -> Dict[int, List[float]]: ...   # the _last_settled snapshot
```

`get_block`/`edges_into` are the representation-agnostic accessors referenced
in §5 — every `connectivity_mode` implements these two, and all other mesh
code (propagation, learning, statistics) goes through them rather than
touching `self.connections`/`self.W` directly. This is what lets
`connectivity_mode` change without touching the settle loop.

### 13.4 Pluggable readout (formalizes §2.5's "pluggable" note)

```python
ReadoutFn = Callable[[Dict[int, List[float]], List[int]], List[float]]
# (settled_state_by_neuron, output_neuron_ids_sorted) -> output_vector

    def set_readout(self, fn: ReadoutFn) -> None: ...
```

Default readout is the mean-pool from §2.5; a learned linear head is a valid
`ReadoutFn` for training scenarios (`MeshLM` already does this in the
trainable core — this API generalizes it into the reference mesh so both
stay in sync).

### 13.5 Cross-language parity

The TS (`NeuronMesh`, `ElasticCoreBlock`) and Python (`NeuralMesh`, `MeshLM`)
implementations must expose equivalent operations under these names (`propagate`
↔ `activate`, `addNeuron` ↔ `add_neuron`, vale getters/setters, `save`/`load`)
so that design changes to this spec update all three call sites rather than
one implementation silently drifting from the documented contract.

---

## 14. Testing

Existing coverage in `asi_core/test_neural_mesh.py` (503 lines, 9 test
classes) already exercises: initialization/config validation, all-to-all
connection counting, multidimensional state shape, zero-sum vale
(distribution/redistribution/bounds), settle dynamics (activation shape,
tick tracking, input clamping, output shape), vale-gated Hebbian learning
(weight change, vale gating direction, reward sign), continuous-mode state
carry, expert group routing/balance/filtering, state save/load round-trip
and config-mismatch rejection, statistics collection, divergence tracking,
and the `create_mesh` factory. That suite is the baseline; this spec adds
required coverage for the parts formalized above that aren't yet
implemented/tested:

### 14.1 New required test classes

- **Connectivity-mode parity** — for a fixed seed/config, `dense` and
  `low_rank` modes must produce settle outputs within a documented
  tolerance of each other (they are approximations of the same tensor, not
  independent implementations); `block_sparse` must reproduce `dense`
  exactly at zero pruning threshold.
- **Structural edit safety** — `add_neuron` mid-settle is rejected or
  queued (§7.2), not applied immediately; a removed neuron's stale id
  raises on next use (§11) rather than resolving silently.
- **NaN/Inf rejection** — `load_state` with a NaN in `weight_matrix` raises
  before mutating the mesh (no partial state corruption); a NaN injected
  into `S` via a mocked `compute_neuron_input` is caught by a debug-mode
  finiteness assertion within one tick.
- **Vale saturation reporting** — extreme repeated `raise_vale` calls that
  cannot be fully absorbed leave `get_statistics()`'s reported total
  measurably off from `vale_total`, and this is exposed, not masked.
- **Parallel/sequential equivalence** — a chunked-parallel tick (§7.3)
  produces bit-identical (or float-tolerance-identical, if using different
  reduction order) results to the sequential reference, verifying the
  Jacobi/synchronous contract actually holds under a real threaded
  implementation, not just in the single-threaded reference.
- **Router contract** — a mock router returning a fixed top-k group set
  produces the same active mask as manually setting `active_groups` to that
  set, verifying §6.2's contract shape before a real router is implemented.
- **Cross-language parity smoke test** — same seed, same config, same
  input into the Python reference and the TS runtime produce outputs within
  tolerance; run as part of `npm test` (`test/smoke.mjs`) and
  `python -m pytest asi_core/`, flagged to run together in CI so drift
  between the two is caught immediately rather than discovered later.

### 14.2 Existing verification entry points (unchanged, still authoritative)

- `python main.py demo` / `test_integration.py` — trains a mesh via
  NeuroLang, verifies taught behavior survives self-healing + extension
  install + live skill-building as one continuous object.
- `python test_elastic_mesh.py` — mesh + expert-core smoke (gradient flow,
  shape preservation, no NaN/Inf).
- `npm test` (`test/smoke.mjs`) — `ElasticCoreBlock` all-to-all density,
  bidirectional wiring on `addNeuron`, vale-gated movement, QAT residual
  tracking.
- `benchmarks/mesh_benchmark.ts` — `propagate()` throughput; new
  `connectivity_mode`s should extend this benchmark rather than get a
  separate one, so dense/low-rank/block-sparse throughput stays
  directly comparable.

---

## See also

- `wiki/Neuron-Mesh.md` — the existing shorter overview this document
  formalizes and extends into a full implementation spec.
- `docs/asi_architecture_v2.md` — where the mesh sits within the larger
  25-capability ASI system.
- `asi_core/neural_mesh.py`, `asi_core/test_neural_mesh.py` — canonical
  Python reference implementation and its test suite.
