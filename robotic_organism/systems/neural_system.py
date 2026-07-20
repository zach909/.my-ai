"""
Neural System - Artificial brain and nervous system.

An elastic neural network inspired by human brain organization,
with highly interconnected artificial neurons maintaining
multidimensional internal states.
"""

from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
import math
import random


@dataclass
class NeuronState:
    """Multidimensional internal state of a neuron"""
    membrane_potential: float = 0.0
    activation_level: float = 0.0
    fatigue: float = 0.0
    neurotransmitter_levels: Dict[str, float] = field(default_factory=dict)
    last_fired_time: float = 0.0
    firing_rate: float = 0.0
    plasticity_factor: float = 1.0  # Learning rate modifier
    

class ArtificialNeuron:
    """
    A single artificial neuron with elastic properties.
    
    Maintains multidimensional internal state and can form
    dynamic connections with other neurons.
    """
    
    def __init__(self, neuron_id: str, neuron_type: str = "regular"):
        self.id = neuron_id
        self.neuron_type = neuron_type  # sensory, motor, interneuron, etc.
        self.state = NeuronState()
        
        # Connections to other neurons
        self.inputs: Dict[str, float] = {}  # neuron_id -> weight
        self.outputs: Dict[str, float] = {}  # neuron_id -> weight
        
        # Firing threshold and parameters
        self.threshold = 0.5
        self.refractory_period = 0.002  # seconds
        self.decay_rate = 0.95
        
        # Position in neural space (for spatial organization)
        self.position: Tuple[float, float, float] = (0.0, 0.0, 0.0)
        
    def receive_signal(self, source_id: str, signal_strength: float):
        """Receive input signal from another neuron"""
        weight = self.inputs.get(source_id, 0.0)
        self.state.membrane_potential += signal_strength * weight
        
    def update(self, delta_time: float) -> float:
        """
        Update neuron state and return output signal if fired.
        
        Returns:
            Output signal strength (0 if not fired)
        """
        # Apply decay to membrane potential
        self.state.membrane_potential *= self.decay_rate
        
        # Update fatigue
        if self.state.fatigue > 0:
            self.state.fatigue -= delta_time * 0.5
            
        # Calculate activation level
        self.state.activation_level = max(0, min(1, 
            self.state.membrane_potential))
            
        # Check refractory period
        time_since_fire = delta_time  # Simplified
        if time_since_fire < self.refractory_period:
            return 0.0
            
        # Check if neuron fires
        if (self.state.membrane_potential >= self.threshold and 
            self.state.fatigue < 0.8):
            self._fire()
            output = self.state.activation_level
            self.state.membrane_potential = 0.0
            return output
            
        return 0.0
        
    def _fire(self):
        """Handle neuron firing event"""
        self.state.last_fired_time += 1
        self.state.firing_rate = 1.0 / (self.state.last_fired_time + 1)
        self.state.fatigue += 0.2
        
        # Update neurotransmitter levels
        for nt in self.state.neurotransmitter_levels:
            self.state.neurotransmitter_levels[nt] *= 0.9
            
    def adjust_weight(self, target_id: str, adjustment: float):
        """Adjust connection weight (synaptic plasticity)"""
        if target_id in self.outputs:
            self.outputs[target_id] += adjustment * self.state.plasticity_factor
            self.outputs[target_id] = max(0, min(1, self.outputs[target_id]))
            
    def connect_to(self, target_neuron: 'ArtificialNeuron', initial_weight: float = 0.5):
        """Form connection to another neuron"""
        self.outputs[target_neuron.id] = initial_weight
        target_neuron.inputs[self.id] = initial_weight
        
    def disconnect_from(self, target_id: str):
        """Remove connection to another neuron"""
        if target_id in self.outputs:
            del self.outputs[target_id]


class NeuralLayer:
    """A layer of interconnected neurons"""
    
    def __init__(self, layer_id: str, layer_type: str, size: int):
        self.id = layer_id
        self.layer_type = layer_type  # input, hidden, output, motor, sensory
        self.neurons: List[ArtificialNeuron] = []
        
        # Create neurons for this layer
        for i in range(size):
            neuron = ArtificialNeuron(f"{layer_id}_n{i}", layer_type)
            self.neurons.append(neuron)
            
    def update(self, delta_time: float) -> List[float]:
        """Update all neurons and return outputs"""
        outputs = []
        for neuron in self.neurons:
            output = neuron.update(delta_time)
            outputs.append(output)
        return outputs


