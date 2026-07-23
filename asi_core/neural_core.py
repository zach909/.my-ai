"""
ASI Neural Core - Stage 1 Implementation

The foundational neural architecture for Artificial Superintelligence.
This implements real, executable neural computation with learning capabilities.

Architecture:
- Neurons with configurable activation functions
- Synaptic connections with plastic weights
- Hebbian learning rules
- Spike-timing-dependent plasticity (STDP)
- Multiple neuron types (excitatory, inhibitory)
- Layer organization
"""

import math
import time
import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Callable
from enum import Enum


class ActivationFunction(Enum):
    """Supported activation functions."""
    SIGMOID = "sigmoid"
    TANH = "tanh"
    RELU = "relu"
    LEAKY_RELU = "leaky_relu"
    SOFTPLUS = "softplus"
    GAUSSIAN = "gaussian"


class NeuronType(Enum):
    """Types of neurons."""
    EXCITATORY = "excitatory"
    INHIBITORY = "inhibitory"
    MODULATORY = "modulatory"
    SENSORY = "sensory"
    MOTOR = "motor"
    INTERNEURON = "interneuron"


@dataclass
class Synapse:
    """
    A synaptic connection between neurons.
    
    Implements synaptic plasticity for learning.
    """
    source_id: str
    target_id: str
    weight: float = 0.5
    delay: float = 0.001  # Transmission delay in seconds
    last_activation: float = 0.0
    
    # Plasticity parameters
    learning_rate: float = 0.01
    decay_rate: float = 0.001
    stdp_window: float = 0.02  # 20ms window for STDP
    stdp_amplitude: float = 0.1
    
    # State
    eligibility_trace: float = 0.0
    cumulative_spike_timing: float = 0.0
    
    def update_weight_hebbian(self, pre_activation: float, post_activation: float, dt: float):
        """
        Update weight using Hebbian learning rule.
        "Neurons that fire together, wire together."
        """
        delta = self.learning_rate * pre_activation * post_activation * (1 - abs(self.weight))
        self.weight += delta * dt
        
        # Apply decay
        self.weight -= self.decay_rate * self.weight * dt
        
        # Clamp weight
        self.weight = max(-1.0, min(1.0, self.weight))
    
    def update_weight_stdp(self, pre_spike_time: float, post_spike_time: float):
        """
        Update weight using Spike-Timing-Dependent Plasticity.
        
        If pre fires before post: potentiation (strengthen)
        If post fires before pre: depression (weaken)
        """
        delta_t = post_spike_time - pre_spike_time
        
        if abs(delta_t) < self.stdp_window:
            if delta_t > 0:
                # Pre before post: LTP (Long-Term Potentiation)
                delta_w = self.stdp_amplitude * math.exp(-delta_t / self.stdp_window)
            else:
                # Post before pre: LTD (Long-Term Depression)
                delta_w = -self.stdp_amplitude * math.exp(delta_t / self.stdp_window)
            
            self.weight += delta_w
            self.weight = max(-1.0, min(1.0, self.weight))
    
    def transmit(self, source_activation: float) -> float:
        """Transmit signal from source to target."""
        return source_activation * self.weight


