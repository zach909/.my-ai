"""
Hyper-Dimensional Thinking (HDT) System

Reference implementation of the design in docs/HYPERDIMENSIONAL_THINKING.md.

Gives every neuron a structured, multi-subspace internal state (semantic,
context, value, temporary, meta) instead of a single scalar, and defines:
- hyperdimensional algebra for communication (bind/bundle/permute/unbind)
- per-neuron state transitions with temporary vs. long-term state
- online prediction with surprise-gated consolidation
- an associative long-term memory store
- compositional reasoning (analogy solving, sequence queries)

Pure Python, no external numeric dependencies, consistent with the rest of
asi_core (neural_core.py, neural_mesh.py, neural_states.py).
"""

import math
import random
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# 2. State vectors
# ---------------------------------------------------------------------------

class HDVector:
    """
    A D-dimensional hypervector partitioned into named subspaces:
    semantic (sem), context (ctx), value (val), temporary (tmp), meta (meta).

    Layout is fixed by fractional sizes so all vectors in a system are
    comparable under bind/bundle/similarity.
    """

    SEM_FRAC = 0.40
    CTX_FRAC = 0.25
    VAL_FRAC = 0.10
    TMP_FRAC = 0.15
    META_FRAC = 0.10

    __slots__ = ("data", "_bounds")

    def __init__(self, data: List[float], bounds: Tuple[int, int, int, int, int]):
        self.data = data
        self._bounds = bounds  # cumulative end indices: (sem_end, ctx_end, val_end, tmp_end, meta_end)

    @staticmethod
    def _compute_bounds(dimensions: int) -> Tuple[int, int, int, int, int]:
        sem = max(1, round(dimensions * HDVector.SEM_FRAC))
        ctx = max(1, round(dimensions * HDVector.CTX_FRAC))
        val = max(1, round(dimensions * HDVector.VAL_FRAC))
        tmp = max(1, round(dimensions * HDVector.TMP_FRAC))
        meta = dimensions - sem - ctx - val - tmp
        if meta < 1:
            meta = 1
        sem_end = sem
        ctx_end = sem_end + ctx
        val_end = ctx_end + val
        tmp_end = val_end + tmp
        meta_end = tmp_end + meta
        return (sem_end, ctx_end, val_end, tmp_end, meta_end)

    @classmethod
    def zeros(cls, dimensions: int) -> "HDVector":
        bounds = cls._compute_bounds(dimensions)
        return cls([0.0] * bounds[-1], bounds)

    @classmethod
    def random(cls, dimensions: int, seed: Optional[int] = None) -> "HDVector":
        rng = random.Random(seed)
        bounds = cls._compute_bounds(dimensions)
        data = [rng.uniform(-1.0, 1.0) for _ in range(bounds[-1])]
        vec = cls(data, bounds)
        return vec.normalized()

    @property
    def dimensions(self) -> int:
        return self._bounds[-1]

    def _slice(self, lo: int, hi: int) -> List[float]:
        return self.data[lo:hi]

    def _set_slice(self, lo: int, hi: int, values: List[float]) -> None:
        self.data[lo:hi] = list(values)[: hi - lo]

    @property
    def sem(self) -> List[float]:
        return self._slice(0, self._bounds[0])

    @sem.setter
    def sem(self, values: List[float]) -> None:
        self._set_slice(0, self._bounds[0], values)

    @property
    def ctx(self) -> List[float]:
        return self._slice(self._bounds[0], self._bounds[1])

    @ctx.setter
    def ctx(self, values: List[float]) -> None:
        self._set_slice(self._bounds[0], self._bounds[1], values)

    @property
    def val(self) -> List[float]:
        return self._slice(self._bounds[1], self._bounds[2])

    @val.setter
    def val(self, values: List[float]) -> None:
        self._set_slice(self._bounds[1], self._bounds[2], values)

    @property
    def tmp(self) -> List[float]:
        return self._slice(self._bounds[2], self._bounds[3])

    @tmp.setter
    def tmp(self, values: List[float]) -> None:
        self._set_slice(self._bounds[2], self._bounds[3], values)

    @property
    def meta(self) -> List[float]:
        return self._slice(self._bounds[3], self._bounds[4])

    @meta.setter
    def meta(self, values: List[float]) -> None:
        self._set_slice(self._bounds[3], self._bounds[4], values)

    def copy(self) -> "HDVector":
        return HDVector(list(self.data), self._bounds)

    def norm(self) -> float:
        return math.sqrt(sum(v * v for v in self.data)) or 1e-12

    def normalized(self) -> "HDVector":
        n = self.norm()
        return HDVector([v / n for v in self.data], self._bounds)

    def __len__(self) -> int:
        return len(self.data)

    def __repr__(self) -> str:
        return f"HDVector(D={self.dimensions})"


