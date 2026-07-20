"""
Artificial Muscle System - Stage 4 of development

Build one artificial muscle first, then combine into groups, joints, and limbs.

A single artificial muscle has:
- Control signal → Actuator → Movement → Position sensor → Feedback to controller

Capabilities:
- Contract and relax
- Produce force
- Detect position
- Detect resistance
- Receive feedback control

Progression: 1 muscle → Muscle group → Joint → Limb → Full body
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
import math


class MuscleState(Enum):
    """States an artificial muscle can be in."""
    RELAXED = "relaxed"
    CONTRACTING = "contracting"
    CONTRACTED = "contracted"
    RELAXING = "relaxing"
    FATIGUED = "fatigued"
    DAMAGED = "damaged"


@dataclass
class MuscleFiber:
    """
    A single artificial muscle fiber.
    
    Uses electromagnetic actuation with position feedback.
    """
    id: str
    rest_length: float = 0.1  # meters
    current_length: float = 0.1
    max_contraction: float = 0.3  # Maximum contraction ratio (30%)
    max_force: float = 10.0  # Newtons
    
    # State
    activation: float = 0.0  # 0.0 to 1.0
    state: MuscleState = MuscleState.RELAXED
    fatigue: float = 0.0  # 0.0 to 1.0
    temperature: float = 20.0  # Celsius
    
    # Sensors
    position: float = 0.0  # Current position (0.0 = relaxed, 1.0 = fully contracted)
    velocity: float = 0.0  # Contraction velocity
    force_output: float = 0.0  # Current force being produced
    resistance: float = 0.0  # External resistance detected
    
    # Control
    target_activation: float = 0.0
    feedback_enabled: bool = True
    
    def update(self, dt: float = 0.01) -> Dict:
        """Update fiber state for one timestep."""
        if self.state == MuscleState.DAMAGED:
            return self._get_state()
        
        # Update activation toward target
        activation_rate = 5.0  # How fast activation changes
        if self.target_activation > self.activation:
            self.activation = min(
                self.activation + activation_rate * dt,
                self.target_activation
            )
            self.state = MuscleState.CONTRACTING
        elif self.target_activation < self.activation:
            self.activation = max(
                self.activation - activation_rate * dt,
                self.target_activation
            )
            self.state = MuscleState.RELAXING
        
        # Calculate target length based on activation
        target_shortening = self.rest_length * self.max_contraction * self.activation
        target_length = self.rest_length - target_shortening
        
        # Move toward target length
        length_change_rate = 2.0  # meters/second
        if self.current_length > target_length:
            delta = min(
                self.current_length - target_length,
                length_change_rate * dt
            )
            self.current_length -= delta
            self.velocity = delta / dt if dt > 0 else 0
            if self.activation > 0.5:
                self.state = MuscleState.CONTRACTING
        elif self.current_length < target_length:
            delta = min(
                target_length - self.current_length,
                length_change_rate * dt
            )
            self.current_length += delta
            self.velocity = -delta / dt if dt > 0 else 0
            if self.activation < 0.5:
                self.state = MuscleState.RELAXING
        
        # Update position (0.0 = relaxed, 1.0 = contracted)
        self.position = (self.rest_length - self.current_length) / (
            self.rest_length * self.max_contraction
        ) if self.rest_length * self.max_contraction > 0 else 0.0
        self.position = max(0.0, min(1.0, self.position))
        
        # Calculate force output
        # Force depends on activation and current length
        length_factor = 1.0 - abs(0.5 - self.position) * 0.5  # Peak at middle
        self.force_output = self.activation * self.max_force * length_factor
        
        # Update fatigue
        if self.activation > 0.7:
            self.fatigue = min(1.0, self.fatigue + 0.01 * dt)
        else:
            self.fatigue = max(0.0, self.fatigue - 0.005 * dt)
        
        # Check for fatigue state
        if self.fatigue > 0.9:
            self.state = MuscleState.FATIGUED
            self.activation *= 0.5  # Reduce activation when fatigued
        
        # Update temperature
        ambient_temp = 20.0
        heat_generation = self.activation * self.fatigue * 5.0
        cooling = (self.temperature - ambient_temp) * 0.1
        self.temperature += (heat_generation - cooling) * dt
        
        # Check for damage
        if self.temperature > 80.0 or self.fatigue > 0.95:
            self.state = MuscleState.DAMAGED
        
        return self._get_state()
    
    def _get_state(self) -> Dict:
        """Get current state as dictionary."""
        return {
            'id': self.id,
            'state': self.state.value,
            'activation': self.activation,
            'position': self.position,
            'length': self.current_length,
            'velocity': self.velocity,
            'force': self.force_output,
            'resistance': self.resistance,
            'fatigue': self.fatigue,
            'temperature': self.temperature
        }
    
    def set_activation(self, value: float):
        """Set target activation level (0.0 to 1.0)."""
        self.target_activation = max(0.0, min(1.0, value))
    
    def detect_resistance(self, value: float):
        """Record external resistance detected."""
        self.resistance = value
        if self.feedback_enabled and value > self.max_force * 0.8:
            # Reduce activation if too much resistance
            self.target_activation *= 0.8


@dataclass
class MuscleBundle:
    """
    A bundle of muscle fibers working together.
    
    Combines multiple fibers to produce greater force.
    """
    id: str
    fibers: List[MuscleFiber] = field(default_factory=list)
    
    @property
    def total_force(self) -> float:
        """Total force output of the bundle."""
        return sum(f.force_output for f in self.fibers)
    
    @property
    def average_position(self) -> float:
        """Average position of all fibers."""
        if not self.fibers:
            return 0.0
        return sum(f.position for f in self.fibers) / len(self.fibers)
    
    @property
    def active_fibers(self) -> int:
        """Number of non-damaged fibers."""
        return sum(1 for f in self.fibers if f.state != MuscleState.DAMAGED)
    
    def set_activation(self, value: float):
        """Set activation for all fibers."""
        for fiber in self.fibers:
            fiber.set_activation(value)
    
    def update(self, dt: float = 0.01) -> Dict:
        """Update all fibers in the bundle."""
        states = [f.update(dt) for f in self.fibers]
        return {
            'id': self.id,
            'total_force': self.total_force,
            'average_position': self.average_position,
            'active_fibers': self.active_fibers,
            'total_fibers': len(self.fibers),
            'fiber_states': states
        }


@dataclass
class Joint:
    """
    A joint controlled by agonist/antagonist muscle pairs.
    
    Mimics biological joint structure with opposing muscle groups.
    """
    id: str
    joint_type: str  # hinge, ball, pivot
    current_angle: float = 0.0  # radians
    min_angle: float = -math.pi/2
    max_angle: float = math.pi/2
    
    # Agonist/antagonist muscle bundles
    agonist: Optional[MuscleBundle] = None
    antagonist: Optional[MuscleBundle] = None
    
    # Properties
    damping: float = 0.1
    stiffness: float = 10.0
    
    def update(self, dt: float = 0.01) -> Dict:
        """Update joint based on muscle activity."""
        # Get forces from muscle bundles
        agonist_force = self.agonist.total_force if self.agonist else 0.0
        antagonist_force = self.antagonist.total_force if self.antagonist else 0.0
        
        # Net torque on joint
        net_torque = (agonist_force - antagonist_force) * 0.05  # Moment arm
        
        # Update angle based on torque
        angular_accel = net_torque / self.stiffness
        angular_velocity = getattr(self, '_velocity', 0.0)
        angular_velocity += angular_accel * dt
        angular_velocity *= (1.0 - self.damping)  # Apply damping
        self._velocity = angular_velocity
        
        self.current_angle += angular_velocity * dt
        self.current_angle = max(self.min_angle, min(self.max_angle, self.current_angle))
        
        # Update muscle bundles
        agonist_state = self.agonist.update(dt) if self.agonist else None
        antagonist_state = self.antagonist.update(dt) if self.antagonist else None
        
        return {
            'id': self.id,
            'type': self.joint_type,
            'angle': self.current_angle,
            'angle_degrees': math.degrees(self.current_angle),
            'angular_velocity': angular_velocity,
            'agonist_force': agonist_force,
            'antagonist_force': antagonist_force,
            'net_torque': net_torque,
            'agonist': agonist_state,
            'antagonist': antagonist_state
        }
    
    def activate(self, agonist_activation: float, antagonist_activation: float):
        """Activate agonist and antagonist muscles."""
        if self.agonist:
            self.agonist.set_activation(agonist_activation)
        if self.antagonist:
            self.antagonist.set_activation(antagonist_activation)


class ArtificialMuscleSystem:
    """
    Complete artificial muscle system for the organism.
    
    Manages:
    - Individual muscle fibers
    - Muscle bundles
    - Joints with agonist/antagonist pairs
    - Coordinated movement patterns
    """
    
    def __init__(self):
        self.fibers: Dict[str, MuscleFiber] = {}
        self.bundles: Dict[str, MuscleBundle] = {}
        self.joints: Dict[str, Joint] = {}
        
        # Create default muscle configuration for a simple limb
        self._create_default_limb()
        
        # Movement patterns
        self.active_patterns: List[Dict] = []
        
        # Statistics
        self.total_activations = 0
        self.fatigue_events = 0
    
    def _create_default_limb(self):
        """Create a simple limb with one joint and muscle pairs."""
        # Create fibers for agonist muscle (flexor)
        flexor_fibers = [
            MuscleFiber(id=f"flex_fiber_{i}", rest_length=0.08, max_force=15.0)
            for i in range(10)
        ]
        flexor_bundle = MuscleBundle(id="flexor", fibers=flexor_fibers)
        
        # Create fibers for antagonist muscle (extensor)
        extensor_fibers = [
            MuscleFiber(id=f"ext_fiber_{i}", rest_length=0.08, max_force=12.0)
            for i in range(8)
        ]
        extensor_bundle = MuscleBundle(id="extensor", fibers=extensor_fibers)
        
        # Store bundles
        self.bundles["flexor"] = flexor_bundle
        self.bundles["extensor"] = extensor_bundle
        
        # Store individual fibers
        for fiber in flexor_fibers + extensor_fibers:
            self.fibers[fiber.id] = fiber
        
        # Create joint
        elbow = Joint(
            id="elbow",
            joint_type="hinge",
            agonist=flexor_bundle,
            antagonist=extensor_bundle
        )
        self.joints["elbow"] = elbow
    
    def add_fiber(self, fiber: MuscleFiber):
        """Add a muscle fiber to the system."""
        self.fibers[fiber.id] = fiber
    
    def add_bundle(self, bundle: MuscleBundle):
        """Add a muscle bundle to the system."""
        self.bundles[bundle.id] = bundle
    
    def add_joint(self, joint: Joint):
        """Add a joint to the system."""
        self.joints[joint.id] = joint
    
    def activate_muscle(self, muscle_id: str, activation: float):
        """Activate a specific muscle or bundle."""
        if muscle_id in self.bundles:
            self.bundles[muscle_id].set_activation(activation)
            self.total_activations += 1
        elif muscle_id in self.fibers:
            self.fibers[muscle_id].set_activation(activation)
            self.total_activations += 1
    
    def activate_joint(self, joint_id: str, agonist: float, antagonist: float):
        """Activate both sides of a joint."""
        if joint_id in self.joints:
            self.joints[joint_id].activate(agonist, antagonist)
            self.total_activations += 2
    
    def start_movement_pattern(self, pattern: str, duration: float = 2.0):
        """Start a predefined movement pattern."""
        patterns = {
            'flex_extend': self._pattern_flex_extend,
            'oscillate': self._pattern_oscillate,
            'hold': self._pattern_hold
        }
        
        if pattern in patterns:
            self.active_patterns.append({
                'name': pattern,
                'function': patterns[pattern],
                'duration': duration,
                'elapsed': 0.0
            })
    
    def _pattern_flex_extend(self, t: float, duration: float) -> Tuple[float, float]:
        """Flex then extend movement pattern."""
        progress = t / duration
        if progress < 0.5:
            # Flex phase
            return progress * 2, 0.0
        else:
            # Extend phase
            return 0.0, (progress - 0.5) * 2
    
    def _pattern_oscillate(self, t: float, duration: float) -> Tuple[float, float]:
        """Oscillating movement pattern."""
        import math
        progress = t / duration * math.pi * 2
        value = (math.sin(progress) + 1) / 2
        return value * 0.8, (1 - value) * 0.6
    
    def _pattern_hold(self, t: float, duration: float) -> Tuple[float, float]:
        """Hold position pattern."""
        return 0.5, 0.3
    
    def update_patterns(self, dt: float = 0.01):
        """Update active movement patterns."""
        completed = []
        
        for i, pattern in enumerate(self.active_patterns):
            pattern['elapsed'] += dt
            
            if pattern['elapsed'] >= pattern['duration']:
                completed.append(i)
                continue
            
            # Get activation values from pattern function
            agonist, antagonist = pattern['function'](
                pattern['elapsed'],
                pattern['duration']
            )
            
            # Apply to elbow joint
            if 'elbow' in self.joints:
                self.joints['elbow'].activate(agonist, antagonist)
        
        # Remove completed patterns
        for i in sorted(completed, reverse=True):
            self.active_patterns.pop(i)
    
    def update(self, dt: float = 0.01) -> Dict:
        """Update entire muscle system."""
        self.update_patterns(dt)
        
        # Update all joints
        joint_states = {}
        for joint_id, joint in self.joints.items():
            joint_states[joint_id] = joint.update(dt)
            
            # Track fatigue events
            if joint.agonist:
                self.fatigue_events += sum(
                    1 for f in joint.agonist.fibers 
                    if f.state == MuscleState.FATIGUED
                )
            if joint.antagonist:
                self.fatigue_events += sum(
                    1 for f in joint.antagonist.fibers 
                    if f.state == MuscleState.FATIGUED
                )
        
        # Update bundles not in joints
        bundle_states = {}
        for bundle_id, bundle in self.bundles.items():
            if bundle_id not in [j.agonist.id if j.agonist else None 
                                for j in self.joints.values()] + \
                               [j.antagonist.id if j.antagonist else None 
                                for j in self.joints.values()]:
                bundle_states[bundle_id] = bundle.update(dt)
        
        return {
            'joints': joint_states,
            'bundles': bundle_states,
            'active_patterns': len(self.active_patterns),
            'total_fibers': len(self.fibers),
            'total_bundles': len(self.bundles),
            'total_joints': len(self.joints)
        }
    
    def get_status(self) -> Dict:
        """Get detailed status of muscle system."""
        total_fatigue = sum(f.fatigue for f in self.fibers.values())
        avg_fatigue = total_fatigue / len(self.fibers) if self.fibers else 0.0
        
        damaged_count = sum(
            1 for f in self.fibers.values() 
            if f.state == MuscleState.DAMAGED
        )
        
        return {
            'fibers': {
                'total': len(self.fibers),
                'active': sum(1 for f in self.fibers.values() if f.state != MuscleState.DAMAGED),
                'damaged': damaged_count,
                'average_fatigue': f"{avg_fatigue:.2f}"
            },
            'bundles': {
                'total': len(self.bundles),
                'details': {
                    b_id: {
                        'force': b.total_force,
                        'position': f"{b.average_position:.2f}",
                        'active_fibers': b.active_fibers
                    }
                    for b_id, b in self.bundles.items()
                }
            },
            'joints': {
                'total': len(self.joints),
                'details': {
                    j_id: {
                        'type': j.joint_type,
                        'angle': f"{math.degrees(j.current_angle):.1f}°",
                        'range': f"{math.degrees(j.min_angle):.0f}° to {math.degrees(j.max_angle):.0f}°"
                    }
                    for j_id, j in self.joints.items()
                }
            },
            'statistics': {
                'total_activations': self.total_activations,
                'fatigue_events': self.fatigue_events,
                'active_patterns': len(self.active_patterns)
            }
        }