class NeuralSystem:
    """
    Complete artificial neural system serving as the organism's brain.
    
    Organized into regions analogous to brain structures:
    - Cortex (processing)
    - Cerebellum (motor coordination)
    - Brainstem (basic functions)
    - Sensory processing areas
    - Motor control areas
    """
    
    def __init__(self, organism):
        self.organism = organism
        self.layers: Dict[str, NeuralLayer] = {}
        self.inter_layer_connections: Dict[str, Dict[str, float]] = {}
        self.sensory_inputs: Dict[str, List[float]] = {}
        self.motor_outputs: Dict[str, float] = {}
        self.memory_traces: List[Dict[str, Any]] = []
        self.global_activity: float = 0.0
        
        # Initialize brain regions
        self._initialize_brain_regions()
        self._connect_regions()
        
    def _initialize_brain_regions(self):
        """Create neural layers for different brain regions"""
        # Sensory processing layer
        self.layers['sensory_cortex'] = NeuralLayer(
            'sensory_cortex', 'sensory', size=64
        )
        
        # Visual processing
        self.layers['visual_cortex'] = NeuralLayer(
            'visual_cortex', 'sensory', size=128
        )
        
        # Auditory processing
        self.layers['auditory_cortex'] = NeuralLayer(
            'auditory_cortex', 'sensory', size=64
        )
        
        # Somatosensory (touch, proprioception)
        self.layers['somatosensory'] = NeuralLayer(
            'somatosensory', 'sensory', size=96
        )
        
        # Motor cortex
        self.layers['motor_cortex'] = NeuralLayer(
            'motor_cortex', 'motor', size=128
        )
        
        # Premotor planning
        self.layers['premotor'] = NeuralLayer(
            'premotor', 'motor', size=64
        )
        
        # Association cortex (integration)
        self.layers['association'] = NeuralLayer(
            'association', 'hidden', size=256
        )
        
        # Cerebellum (fine motor control)
        self.layers['cerebellum'] = NeuralLayer(
            'cerebellum', 'motor', size=192
        )
        
        # Brainstem (autonomic functions)
        self.layers['brainstem'] = NeuralLayer(
            'brainstem', 'interneuron', size=32
        )
        
        # Hippocampus analog (memory formation)
        self.layers['hippocampus'] = NeuralLayer(
            'hippocampus', 'hidden', size=64
        )
        
    def _connect_regions(self):
        """Establish connections between brain regions"""
        # Sensory pathways
        self._connect_layers('sensory_cortex', 'association', 0.7)
        self._connect_layers('visual_cortex', 'association', 0.8)
        self._connect_layers('auditory_cortex', 'association', 0.7)
        self._connect_layers('somatosensory', 'association', 0.75)
        
        # Motor pathways
        self._connect_layers('association', 'premotor', 0.7)
        self._connect_layers('premotor', 'motor_cortex', 0.8)
        self._connect_layers('motor_cortex', 'cerebellum', 0.6)
        
        # Feedback loops
        self._connect_layers('cerebellum', 'motor_cortex', 0.5)
        self._connect_layers('hippocampus', 'association', 0.6)
        
        # Autonomic control
        self._connect_layers('brainstem', 'association', 0.4)
        
    def _connect_layers(self, source: str, target: str, base_weight: float):
        """Create connections between two layers"""
        if source not in self.layers or target not in self.layers:
            return
            
        source_layer = self.layers[source]
        target_layer = self.layers[target]
        
        # Sparse connectivity (not every neuron connects to every other)
        connection_density = 0.3
        
        for source_neuron in source_layer.neurons:
            for target_neuron in target_layer.neurons:
                if random.random() < connection_density:
                    weight = base_weight * random.uniform(0.5, 1.0)
                    source_neuron.connect_to(target_neuron, weight)
                    
    def process_sensory_input(self, sensor_type: str, data: List[float]):
        """Process incoming sensory data"""
        self.sensory_inputs[sensor_type] = data
        
        # Route to appropriate cortical area
        layer_map = {
            'vision': 'visual_cortex',
            'audio': 'auditory_cortex',
            'touch': 'somatosensory',
            'proprioception': 'somatosensory',
            'general': 'sensory_cortex'
        }
        
        target_layer = layer_map.get(sensor_type, 'sensory_cortex')
        if target_layer in self.layers:
            layer = self.layers[target_layer]
            for i, neuron in enumerate(layer.neurons):
                if i < len(data):
                    neuron.state.membrane_potential += data[i] * 0.5
                    
    def generate_motor_command(self, action: str, 
                                parameters: Optional[Dict] = None) -> Dict[str, Any]:
        """
        Generate coordinated motor command for an action.
        
        Args:
            action: Name of action to perform
            parameters: Additional parameters for the action
            
        Returns:
            Motor command dictionary
        """
        parameters = parameters or {}
        
        # Activate premotor planning
        if 'premotor' in self.layers:
            for neuron in self.layers['premotor'].neurons[:10]:
                neuron.state.membrane_potential += 0.7
                
        # Generate specific motor pattern
        motor_pattern = self._generate_action_pattern(action, parameters)
        
        # Activate motor cortex
        if 'motor_cortex' in self.layers:
            for i, neuron in enumerate(self.layers['motor_cortex'].neurons):
                if i < len(motor_pattern):
                    neuron.state.membrane_potential += motor_pattern[i]
                    
        # Engage cerebellum for coordination
        if 'cerebellum' in self.layers:
            for neuron in self.layers['cerebellum'].neurons[:20]:
                neuron.state.membrane_potential += 0.5
                
        return {
            'action': action,
            'parameters': parameters,
            'pattern': motor_pattern,
            'coordination_level': 0.8
        }
        
    def _generate_action_pattern(self, action: str, 
                                  parameters: Dict) -> List[float]:
        """Generate neural activation pattern for specific action"""
        # Simplified pattern generation
        pattern_length = len(self.layers.get('motor_cortex', 
                          NeuralLayer('temp', 'motor', 1)).neurons)
        
        # Different actions have different patterns
        action_seeds = {
            'walk': [0.3, 0.7, 0.5, 0.8, 0.2],
            'reach': [0.6, 0.4, 0.9, 0.3, 0.7],
            'grasp': [0.8, 0.6, 0.4, 0.7, 0.5],
            'speak': [0.5, 0.8, 0.3, 0.6, 0.9],
            'turn': [0.4, 0.5, 0.7, 0.4, 0.6]
        }
        
        seed = action_seeds.get(action, [0.5] * 5)
        
        # Expand seed to full pattern
        pattern = []
        for i in range(pattern_length):
            base = seed[i % len(seed)]
            variation = random.uniform(-0.2, 0.2)
            pattern.append(max(0, min(1, base + variation)))
            
        return pattern
        
    def update(self, delta_time: float):
        """Update entire neural system"""
        total_activity = 0.0
        neuron_count = 0
        
        # Update all layers
        for layer_id, layer in self.layers.items():
            outputs = layer.update(delta_time)
            total_activity += sum(outputs)
            neuron_count += len(outputs)
            
        # Calculate global activity level
        self.global_activity = total_activity / max(1, neuron_count)
        
        # Process ongoing sensory inputs
        for sensor_type, data in self.sensory_inputs.items():
            self.process_sensory_input(sensor_type, data)
            
        # Consolidate memories during low activity
        if self.global_activity < 0.3 and len(self.memory_traces) > 10:
            self._consolidate_memories()
            
    def get_activity_level(self) -> float:
        """Get current overall neural activity (0-1)"""
        return self.global_activity
        
    def _consolidate_memories(self):
        """Simplify and consolidate memory traces"""
        if len(self.memory_traces) > 20:
            # Keep most recent and most significant
            self.memory_traces = sorted(
                self.memory_traces,
                key=lambda x: x.get('significance', 0),
                reverse=True
            )[:15]
            
    def store_memory(self, memory_data: Dict[str, Any]):
        """Store a new memory trace"""
        memory_data['timestamp'] = self.organism.state.age if hasattr(self.organism, 'state') else 0
        memory_data['significance'] = memory_data.get('significance', 0.5)
        self.memory_traces.append(memory_data)
        
    def recall_pattern(self, pattern_name: str) -> Optional[List[float]]:
        """Recall a stored motor or sensory pattern"""
        for memory in self.memory_traces:
            if memory.get('type') == 'motor_pattern' and memory.get('name') == pattern_name:
                return memory.get('pattern')
        return None
        
    def learn_connection(self, source_id: str, target_id: str, 
                         reinforcement: float):
        """Strengthen or weaken connection based on experience"""
        # Find source neuron
        for layer in self.layers.values():
            for neuron in layer.neurons:
                if neuron.id == source_id:
                    neuron.adjust_weight(target_id, reinforcement)
                    break
                    
    def get_status(self) -> Dict[str, Any]:
        """Get neural system status"""
        layer_activities = {}
        for layer_id, layer in self.layers.items():
            avg_activity = sum(n.state.activation_level for n in layer.neurons) / len(layer.neurons)
            layer_activities[layer_id] = avg_activity
            
        return {
            'global_activity': self.global_activity,
            'layer_activities': layer_activities,
            'memory_count': len(self.memory_traces),
            'total_neurons': sum(len(l.neurons) for l in self.layers.values())
        }