# ---------------------------------------------------------------------------
# 6. Communication — hyperdimensional algebra
# ---------------------------------------------------------------------------

def _check_compat(a: HDVector, b: HDVector) -> None:
    if a.dimensions != b.dimensions:
        raise ValueError(f"Dimension mismatch: {a.dimensions} vs {b.dimensions}")


def bind(a: HDVector, b: HDVector) -> HDVector:
    """Elementwise multiply — combine two vectors into a dissimilar-to-both one."""
    _check_compat(a, b)
    return HDVector([x * y for x, y in zip(a.data, b.data)], a._bounds)


def unbind(a: HDVector, b: HDVector) -> HDVector:
    """Inverse of bind under elementwise multiply (b assumed unit-magnitude components)."""
    _check_compat(a, b)
    out = []
    for x, y in zip(a.data, b.data):
        out.append(x / y if abs(y) > 1e-9 else 0.0)
    return HDVector(out, a._bounds)


def bundle(*vectors: HDVector, weights: Optional[List[float]] = None) -> HDVector:
    """Weighted elementwise mean, renormalized — superpose several vectors into one."""
    if not vectors:
        raise ValueError("bundle() requires at least one vector")
    bounds = vectors[0]._bounds
    for v in vectors:
        _check_compat(vectors[0], v)
    if weights is None:
        weights = [1.0] * len(vectors)
    total_w = sum(weights) or 1.0
    dims = bounds[-1]
    acc = [0.0] * dims
    for vec, w in zip(vectors, weights):
        for i in range(dims):
            acc[i] += vec.data[i] * w
    acc = [v / total_w for v in acc]
    return HDVector(acc, bounds).normalized()


def permute(a: HDVector, k: int) -> HDVector:
    """Cyclic shift by k — encodes sequence position without consuming a bind slot."""
    n = len(a.data)
    k = k % n
    if k == 0:
        return a.copy()
    shifted = a.data[-k:] + a.data[:-k]
    return HDVector(shifted, a._bounds)


def cosine_similarity(a: HDVector, b: HDVector) -> float:
    _check_compat(a, b)
    dot = sum(x * y for x, y in zip(a.data, b.data))
    denom = a.norm() * b.norm()
    return dot / denom if denom > 1e-12 else 0.0


# ---------------------------------------------------------------------------
# 13. Data structures
# ---------------------------------------------------------------------------

class NeuronPhase(Enum):
    IDLE = "idle"
    INTEGRATING = "integrating"
    PREDICTING = "predicting"
    CONSOLIDATING = "consolidating"


class MemoryKind(Enum):
    """
    Spec Part 3 section 22 ("Types of Memory"). Short-term working memory
    isn't stored here at all — it's the live `HDNeuron.state.tmp`, which is
    already exactly that: high-activity, temporary, low-vale. This enum
    covers what actually gets written into `MemoryStore`.
    """
    LONG_TERM = "long_term"      # proven-useful, high-value & low-surprise outcomes
    EXPERIENCE = "experience"    # confidently negative outcomes: mistakes/failures to avoid repeating


