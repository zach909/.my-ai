"""
Neural States and Learning Systems - Stage 2 Implementation

Implements detailed neural state representations and advanced learning mechanisms:
- Neural state vectors and dynamics
- Synaptic plasticity rules (Hebbian, STDP, homeostatic)
- Value systems for reinforcement learning
- State persistence and serialization
- Learning rate adaptation
"""

import math
import time
import json
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Tuple, Any
from enum import Enum
import random


class LearningRule(Enum):
    """Available learning rules."""
    HEBBIAN = "hebbian"
    STDP = "stdp"
    OJA = "oja"  # Normalized Hebbian
    BCM = "bcm"  # Bienenstock-Cooper-Munro
    REINFORCEMENT = "reinforcement"
    HOMEOSTATIC = "homeostatic"


class StateType(Enum):
    """Types of neural states."""
    MEMBRANE_POTENTIAL = "membrane_potential"
    ACTIVATION = "activation"
    CALCIUM = "calcium"
    CAMP = "camp"  # cAMP second messenger
    GENE_EXPRESSION = "gene_expression"
    SYNAPTIC_TAG = "synaptic_tag"
    ELIGIBILITY_TRACE = "eligibility_trace"


@dataclass
class NeuralState:
    """
    Complete state vector for a neuron.
    
    Tracks all internal variables that define neuron state.
    """
    neuron_id: str
    
    # Electrical state
    membrane_potential: float = 0.0
    activation: float = 0.0
    threshold: float = 0.5
    
    # Ionic concentrations (simplified)
    calcium_concentration: float = 0.0
    sodium_concentration: float = 140.0
    potassium_concentration: float = 5.0
    
    # Second messengers
    camp_level: float = 0.5
    
    # Gene expression (for long-term changes)
    gene_expression_level: float = 0.0
    protein_synthesis_rate: float = 0.0
    
    # Synaptic tagging (for memory consolidation)
    synaptic_tag: float = 0.0
    
    # Eligibility traces (for delayed reinforcement)
    eligibility_trace: float = 0.0
    eligibility_decay: float = 0.9
    
    # Temporal state
    last_spike_time: float = -1.0
    last_update_time: float = 0.0
    refractory_remaining: float = 0.0
    
    # Statistics
    total_spikes: int = 0
    average_firing_rate: float = 0.0
    spike_times: List[float] = field(default_factory=list)
    
    def update_eligibility_trace(self, dt: float = 0.001):
        """Decay eligibility trace over time."""
        self.eligibility_trace *= self.eligibility_decay ** (dt * 1000)
    
    def update_firing_rate(self, current_time: float):
        """Update running estimate of firing rate."""
        self.spike_times.append(current_time)
        
        # Keep only recent spikes (last 1 second)
        cutoff = current_time - 1.0
        self.spike_times = [t for t in self.spike_times if t > cutoff]
        
        if len(self.spike_times) >= 2:
            interval = self.spike_times[-1] - self.spike_times[0]
            if interval > 0:
                self.average_firing_rate = len(self.spike_times) / interval
    
    def to_dict(self) -> Dict:
        """Convert state to dictionary."""
        return {
            'neuron_id': self.neuron_id,
            'membrane_potential': self.membrane_potential,
            'activation': self.activation,
            'threshold': self.threshold,
            'calcium': self.calcium_concentration,
            'camp': self.camp_level,
            'gene_expression': self.gene_expression_level,
            'eligibility_trace': self.eligibility_trace,
            'firing_rate': self.average_firing_rate,
            'total_spikes': self.total_spikes
        }


