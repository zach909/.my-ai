"""
Neural Controller - Stage 7 of development

Artificial brain with two layers:
1. Fast biological-like control (reflexes, balance, muscle coordination)
2. High-level AI (reasoning, planning, learning, memory)

The brain receives information about the entire body and sends commands to all systems.
This makes it an organism rather than a robot.
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Callable
import math
import time
import random


class BrainRegion(Enum):
    """Major regions of the artificial brain."""
    CORTEX = "cortex"  # High-level reasoning
    CEREBELLUM = "cerebellum"  # Motor coordination
    BRAINSTEM = "brainstem"  # Basic life functions
    HIPPOCAMPUS = "hippocampus"  # Memory formation
    THALAMUS = "thalamus"  # Sensory relay
    HYPOTHALAMUS = "hypothalamus"  # Homeostasis


@dataclass
class Neuron:
    """A single artificial neuron."""
    id: str
    region: BrainRegion
    activation: float = 0.0
    bias: float = 0.0
    threshold: float = 0.5
    
    # Connections
    inputs: Dict[str, float] = field(default_factory=dict)  # source_id -> weight
    outputs: List[str] = field(default_factory=list)  # target neuron IDs
    
    # State
    last_fired: float = 0.0
    firing_rate: float = 0.0
    
    def activate(self, input_values: Dict[str, float]) -> float:
        """Calculate activation from inputs."""
        total = self.bias
        for source_id, value in input_values.items():
            weight = self.inputs.get(source_id, 0.0)
            total += weight * value
        
        # Sigmoid activation
        self.activation = 1.0 / (1.0 + math.exp(-total))
        
        return self.activation
    
    def fire(self) -> bool:
        """Check if neuron fires based on threshold."""
        if self.activation > self.threshold:
            self.last_fired = time.time()
            self.firing_rate = min(1.0, self.firing_rate + 0.1)
            return True
        else:
            self.firing_rate = max(0.0, self.firing_rate - 0.01)
            return False


@dataclass
class Memory:
    """A stored memory."""
    id: str
    content: Dict
    timestamp: float
    importance: float = 0.5
    access_count: int = 0
    
    def to_dict(self) -> Dict:
        return {
            'id': self.id,
            'content': self.content,
            'timestamp': self.timestamp,
            'importance': self.importance,
            'accesses': self.access_count
        }


class NeuralController:
    """
    Artificial neural controller for the organism.
    
    Architecture:
    - Fast layer: Reflexes, balance, muscle coordination, internal regulation
    - High layer: Reasoning, planning, learning, memory, decision-making
    
    Receives input from all sensors and controls all body systems.
    Maintains internal model of body state.
    """
    
    def __init__(self, neuron_count: int = 1088):
        # Neurons organized by region
        self.neurons: Dict[str, Neuron] = {}
        self.regions: Dict[BrainRegion, List[str]] = {
            r: [] for r in BrainRegion
        }
        
        # Create neurons distributed across regions
        region_distribution = {
            BrainRegion.CORTEX: 0.4,
            BrainRegion.CEREBELLUM: 0.25,
            BrainRegion.BRAINSTEM: 0.15,
            BrainRegion.HIPPOCAMPUS: 0.1,
            BrainRegion.THALAMUS: 0.05,
            BrainRegion.HYPOTHALAMUS: 0.05
        }
        
        for i in range(neuron_count):
            # Assign region based on distribution
            rand = random.random()
            cumulative = 0.0
            region = BrainRegion.CORTEX
            
            for r, prob in region_distribution.items():
                cumulative += prob
                if rand < cumulative:
                    region = r
                    break
            
            neuron = Neuron(id=f"neuron_{i}", region=region)
            self.neurons[neuron.id] = neuron
            self.regions[region].append(neuron.id)
        
        # Create some basic connections
        self._create_basic_connections()
        
        # Memory system
        self.memories: Dict[str, Memory] = {}
        self.memory_capacity = 1000
        self.next_memory_id = 0
        
        # Body model (internal representation of body state)
        self.body_model: Dict = {
            'energy_level': 1.0,
            'damage_level': 0.0,
            'position': (0.0, 0.0, 0.0),
            'posture': 'standing',
            'joint_angles': {},
            'muscle_states': {}
        }
        
        # Goals and drives
        self.current_goals: List[Dict] = []
        self.drives: Dict[str, float] = {
            'hunger': 0.0,  # Need energy
            'safety': 0.0,  # Avoid damage
            'curiosity': 0.5,  # Explore
            'rest': 0.0  # Conserve energy
        }
        
        # Output commands
        self.motor_commands: Dict[str, float] = {}
        self.system_commands: Dict[str, Dict] = {}
        
        # Statistics
        self.total_firings = 0
        self.decisions_made = 0
    
    def _create_basic_connections(self):
        """Create basic neural connections."""
        neuron_list = list(self.neurons.keys())
        
        # Connect sensory neurons (thalamus) to cortex
        thalamus_neurons = self.regions[BrainRegion.THALAMUS]
        cortex_neurons = self.regions[BrainRegion.CORTEX]
        
        for i, t_id in enumerate(thalamus_neurons[:10]):
            neuron = self.neurons[t_id]
            if i < 5:
                # process_sensory_input() activates this neuron with
                # {f'sensor_{i}': value} -- without a weight for that key
                # in the neuron's own `inputs`, activate()'s
                # self.inputs.get(..., 0.0) always falls back to 0.0
                # regardless of the real sensor value, so every thalamus
                # neuron's activation silently collapsed to a constant
                # sigmoid(0) = 0.5 no matter what sensors actually reported.
                neuron.inputs[f'sensor_{i}'] = 1.0
            # Connect to random cortex neurons
            targets = random.sample(cortex_neurons, min(5, len(cortex_neurons)))
            neuron.outputs.extend(targets)

            for target_id in targets:
                target = self.neurons[target_id]
                target.inputs[t_id] = random.uniform(-0.5, 0.5)
        
        # Connect cerebellum to motor output
        cerebellum_neurons = self.regions[BrainRegion.CEREBELLUM]
        for c_id in cerebellum_neurons[:20]:
            self.neurons[c_id].threshold = 0.3  # Lower threshold for fast response
    
    def process_sensory_input(self, sensory_data: Dict):
        """Process incoming sensory data through thalamus to cortex."""
        # Activate thalamus neurons based on sensory input
        thalamus_neurons = self.regions[BrainRegion.THALAMUS]
        
        sensory_channels = [
            sensory_data.get('vision', {}),
            sensory_data.get('audio', {}),
            sensory_data.get('tactile', {}),
            sensory_data.get('proprioception', {}),
            sensory_data.get('internal', {})
        ]
        
        for i, channel in enumerate(sensory_channels):
            if i < len(thalamus_neurons):
                neuron_id = thalamus_neurons[i]
                neuron = self.neurons[neuron_id]
                
                # Convert sensory data to activation value
                if isinstance(channel, dict):
                    value = len(channel) / 10.0  # Simplified
                else:
                    value = 0.5
                
                neuron.activate({f'sensor_{i}': value})
                
                # Propagate to connected neurons
                for target_id in neuron.outputs[:5]:
                    if target_id in self.neurons:
                        target = self.neurons[target_id]
                        weight = target.inputs.get(neuron_id, 0.5)
                        target.activate({neuron_id: neuron.activation * weight})
    
    def update_fast_control(self, dt: float = 0.01) -> Dict:
        """Update fast biological-like control layer."""
        commands = {}
        
        # Brainstem controls basic functions
        brainstem_neurons = self.regions[BrainRegion.BRAINSTEM][:10]
        for n_id in brainstem_neurons:
            neuron = self.neurons[n_id]
            neuron.fire()
            if neuron.activation > 0.5:
                self.total_firings += 1
        
        # Cerebellum coordinates movement
        cerebellum_neurons = self.regions[BrainRegion.CEREBELLUM][:20]
        motor_pattern = []
        
        for n_id in cerebellum_neurons:
            neuron = self.neurons[n_id]
            fired = neuron.fire()
            if fired:
                self.total_firings += 1
                motor_pattern.append(n_id)
        
        # Generate smooth motor commands from cerebellum activity
        if motor_pattern:
            # Create oscillating pattern for natural movement
            t = time.time()
            for joint in ['elbow', 'shoulder', 'hip', 'knee']:
                self.motor_commands[joint] = (
                    math.sin(t * 2) * 0.3 +
                    math.cos(t * 3) * 0.2
                )
        
        # Hypothalamus maintains homeostasis
        hypothalamus_neurons = self.regions[BrainRegion.HYPOTHALAMUS][:5]
        for n_id in hypothalamus_neurons:
            neuron = self.neurons[n_id]
            
            # Adjust drives based on body state
            self.drives['hunger'] = min(1.0, self.drives['hunger'] + 0.001 * dt)
            self.drives['rest'] = min(1.0, self.drives['rest'] + 0.0005 * dt)
            
            if self.body_model['damage_level'] > 0.1:
                self.drives['safety'] = min(1.0, self.drives['safety'] + 0.01 * dt)
        
        return {
            'motor_commands': dict(self.motor_commands),
            'drives': dict(self.drives),
            'fast_firings': self.total_firings
        }
    
    def update_high_level(self, dt: float = 0.01) -> Dict:
        """Update high-level cognitive processing."""
        decisions = []
        
        # Cortex processes complex information
        cortex_neurons = self.regions[BrainRegion.CORTEX][:50]
        active_cortex = 0
        
        for n_id in cortex_neurons:
            neuron = self.neurons[n_id]
            # Random activation simulating thought processes
            if random.random() < 0.1:
                neuron.activate({
                    f'input_{i}': random.random() 
                    for i in range(len(neuron.inputs) or 3)
                })
            
            if neuron.fire():
                active_cortex += 1
                self.total_firings += 1
        
        # Hippocampus handles memory
        hippocampus_neurons = self.regions[BrainRegion.HIPPOCAMPUS][:10]
        for n_id in hippocampus_neurons:
            neuron = self.neurons[n_id]
            if neuron.fire():
                self.total_firings += 1
                # Potentially form new memory
                if random.random() < 0.01 and len(self.memories) < self.memory_capacity:
                    self._form_memory({'type': 'experience', 'time': time.time()})
        
        # Update goals based on drives
        self._update_goals()
        
        # Make decisions
        if active_cortex > 10 and self.current_goals:
            decision = self._make_decision()
            if decision:
                decisions.append(decision)
                self.decisions_made += 1
        
        return {
            'active_cortex': active_cortex,
            'goals': len(self.current_goals),
            'decisions': decisions,
            'memories': len(self.memories)
        }
    
    def _form_memory(self, content: Dict, importance: float = 0.5):
        """Form a new memory."""
        memory_id = f"mem_{self.next_memory_id}"
        self.next_memory_id += 1
        
        memory = Memory(
            id=memory_id,
            content=content,
            timestamp=time.time(),
            importance=importance
        )
        
        self.memories[memory_id] = memory
        
        # Remove old low-importance memories if at capacity
        if len(self.memories) > self.memory_capacity:
            sorted_memories = sorted(
                self.memories.values(),
                key=lambda m: m.importance * 0.7 + m.access_count * 0.3
            )
            oldest_low_importance = sorted_memories[0]
            del self.memories[oldest_low_importance.id]
    
    def _update_goals(self):
        """Update goals based on current drives."""
        # Clear expired goals
        self.current_goals = [
            g for g in self.current_goals 
            if g.get('expires', float('inf')) > time.time()
        ]
        
        # Add new goals based on high drives
        if self.drives['hunger'] > 0.7:
            if not any(g.get('type') == 'find_energy' for g in self.current_goals):
                self.current_goals.append({
                    'type': 'find_energy',
                    'priority': self.drives['hunger'],
                    'expires': time.time() + 60
                })
        
        if self.drives['safety'] > 0.7:
            if not any(g.get('type') == 'avoid_danger' for g in self.current_goals):
                self.current_goals.append({
                    'type': 'avoid_danger',
                    'priority': self.drives['safety'],
                    'expires': time.time() + 30
                })
    
    def _make_decision(self) -> Optional[Dict]:
        """Make a decision based on goals and current state."""
        if not self.current_goals:
            return None
        
        # Select highest priority goal
        goal = max(self.current_goals, key=lambda g: g.get('priority', 0))
        
        # Generate action plan
        action_map = {
            'find_energy': {'action': 'consume_material', 'target': 'organic'},
            'avoid_danger': {'action': 'move_away', 'direction': 'safe'},
            'explore': {'action': 'move_random', 'duration': 5},
            'repair': {'action': 'initiate_repair', 'location': 'damaged_area'}
        }
        
        action = action_map.get(goal['type'], {'action': 'wait'})
        
        return {
            'goal': goal,
            'action': action,
            'timestamp': time.time()
        }
    
    def update_body_model(self, energy: float, damage: float,
                         joint_angles: Dict, muscle_states: Dict):
        """Update internal model of body state."""
        self.body_model['energy_level'] = energy
        self.body_model['damage_level'] = damage
        self.body_model['joint_angles'] = dict(joint_angles)
        self.body_model['muscle_states'] = dict(muscle_states)
    
    def issue_command(self, system: str, command: Dict):
        """Issue command to a body system."""
        self.system_commands[system] = command
    
    def update(self, dt: float = 0.01, 
               sensory_data: Optional[Dict] = None) -> Dict:
        """Full neural controller update cycle."""
        sensory_data = sensory_data or {}
        
        # Process sensory input
        self.process_sensory_input(sensory_data)
        
        # Update body model
        internal = sensory_data.get('internal', {})
        proprio = sensory_data.get('proprioception', {})
        
        self.update_body_model(
            energy=1.0 - self.drives['hunger'],
            damage=self.drives['safety'] * 0.5,
            joint_angles=proprio.get('joint_angles', {}),
            muscle_states=proprio.get('muscle_activations', {})
        )
        
        # Update both layers
        fast_result = self.update_fast_control(dt)
        high_result = self.update_high_level(dt)
        
        return {
            'fast_control': fast_result,
            'high_level': high_result,
            'body_model': dict(self.body_model),
            'commands': {
                'motor': dict(self.motor_commands),
                'system': dict(self.system_commands)
            },
            'statistics': {
                'total_firings': self.total_firings,
                'decisions': self.decisions_made,
                'memories': len(self.memories),
                'goals': len(self.current_goals)
            }
        }
    
    def get_status(self) -> Dict:
        """Get detailed status of neural controller."""
        region_stats = {
            r.name: {
                'neurons': len(ids),
                'active': sum(
                    1 for nid in ids 
                    if self.neurons[nid].activation > 0.5
                )
            }
            for r, ids in self.regions.items()
        }
        
        return {
            'architecture': {
                'total_neurons': len(self.neurons),
                'regions': region_stats
            },
            'memory': {
                'count': len(self.memories),
                'capacity': self.memory_capacity,
                'recent': [
                    m.to_dict() 
                    for m in list(self.memories.values())[-5:]
                ]
            },
            'goals': {
                'current': self.current_goals,
                'drives': self.drives
            },
            'body_model': self.body_model,
            'statistics': {
                'total_firings': self.total_firings,
                'decisions_made': self.decisions_made
            }
        }