@dataclass
class Neuron:
    """
    A computational neuron unit.
    
    Implements:
    - Membrane potential dynamics
    - Spike generation
    - Refractory period
    - Adaptive threshold
    """
    id: str
    neuron_type: NeuronType = NeuronType.INTERNEURON
    activation_fn: ActivationFunction = ActivationFunction.SIGMOID
    
    # State variables
    membrane_potential: float = 0.0
    activation: float = 0.0
    bias: float = 0.0
    
    # Threshold dynamics
    threshold: float = 0.5
    adaptive_threshold: bool = True
    threshold_adaptation: float = 0.1
    
    # Refractory period
    refractory_period: float = 0.002  # 2ms absolute refractory
    last_spike_time: float = -1.0
    in_refractory: bool = False
    
    # Connections
    incoming_synapses: Dict[str, Synapse] = field(default_factory=dict)
    outgoing_synapses: List[str] = field(default_factory=list)
    
    # Learning parameters
    learning_rate: float = 0.01
    homeostatic_target: float = 0.3  # Target firing rate
    
    # Statistics
    total_spikes: int = 0
    average_firing_rate: float = 0.0
    spike_times: List[float] = field(default_factory=list)
    
    def activate(self, input_current: float, dt: float = 0.001) -> float:
        """
        Compute activation from input current.
        
        Args:
            input_current: Total synaptic input current
            dt: Time step
            
        Returns:
            New activation value
        """
        # Check refractory period
        if self.in_refractory:
            time_since_spike = time.time() - self.last_spike_time
            if time_since_spike > self.refractory_period:
                self.in_refractory = False
            else:
                # In refractory: reduced response
                input_current *= 0.1
        
        # Update membrane potential (leaky integrate-and-fire model)
        tau = 0.01  # Membrane time constant
        self.membrane_potential += dt / tau * (-self.membrane_potential + input_current + self.bias)
        
        # Apply activation function
        if self.activation_fn == ActivationFunction.SIGMOID:
            self.activation = 1.0 / (1.0 + math.exp(-self.membrane_potential))
        elif self.activation_fn == ActivationFunction.TANH:
            self.activation = math.tanh(self.membrane_potential)
        elif self.activation_fn == ActivationFunction.RELU:
            self.activation = max(0.0, self.membrane_potential)
        elif self.activation_fn == ActivationFunction.LEAKY_RELU:
            self.activation = self.membrane_potential if self.membrane_potential > 0 else 0.01 * self.membrane_potential
        elif self.activation_fn == ActivationFunction.SOFTPLUS:
            self.activation = math.log(1 + math.exp(self.membrane_potential))
        elif self.activation_fn == ActivationFunction.GAUSSIAN:
            self.activation = math.exp(-self.membrane_potential ** 2)
        
        # Adaptive threshold
        if self.adaptive_threshold:
            self.threshold += dt * self.threshold_adaptation * (self.activation - self.homeostatic_target)
            self.threshold = max(0.1, min(1.0, self.threshold))
        
        return self.activation
    
    def check_spike(self, current_time: float) -> bool:
        """
        Check if neuron should fire a spike.
        
        Returns:
            True if neuron fired
        """
        if self.in_refractory:
            return False
        
        if self.activation > self.threshold:
            self.last_spike_time = current_time
            self.in_refractory = True
            self.total_spikes += 1
            
            # Record spike time (keep last 100)
            self.spike_times.append(current_time)
            if len(self.spike_times) > 100:
                self.spike_times.pop(0)
            
            # Update firing rate estimate
            if len(self.spike_times) >= 2:
                interval = self.spike_times[-1] - self.spike_times[0]
                if interval > 0:
                    self.average_firing_rate = len(self.spike_times) / interval
            
            # Reset membrane potential after spike
            self.membrane_potential = 0.0
            
            return True
        
        return False
    
    def get_input_current(self, presynaptic_activations: Dict[str, float]) -> float:
        """
        Calculate total input current from all presynaptic neurons.
        
        Args:
            presynaptic_activations: Dictionary of source neuron activations
            
        Returns:
            Total input current
        """
        total_current = 0.0
        
        for synapse in self.incoming_synapses.values():
            source_id = synapse.source_id
            if source_id in presynaptic_activations:
                pre_activation = presynaptic_activations[source_id]
                current = synapse.transmit(pre_activation)
                
                # Inhibitory neurons produce negative current
                if self.neuron_type == NeuronType.INHIBITORY:
                    current = -abs(current)
                
                total_current += current
        
        return total_current