@dataclass 
class SynapticState:
    """
    Complete state for a synapse.
    
    Includes weight, plasticity parameters, and temporal traces.
    """
    source_id: str
    target_id: str
    weight: float = 0.5
    
    # Plasticity parameters
    learning_rule: LearningRule = LearningRule.HEBBIAN
    learning_rate: float = 0.01
    decay_rate: float = 0.001
    
    # STDP parameters
    stdp_window: float = 0.02
    stdp_amplitude: float = 0.1
    
    # Temporal traces
    pre_trace: float = 0.0  # Presynaptic activity trace
    post_trace: float = 0.0  # Postsynaptic activity trace
    trace_decay: float = 0.9
    
    # Calcium-dependent plasticity
    calcium_threshold_ltp: float = 0.7  # High calcium -> LTP
    calcium_threshold_ltd: float = 0.3  # Medium calcium -> LTD
    
    # Weight bounds
    min_weight: float = -1.0
    max_weight: float = 1.0
    
    # Metaplasticity (learning rate adaptation)
    metaplasticity_threshold: float = 0.5
    accumulated_activity: float = 0.0
    
    def update_traces(self, pre_active: bool, post_active: bool, dt: float = 0.001):
        """Update presynaptic and postsynaptic traces."""
        if pre_active:
            self.pre_trace = min(1.0, self.pre_trace + 0.1)
        else:
            self.pre_trace *= self.trace_decay
        
        if post_active:
            self.post_trace = min(1.0, self.post_trace + 0.1)
        else:
            self.post_trace *= self.trace_decay
    
    def apply_hebbian(self, pre_activation: float, post_activation: float, dt: float):
        """Standard Hebbian learning."""
        delta = self.learning_rate * pre_activation * post_activation
        self.weight += delta * dt
        self._clamp_weight()
    
    def apply_stdp(self, pre_spike_time: float, post_spike_time: float):
        """Spike-timing-dependent plasticity."""
        delta_t = post_spike_time - pre_spike_time
        
        if abs(delta_t) < self.stdp_window:
            if delta_t > 0:
                # Pre before post: LTP
                delta_w = self.stdp_amplitude * math.exp(-delta_t / self.stdp_window)
            else:
                # Post before pre: LTD
                delta_w = -self.stdp_amplitude * math.exp(delta_t / self.stdp_window)
            
            self.weight += delta_w
            self._clamp_weight()
    
    def apply_oja(self, pre_activation: float, post_activation: float, dt: float):
        """Oja's rule - normalized Hebbian learning."""
        # Oja's rule: dw = η(yx - y²w)
        delta = self.learning_rate * (
            post_activation * pre_activation - 
            post_activation ** 2 * self.weight
        )
        self.weight += delta * dt
        self._clamp_weight()
    
    def apply_bcm(self, pre_activation: float, post_activation: float, dt: float):
        """BCM rule - sliding threshold plasticity."""
        # BCM: dw = η * y * x * (y - θ_m)
        # where θ_m is the metaplasticity threshold
        delta = self.learning_rate * post_activation * pre_activation * (
            post_activation - self.metaplasticity_threshold
        )
        self.weight += delta * dt
        
        # Update metaplasticity threshold (slowly track average activity)
        self.metaplasticity_threshold += 0.001 * (post_activation - self.metaplasticity_threshold)
        self._clamp_weight()
    
    def apply_reinforcement(self, reward_signal: float, eligibility: float, dt: float):
        """Three-factor reinforcement learning rule."""
        # dw = η * reward * eligibility_trace
        delta = self.learning_rate * reward_signal * eligibility
        self.weight += delta * dt
        self._clamp_weight()
    
    def apply_homeostatic(self, target_rate: float, current_rate: float, dt: float):
        """Homeostatic plasticity to maintain target firing rate."""
        error = target_rate - current_rate
        self.learning_rate *= (1.0 + 0.1 * error)
        self.learning_rate = max(0.001, min(0.1, self.learning_rate))
    
    def _clamp_weight(self):
        """Ensure weight stays within bounds."""
        self.weight = max(self.min_weight, min(self.max_weight, self.weight))
    
    def to_dict(self) -> Dict:
        """Convert state to dictionary."""
        return {
            'source': self.source_id,
            'target': self.target_id,
            'weight': self.weight,
            'learning_rule': self.learning_rule.value,
            'learning_rate': self.learning_rate,
            'pre_trace': self.pre_trace,
            'post_trace': self.post_trace
        }


