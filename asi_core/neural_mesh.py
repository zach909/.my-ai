"""
ASI Neural Core - Stage 1 Implementation

A neural mesh architecture for Artificial Superintelligence.

This implements a true all-to-all connected neural mesh with:
- Multidimensional neuron states (each neuron has a D-dimensional state vector)
- Full connectivity (every neuron connects to every other neuron)
- Zero-sum value system (vale) controlling plasticity
- Dynamic learning based on neuron state, input, and value
- Persistent internal neural state across ticks
- Support for specialized neural groups (experts)
- Compressed internal representations

Architecture follows the Prometheus design from the existing mesh.py implementation
but provides a standalone Python reference implementation for the ASI system.
"""

import math
import time
import random
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Set
from enum import Enum
import json


class NeuronRole(Enum):
    """Role of a neuron in the mesh."""
    INPUT = "input"       # Receives external input
    HIDDEN = "hidden"     # Internal computation
    OUTPUT = "output"     # Produces output
    EXPERT = "expert"     # Specialized expert neuron


@dataclass
class NeuronState:
    """
    Complete multidimensional state of a single neuron.
    
    Each neuron maintains a D-dimensional state vector plus metadata.
    """
    neuron_id: int
    role: NeuronRole = NeuronRole.HIDDEN
    group: int = 0  # Expert/skill group membership
    
    # Multidimensional state vector
    state_vector: List[float] = field(default_factory=lambda: [0.0])
    
    # Value system (vale) - controls plasticity resistance
    # High vale = resists change, Low vale = learns readily
    vale: float = 0.1
    
    # Input flag (dimension 0 reserved for external input indicator)
    input_flag: float = 0.0
    
    # Activation after settle
    activation: float = 0.0
    
    # Temporal tracking
    last_spike_time: float = -1.0
    total_spikes: int = 0
    consecutive_divergence: int = 0  # For live correction
    
    # Statistics
    average_activation: float = 0.0
    update_count: int = 0

    # Explicit per-neuron input bias set by the Neural Definition Language's
    # `"name"@connections="target*weight+bias"` override (see neural_dsl.py):
    # a DSL-declared connection's bias term is additive input this neuron
    # receives every settle tick, on top of whatever the all-to-all weights
    # compute, so an explicit override can express "this neuron leans toward
    # firing/not firing" independent of its incoming weights.
    dsl_bias: float = 0.0

    def initialize_state(self, dimensions: int, rng: Optional[random.Random] = None):
        """Initialize state vector with given dimensions."""
        source = rng or random
        self.state_vector = [source.gauss(0, 0.1) for _ in range(dimensions)]
        self.input_flag = 0.0
        
    def get_content_state(self) -> List[float]:
        """Get state excluding the input flag (dimension 0)."""
        return self.state_vector[1:] if len(self.state_vector) > 1 else []
    
    def set_input_driven(self, is_driven: bool):
        """Set whether this neuron is externally driven."""
        self.input_flag = 1.0 if is_driven else 0.0


@dataclass
class SynapticConnection:
    """
    Connection between two neurons in the mesh.
    
    Each connection is a D×D weight matrix allowing cross-dimensional influence.
    """
    source_id: int
    target_id: int
    
    # Weight matrix: W[target_dim][source_dim]
    weight_matrix: List[List[float]] = field(default_factory=list)
    
    # Learning parameters gated by target's vale
    base_learning_rate: float = 0.01
    
    # Eligibility trace for delayed learning
    eligibility_trace: float = 0.0
    eligibility_decay: float = 0.9
    
    def initialize_weights(self, dimensions: int, scale: float = 0.1, rng: Optional[random.Random] = None):
        """Initialize weight matrix with small random values."""
        source = rng or random
        self.weight_matrix = [
            [source.gauss(0, scale) for _ in range(dimensions)]
            for _ in range(dimensions)
        ]
    
    def apply_vale_gate(self, vale: float) -> float:
        """Get effective learning rate gated by vale."""
        # High vale = low plasticity, Low vale = high plasticity
        return self.base_learning_rate * (1.0 - vale)


@dataclass
class _MeshWeightsSnapshot:
    """
    Immutable, worker-process-resident copy of everything a settle tick
    needs that does *not* change tick-to-tick: topology and connection
    weights. Sent to each worker exactly once, via ProcessPoolExecutor's
    ``initializer``, when the pool is (re)created -- not on every settle
    tick.

    This is the difference between a parallel settle tick that's actually
    faster and one that isn't: the weights are the O(n_neurons^2 *
    n_dimensions^2) part of the mesh, so re-pickling a shard's slice of
    them on every tick (the first version of this feature did exactly
    that) makes the IPC cost dominate the compute it was supposed to
    parallelize away. Caching them worker-side instead means a steady
    -state tick only has to ship the O(n_neurons * n_dimensions) state
    snapshot, which is genuinely cheaper than computing it serially once
    n_neurons is large enough.

    Whenever anything here could go stale -- learning
    (apply_hebbian_learning), a new expert group (add_expert_group), an
    explicit weight or DSL-bias override (set_connection_weight,
    add_dsl_bias), or a full state load (load_state) -- NeuralMesh calls
    _invalidate_parallel_pool(), which tears the pool down so the next
    parallel tick lazily rebuilds it (and this snapshot) from current
    weights/biases.
    """
    n_dimensions: int
    incoming_by_target: Dict[int, List[int]]
    weight_by_pair: Dict[Tuple[int, int], List[List[float]]]
    dsl_bias_by_id: Dict[int, float]


# Worker-process-local: set once by _worker_attach_snapshot (the pool's
# ``initializer``) and read by every _settle_shard call this worker process
# ever handles. Each worker process gets its own copy of this module-level
# name -- there is no cross-process sharing of the *variable*, only of the
# (picklable) snapshot value passed through the pool's initargs.
_WORKER_SNAPSHOT: Optional["_MeshWeightsSnapshot"] = None


def _worker_attach_snapshot(snapshot: "_MeshWeightsSnapshot") -> None:
    """ProcessPoolExecutor ``initializer``: runs once when a worker
    process starts, stashing the mesh's topology/weights snapshot so
    every later `_settle_shard` call in this same worker reuses it
    instead of receiving it again."""
    global _WORKER_SNAPSHOT
    _WORKER_SNAPSHOT = snapshot