class NeuralLayer:
    """
    A layer of neurons with shared properties.
    """
    
    def __init__(self, layer_id: str, neuron_count: int, 
                 neuron_type: NeuronType = NeuronType.INTERNEURON,
                 activation_fn: ActivationFunction = ActivationFunction.SIGMOID):
        self.layer_id = layer_id
        self.neuron_type = neuron_type
        self.activation_fn = activation_fn
        
        self.neurons: Dict[str, Neuron] = {}
        
        # Create neurons
        for i in range(neuron_count):
            neuron_id = f"{layer_id}_n{i}"
            self.neurons[neuron_id] = Neuron(
                id=neuron_id,
                neuron_type=neuron_type,
                activation_fn=activation_fn
            )
        
        # Create intra-layer connections (sparse connectivity)
        self._create_sparse_connections(connection_probability=0.1)
    
    def _create_sparse_connections(self, connection_probability: float = 0.1):
        """Create random connections within the layer."""
        neuron_ids = list(self.neurons.keys())
        
        for source_id in neuron_ids:
            for target_id in neuron_ids:
                if source_id != target_id and random.random() < connection_probability:
                    self.connect(source_id, target_id)
    
    def connect(self, source_id: str, target_id: str, weight: float = None):
        """Create a synaptic connection between neurons."""
        if target_id not in self.neurons:
            return
        
        target_neuron = self.neurons[target_id]
        
        if source_id not in target_neuron.incoming_synapses:
            synapse = Synapse(
                source_id=source_id,
                target_id=target_id,
                weight=weight if weight is not None else random.uniform(-0.5, 0.5)
            )
            target_neuron.incoming_synapses[source_id] = synapse
        
        if source_id in self.neurons:
            source_neuron = self.neurons[source_id]
            if target_id not in source_neuron.outgoing_synapses:
                source_neuron.outgoing_synapses.append(target_id)
    
    def get_activations(self) -> Dict[str, float]:
        """Get activations of all neurons in the layer."""
        return {n.id: n.activation for n in self.neurons.values()}
    
    def update(self, external_input: Dict[str, float] = None, dt: float = 0.001) -> Dict[str, float]:
        """
        Update all neurons in the layer.
        
        Args:
            external_input: Optional external input to specific neurons
            dt: Time step
            
        Returns:
            Dictionary of neuron activations
        """
        current_time = time.time()
        activations = self.get_activations()
        
        # Add external input
        if external_input:
            for neuron_id, input_value in external_input.items():
                if neuron_id in activations:
                    activations[neuron_id] += input_value
        
        # Update each neuron
        for neuron in self.neurons.values():
            input_current = neuron.get_input_current(activations)
            neuron.activate(input_current, dt)
            neuron.check_spike(current_time)
        
        return self.get_activations()