class StateManager:
    """
    Manages neural states across the entire network.
    
    Provides:
    - State initialization
    - State updates
    - State persistence
    - State queries
    """
    
    def __init__(self):
        self.neuron_states: Dict[str, NeuralState] = {}
        self.synapse_states: Dict[str, SynapticState] = {}
        self.global_state: Dict[str, Any] = {
            'time': 0.0,
            'learning_enabled': True,
            'global_learning_rate': 0.01,
            'neuromodulators': {
                'dopamine': 0.5,
                'serotonin': 0.5,
                'acetylcholine': 0.5,
                'norepinephrine': 0.5
            }
        }
        
        # History for analysis
        self.state_history: List[Dict] = []
        self.history_max_length = 1000
    
    def register_neuron(self, neuron_id: str) -> NeuralState:
        """Register a new neuron state."""
        if neuron_id not in self.neuron_states:
            self.neuron_states[neuron_id] = NeuralState(neuron_id=neuron_id)
        return self.neuron_states[neuron_id]
    
    def register_synapse(self, source_id: str, target_id: str, 
                        weight: float = 0.5) -> SynapticState:
        """Register a new synapse state."""
        synapse_key = f"{source_id}->{target_id}"
        if synapse_key not in self.synapse_states:
            self.synapse_states[synapse_key] = SynapticState(
                source_id=source_id,
                target_id=target_id,
                weight=weight
            )
        return self.synapse_states[synapse_key]
    
    def get_neuron_state(self, neuron_id: str) -> Optional[NeuralState]:
        """Get state for a specific neuron."""
        return self.neuron_states.get(neuron_id)
    
    def get_synapse_state(self, source_id: str, target_id: str) -> Optional[SynapticState]:
        """Get state for a specific synapse."""
        synapse_key = f"{source_id}->{target_id}"
        return self.synapse_states.get(synapse_key)
    
    def update_time(self, dt: float):
        """Advance global time."""
        self.global_state['time'] += dt
    
    def record_state_snapshot(self):
        """Record current state for history."""
        snapshot = {
            'time': self.global_state['time'],
            'neuron_count': len(self.neuron_states),
            'synapse_count': len(self.synapse_states),
            'average_activation': sum(s.activation for s in self.neuron_states.values()) / max(1, len(self.neuron_states)),
            'average_weight': sum(s.weight for s in self.synapse_states.values()) / max(1, len(self.synapse_states))
        }
        
        self.state_history.append(snapshot)
        if len(self.state_history) > self.history_max_length:
            self.state_history.pop(0)
    
    def set_neuromodulator(self, name: str, value: float):
        """Set neuromodulator concentration."""
        if name in self.global_state['neuromodulators']:
            self.global_state['neuromodulators'][name] = max(0.0, min(1.0, value))
    
    def get_statistics(self) -> Dict:
        """Get comprehensive statistics about network state."""
        stats = {
            'time': self.global_state['time'],
            'neurons': {
                'count': len(self.neuron_states),
                'active_count': sum(1 for s in self.neuron_states.values() if s.activation > 0.5),
                'total_spikes': sum(s.total_spikes for s in self.neuron_states.values()),
                'average_firing_rate': sum(s.average_firing_rate for s in self.neuron_states.values()) / max(1, len(self.neuron_states))
            },
            'synapses': {
                'count': len(self.synapse_states),
                'average_weight': sum(s.weight for s in self.synapse_states.values()) / max(1, len(self.synapse_states)),
                'max_weight': max((s.weight for s in self.synapse_states.values()), default=0),
                'min_weight': min((s.weight for s in self.synapse_states.values()), default=0)
            },
            'neuromodulators': dict(self.global_state['neuromodulators']),
            'history_length': len(self.state_history)
        }
        return stats
    
    def save_to_file(self, filepath: str):
        """Save state to JSON file."""
        data = {
            'global_state': self.global_state,
            'neuron_states': {k: v.to_dict() for k, v in self.neuron_states.items()},
            'synapse_states': {k: v.to_dict() for k, v in self.synapse_states.items()},
            'history': self.state_history[-100:]  # Last 100 snapshots
        }
        
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
    
    def load_from_file(self, filepath: str):
        """Load state from JSON file."""
        with open(filepath, 'r') as f:
            data = json.load(f)
        
        self.global_state = data.get('global_state', self.global_state)
        
        for neuron_id, state_dict in data.get('neuron_states', {}).items():
            state = self.register_neuron(neuron_id)
            state.membrane_potential = state_dict.get('membrane_potential', 0.0)
            state.activation = state_dict.get('activation', 0.0)
            state.threshold = state_dict.get('threshold', 0.5)
            state.total_spikes = state_dict.get('total_spikes', 0)
        
        for synapse_key, state_dict in data.get('synapse_states', {}).items():
            parts = synapse_key.split('->')
            if len(parts) == 2:
                source_id, target_id = parts
                state = self.register_synapse(source_id, target_id)
                state.weight = state_dict.get('weight', 0.5)
                state.learning_rate = state_dict.get('learning_rate', 0.01)