def _settle_shard(
    payload: Tuple[
        List[int],
        Dict[int, List[float]],
        Dict[int, float],
        Dict[int, List[float]],
        Optional[Set[int]],
    ]
) -> Dict[int, Tuple[List[float], float]]:
    """
    Picklable, process-pool-safe unit of work for parallel settle():
    compute the settled state vector and squared-diff sum for one shard of
    target neurons, using this worker's already-attached
    ``_WORKER_SNAPSHOT`` (see ``_worker_attach_snapshot``) for
    topology/weights.

    This deliberately re-implements the exact same weighted-sum + bias +
    tanh + divergence arithmetic, in the exact same iteration order, as
    ``compute_neuron_input`` and the serial branch of ``_settle`` (rather
    than calling those methods, which live on the mesh), so the parallel
    path is bit-for-bit identical to the serial one, not just numerically
    close -- verified in test_neural_mesh.py by comparing full activate()
    outputs.

    Args (all packed into one tuple -- ProcessPoolExecutor.map passes one
    positional argument per call):
        target_ids: neuron ids this shard is responsible for.
        state_by_id: read-only snapshot of every active neuron's current
            state_vector, keyed by id (shared across all shards).
        input_flag_by_target / prev_sv_by_target: per-target scalars/
            vectors this shard needs from the live NeuronState objects.
        active_mask: same active-group gate `compute_neuron_input` checks
            (or None when every neuron is active).

    Returns: target_id -> (new_state_vector, sq_sum_of_content_diffs).
    """
    target_ids, state_by_id, input_flag_by_target, prev_sv_by_target, active_mask = payload

    snapshot = _WORKER_SNAPSHOT
    if snapshot is None:
        raise RuntimeError(
            "parallel settle worker has no attached mesh snapshot -- "
            "_worker_attach_snapshot should have run as this pool's initializer"
        )
    nd = snapshot.n_dimensions
    incoming_by_target = snapshot.incoming_by_target
    weight_by_pair = snapshot.weight_by_pair
    dsl_bias_by_id = snapshot.dsl_bias_by_id

    tanh = math.tanh
    results: Dict[int, Tuple[List[float], float]] = {}

    for target_id in target_ids:
        result = [0.0] * nd

        for source_id in incoming_by_target.get(target_id, ()):
            if active_mask is not None and source_id not in active_mask:
                continue
            sv = state_by_id.get(source_id)
            wm = weight_by_pair.get((source_id, target_id))
            if sv is None or wm is None:
                continue
            n_src = len(sv)
            lim = nd if nd <= n_src else n_src
            for target_d in range(nd):
                wrow = wm[target_d]
                acc = 0.0
                for source_d in range(lim):
                    acc += wrow[source_d] * sv[source_d]
                result[target_d] += acc

        total_bias = 0.01 + dsl_bias_by_id.get(target_id, 0.0)
        for d in range(1, nd):
            result[d] += total_bias

        new_state = [0.0] * nd
        new_state[0] = input_flag_by_target.get(target_id, 0.0)
        prev_sv = prev_sv_by_target[target_id]
        sq_sum = 0.0
        for d in range(1, nd):
            v = tanh(result[d])
            new_state[d] = v
            diff = v - prev_sv[d]
            sq_sum += diff * diff

        results[target_id] = (new_state, sq_sum)

    return results


