# Hyper-Dimensional Thinking (HDT) System

Complete specification of the Hyper-Dimensional Thinking layer built on top of
the existing ASI neural substrate (`asi_core/neural_mesh.py`,
`asi_core/neural_core.py`, `asi_core/neural_states.py`). HDT gives every
neuron a structured, multi-part internal state (not a single scalar) and
defines how that state is computed, communicated, predicted, stored, and
reasoned over. Reference implementation: `asi_core/hyperdim_thinking.py`.
Tests: `asi_core/test_hyperdim_thinking.py`.

## 1. Mathematical Model

A neuron `i` is not a scalar activation but a point in a `D`-dimensional
hyperspace, `D` on the order of hundreds to thousands (typical HDC regime:
`D ∈ [512, 10000]`), partitioned into named **subspaces**:

```
x_i ∈ R^D  =  [ x_i^sem | x_i^ctx | x_i^val | x_i^tmp | x_i^meta ]
```

| Subspace | Symbol | Fraction of D | Meaning |
|---|---|---|---|
| Semantic  | `sem`  | 40% | content / "what" — bound concept representation |
| Context   | `ctx`  | 25% | "where/when" — episodic binding, position/role |
| Value     | `val`  | 10% | scalar-like: reward, salience, confidence, vale |
| Temporary | `tmp`  | 15% | fast-decaying working state (this tick's evidence) |
| Meta      | `meta` | 10% | self-referential: uncertainty, novelty, control gates |

Each subspace is itself a vector so a neuron's total state is a concatenation.
This is the "multiple internal state variables per neuron" requirement: the
neuron does not have one number, it has five typed vector-valued variables
that evolve on different timescales and participate in different equations.

### 1.1 Global dynamical system

For a mesh of `N` neurons, let `X(t) ∈ R^{N×D}` be the full state matrix at
discrete tick `t`. The system evolves as:

```
X(t+1) = (1 − λ) ⊙ X(t) + λ ⊙ φ( W · X(t) + B(t) + η(t) )
```

- `W ∈ R^{(N·D)×(N·D)}`, block-structured as `D×D` matrices `W_ij` per
  ordered neuron pair (source `j` → target `i`), exactly the
  `SynapticConnection.weight_matrix` already present in `neural_mesh.py`.
- `λ ∈ R^D` is a per-subspace **leak/plasticity rate** (subspace-specific
  time constant — `tmp` has high `λ`, `meta`/`val` have low `λ`, giving each
  subspace its own timescale without a separate equation).
- `φ` is an elementwise squashing nonlinearity (`tanh` for `sem`/`ctx`/`tmp`,
  identity clipped to `[0,1]` for `val`, softplus for `meta` uncertainty).
- `B(t)` is external/injected input (sensory clamp, task signal).
- `η(t)` is stochastic exploration noise, annealed over training.

This is a direct generalization of the leaky-integrate dynamics already used
for `membrane_potential` in `neural_core.py` and the settle loop in
`neural_mesh.py`, lifted from a scalar to a structured vector per subspace.

### 1.2 Per-subspace equations

Because `λ` and `φ` are subspace-specific, the single matrix equation above
expands into five coupled but distinct update laws:

```
sem_i(t+1)  = (1-λ_sem)  sem_i(t)  + λ_sem  tanh( Σ_j W_ij^sem  x_j(t) )
ctx_i(t+1)  = (1-λ_ctx)  ctx_i(t)  + λ_ctx  tanh( Σ_j W_ij^ctx  x_j(t) + bind(sem_i, pos_i) )
val_i(t+1)  = clip( val_i(t) + α_v (r(t) - val_i(t)), 0, 1)          # value/vale, reward-tracking
tmp_i(t+1)  = ρ_tmp · tmp_i(t) + (1-ρ_tmp) · evidence_i(t)           # fast decaying working state
meta_i(t+1) = softplus( ‖ x_i(t+1) - x̂_i(t) ‖ )                     # prediction-error-derived uncertainty
```

`x̂_i(t)` is the neuron's own prediction of its state (§8), so `meta` is
literally "how surprised was I" — a self-monitoring signal, computed after
the rest of the state has updated.

## 2. State Vectors

`HDVector` (`asi_core/hyperdim_thinking.py`) is the atomic data type: a plain
`List[float]` of length `D` plus named slice accessors for the five
subspaces. All neuron-level and message-level data is an `HDVector`, so
binding/bundling/similarity are defined once and reused everywhere (mesh
messages, memory traces, predictions).

```
HDVector.sem / .ctx / .val / .tmp / .meta   -> read/write views (slices)
HDVector.random(seed)                       -> unit-norm random hypervector
HDVector.zeros()
```

Layout constants (`SEM_DIM`, `CTX_DIM`, `VAL_DIM`, `TMP_DIM`, `META_DIM`) sum
to `D` and are fixed per `HDThinkingSystem` instance (they are a
configuration, not a per-neuron choice, so all neurons stay comparable under
similarity/bind operations).

## 3. State Transitions

`HDNeuron.step(inbound, dt)` implements §1.2 in code, in this fixed order
each tick (order matters — later steps read outputs of earlier ones):

1. **Integrate** — combine `inbound` (weighted sum of neighbor contributions,
   already computed by the mesh) into `tmp` via exponential moving average.
2. **Bind context** — `ctx' = bind(sem, position_code)` folds in *where this
   information sits* (see §6 for `bind`).
3. **Update semantic** — leaky-integrate `sem` toward `tanh(W·x)`.
4. **Update value** — reward-tracking EMA of `val` toward the incoming
   reward/salience signal.
5. **Predict & measure surprise** — run the forward predictor (§8), compare
   to actual new `sem`, write the error norm into `meta`.
6. **Consolidation check** — if `val` (vale) and `meta` (low surprise, i.e.
   stable) both cross thresholds, promote content from `tmp`/`sem` into the
   long-term store (§5, §9).

This is a strict state machine per neuron: `IDLE -> INTEGRATING -> PREDICTING
-> (CONSOLIDATING) -> IDLE`, implemented as an `Enum` (`NeuronPhase`) so tests
can assert on it directly rather than inferring it from side effects.

## 4. Temporary States

`tmp` is the working-memory subspace: high leak rate (`ρ_tmp ≈ 0.3`, i.e. it
forgets ~70% of its old content per tick), holds *this tick's* raw evidence
before it has been integrated into the slower `sem`/long-term stores. It is
the HDT analogue of `eligibility_trace` in `neural_states.py`, generalized
from a scalar to a vector. Two derived temporary quantities live alongside
it but are not persisted:

- `prediction_error(t)` — computed fresh every tick from §8, feeds `meta`.
- `active_mask` — which neurons participated this tick (expert routing,
  reused from `neural_mesh.py`'s `_get_active_neurons`).

Temporary state is never written to the long-term store directly; it must
pass through consolidation (§9).

## 5. Long-Term States

Long-term state is **not** a per-neuron field — it is a separate associative
store, `MemoryStore`, holding consolidated `(key: HDVector, value: HDVector,
strength: float, last_access: int)` traces. This mirrors real synaptic
consolidation (Chapter references `synaptic_tag` / `gene_expression_level`
in `neural_states.py`): the neuron's fast state changes every tick, but only
tagged, high-vale, low-surprise content gets written into something that
outlives the tick. Consolidation (§9) is the only writer; recall (§10) is
the only reader-that-matters for reasoning.

Long-term entries decay slowly (`strength *= decay_ltm` per tick, `decay_ltm
≈ 0.9999`) and are pruned when `strength` falls below `min_strength`,
giving bounded memory with graceful forgetting instead of unbounded growth.

## 6. Communication

Neurons communicate exclusively through **hyperdimensional algebra** on
`HDVector`s — no raw scalar message passing:

- **Bind** `bind(a, b)`: elementwise multiply (or circular convolution for
  the `sem` block) — combines two vectors into one that is dissimilar to
  both inputs but recoverable via unbind. Used to attach role/position
  information to content (`bind(concept, role)`).
- **Bundle** `bundle(a, b, ...)`: elementwise (weighted) mean followed by
  renormalization — superposes multiple vectors into one that is similar to
  all inputs. Used to combine multiple incoming messages into one neuron
  input.
- **Permute** `permute(a, k)`: cyclic shift by `k` — used to encode sequence
  position without consuming a bind slot (so `permute(x, t)` marks "x at
  time-step t").
- **Unbind** `unbind(a, b) = bind(a, inverse(b))`: recovers the other operand
  of a bind, used for query/recall (§10) and reasoning (§11).

A `Message` is `(sender_id, HDVector, weight)`; the mesh's inbound function
for neuron `i` is `bundle(*[bind(msg.vector, W_ij) ... ])`, i.e. bind each
incoming message with the (learned) edge-specific transform before bundling
— this recovers the matrix-multiply form of §1.1 as a special case of HDC
binding, so the two views (linear-algebra mesh, symbolic HDC) are the same
mechanism.

## 7. Dynamic Updates

`HDThinkingSystem.tick(inputs)` runs one global tick:

1. Clamp `inputs` onto input neurons' `tmp`/`sem`.
2. For every neuron, gather inbound messages from all (or expert-routed
   active) source neurons — reused wiring from `NeuralMesh.connections`.
3. Call `HDNeuron.step` (§3) for every neuron — this is embarrassingly
   parallel and implemented as an independent loop so it can later be
   vectorized/batched without changing semantics.
4. Apply plasticity (`LearningSystem`-style Hebbian/STDP on the bind
   weights `W_ij`, gated by `val`/vale exactly as in `neural_mesh.py`).
5. Run consolidation pass (§9).
6. Advance global tick counter, append a `SettleSnapshot` to bounded
   history (reuses `state_history` pattern from `neural_states.py`).

Convergence/divergence handling reuses the existing live-correction
mechanism in `neural_mesh.py` (`_apply_divergence_correction`) unchanged —
HDT sits above the mesh's settle loop rather than replacing it.

## 8. Prediction

Each neuron owns a lightweight linear forward predictor,
`x̂_i(t) = P_i · x_i(t-1)`, where `P_i` is a `D×D` matrix initialized to the
identity (i.e., "predict no change") and updated online by gradient descent
on prediction error:

```
e_i(t) = x_i(t) - x̂_i(t)                 # prediction error vector
P_i   += η_p · e_i(t) ⊗ x_i(t-1)^T        # outer-product (delta-rule) update
meta_i(t) = softplus(‖e_i(t)‖)            # surprise signal, feeds subspace §1.2
```

`‖e_i(t)‖` (prediction error norm) is the system's operational definition of
*surprise*, and is what gates both attention (higher surprise → higher
learning rate, via the acetylcholine-style neuromodulator hook already in
`neural_core.py`) and consolidation eligibility (§9: only **low**-surprise,
**high**-vale states consolidate — stable, valued content becomes long-term
memory, novel/unstable content stays provisional).

`HDThinkingSystem.predict(horizon)` chains the per-neuron predictors forward
`horizon` ticks without new input, for lookahead/planning queries.

## 9. Memory Interaction

Two directions, both mediated by `MemoryStore` (§5):

**Write (consolidation)** — `consolidate()` runs each tick: for every
neuron `i` with `val_i > θ_val` and `meta_i < θ_meta` (valued and no longer
surprising — the HDT analogue of `synaptic_tag > consolidation_threshold` in
`neural_states.py`), write `(key=ctx_i, value=sem_i)` into `MemoryStore`,
bundling into an existing entry if `cosine_sim(key, existing_key) >
θ_merge` rather than growing unboundedly.

**Read (recall)** — `recall(cue: HDVector, k=1)` returns the `k` stored
values whose keys have highest cosine similarity to `cue` (a `k`-NN cleanup
memory, the standard HDC "cleanup" operation), and injects the best match's
`value` into the querying neuron's `tmp` subspace bound with a "recalled"
tag so it's distinguishable from freshly-perceived input.

## 10. Reasoning

Reasoning is compositional algebra over hypervectors, exposed as
`HDThinkingSystem.reason(query, operator)`:

- **Analogy / relation query**: given `a : b :: c : ?`, compute
  `d̂ = unbind(bind(unbind(b, a), c), identity)` (the classic HDC analogy
  solve: `d ≈ bind(c, unbind(b, a))`), then `recall(d̂)` cleans the noisy
  result up to the nearest stored concept.
- **Conjunction**: `bundle(a, b)` — "state where both a and b hold".
- **Sequence query**: `unbind(seq, permute(role, t))` — "what was bound at
  step t".
- **Chained inference**: repeated bind/unbind/recall, each recall's output
  feeding the next query — a fixed-depth (configurable, default 3) loop with
  early exit once similarity to a recalled item exceeds `θ_confident`, so
  reasoning cost is bounded and testable.

Reasoning never mutates neuron state directly — it operates on copies drawn
from current `sem`/`ctx` plus `MemoryStore` reads, so a reasoning query is
side-effect-free with respect to the live mesh (important for both testing
and for not corrupting working state with speculative what-ifs).

## 11. APIs

Public surface (`asi_core/hyperdim_thinking.py`), mirroring the existing
`NeuralMesh`/`NeuralCore` API shape for consistency:

```python
class HDThinkingSystem:
    def __init__(self, n_neurons: int, dimensions: int = 512, n_input: int = 8,
                 n_groups: int = 4, config: HDConfig | None = None): ...

    def tick(self, inputs: Dict[int, HDVector] | None = None) -> TickResult: ...
    def predict(self, horizon: int = 1) -> Dict[int, HDVector]: ...
    def recall(self, cue: HDVector, k: int = 1) -> List[MemoryTrace]: ...
    def reason(self, a: HDVector, b: HDVector, c: HDVector) -> HDVector: ...
    def consolidate(self) -> int: ...                 # returns count consolidated
    def send_message(self, source: int, target: int, vector: HDVector) -> None: ...
    def get_neuron(self, neuron_id: int) -> HDNeuron: ...
    def get_statistics(self) -> Dict[str, Any]: ...
    def save_state(self) -> Dict[str, Any]: ...
    def load_state(self, state: Dict[str, Any]) -> None: ...

# Free functions — the HDC algebra, usable independent of the class:
def bind(a: HDVector, b: HDVector) -> HDVector: ...
def bundle(*vectors: HDVector, weights: List[float] | None = None) -> HDVector: ...
def permute(a: HDVector, k: int) -> HDVector: ...
def unbind(a: HDVector, b: HDVector) -> HDVector: ...
def cosine_similarity(a: HDVector, b: HDVector) -> float: ...
```

`TickResult`, `MemoryTrace`, `HDConfig`, `NeuronPhase` are small
dataclasses/enums defined alongside. `save_state`/`load_state` follow the
plain-dict-of-JSON-primitives convention already used by `NeuralMesh` and
`StateManager`, so HDT state can be persisted with `json.dump` with no
custom codec.

## 12. Algorithms

Complexity per tick, `N` neurons, `D` dimensions, average fan-in `F`:

| Algorithm | Complexity | Notes |
|---|---|---|
| `bind`/`bundle`/`permute` | `O(D)` | elementwise / cyclic-shift |
| `cosine_similarity` | `O(D)` | one dot product + two norms |
| message gather per neuron | `O(F·D)` | bind each inbound msg then bundle |
| full tick (all neurons) | `O(N·F·D)` | dominant cost; matches mesh's existing `O(N²D²)` worst case when `F=N` and edges are `D×D` matrices — HDT's elementwise bind is the `O(D)` special case used when edges are diagonal (the default, cheaper mode) |
| predictor update per neuron | `O(D²)` | outer-product delta rule; optional, can be disabled for pure-elementwise-`P_i` (diagonal predictor, `O(D)`) when `D` is large |
| `recall` (k-NN over M stored traces) | `O(M·D)` | linear scan; fine for `M` up to ~10⁴, swap for an ANN index (e.g. LSH bucket by sign-bits) beyond that — noted as a future optimization, not implemented now |
| `reason` (bounded chain, depth `d`) | `O(d·D)` plus `d` recalls | early-exits on confidence |

Determinism: all randomness (`HDVector.random`, mesh init) is seeded, so a
given `(config, seed, input sequence)` reproduces bit-identical output —
required for the test suite (§14) to assert on exact values rather than
"roughly equal".

## 13. Data Structures

```
HDVector          # List[float] length D + named subspace slice views
NeuronPhase(Enum)  # IDLE, INTEGRATING, PREDICTING, CONSOLIDATING
HDNeuron           # id, role, state: HDVector, predictor P (List[List[float]]),
                   #   phase, last_error: float, consolidation_count: int
Message            # sender_id: int, vector: HDVector, weight: float
MemoryTrace        # key: HDVector, value: HDVector, strength: float, last_tick: int
MemoryStore        # List[MemoryTrace] + insert/merge/decay/prune/query
TickResult         # tick: int, activations: Dict[int, HDVector], surprises: Dict[int, float],
                   #   consolidated: int, statistics: Dict
HDConfig           # dimensions, subspace fractions, leak rates λ per subspace,
                   #   thresholds (θ_val, θ_meta, θ_merge, θ_confident), decay_ltm, min_strength
HDThinkingSystem   # neurons: Dict[int, HDNeuron], connections (reused NeuralMesh
                   #   SynapticConnection map), memory: MemoryStore, config: HDConfig
```

All structures are plain dataclasses over `List[float]`/`Dict`/`List` (no
NumPy dependency), consistent with the rest of `asi_core` which is
pure-Python by design (see existing `neural_mesh.py`, `neural_core.py`).

## 14. Testing

`asi_core/test_hyperdim_thinking.py`, `unittest`-based like the existing
suites, organized by section so each part of this spec has a corresponding,
named test class:

- `TestHDVector` — subspace slicing round-trips, `random()` determinism
  under a fixed seed, `zeros()`.
- `TestAlgebra` — `bind`/`unbind` invertibility (`unbind(bind(a,b), b) ≈ a`
  within tolerance), `bundle` similarity-to-inputs property, `permute`
  invertibility (`permute(permute(a,k), -k) == a`), `cosine_similarity`
  bounds and self-similarity `== 1.0`.
- `TestNeuronTransitions` — one `HDNeuron.step` call moves through the
  documented phase sequence; `tmp` decays at the configured rate with zero
  input; `val` tracks a constant reward target monotonically.
- `TestPrediction` — predictor error shrinks over repeated exposure to a
  periodic input (learns the pattern); `meta` (surprise) spikes on a novel
  input after convergence on a repeated one.
- `TestMemory` — `consolidate()` only writes entries above threshold;
  `recall()` returns the nearest stored trace for a noisy cue; decay+prune
  bounds store size under continuous low-value writes.
- `TestReasoning` — analogy solve on a hand-built toy vocabulary (bind three
  concepts, assert the fourth recalled concept is the intended one above a
  similarity threshold); sequence bind/unbind round-trip.
- `TestSystemIntegration` — `HDThinkingSystem` end-to-end: construct, run
  `N` ticks with synthetic input, assert statistics are well-formed,
  `save_state`/`load_state` round-trip reproduces identical subsequent
  ticks (determinism check from §12).

Run with `python -m pytest asi_core/test_hyperdim_thinking.py -v` or
`python -m unittest asi_core.test_hyperdim_thinking`.