@dataclass
class HDConfig:
    dimensions: int = 512
    leak_sem: float = 0.3
    leak_ctx: float = 0.3
    leak_val: float = 0.05
    leak_tmp: float = 0.7  # fraction replaced by new evidence each tick
    predictor_lr: float = 0.05
    theta_val: float = 0.6       # long-term consolidation threshold: value/vale must exceed this
    theta_experience: float = 0.3  # experience-memory threshold: value/vale must fall below this
    theta_meta: float = 0.3      # consolidation threshold: surprise must be below this
    theta_merge: float = 0.85    # merge into existing memory trace if similarity exceeds this
    theta_confident: float = 0.8  # reasoning early-exit confidence
    decay_ltm: float = 0.9999
    min_strength: float = 0.05
    reasoning_max_depth: int = 3


@dataclass
class Message:
    sender_id: int
    vector: HDVector
    weight: float = 1.0


@dataclass
class MemoryTrace:
    key: HDVector
    value: HDVector
    strength: float = 1.0
    last_tick: int = 0
    kind: str = MemoryKind.LONG_TERM.value


@dataclass
class TickResult:
    tick: int
    activations: Dict[int, HDVector]
    surprises: Dict[int, float]
    consolidated: int
    statistics: Dict[str, Any]


class MemoryStore:
    """Associative long-term memory: consolidated (key, value) hypervector traces."""

    def __init__(self, config: HDConfig):
        self.config = config
        self.traces: List[MemoryTrace] = []

    def write(self, key: HDVector, value: HDVector, tick: int, kind: str = MemoryKind.LONG_TERM.value) -> bool:
        """Insert a trace, merging into an existing similar trace of the same
        kind instead of growing unboundedly (a mistake should never merge
        into a proven-good long-term trace just because they look similar)."""
        for trace in self.traces:
            if trace.kind == kind and cosine_similarity(key, trace.key) >= self.config.theta_merge:
                trace.value = bundle(trace.value, value, weights=[trace.strength, 1.0])
                trace.key = bundle(trace.key, key, weights=[trace.strength, 1.0])
                trace.strength = min(2.0, trace.strength + 1.0)
                trace.last_tick = tick
                return False
        self.traces.append(
            MemoryTrace(key=key.copy(), value=value.copy(), strength=1.0, last_tick=tick, kind=kind)
        )
        return True

    def recall(self, cue: HDVector, k: int = 1, kind: Optional[str] = None) -> List[MemoryTrace]:
        pool = self.traces if kind is None else [t for t in self.traces if t.kind == kind]
        scored = sorted(pool, key=lambda t: cosine_similarity(cue, t.key), reverse=True)
        return scored[:k]

    def decay_and_prune(self) -> None:
        for trace in self.traces:
            trace.strength *= self.config.decay_ltm
        self.traces = [t for t in self.traces if t.strength >= self.config.min_strength]

    def __len__(self) -> int:
        return len(self.traces)