class NeuralMesh:
    """
    A fully connected neural mesh with all-to-all connectivity.

    This implements:
    - True all-to-all density (every neuron reads every other)
    - D×D weight blocks for cross-dimensional reasoning
    - Settle dynamics through iterative propagation
    - Zero-sum vale system for plasticity control
    - Live correction for divergent settles
    - Continuous operation with state carry-over
    - Expert groups with selective activation

    Settle ticks are single-threaded Python by default. Passing
    ``parallel_workers > 1`` distributes each tick's per-neuron update
    across that many subprocesses (sharded by target neuron id), which
    only pays off once the O(n_neurons^2 * n_dimensions^2) weighted-sum
    work per tick outweighs the cost of shipping each shard's slice of
    the state/weights across the process boundary -- see
    ``parallel_min_neurons``. Off (``parallel_workers=0``, the default)
    is bit-for-bit and performance-identical to the mesh before this
    option existed.
    """

    def __init__(
        self,
        n_neurons: int = 64,
        n_dimensions: int = 4,
        n_input: int = 8,
        n_groups: int = 4,
        settle_ticks: int = 4,
        vale_init: float = 0.1,
        divergence_tolerance: float = 0.5,
        sustained_divergence_ticks: int = 3,
        continuous: bool = False,
        seed: Optional[int] = None,
        auto_route: bool = False,
        group_score_decay: float = 0.9,
        parallel_workers: int = 0,
        parallel_min_neurons: int = 32,
    ):
        # Validate configuration
        assert n_dimensions >= 2, "Need dim 0 for input flag plus >=1 content dim"
        assert 1 <= n_input < n_neurons, "Input neurons must be subset of total"
        assert parallel_workers >= 0, "parallel_workers must be >= 0 (0 disables it)"

        self._rng = random.Random(seed) if seed is not None else random
        self.n_neurons = n_neurons
        self.n_dimensions = n_dimensions
        self.n_input = n_input
        self.n_groups = n_groups
        self.settle_ticks = settle_ticks
        self.vale_total = vale_init * n_neurons  # Zero-sum budget
        self.divergence_tolerance = divergence_tolerance
        self.sustained_divergence_ticks = sustained_divergence_ticks
        self.continuous = continuous

        # Parallel settle (see class docstring). `_pool` is created lazily,
        # on the first tick that actually qualifies for the parallel path,
        # so constructing a mesh with parallel_workers>0 that never reaches
        # parallel_min_neurons (e.g. every "small"/"default" preset) never
        # spawns a process.
        self.parallel_workers = parallel_workers
        self.parallel_min_neurons = parallel_min_neurons
        self._pool: Optional[ProcessPoolExecutor] = None
        
        # Initialize neurons
        self.neurons: Dict[int, NeuronState] = {}
        self._initialize_neurons()
        
        # Initialize connections (all-to-all, no self-connections)
        self.connections: Dict[Tuple[int, int], SynapticConnection] = {}
        self._initialize_connections()
        
        # State management
        self.current_tick: int = 0
        self.global_time: float = 0.0
        self._carried_state: Optional[Dict[int, List[float]]] = None  # For continuous mode
        
        # Diagnostics
        self._live_corrections = 0
        self._divergence_events = 0
        self._settle_history: List[Dict] = []
        
        # Skill/expert routing
        self.active_groups: Set[int] = set(range(n_groups))  # All active by default
        self.skill_top_k = min(2, n_groups)

        # Optional top-k expert-group router. When disabled (default),
        # `active_groups` is purely caller-controlled, as before. When
        # enabled, `activate()` recomputes it every call from each group's
        # recent-activity score, always keeping one round-robin exploration
        # slot so a group that has never been picked is not starved forever.
        self.auto_route = auto_route
        self.group_score_decay = group_score_decay
        self.group_scores: List[float] = [0.0] * n_groups
        self._route_explore_cursor = 0

        # Spec Part 4 section 39: expert groups are given human-readable
        # names ("Coding Expert", "Language Expert", ...) instead of being
        # addressed only by numeric id. Unnamed groups get a stable default.
        self.group_names: Dict[int, str] = {i: f"expert_{i}" for i in range(n_groups)}
        
    def _initialize_neurons(self):
        """Create all neurons with appropriate roles and groups."""
        for i in range(self.n_neurons):
            # Assign roles
            if i < self.n_input:
                role = NeuronRole.INPUT
            elif i < self.n_input + 4:  # Some output neurons
                role = NeuronRole.OUTPUT
            else:
                role = NeuronRole.HIDDEN
            
            # Assign to groups (round-robin for balanced distribution)
            group = i % self.n_groups
            
            neuron = NeuronState(
                neuron_id=i,
                role=role,
                group=group,
                vale=self.vale_total / self.n_neurons  # Equal initial distribution
            )
            neuron.initialize_state(self.n_dimensions, rng=self._rng)
            self.neurons[i] = neuron
    
    def _initialize_connections(self):
        """Create all-to-all connections excluding self-connections."""
        scale = 1.0 / math.sqrt(self.n_neurons * self.n_dimensions)
        
        # Incoming-connection index: target_id -> list of source_ids.
        # Lets compute_neuron_input iterate a target's incoming sources
        # directly instead of scanning all N neurons and rebuilding
        # (source, target) tuple keys in the hot loop.
        self._incoming_by_target: Dict[int, List[int]] = {
            tid: [] for tid in range(self.n_neurons)
        }

        for source_id in range(self.n_neurons):
            for target_id in range(self.n_neurons):
                if source_id != target_id:  # No self-connections
                    conn = SynapticConnection(
                        source_id=source_id,
                        target_id=target_id,
                        base_learning_rate=0.01
                    )
                    conn.initialize_weights(self.n_dimensions, scale, rng=self._rng)
                    self.connections[(source_id, target_id)] = conn
                    self._incoming_by_target[target_id].append(source_id)

    
    def redistribute_vale(self, changes: Dict[int, float]):
        """
        Redistribute vale values while maintaining zero-sum constraint.
        
        Args:
            changes: Dictionary mapping neuron_id to desired vale change
        """
        # Calculate total increase needed
        total_increase = sum(max(0, c) for c in changes.values())
        total_decrease = sum(abs(c) for c in changes.values() if c < 0)
        
        # Apply direct changes
        for neuron_id, change in changes.items():
            if neuron_id in self.neurons:
                new_vale = self.neurons[neuron_id].vale + change
                self.neurons[neuron_id].vale = max(0.0, min(1.0, new_vale))
        
        # Redistribute to maintain zero-sum
        current_total = sum(n.vale for n in self.neurons.values())
        if abs(current_total - self.vale_total) > 1e-6:
            # Proportionally adjust all neurons
            ratio = self.vale_total / current_total if current_total > 0 else 1.0
            for neuron in self.neurons.values():
                neuron.vale = max(0.0, min(1.0, neuron.vale * ratio))
    
    def raise_vale(self, neuron_ids: List[int], amount: float = 0.3):
        """Raise vale (stability) of specified neurons, lowering others proportionally."""
        changes = {nid: amount for nid in neuron_ids}
        self.redistribute_vale(changes)
    
    def demote_vale(self, neuron_ids: List[int], amount: float = 0.3):
        """Lower vale (plasticity) of specified neurons, raising others proportionally."""
        changes = {nid: -amount for nid in neuron_ids}
        self.redistribute_vale(changes)
    
    def clamp_input_neurons(self, input_pattern: List[float]):
        """
        Clamp external input onto input neurons.
        
        Args:
            input_pattern: Values to clamp onto input neurons (length <= n_input)
        """
        for i, value in enumerate(input_pattern[:self.n_input]):
            if i in self.neurons:
                neuron = self.neurons[i]
                neuron.set_input_driven(True)
                # Set content dimensions (skip dimension 0 which is the flag).
                # Content dims are state_vector[1:]. We write the provided
                # input values into the leading content dims and *zero* any
                # remaining content dims so a short input does not leak
                # stale random-init noise into the unset dimensions.
                sv = neuron.state_vector
                n_provided = len(input_pattern)
                for d in range(1, len(sv)):
                    idx = d - 1  # index into input_pattern
                    if idx < n_provided:
                        sv[d] = input_pattern[idx]
                    else:
                        sv[d] = 0.0
    
    def compute_neuron_input(self, neuron_id: int, active_mask: Optional[Set[int]] = None) -> List[float]:
        """
        Compute total input to a neuron from all other neurons.
        
        Args:
            neuron_id: Target neuron ID
            active_mask: Optional set of active neuron IDs (for expert routing)
            
        Returns:
            List of input values for each dimension
        """
        nd = self.n_dimensions
        result = [0.0] * nd
        
        # Check if neuron is active (for expert routing)
        if active_mask is not None and neuron_id not in active_mask:
            return result  # Dormant neuron receives no update
        
        neuron = self.neurons.get(neuron_id)
        if neuron is None:
            return result
        
        # Hot-loop locals: avoid repeated attribute lookups. The incoming
        # index (_incoming_by_target) lets us iterate only this target's
        # actual sources instead of scanning all N neurons and rebuilding
        # (source_id, neuron_id) tuple keys each iteration.
        neurons = self.neurons
        connections = self.connections
        sources = self._incoming_by_target.get(neuron_id, ())
        active_check = active_mask is not None
        if active_check:
            am = active_mask  # local alias
        
        for source_id in sources:
            if active_check and source_id not in am:
                continue  # Skip inactive sources
            
            source = neurons.get(source_id)
            if source is None:
                continue
            
            conn = connections.get((source_id, neuron_id))
            if conn is None:
                continue
            
            sv = source.state_vector
            wm = conn.weight_matrix
            n_src = len(sv)
            # Matrix-vector multiplication: result[d] += sum(W[d][s] * sv[s]).
            # The weight matrix is nd x nd; source state may be shorter only
            # if dimensions changed after construction (defensive min).
            lim = nd if nd <= n_src else n_src
            for target_d in range(nd):
                wrow = wm[target_d]
                acc = 0.0
                for source_d in range(lim):
                    acc += wrow[source_d] * sv[source_d]
                result[target_d] += acc
        
        # Add bias. Dimension 0 is the input flag and is overwritten in
        # _settle, so adding bias there is wasted work -- only apply bias
        # to the content dimensions (1..nd-1). The constant 0.01 plus any
        # explicit DSL-declared bias (see NeuronState.dsl_bias) acts as a
        # virtual bias-neuron contribution.
        total_bias = 0.01 + neuron.dsl_bias
        for d in range(1, nd):
            result[d] += total_bias

        return result

    def set_connection_weight(self, source_id: int, target_id: int, weight: float) -> None:
        """
        Explicit connection override (Neural Definition Language spec:
        `"name"@connections="target*weight+bias"`). Uniformly overwrites the
        source->target weight matrix with `weight`, replacing whatever
        random/learned matrix was there -- the DSL's explicit connection
        statement is meant to pin a specific weight, not nudge it.
        """
        conn = self.connections.get((source_id, target_id))
        if conn is None:
            raise ValueError(f"no such connection: {source_id} -> {target_id}")
        conn.weight_matrix = [[weight for _ in range(self.n_dimensions)] for _ in range(self.n_dimensions)]
        self._invalidate_parallel_pool()

    def add_dsl_bias(self, target_id: int, bias: float) -> None:
        """Accumulate an explicit DSL-declared bias onto a neuron's input term."""
        if target_id in self.neurons:
            self.neurons[target_id].dsl_bias += bias
            self._invalidate_parallel_pool()
    
    def activate(self, input_vector: List[float]) -> List[float]:
        """
        Process input through the mesh and return output.
        
        Args:
            input_vector: Input values for input neurons
            
        Returns:
            Output values from output neurons
        """
        self.current_tick = 0
        
        # Reset non-input neurons if not in continuous mode
        if not self.continuous:
            # Use fixed initialization for deterministic behavior
            for neuron_id, neuron in self.neurons.items():
                if neuron.role != NeuronRole.INPUT:
                    # Reset state vector to zero (deterministic)
                    neuron.state_vector = [0.0] * self.n_dimensions
                    neuron.input_flag = 0.0
                    neuron.activation = 0.0
                    neuron.consecutive_divergence = 0
        
        # Clamp inputs
        self.clamp_input_neurons(input_vector)

        # Route to top-k expert groups before settling, using scores from
        # the previous cycle's activity (opt-in; see auto_route).
        if self.auto_route:
            self.update_group_routing()

        # Run settle loop
        settled_state = self._settle()
        
        # Read output
        output = self._read_output()
        
        return output
    
    def _settle(self) -> Dict[int, List[float]]:
        """
        Run the settle loop until convergence or max ticks.
        
        Implements live correction for divergent settles.
        """
        prev_state = {nid: list(n.state_vector) for nid, n in self.neurons.items()}
        consecutive_high_divergence = 0
        
        for tick in range(self.settle_ticks):
            self.current_tick = tick
            
            # Determine active neurons (expert routing)
            active_mask = self._get_active_neurons()
            nd = self.n_dimensions

            # Update each neuron: either the serial in-process loop, or --
            # once parallel_workers>0 and enough neurons are active to be
            # worth it -- the sharded-subprocess path. Both produce
            # bit-for-bit identical (new_state, sq_sum) pairs per neuron;
            # see _settle_shard's docstring for why.
            if self._use_parallel_settle(active_mask):
                new_states, per_neuron_sq_sum = self._settle_tick_parallel(active_mask, prev_state)
            else:
                new_states, per_neuron_sq_sum = self._settle_tick_serial(active_mask, prev_state)

            # Divergence (L2 norm of the state delta) and live-correction
            # bookkeeping, common to both paths.
            max_divergence = 0.0
            for neuron_id, sq_sum in per_neuron_sq_sum.items():
                neuron = self.neurons[neuron_id]
                divergence = sq_sum ** 0.5
                if divergence > max_divergence:
                    max_divergence = divergence

                # Track consecutive divergence for live correction
                if divergence > self.divergence_tolerance:
                    neuron.consecutive_divergence += 1
                else:
                    neuron.consecutive_divergence = 0

            # Live correction for sustained divergence
            if consecutive_high_divergence >= self.sustained_divergence_ticks:
                self._apply_divergence_correction(prev_state, new_states)
                self._live_corrections += 1
                consecutive_high_divergence = 0
                # Reset neuron-level divergence counters after correction
                for neuron in self.neurons.values():
                    neuron.consecutive_divergence = 0
            
            if max_divergence > self.divergence_tolerance:
                consecutive_high_divergence += 1
            else:
                consecutive_high_divergence = 0
            
            # Update neuron states
            denom = nd - 1 if nd > 1 else 1
            for neuron_id, new_state in new_states.items():
                neuron = self.neurons[neuron_id]
                neuron.state_vector = new_state
                # Mean of content dims (1..nd-1); denom is constant per mesh.
                neuron.activation = sum(new_state[1:]) / denom
            
            prev_state = new_states
        
        # Store settled state for diagnostics
        self._last_settled = dict(prev_state)

        return prev_state

    def _settle_tick_serial(
        self,
        active_mask: Optional[Set[int]],
        prev_state: Dict[int, List[float]],
    ) -> Tuple[Dict[int, List[float]], Dict[int, float]]:
        """
        One settle tick's per-neuron update, single-threaded. Returns
        (new_states, per_neuron_sq_sum) where the latter holds an entry
        only for neurons that were actually recomputed (dormant/masked-out
        neurons carry their state forward with no divergence tracking,
        matching the pre-parallel behavior exactly).
        """
        nd = self.n_dimensions
        tanh = math.tanh
        new_states: Dict[int, List[float]] = {}
        per_neuron_sq_sum: Dict[int, float] = {}

        for neuron_id, neuron in self.neurons.items():
            if active_mask is not None and neuron_id not in active_mask:
                # Dormant neurons maintain state
                new_states[neuron_id] = list(neuron.state_vector)
                continue

            # Compute input from all other neurons
            neuron_input = self.compute_neuron_input(neuron_id, active_mask)
            ni_len = len(neuron_input)

            # Apply nonlinearity (tanh) to each dimension. Dimension 0
            # is the input flag and is carried through unchanged; content
            # dimensions get tanh(total_input).
            new_state = [0.0] * nd
            new_state[0] = neuron.input_flag
            prev_sv = prev_state[neuron_id]
            sq_sum = 0.0
            for d in range(1, nd):
                total_input = neuron_input[d] if d < ni_len else 0.0
                v = tanh(total_input)
                new_state[d] = v
                diff = v - prev_sv[d]
                sq_sum += diff * diff

            new_states[neuron_id] = new_state
            per_neuron_sq_sum[neuron_id] = sq_sum

        return new_states, per_neuron_sq_sum

    def _use_parallel_settle(self, active_mask: Optional[Set[int]]) -> bool:
        """Whether this tick's neuron update should go through the
        subprocess pool: opted in (parallel_workers>1) and enough neurons
        are actually being recomputed this tick to outweigh the fixed
        per-tick cost of sharding + IPC."""
        if self.parallel_workers <= 1:
            return False
        n_active = len(active_mask) if active_mask is not None else self.n_neurons
        return n_active >= self.parallel_min_neurons

    def _ensure_pool(self) -> ProcessPoolExecutor:
        """
        Lazily create (and reuse) the subprocess pool for parallel settle
        ticks, so a mesh that never crosses parallel_min_neurons never
        pays process-startup cost. Every worker is started with the
        current topology/weights (see _MeshWeightsSnapshot) attached once
        via the pool's ``initializer`` -- not shipped again on every tick.
        """
        if self._pool is None:
            snapshot = _MeshWeightsSnapshot(
                n_dimensions=self.n_dimensions,
                incoming_by_target=self._incoming_by_target,
                weight_by_pair={key: conn.weight_matrix for key, conn in self.connections.items()},
                dsl_bias_by_id={nid: n.dsl_bias for nid, n in self.neurons.items()},
            )
            self._pool = ProcessPoolExecutor(
                max_workers=self.parallel_workers,
                initializer=_worker_attach_snapshot,
                initargs=(snapshot,),
            )
        return self._pool

    def _invalidate_parallel_pool(self) -> None:
        """
        Tear down the worker pool, if one exists, so the next parallel
        settle tick lazily recreates it (and re-snapshots current
        topology/weights/dsl_bias). Called from every method that mutates
        connections, weights, or dsl_bias after the pool could have been
        created: _initialize_connections, add_expert_group,
        set_connection_weight, apply_hebbian_learning, add_dsl_bias, and
        load_state. Non-blocking (``wait=False``) -- correctness only
        requires that `self._pool` stop being reused, not that the old
        worker processes have actually exited before this call returns.
        """
        if self._pool is not None:
            self._pool.shutdown(wait=False)
            self._pool = None

    def _settle_tick_parallel(
        self,
        active_mask: Optional[Set[int]],
        prev_state: Dict[int, List[float]],
    ) -> Tuple[Dict[int, List[float]], Dict[int, float]]:
        """
        Parallel counterpart to `_settle_tick_serial`: shards the active
        neuron ids across `parallel_workers` subprocesses (see
        `_settle_shard`) and merges their results. Dormant/masked-out
        neurons are still handled directly here (cheap; no reason to ship
        them to a worker), exactly as in the serial path. Unlike weights/
        topology (cached worker-side, see `_ensure_pool`), the per-neuron
        state snapshot and input_flag/prev-state are genuinely per-tick
        and are sent fresh every call.
        """
        active_ids = sorted(active_mask) if active_mask is not None else sorted(self.neurons.keys())

        new_states: Dict[int, List[float]] = {}
        if active_mask is not None:
            for neuron_id, neuron in self.neurons.items():
                if neuron_id not in active_mask:
                    new_states[neuron_id] = list(neuron.state_vector)

        if not active_ids:
            return new_states, {}

        # Read-only snapshot every worker needs of every neuron it might
        # read as a source (any active neuron -- inactive sources are
        # skipped identically to compute_neuron_input). Built once per
        # tick and shared across every shard's payload.
        source_ids = active_mask if active_mask is not None else self.neurons.keys()
        state_by_id = {nid: self.neurons[nid].state_vector for nid in source_ids}

        n_workers = min(self.parallel_workers, len(active_ids))
        shard_size = -(-len(active_ids) // n_workers)  # ceil division
        shards = [active_ids[i:i + shard_size] for i in range(0, len(active_ids), shard_size)]

        payloads = []
        for shard in shards:
            input_flag_by_target = {tid: self.neurons[tid].input_flag for tid in shard}
            prev_sv_by_target = {tid: prev_state[tid] for tid in shard}
            payloads.append((shard, state_by_id, input_flag_by_target, prev_sv_by_target, active_mask))

        pool = self._ensure_pool()
        per_neuron_sq_sum: Dict[int, float] = {}
        for shard_result in pool.map(_settle_shard, payloads):
            for neuron_id, (new_state, sq_sum) in shard_result.items():
                new_states[neuron_id] = new_state
                per_neuron_sq_sum[neuron_id] = sq_sum

        return new_states, per_neuron_sq_sum

    def close(self) -> None:
        """Shut down the parallel worker pool, if `parallel_workers>1`
        ever actually created one. Safe to call unconditionally (no-op
        when there is no pool), and safe to call more than once."""
        if self._pool is not None:
            self._pool.shutdown(wait=True)
            self._pool = None

    def __del__(self):
        # Interpreter shutdown can tear down module globals (including
        # ProcessPoolExecutor's own internals) before __del__ runs on
        # still-live objects; swallow whatever that produces rather than
        # letting a destructor raise.
        try:
            self.close()
        except Exception:
            pass

    def _get_active_neurons(self) -> Optional[Set[int]]:
        """
        Get set of active neurons based on expert routing.

        `active_groups` is the gate: by default every group is active, but a
        caller may restrict it manually, or `auto_route=True` can be set to
        have `activate()` recompute it every call via `update_group_routing`
        (top-k expert-group selection, see that method).
        """
        if self.n_groups <= 1:
            return None  # All neurons active

        active_neurons = set()
        for neuron_id, neuron in self.neurons.items():
            if neuron.group in self.active_groups:
                active_neurons.add(neuron_id)
        
        return active_neurons

    def update_group_routing(self) -> Set[int]:
        """
        Recompute `active_groups` as a top-k expert-group selection.

        Each group's score is an EMA of its members' mean absolute
        activation from the previous cycle, so groups that have recently
        been useful are favored (spec: "Activate experts" as part of the
        continuous tick cycle). One slot of `skill_top_k` is always
        reserved for round-robin exploration of a currently-inactive group,
        so a group with a stale low score is never starved permanently.
        """
        for group in range(self.n_groups):
            members = [n for n in self.neurons.values() if n.group == group]
            avg_activity = (
                sum(abs(n.activation) for n in members) / len(members) if members else 0.0
            )
            self.group_scores[group] = (
                self.group_score_decay * self.group_scores[group]
                + (1 - self.group_score_decay) * avg_activity
            )

        top_k = max(1, min(self.skill_top_k, self.n_groups))
        ranked = sorted(range(self.n_groups), key=lambda g: self.group_scores[g], reverse=True)

        if top_k >= self.n_groups:
            selected = set(range(self.n_groups))
        else:
            selected = set(ranked[: top_k - 1]) if top_k > 1 else set()
            remaining = [g for g in range(self.n_groups) if g not in selected]
            for _ in range(len(remaining)):
                candidate = remaining[self._route_explore_cursor % len(remaining)]
                self._route_explore_cursor += 1
                if candidate not in selected:
                    selected.add(candidate)
                    break

        self.active_groups = selected
        return selected

    def set_group_name(self, group_id: int, name: str) -> None:
        """Assign a human-readable name to an expert group (spec section 39)."""
        if not (0 <= group_id < self.n_groups):
            raise ValueError(f"no such group: {group_id}")
        self.group_names[group_id] = name

    def get_group_name(self, group_id: int) -> str:
        return self.group_names.get(group_id, f"expert_{group_id}")

    def active_expert_names(self) -> List[str]:
        """Human-readable names of the currently active expert groups."""
        return [self.get_group_name(g) for g in sorted(self.active_groups)]

    def add_expert_group(self, name: str, n_new_neurons: int) -> Tuple[int, List[int]]:
        """
        Spec Part 4 section 42 (Expert Creation): grow the mesh with a
        brand new, named expert group of freshly initialized neurons,
        wired all-to-all with every existing neuron (preserving the mesh's
        own all-to-all invariant) and with each other.

        New neurons start at vale=0.0 as a placeholder. This mesh has no
        opinion on where their real vale stake should come from — a caller
        that also owns a ValeSystem (UnifiedBrain does) should call
        vale.add_neurons() and re-sync immediately afterward, since
        ValeSystem is the single source of truth for vale.

        Returns (new_group_id, new_neuron_ids).
        """
        if n_new_neurons < 1:
            raise ValueError("n_new_neurons must be >= 1")

        existing_ids = list(self.neurons.keys())

        new_group_id = self.n_groups
        self.n_groups += 1
        self.group_scores.append(0.0)
        self.group_names[new_group_id] = name

        start_id = self.n_neurons
        new_ids = list(range(start_id, start_id + n_new_neurons))
        self.n_neurons += n_new_neurons

        for nid in new_ids:
            neuron = NeuronState(neuron_id=nid, role=NeuronRole.HIDDEN, group=new_group_id, vale=0.0)
            neuron.initialize_state(self.n_dimensions, rng=self._rng)
            self.neurons[nid] = neuron
            # Ensure the new neuron has an incoming-source bucket so
            # compute_neuron_input can index it.
            self._incoming_by_target.setdefault(nid, [])

        scale = 1.0 / math.sqrt(self.n_neurons * self.n_dimensions)

        def _wire(source_id: int, target_id: int) -> None:
            conn = SynapticConnection(source_id=source_id, target_id=target_id, base_learning_rate=0.01)
            conn.initialize_weights(self.n_dimensions, scale, rng=self._rng)
            self.connections[(source_id, target_id)] = conn
            self._incoming_by_target.setdefault(target_id, []).append(source_id)

        for nid in new_ids:
            for other in existing_ids:
                _wire(nid, other)
                _wire(other, nid)
            for other in new_ids:
                if other != nid:
                    _wire(nid, other)

        self.active_groups.add(new_group_id)
        self._invalidate_parallel_pool()
        return new_group_id, new_ids

    def merge_from(
        self,
        other: "NeuralMesh",
        group_prefix: Optional[str] = None,
    ) -> Tuple[Dict[int, int], Dict[int, int]]:
        """
        Absorb every neuron, connection, and expert group from `other`
        into this mesh, wiring the two former-meshes' neurons all-to-all
        with each other (preserving the mesh's own all-to-all invariant)
        -- the runtime counterpart to add_expert_group's "grow with
        brand-new neurons": this grows with neurons that already have
        real state/weights/vale, because they came from an existing,
        already-settled mesh, not a fresh random/zero init.

        `other`'s own connections *among its absorbed neurons* are
        copied over unchanged (remapped to new ids), preserving whatever
        it had learned. Only the *cross* connections between self's
        original neurons and other's absorbed ones are new -- there is
        no history between two previously-separate meshes to preserve --
        and those get freshly initialized weights exactly like
        add_expert_group's own cross-wiring.

        `other` must have the same n_dimensions: state vectors and D×D
        weight matrices from a different-dimensional mesh cannot be
        combined meaningfully, and this method does not attempt to
        project between dimensionalities. Raises ValueError if they
        differ.

        `group_prefix`, if given, is prepended ("prefix.originalname")
        to every absorbed group's name, so two meshes that happen to use
        the same group name don't collide once merged. Omit it to keep
        other's group names as-is.

        Caveats a caller should know about before relying on this:
          - `self.n_input` is NOT extended: `other`'s former input
            neurons keep NeuronRole.INPUT as a label, but
            clamp_input_neurons() only ever writes into indices <
            self.n_input, so they will not receive external input
            through that path post-merge. Drive them directly
            (state_vector writes, or add_dsl_bias) if needed.
          - `self.vale_total` (the zero-sum budget) is NOT increased to
            cover the absorbed neurons' vale, mirroring
            add_expert_group's same documented caveat -- a caller that
            also owns a ValeSystem should grow and re-sync it
            separately.
          - `other`'s own parallel worker pool (if any) is closed as
            part of this call, since its neurons no longer belong to a
            standalone mesh; `other` itself should not be used after
            merging into `self`.

        Returns (neuron_id_map, group_id_map): other's old neuron/group
        ids -> their new ids in `self`, so a caller tracking identity
        across the merge (e.g. "this was other's neuron 3") can
        translate it.
        """
        if other.n_dimensions != self.n_dimensions:
            raise ValueError(
                f"cannot merge a {other.n_dimensions}-dimensional mesh into a "
                f"{self.n_dimensions}-dimensional one"
            )

        other.close()

        nd = self.n_dimensions
        existing_ids = list(self.neurons.keys())

        group_id_map: Dict[int, int] = {}
        for old_gid in range(other.n_groups):
            new_gid = self.n_groups
            self.n_groups += 1
            old_score = other.group_scores[old_gid] if old_gid < len(other.group_scores) else 0.0
            self.group_scores.append(old_score)
            base_name = other.get_group_name(old_gid)
            self.group_names[new_gid] = f"{group_prefix}.{base_name}" if group_prefix else base_name
            group_id_map[old_gid] = new_gid
            if old_gid in other.active_groups:
                self.active_groups.add(new_gid)

        neuron_id_map: Dict[int, int] = {}
        new_ids: List[int] = []
        for old_id in sorted(other.neurons.keys()):
            new_id = self.n_neurons
            self.n_neurons += 1
            neuron_id_map[old_id] = new_id
            new_ids.append(new_id)

        for old_id, new_id in neuron_id_map.items():
            old_neuron = other.neurons[old_id]
            neuron = NeuronState(
                neuron_id=new_id,
                role=old_neuron.role,
                group=group_id_map[old_neuron.group],
                state_vector=list(old_neuron.state_vector),
                vale=old_neuron.vale,
                input_flag=old_neuron.input_flag,
                activation=old_neuron.activation,
                last_spike_time=old_neuron.last_spike_time,
                total_spikes=old_neuron.total_spikes,
                consecutive_divergence=old_neuron.consecutive_divergence,
                average_activation=old_neuron.average_activation,
                update_count=old_neuron.update_count,
                dsl_bias=old_neuron.dsl_bias,
            )
            self.neurons[new_id] = neuron
            self._incoming_by_target.setdefault(new_id, [])

        # Preserve other's own connections among its absorbed neurons.
        for (old_src, old_tgt), conn in other.connections.items():
            new_src, new_tgt = neuron_id_map[old_src], neuron_id_map[old_tgt]
            new_conn = SynapticConnection(
                source_id=new_src,
                target_id=new_tgt,
                weight_matrix=[row[:] for row in conn.weight_matrix],
                base_learning_rate=conn.base_learning_rate,
                eligibility_trace=conn.eligibility_trace,
                eligibility_decay=conn.eligibility_decay,
            )
            self.connections[(new_src, new_tgt)] = new_conn
            self._incoming_by_target[new_tgt].append(new_src)

        # New cross-connections between self's original neurons and the
        # absorbed ones -- fresh weights, exactly like add_expert_group's
        # own cross-wiring, since there is no learned relationship yet.
        scale = 1.0 / math.sqrt(self.n_neurons * nd)

        def _wire(source_id: int, target_id: int) -> None:
            conn = SynapticConnection(source_id=source_id, target_id=target_id, base_learning_rate=0.01)
            conn.initialize_weights(nd, scale, rng=self._rng)
            self.connections[(source_id, target_id)] = conn
            self._incoming_by_target.setdefault(target_id, []).append(source_id)

        for nid in new_ids:
            for existing_id in existing_ids:
                _wire(nid, existing_id)
                _wire(existing_id, nid)

        self._invalidate_parallel_pool()
        return neuron_id_map, group_id_map

    def _apply_divergence_correction(
        self,
        prev_state: Dict[int, List[float]],
        new_states: Dict[int, List[float]],
        damping_factor: float = 0.5
    ):
        """Apply damping to correct divergent settle."""
        self._divergence_events += 1
        
        for neuron_id in new_states:
            if neuron_id in prev_state:
                # Blend toward previous state
                for d in range(len(new_states[neuron_id])):
                    new_states[neuron_id][d] = (
                        damping_factor * prev_state[neuron_id][d] +
                        (1 - damping_factor) * new_states[neuron_id][d]
                    )
    
    def _read_output(self) -> List[float]:
        """Read output from output neurons."""
        output = []
        for neuron_id, neuron in sorted(self.neurons.items()):
            if neuron.role == NeuronRole.OUTPUT:
                # Average of content dimensions
                content = neuron.get_content_state()
                if content:
                    output.append(sum(content) / len(content))
                else:
                    output.append(0.0)
        return output
    
    def apply_hebbian_learning(self, pre_activations: Dict[int, float], 
                                post_activations: Dict[int, float],
                                reward_signal: float = 1.0,
                                dt: float = 0.001):
        """
        Apply Hebbian learning rule across all connections.
        
        Learning is gated by target neuron's vale.
        """
        for (source_id, target_id), conn in self.connections.items():
            pre_act = pre_activations.get(source_id, 0.0)
            post_act = post_activations.get(target_id, 0.0)
            
            target_neuron = self.neurons.get(target_id)
            if not target_neuron:
                continue
            
            # Get effective learning rate (gated by vale)
            effective_lr = conn.apply_vale_gate(target_neuron.vale)
            
            # Three-factor learning: pre * post * reward
            delta = effective_lr * pre_act * post_act * reward_signal * dt

            # Update weight matrix (simplified: scale all weights uniformly).
            # NOTE: the delta above is already scaled by effective_lr (~0.01),
            # the activations, reward, and dt (~0.001). The previous code
            # multiplied by an *extra* 0.01 here, which collapsed the per-step
            # weight change to ~1e-7 -- so learning was effectively dead
            # (~10^7 steps to move a weight by 1.0). That extra factor has been
            # removed so the three-factor Hebbian rule actually updates weights.
            wm = conn.weight_matrix
            nd = self.n_dimensions
            for d1 in range(nd):
                row = wm[d1]
                for d2 in range(nd):
                    v = row[d2] + delta
                    # Clamp weights to [-1, 1]
                    row[d2] = -1.0 if v < -1.0 else (1.0 if v > 1.0 else v)

        self._invalidate_parallel_pool()

    def step_continuous(self, input_vector: List[float]) -> List[float]:
        """
        Step the mesh in continuous mode, carrying state forward.
        
        Args:
            input_vector: New input values
            
        Returns:
            Output values
        """
        if not self.continuous:
            return self.activate(input_vector)
        
        # Carry state from previous step
        if self._carried_state is not None:
            for neuron_id, state in self._carried_state.items():
                if neuron_id in self.neurons:
                    self.neurons[neuron_id].state_vector = list(state)
        
        # Activate with new input
        output = self.activate(input_vector)
        
        # Save state for next step
        self._carried_state = {
            nid: list(n.state_vector) 
            for nid, n in self.neurons.items()
        }
        
        return output
    
    def get_statistics(self) -> Dict:
        """Get comprehensive statistics about the mesh state."""
        stats = {
            'current_tick': self.current_tick,
            'global_time': self.global_time,
            'neurons': {
                'total': len(self.neurons),
                'by_role': {},
                'by_group': {},
                'average_vale': sum(n.vale for n in self.neurons.values()) / len(self.neurons),
                'average_activation': sum(n.activation for n in self.neurons.values()) / len(self.neurons)
            },
            'connections': len(self.connections),
            'diagnostics': {
                'live_corrections': self._live_corrections,
                'divergence_events': self._divergence_events
            }
        }
        
        # Count by role
        for neuron in self.neurons.values():
            role = neuron.role.value
            stats['neurons']['by_role'][role] = stats['neurons']['by_role'].get(role, 0) + 1
            group = neuron.group
            stats['neurons']['by_group'][group] = stats['neurons']['by_group'].get(group, 0) + 1
        
        return stats
    
    def save_state(self) -> Dict:
        """Save complete mesh state for serialization."""
        return {
            'config': {
                'n_neurons': self.n_neurons,
                'n_dimensions': self.n_dimensions,
                'n_input': self.n_input,
                'n_groups': self.n_groups,
                'settle_ticks': self.settle_ticks,
                'vale_total': self.vale_total,
                'continuous': self.continuous
            },
            'neurons': {
                nid: {
                    'role': n.role.value,
                    'group': n.group,
                    'state_vector': n.state_vector,
                    'vale': n.vale,
                    'activation': n.activation,
                    'total_spikes': n.total_spikes
                }
                for nid, n in self.neurons.items()
            },
            'connections': {
                f"{sid}->{tid}": {
                    'weight_matrix': c.weight_matrix,
                    'eligibility_trace': c.eligibility_trace
                }
                for (sid, tid), c in self.connections.items()
            },
            'diagnostics': {
                'live_corrections': self._live_corrections,
                'divergence_events': self._divergence_events
            },
            'groups': {
                'names': dict(self.group_names),
                'scores': list(self.group_scores),
                'active': sorted(self.active_groups),
            }
        }

    def load_state(self, state: Dict):
        """Load mesh state from serialization."""
        config = state.get('config', {})

        # Verify config matches
        if config.get('n_neurons') != self.n_neurons:
            raise ValueError("Neuron count mismatch")
        if config.get('n_dimensions') != self.n_dimensions:
            raise ValueError("Dimension count mismatch")
        if config.get('n_groups') != self.n_groups:
            raise ValueError("Group count mismatch")

        # Load neurons
        for nid_str, n_data in state.get('neurons', {}).items():
            nid = int(nid_str)
            if nid in self.neurons:
                neuron = self.neurons[nid]
                neuron.role = NeuronRole(n_data['role'])
                neuron.group = n_data['group']
                neuron.state_vector = n_data['state_vector']
                neuron.vale = n_data['vale']
                neuron.activation = n_data.get('activation', 0.0)
                neuron.total_spikes = n_data.get('total_spikes', 0)
        
        # Load connections
        for conn_key, c_data in state.get('connections', {}).items():
            parts = conn_key.split('->')
            if len(parts) == 2:
                sid, tid = int(parts[0]), int(parts[1])
                if (sid, tid) in self.connections:
                    conn = self.connections[(sid, tid)]
                    conn.weight_matrix = c_data['weight_matrix']
                    conn.eligibility_trace = c_data.get('eligibility_trace', 0.0)

        self._invalidate_parallel_pool()

        # Load diagnostics
        diag = state.get('diagnostics', {})
        self._live_corrections = diag.get('live_corrections', 0)
        self._divergence_events = diag.get('divergence_events', 0)

        # Load expert group names/scores/active selection
        groups = state.get('groups', {})
        if groups:
            self.group_names = {int(k): v for k, v in groups.get('names', {}).items()}
            saved_scores = groups.get('scores')
            if saved_scores is not None and len(saved_scores) == self.n_groups:
                self.group_scores = list(saved_scores)
            active = groups.get('active')
            if active is not None:
                self.active_groups = set(active)


# Convenience function for creating standard configurations
def create_mesh(config_type: str = "default") -> NeuralMesh:
    """
    Create a neural mesh with predefined configurations.
    
    Args:
        config_type: One of "default", "small", "large", "experimental"
        
    Returns:
        Configured NeuralMesh instance
    """
    configs = {
        "default": {
            "n_neurons": 64,
            "n_dimensions": 4,
            "n_input": 8,
            "n_groups": 4,
            "settle_ticks": 4
        },
        "small": {
            "n_neurons": 16,
            "n_dimensions": 4,
            "n_input": 4,
            "n_groups": 2,
            "settle_ticks": 3
        },
        "large": {
            "n_neurons": 128,
            "n_dimensions": 8,
            "n_input": 16,
            "n_groups": 8,
            "settle_ticks": 6
        },
        "experimental": {
            "n_neurons": 32,
            "n_dimensions": 6,
            "n_input": 6,
            "n_groups": 4,
            "settle_ticks": 8,
            "continuous": True
        }
    }
    
    cfg = configs.get(config_type, configs["default"])
    return NeuralMesh(**cfg)