class NeuralCore:
    """
    The central neural architecture for ASI.
    
    This implements:
    - Multi-layer neural network
    - Recurrent connections
    - Synaptic plasticity (Hebbian + STDP)
    - Homeostatic regulation
    - Activity monitoring
    """
    
    def __init__(self, config: Dict = None):
        self.config = config or self._default_config()
        
        # Layers
        self.layers: Dict[str, NeuralLayer] = {}
        
        # Inter-layer connections
        self.inter_layer_synapses: Dict[Tuple[str, str], Synapse] = {}
        
        # Global state
        self.current_time: float = 0.0
        self.learning_enabled: bool = True
        self.global_learning_rate: float = 0.01
        
        # Neuromodulators (global signals that affect learning)
        self.neuromodulators: Dict[str, float] = {
            'dopamine': 0.5,  # Reward prediction error
            'serotonin': 0.5,  # Mood/well-being
            'acetylcholine': 0.5,  # Attention/learning rate
            'norepinephrine': 0.5  # Arousal/alertness
        }
        
        # Statistics
        self.total_updates: int = 0
        self.total_spikes: int = 0
        self.learning_events: int = 0
        
        # Initialize layers from config
        self._initialize_layers()
    
    def _default_config(self) -> Dict:
        """Default network configuration."""
        return {
            'layers': [
                {'id': 'input', 'size': 64, 'type': 'SENSORY'},
                {'id': 'hidden1', 'size': 128, 'type': 'INTERNEURON'},
                {'id': 'hidden2', 'size': 128, 'type': 'INTERNEURON'},
                {'id': 'output', 'size': 32, 'type': 'MOTOR'}
            ],
            'connection_probability': 0.1,
            'recurrent_connections': True,
            'learning_enabled': True
        }
    
    def _initialize_layers(self):
        """Initialize neural layers from configuration."""
        for layer_config in self.config['layers']:
            layer_id = layer_config['id']
            size = layer_config['size']
            neuron_type = NeuronType[layer_config.get('type', 'INTERNEURON')]
            
            layer = NeuralLayer(
                layer_id=layer_id,
                neuron_count=size,
                neuron_type=neuron_type
            )
            self.layers[layer_id] = layer
        
        # Connect layers sequentially
        layer_ids = [lc['id'] for lc in self.config['layers']]
        for i in range(len(layer_ids) - 1):
            self._connect_layers(layer_ids[i], layer_ids[i + 1])
        
        # Add recurrent connections if enabled
        if self.config.get('recurrent_connections', True):
            self._add_recurrent_connections()
    
    def _connect_layers(self, source_layer: str, target_layer: str, 
                       connection_probability: float = 0.1):
        """Create connections between two layers."""
        if source_layer not in self.layers or target_layer not in self.layers:
            return
        
        source_neurons = list(self.layers[source_layer].neurons.keys())
        target_neurons = list(self.layers[target_layer].neurons.keys())
        
        for source_id in source_neurons:
            for target_id in target_neurons:
                if random.random() < connection_probability:
                    synapse = Synapse(
                        source_id=source_id,
                        target_id=target_id,
                        weight=random.uniform(-0.5, 0.5)
                    )
                    
                    # Add synapse to target neuron
                    self.layers[target_layer].neurons[target_id].incoming_synapses[source_id] = synapse
                    
                    # Store inter-layer synapse reference
                    self.inter_layer_synapses[(source_id, target_id)] = synapse
                    
                    # Track in source neuron
                    if target_id not in self.layers[source_layer].neurons[source_id].outgoing_synapses:
                        self.layers[source_layer].neurons[source_id].outgoing_synapses.append(target_id)
    
    def _add_recurrent_connections(self):
        """Add recurrent (feedback) connections within layers."""
        for layer_id, layer in self.layers.items():
            # Add some recurrent connections (10% of neurons connect back)
            neuron_ids = list(layer.neurons.keys())
            for i, source_id in enumerate(neuron_ids[:len(neuron_ids)//10]):
                target_idx = (i + 1) % len(neuron_ids)
                target_id = neuron_ids[target_idx]
                layer.connect(source_id, target_id, weight=random.uniform(0.1, 0.3))
    
    def inject_input(self, layer_id: str, input_pattern: Dict[str, float]):
        """
        Inject input pattern into a specific layer.
        
        Args:
            layer_id: Target layer
            input_pattern: Dictionary mapping neuron IDs to input values
        """
        if layer_id not in self.layers:
            return
        
        for neuron_id, value in input_pattern.items():
            full_id = f"{layer_id}_{neuron_id}" if not neuron_id.startswith(layer_id) else neuron_id
            if full_id in self.layers[layer_id].neurons:
                neuron = self.layers[layer_id].neurons[full_id]
                neuron.membrane_potential += value
    
    def apply_neuromodulator(self, modulator: str, value: float):
        """
        Apply neuromodulator signal.
        
        Args:
            modulator: Name of neuromodulator
            value: Concentration level (0.0 to 1.0)
        """
        if modulator in self.neuromodulators:
            self.neuromodulators[modulator] = max(0.0, min(1.0, value))
            
            # Modulate learning rates based on neuromodulators
            if modulator == 'acetylcholine':
                # Acetylcholine increases learning rate
                self.global_learning_rate = 0.01 * (0.5 + value)
            elif modulator == 'dopamine':
                # Dopamine gates plasticity
                for synapse in self.inter_layer_synapses.values():
                    synapse.learning_rate = 0.01 * value
    
    def update(self, inputs: Dict[str, Dict[str, float]] = None, dt: float = 0.001) -> Dict:
        """
        Update the entire neural core for one timestep.
        
        Args:
            inputs: Optional inputs per layer
            dt: Time step
            
        Returns:
            Status dictionary with activations and statistics
        """
        self.current_time += dt
        self.total_updates += 1
        
        # Process layers in order
        layer_order = [lc['id'] for lc in self.config['layers']]
        all_activations = {}
        spikes_this_step = 0
        
        for layer_id in layer_order:
            layer = self.layers[layer_id]
            external_input = inputs.get(layer_id) if inputs else None
            
            activations = layer.update(external_input, dt)
            all_activations[layer_id] = activations
            
            # Count spikes
            for neuron in layer.neurons.values():
                spikes_this_step += neuron.total_spikes
        
        self.total_spikes = spikes_this_step
        
        # Apply learning if enabled
        if self.learning_enabled:
            self._apply_learning(dt)
        
        return {
            'time': self.current_time,
            'activations': all_activations,
            'spikes': spikes_this_step,
            'neuromodulators': dict(self.neuromodulators),
            'statistics': {
                'total_updates': self.total_updates,
                'learning_events': self.learning_events,
                'total_neurons': sum(len(l.neurons) for l in self.layers.values())
            }
        }
    
    def _apply_learning(self, dt: float):
        """Apply synaptic plasticity rules."""
        dopamine = self.neuromodulators.get('dopamine', 0.5)
        
        for layer in self.layers.values():
            for neuron in layer.neurons.values():
                # Apply Hebbian learning to incoming synapses
                for synapse in neuron.incoming_synapses.values():
                    source_id = synapse.source_id
                    
                    # Find source neuron activation
                    source_activation = 0.0
                    for l in layer.neurons.values():
                        if l.id == source_id:
                            source_activation = l.activation
                            break
                    
                    # Check if source is in another layer
                    if source_activation == 0.0:
                        for other_layer in self.layers.values():
                            if source_id in other_layer.neurons:
                                source_activation = other_layer.neurons[source_id].activation
                                break
                    
                    # Hebbian update gated by dopamine
                    if source_activation > 0 and neuron.activation > 0:
                        synapse.update_weight_hebbian(
                            source_activation,
                            neuron.activation,
                            dt * dopamine
                        )
                        self.learning_events += 1
    
    def get_activity_statistics(self) -> Dict:
        """Get statistics about network activity."""
        stats = {
            'layers': {},
            'average_activation': 0.0,
            'total_spikes': 0,
            'active_neurons': 0
        }
        
        total_activation = 0.0
        total_neurons = 0
        
        for layer_id, layer in self.layers.items():
            layer_stats = {
                'neuron_count': len(layer.neurons),
                'average_activation': 0.0,
                'spiking_neurons': 0,
                'firing_rates': []
            }
            
            layer_activation_sum = 0.0
            for neuron in layer.neurons.values():
                layer_activation_sum += neuron.activation
                total_activation += neuron.activation
                total_neurons += 1
                
                if neuron.activation > 0.5:
                    layer_stats['spiking_neurons'] += 1
                    stats['active_neurons'] += 1
                
                if neuron.average_firing_rate > 0:
                    layer_stats['firing_rates'].append(neuron.average_firing_rate)
                
                stats['total_spikes'] += neuron.total_spikes
            
            if layer.neurons:
                layer_stats['average_activation'] = layer_activation_sum / len(layer.neurons)
            
            stats['layers'][layer_id] = layer_stats
        
        if total_neurons > 0:
            stats['average_activation'] = total_activation / total_neurons
        
        return stats
    
    def save_state(self) -> Dict:
        """Save the current state of the neural core."""
        state = {
            'config': self.config,
            'current_time': self.current_time,
            'neuromodulators': dict(self.neuromodulators),
            'layers': {}
        }
        
        for layer_id, layer in self.layers.items():
            layer_state = {
                'neurons': {}
            }
            
            for neuron_id, neuron in layer.neurons.items():
                layer_state['neurons'][neuron_id] = {
                    'membrane_potential': neuron.membrane_potential,
                    'threshold': neuron.threshold,
                    'bias': neuron.bias,
                    'total_spikes': neuron.total_spikes,
                    'synapses': {
                        syn_id: {
                            'weight': syn.weight,
                            'learning_rate': syn.learning_rate
                        }
                        for syn_id, syn in neuron.incoming_synapses.items()
                    }
                }
            
            state['layers'][layer_id] = layer_state
        
        return state
    
    def load_state(self, state: Dict):
        """Load a previously saved state."""
        self.config = state.get('config', self.config)
        self.current_time = state.get('current_time', 0.0)
        self.neuromodulators = state.get('neuromodulators', self.neuromodulators)
        
        # Restore layer states
        for layer_id, layer_state in state.get('layers', {}).items():
            if layer_id in self.layers:
                layer = self.layers[layer_id]
                for neuron_id, neuron_state in layer_state.get('neurons', {}).items():
                    if neuron_id in layer.neurons:
                        neuron = layer.neurons[neuron_id]
                        neuron.membrane_potential = neuron_state.get('membrane_potential', 0.0)
                        neuron.threshold = neuron_state.get('threshold', 0.5)
                        neuron.bias = neuron_state.get('bias', 0.0)
                        neuron.total_spikes = neuron_state.get('total_spikes', 0)


__all__ = [
    'NeuralCore',
    'NeuralLayer', 
    'Neuron',
    'Synapse',
    'ActivationFunction',
    'NeuronType'
]
