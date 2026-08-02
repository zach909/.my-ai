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
        group_score_decay: float = 0.9
    ):
        # Validate configuration
        assert n_dimensions >= 2, "Need dim 0 for input flag plus >=1 content dim"
        assert 1 <= n_input < n_neurons, "Input neurons must be subset of total"

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
                # Set content dimensions (skip dimension 0 which is the flag)
                for d in range(1, min(len(neuron.state_vector), len(input_pattern) + 1)):
                    if d <= len(input_pattern):
                        neuron.state_vector[d] = input_pattern[d - 1] if d - 1 < len(input_pattern) else 0
    
    def compute_neuron_input(self, neuron_id: int, active_mask: Optional[Set[int]] = None) -> List[float]:
        """
        Compute total input to a neuron from all other neurons.
        
        Args:
            neuron_id: Target neuron ID
            active_mask: Optional set of active neuron IDs (for expert routing)
            
        Returns:
            List of input values for each dimension
        """
        result = [0.0] * self.n_dimensions
        
        # Check if neuron is active (for expert routing)
        if active_mask is not None and neuron_id not in active_mask:
            return result  # Dormant neuron receives no update
        
        neuron = self.neurons.get(neuron_id)
        if not neuron:
            return result
        
        # Sum contributions from all source neurons
        for source_id in range(self.n_neurons):
            if source_id == neuron_id:
                continue  # Skip self-connection
            
            if active_mask is not None and source_id not in active_mask:
                continue  # Skip inactive sources
            
            source = self.neurons.get(source_id)
            if not source:
                continue
            
            conn = self.connections.get((source_id, neuron_id))
            if not conn:
                continue
            
            # Matrix-vector multiplication: result[d] += sum(W[d][s] * source_state[s])
            for target_d in range(self.n_dimensions):
                for source_d in range(self.n_dimensions):
                    if source_d < len(source.state_vector):
                        result[target_d] += conn.weight_matrix[target_d][source_d] * source.state_vector[source_d]
        
        # Add bias (stored as connection from a virtual bias neuron)
        # For simplicity, we add a small constant bias
        for d in range(self.n_dimensions):
            result[d] += 0.01
        
        return result
    
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
            
            # Update each neuron
            new_states: Dict[int, List[float]] = {}
            max_divergence = 0.0
            
            for neuron_id, neuron in self.neurons.items():
                if active_mask is not None and neuron_id not in active_mask:
                    # Dormant neurons maintain state
                    new_states[neuron_id] = list(neuron.state_vector)
                    continue
                
                # Compute input from all other neurons
                neuron_input = self.compute_neuron_input(neuron_id, active_mask)
                
                # Apply nonlinearity (tanh) to each dimension
                new_state = []
                for d in range(self.n_dimensions):
                    if d == 0:
                        # Dimension 0 is the input flag - maintain it
                        new_state.append(neuron.input_flag)
                    else:
                        # Content dimensions - apply tanh
                        total_input = neuron_input[d] if d < len(neuron_input) else 0
                        activated = math.tanh(total_input)
                        new_state.append(activated)
                
                new_states[neuron_id] = new_state
                
                # Calculate divergence from previous state
                divergence = sum(
                    (new_state[d] - prev_state[neuron_id][d]) ** 2
                    for d in range(min(len(new_state), len(prev_state[neuron_id])))
                ) ** 0.5
                max_divergence = max(max_divergence, divergence)
                
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
            for neuron_id, new_state in new_states.items():
                self.neurons[neuron_id].state_vector = new_state
                self.neurons[neuron_id].activation = sum(new_state[1:]) / max(1, len(new_state) - 1)
            
            prev_state = new_states
        
        # Store settled state for diagnostics
        self._last_settled = dict(prev_state)
        
        return prev_state
    
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
            
            # Update weight matrix (simplified: scale all weights uniformly)
            for d1 in range(self.n_dimensions):
                for d2 in range(self.n_dimensions):
                    conn.weight_matrix[d1][d2] += delta * 0.01  # Small per-weight adjustment
                    # Clamp weights
                    conn.weight_matrix[d1][d2] = max(-1.0, min(1.0, conn.weight_matrix[d1][d2]))
    
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
        
        # Load diagnostics
        diag = state.get('diagnostics', {})
        self._live_corrections = diag.get('live_corrections', 0)
        self._divergence_events = diag.get('divergence_events', 0)


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