class HDNeuron:
    """
    A single hyper-dimensional-thinking neuron.

    Holds a structured HDVector state (temporary, fast-moving), a slower
    linear predictor of its own next state, and bookkeeping for the phase
    state machine described in the spec (section 3).
    """

    def __init__(self, neuron_id: int, config: HDConfig, seed: Optional[int] = None):
        self.id = neuron_id
        self.config = config
        self.state = HDVector.zeros(config.dimensions)
        # Diagonal predictor by default (O(D)): x_hat = P ⊙ x_prev
        self.predictor_diag: List[float] = [1.0] * config.dimensions
        self.phase = NeuronPhase.IDLE
        self.last_error: float = 0.0
        self.consolidation_count: int = 0
        self._rng = random.Random(seed)

    def position_code(self) -> HDVector:
        """Deterministic per-neuron position hypervector used to bind context."""
        return HDVector.random(self.config.dimensions, seed=self.id * 7919 + 1)

    def predict(self, prev_state: HDVector) -> HDVector:
        return HDVector(
            [p * x for p, x in zip(self.predictor_diag, prev_state.data)],
            prev_state._bounds,
        )

    def _update_predictor(self, prev_state: HDVector, error: HDVector) -> None:
        lr = self.config.predictor_lr
        for i in range(len(self.predictor_diag)):
            self.predictor_diag[i] += lr * error.data[i] * prev_state.data[i]

    def step(self, inbound: HDVector, reward: float, dt: float = 1.0) -> float:
        """
        Run one full transition (integrate -> bind context -> update semantic
        -> update value -> predict & measure surprise). Returns the surprise
        (prediction error norm) for this tick.
        """
        prev_state = self.state.copy()

        # 1. Integrate inbound evidence into tmp (fast working state).
        self.phase = NeuronPhase.INTEGRATING
        rho_tmp = 1.0 - self.config.leak_tmp
        new_tmp = [
            rho_tmp * old + (1 - rho_tmp) * new
            for old, new in zip(self.state.tmp, inbound.tmp)
        ]
        self.state.tmp = new_tmp

        # 2. Bind context with this neuron's position code.
        pos = self.position_code()
        bound_ctx = [s * p for s, p in zip(self.state.sem, pos.sem)]
        leak_ctx = self.config.leak_ctx
        self.state.ctx = [
            (1 - leak_ctx) * old + leak_ctx * math.tanh(b)
            for old, b in zip(self.state.ctx, bound_ctx[: len(self.state.ctx)])
        ]

        # 3. Update semantic subspace toward tanh(inbound).
        leak_sem = self.config.leak_sem
        self.state.sem = [
            (1 - leak_sem) * old + leak_sem * math.tanh(new)
            for old, new in zip(self.state.sem, inbound.sem)
        ]

        # 4. Update value (reward-tracking EMA).
        leak_val = self.config.leak_val
        self.state.val = [
            max(0.0, min(1.0, (1 - leak_val) * old + leak_val * reward))
            for old in self.state.val
        ]

        # 5. Predict & measure surprise.
        self.phase = NeuronPhase.PREDICTING
        predicted = self.predict(prev_state)
        error_vec = HDVector(
            [a - b for a, b in zip(self.state.data, predicted.data)],
            self.state._bounds,
        )
        error_norm = error_vec.norm()
        self._update_predictor(prev_state, error_vec)
        # Overflow-safe softplus of error_norm, shifted so surprise -> 0 as
        # error_norm -> 0 (unshifted softplus floors at ln(2) even for a
        # perfect prediction, which made consolidation's avg_meta < theta_meta
        # check unreachable at the default threshold).
        surprise = math.log1p(math.exp(min(50.0, error_norm))) - math.log(2.0)
        self.state.meta = [surprise] * len(self.state.meta)
        self.last_error = surprise

        self.phase = NeuronPhase.IDLE
        return surprise

    def should_consolidate(self) -> bool:
        avg_val = sum(self.state.val) / len(self.state.val)
        avg_meta = sum(self.state.meta) / len(self.state.meta)
        return avg_val > self.config.theta_val and avg_meta < self.config.theta_meta

    def should_record_experience(self) -> bool:
        """
        Spec Part 3 section 22: experience memory captures confidently bad
        outcomes ("a previous coding mistake", "a failed experiment") so
        they aren't repeated — the mirror image of should_consolidate()'s
        confidently good outcomes.
        """
        avg_val = sum(self.state.val) / len(self.state.val)
        avg_meta = sum(self.state.meta) / len(self.state.meta)
        return avg_val < self.config.theta_experience and avg_meta < self.config.theta_meta


# ---------------------------------------------------------------------------
# 11. Public API — the orchestrating system
# ---------------------------------------------------------------------------