class LearningSystem:
    """
    Centralized learning system that applies plasticity rules.
    
    Coordinates:
    - Multiple learning rules
    - Neuromodulator gating
    - Metaplasticity
    - Consolidation
    """
    
    def __init__(self, state_manager: StateManager):
        self.state_manager = state_manager
        self.active_rules: List[LearningRule] = [LearningRule.HEBBIAN]
        self.consolidation_enabled = True
        
        # Consolidation parameters
        self.consolidation_threshold = 0.8  # Tag strength for consolidation
        self.consolidation_rate = 0.001
    
    def apply_learning(self, dt: float = 0.001):
        """Apply all active learning rules."""
        if not self.state_manager.global_state['learning_enabled']:
            return
        
        dopamine = self.state_manager.global_state['neuromodulators'].get('dopamine', 0.5)
        
        for synapse_key, synapse in self.state_manager.synapse_states.items():
            # Get pre and post neuron states
            pre_state = self.state_manager.neuron_states.get(synapse.source_id)
            post_state = self.state_manager.neuron_states.get(synapse.target_id)
            
            if not pre_state or not post_state:
                continue
            
            # Apply each active learning rule
            for rule in self.active_rules:
                if rule == LearningRule.HEBBIAN:
                    synapse.apply_hebbian(
                        pre_state.activation,
                        post_state.activation,
                        dt * dopamine
                    )
                elif rule == LearningRule.OJA:
                    synapse.apply_oja(
                        pre_state.activation,
                        post_state.activation,
                        dt
                    )
                elif rule == LearningRule.BCM:
                    synapse.apply_bcm(
                        pre_state.activation,
                        post_state.activation,
                        dt
                    )
            
            # Update traces
            synapse.update_traces(
                pre_state.activation > 0.5,
                post_state.activation > 0.5,
                dt
            )
            
            # Homeostatic regulation
            synapse.apply_homeostatic(
                target_rate=0.3,
                current_rate=post_state.average_firing_rate,
                dt=dt
            )
    
    def apply_reinforcement(self, reward: float, dt: float = 0.001):
        """Apply reinforcement learning based on reward signal."""
        for synapse_key, synapse in self.state_manager.synapse_states.items():
            post_state = self.state_manager.neuron_states.get(synapse.target_id)
            if post_state:
                eligibility = post_state.eligibility_trace
                synapse.apply_reinforcement(reward, eligibility, dt)
    
    def consolidate_memories(self, dt: float = 0.001):
        """Consolidate strong synaptic tags into long-term changes."""
        if not self.consolidation_enabled:
            return
        
        for synapse_key, synapse in self.state_manager.synapse_states.items():
            post_state = self.state_manager.neuron_states.get(synapse.target_id)
            if post_state and post_state.synaptic_tag > self.consolidation_threshold:
                # Strengthen synapse permanently
                synapse.weight += self.consolidation_rate * dt
                synapse._clamp_weight()
                
                # Reduce tag after consolidation
                post_state.synaptic_tag *= 0.9


__all__ = [
    'NeuralState',
    'SynapticState', 
    'StateManager',
    'LearningSystem',
    'LearningRule',
    'StateType'
]