class HDThinkingSystem:
    """
    Orchestrates a mesh of HDNeurons: ticking, message routing, prediction,
    memory consolidation/recall, and compositional reasoning.
    """

    def __init__(
        self,
        n_neurons: int,
        dimensions: int = 512,
        n_input: int = 8,
        n_groups: int = 4,
        config: Optional[HDConfig] = None,
        seed: Optional[int] = 42,
    ):
        if n_input >= n_neurons:
            raise ValueError("n_input must be < n_neurons")
        self.config = config or HDConfig(dimensions=dimensions)
        self.n_neurons = n_neurons
        self.n_input = n_input
        self.n_groups = n_groups
        self._rng = random.Random(seed)

        self.neurons: Dict[int, HDNeuron] = {
            i: HDNeuron(i, self.config, seed=seed + i if seed is not None else None)
            for i in range(n_neurons)
        }
        # Sparse random connectivity (edge weight is a scalar gain applied
        # after binding — the O(D) "diagonal edge" mode from the spec).
        self.edge_weights: Dict[Tuple[int, int], float] = {}
        self._init_connections(connection_probability=0.15)

        self.memory = MemoryStore(self.config)
        self.current_tick: int = 0
        self.history: List[Dict[str, Any]] = []
        self._history_max = 500

    def _init_connections(self, connection_probability: float) -> None:
        for src in range(self.n_neurons):
            for tgt in range(self.n_neurons):
                if src != tgt and self._rng.random() < connection_probability:
                    self.edge_weights[(src, tgt)] = self._rng.uniform(-0.5, 0.5)

    # -- Communication -----------------------------------------------------

    def send_message(self, source: int, target: int, vector: HDVector) -> None:
        weight = self.edge_weights.get((source, target), 0.0)
        if weight == 0.0:
            return
        current = getattr(self, "_pending", None)
        if current is None:
            self._pending = {i: [] for i in range(self.n_neurons)}
            current = self._pending
        current[target].append(Message(source, vector, weight))

    def _gather_inbound(self, target: int) -> HDVector:
        dims = self.config.dimensions
        messages = [
            Message(src, self.neurons[src].state, w)
            for (src, tgt), w in self.edge_weights.items()
            if tgt == target
        ]
        if not messages:
            return HDVector.zeros(dims)
        bound = [bind(m.vector, HDVector([m.weight] * dims, m.vector._bounds)) for m in messages]
        return bundle(*bound)

    # -- Dynamic updates -----------------------------------------------------

    def tick(self, inputs: Optional[Dict[int, HDVector]] = None, reward: float = 0.5) -> TickResult:
        inputs = inputs or {}
        activations: Dict[int, HDVector] = {}
        surprises: Dict[int, float] = {}

        for nid, neuron in self.neurons.items():
            inbound = inputs.get(nid) or self._gather_inbound(nid)
            surprise = neuron.step(inbound, reward=reward)
            activations[nid] = neuron.state.copy()
            surprises[nid] = surprise

        consolidated = self.consolidate()
        self.current_tick += 1

        stats = self.get_statistics()
        result = TickResult(
            tick=self.current_tick,
            activations=activations,
            surprises=surprises,
            consolidated=consolidated,
            statistics=stats,
        )
        self.history.append({"tick": self.current_tick, "consolidated": consolidated,
                              "avg_surprise": sum(surprises.values()) / max(1, len(surprises))})
        if len(self.history) > self._history_max:
            self.history.pop(0)
        return result

    # -- Prediction -----------------------------------------------------

    def predict(self, horizon: int = 1) -> Dict[int, HDVector]:
        predictions: Dict[int, HDVector] = {}
        for nid, neuron in self.neurons.items():
            state = neuron.state
            for _ in range(horizon):
                state = neuron.predict(state)
            predictions[nid] = state
        return predictions

    # -- Memory interaction -----------------------------------------------------

    def consolidate(self) -> int:
        count = 0
        for neuron in self.neurons.values():
            kind = None
            if neuron.should_consolidate():
                kind = MemoryKind.LONG_TERM.value
            elif neuron.should_record_experience():
                kind = MemoryKind.EXPERIENCE.value

            if kind is not None:
                key = HDVector(neuron.state.ctx + [0.0] * (self.config.dimensions - len(neuron.state.ctx)),
                               neuron.state._bounds)
                value = HDVector(neuron.state.sem + [0.0] * (self.config.dimensions - len(neuron.state.sem)),
                                  neuron.state._bounds)
                if self.memory.write(key, value, self.current_tick, kind=kind):
                    count += 1
                neuron.consolidation_count += 1
        self.memory.decay_and_prune()
        return count

    def recall(self, cue: HDVector, k: int = 1, kind: Optional[str] = None) -> List[MemoryTrace]:
        return self.memory.recall(cue, k, kind=kind)

    # -- Reasoning -----------------------------------------------------

    def reason(self, a: HDVector, b: HDVector, c: HDVector) -> HDVector:
        """Analogy solve: a : b :: c : ? via d = bind(c, unbind(b, a))."""
        relation = unbind(b, a)
        d_hat = bind(c, relation)
        depth = 0
        best = d_hat
        while depth < self.config.reasoning_max_depth:
            matches = self.recall(best, k=1)
            if not matches:
                break
            sim = cosine_similarity(best, matches[0].value)
            if sim >= self.config.theta_confident:
                return matches[0].value
            best = bundle(best, matches[0].value)
            depth += 1
        return best

    # -- Persistence & stats -----------------------------------------------------

    def get_neuron(self, neuron_id: int) -> HDNeuron:
        return self.neurons[neuron_id]

    def get_statistics(self) -> Dict[str, Any]:
        avg_val = sum(sum(n.state.val) / len(n.state.val) for n in self.neurons.values()) / self.n_neurons
        avg_meta = sum(sum(n.state.meta) / len(n.state.meta) for n in self.neurons.values()) / self.n_neurons
        return {
            "tick": self.current_tick,
            "n_neurons": self.n_neurons,
            "n_connections": len(self.edge_weights),
            "memory_size": len(self.memory),
            "average_value": avg_val,
            "average_surprise": avg_meta,
        }

    def save_state(self) -> Dict[str, Any]:
        return {
            "tick": self.current_tick,
            "neurons": {
                nid: {"state": n.state.data, "predictor_diag": n.predictor_diag,
                      "consolidation_count": n.consolidation_count}
                for nid, n in self.neurons.items()
            },
            "memory": [
                {"key": t.key.data, "value": t.value.data, "strength": t.strength, "last_tick": t.last_tick}
                for t in self.memory.traces
            ],
        }

    def load_state(self, state: Dict[str, Any]) -> None:
        self.current_tick = state.get("tick", 0)
        for nid_str, n_data in state.get("neurons", {}).items():
            nid = int(nid_str)
            if nid in self.neurons:
                neuron = self.neurons[nid]
                neuron.state = HDVector(list(n_data["state"]), neuron.state._bounds)
                neuron.predictor_diag = list(n_data["predictor_diag"])
                neuron.consolidation_count = n_data.get("consolidation_count", 0)
        self.memory.traces = [
            MemoryTrace(
                key=HDVector(list(t["key"]), self.memory.traces[0].key._bounds if self.memory.traces
                             else HDVector.zeros(self.config.dimensions)._bounds),
                value=HDVector(list(t["value"]), HDVector.zeros(self.config.dimensions)._bounds),
                strength=t["strength"],
                last_tick=t["last_tick"],
            )
            for t in state.get("memory", [])
        ]


__all__ = [
    "HDVector",
    "bind",
    "unbind",
    "bundle",
    "permute",
    "cosine_similarity",
    "NeuronPhase",
    "HDConfig",
    "Message",
    "MemoryTrace",
    "TickResult",
    "MemoryStore",
    "HDNeuron",
    "HDThinkingSystem",
]
