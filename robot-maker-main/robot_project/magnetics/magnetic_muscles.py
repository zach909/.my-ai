"""
Magnetic Actuation System for Bio-Robots
Uses magnets embedded in muscles to create movement via electromagnetic fields
"""

import numpy as np
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum


class MuscleState(Enum):
    """States of muscle contraction"""
    RELAXED = "relaxed"
    CONTRACTING = "contracting"
    CONTRACTED = "contracted"
    EXTENDING = "extending"


@dataclass
class MagneticActuator:
    """Represents a magnetic actuator in a muscle group"""
    actuator_id: str
    position: np.ndarray  # 3D position in body
    orientation: np.ndarray  # 3D orientation vector
    field_strength: float  # Tesla
    current_muscle_length: float  # cm
    rest_length: float  # cm
    max_contraction: float  # Maximum contraction percentage (0.0-1.0)


@dataclass
class MuscleGroup:
    """Represents a complete muscle group with embedded magnets"""
    name: str
    actuators: List[MagneticActuator]
    state: MuscleState
    activation_level: float  # 0.0 to 1.0
    force_output: float  # Newtons


class MagneticMuscleSystem:
    """
    Control system for magnetic muscles
    Uses electromagnetic fields to move magnets embedded in artificial muscles
    """
    
    def __init__(self):
        """Initialize the magnetic muscle system"""
        self.muscle_groups: Dict[str, MuscleGroup] = {}
        self.global_field_controller = FieldController()
        self._initialize_all_muscles()
        
    def _initialize_all_muscles(self) -> None:
        """Initialize all major muscle groups from anatomy data"""
        
        # Head and Neck muscles
        self._create_muscle_group("temporalis", "head_neck", 5, 0.8)
        self._create_muscle_group("masseter", "head_neck", 4, 1.2)
        self._create_muscle_group("orbicularis_oculi", "head_neck", 8, 0.3)
        self._create_muscle_group("orbicularis_oris", "head_neck", 8, 0.3)
        self._create_muscle_group("sternocleidomastoid", "head_neck", 3, 2.5)
        
        # Torso muscles
        self._create_muscle_group("pectoralis_major", "torso", 6, 8.0)
        self._create_muscle_group("latissimus_dorsi", "torso", 8, 10.0)
        self._create_muscle_group("trapezius", "torso", 6, 6.0)
        self._create_muscle_group("erector_spinae", "torso", 12, 15.0)
        self._create_muscle_group("rectus_abdominis", "torso", 8, 7.0)
        self._create_muscle_group("obliques", "torso", 8, 6.0)
        self._create_muscle_group("transversus_abdominis", "torso", 6, 5.0)
        
        # Upper limb muscles
        self._create_muscle_group("deltoids", "upper_limbs", 6, 5.0)
        self._create_muscle_group("rotator_cuff", "upper_limbs", 4, 3.0)
        self._create_muscle_group("biceps_brachii", "upper_limbs", 4, 6.0)
        self._create_muscle_group("triceps_brachii", "upper_limbs", 6, 7.0)
        self._create_muscle_group("brachioradialis", "upper_limbs", 3, 3.0)
        self._create_muscle_group("forearm_flexors", "upper_limbs", 8, 4.0)
        self._create_muscle_group("forearm_extensors", "upper_limbs", 8, 4.0)
        
        # Lower limb muscles
        self._create_muscle_group("gluteus_maximus", "lower_limbs", 10, 15.0)
        self._create_muscle_group("gluteus_medius", "lower_limbs", 6, 8.0)
        self._create_muscle_group("gluteus_minimus", "lower_limbs", 4, 5.0)
        self._create_muscle_group("iliopsoas", "lower_limbs", 6, 10.0)
        self._create_muscle_group("quadriceps", "lower_limbs", 12, 20.0)
        self._create_muscle_group("hamstrings", "lower_limbs", 9, 15.0)
        self._create_muscle_group("adductors", "lower_limbs", 8, 10.0)
        self._create_muscle_group("gastrocnemius", "lower_limbs", 6, 12.0)
        self._create_muscle_group("soleus", "lower_limbs", 4, 8.0)
        self._create_muscle_group("tibialis_anterior", "lower_limbs", 4, 6.0)
    
    def _create_muscle_group(self, name: str, region: str, 
                            num_actuators: int, base_force: float) -> None:
        """
        Create a muscle group with magnetic actuators
        
        Args:
            name: Name of the muscle group
            region: Body region (head_neck, torso, upper_limbs, lower_limbs)
            num_actuators: Number of magnetic actuators in the group
            base_force: Base force output in Newtons
        """
        actuators = []
        
        for i in range(num_actuators):
            # Create actuator with specific position and orientation
            actuator = MagneticActuator(
                actuator_id=f"{name}_{i:02d}",
                position=self._get_muscle_position(name, i, num_actuators),
                orientation=np.array([0, 0, 1]),  # Default orientation
                field_strength=0.5,  # Tesla
                current_muscle_length=10.0,  # cm
                rest_length=10.0,  # cm
                max_contraction=0.3  # Can contract to 70% of rest length
            )
            actuators.append(actuator)
        
        muscle_group = MuscleGroup(
            name=name,
            actuators=actuators,
            state=MuscleState.RELAXED,
            activation_level=0.0,
            force_output=base_force
        )
        
        self.muscle_groups[name] = muscle_group
    
    def _get_muscle_position(self, muscle_name: str, actuator_idx: int, 
                            total_actuators: int) -> np.ndarray:
        """
        Get approximate 3D position for muscle actuator
        
        Args:
            muscle_name: Name of the muscle
            actuator_idx: Index of the actuator in the group
            total_actuators: Total number of actuators in group
            
        Returns:
            3D position vector (x, y, z) in cm from body center
        """
        # Simplified positioning based on muscle region
        positions = {
            'head_neck': np.array([0, 15, 5]),
            'torso': np.array([0, 0, 0]),
            'upper_limbs': np.array([15, 5, 0]),
            'lower_limbs': np.array([5, -20, 0])
        }
        
        base_pos = positions.get('torso', np.array([0, 0, 0]))
        
        # Add small offset for each actuator
        offset = np.random.rand(3) * 2 - 1  # Random offset within ±1cm
        
        return base_pos + offset
    
    def activate_muscle(self, muscle_name: str, activation: float) -> bool:
        """
        Activate a specific muscle group
        
        Args:
            muscle_name: Name of the muscle to activate
            activation: Activation level (0.0 to 1.0)
            
        Returns:
            True if activation successful
        """
        if muscle_name not in self.muscle_groups:
            print(f"Error: Muscle '{muscle_name}' not found")
            return False
        
        muscle = self.muscle_groups[muscle_name]
        muscle.activation_level = np.clip(activation, 0.0, 1.0)
        
        if activation > 0.0:
            muscle.state = MuscleState.CONTRACTING
            # Calculate contraction based on activation
            contraction_ratio = activation * muscle.actuators[0].max_contraction
            
            for actuator in muscle.actuators:
                target_length = actuator.rest_length * (1 - contraction_ratio)
                actuator.current_muscle_length = target_length
                
                # Increase magnetic field for contraction
                actuator.field_strength = 0.5 + activation * 0.5  # 0.5 to 1.0 Tesla
            
            muscle.force_output = muscle.force_output * (0.3 + 0.7 * activation)
        else:
            muscle.state = MuscleState.RELAXED
            for actuator in muscle.actuators:
                actuator.current_muscle_length = actuator.rest_length
                actuator.field_strength = 0.5
        
        return True
    
    def coordinate_movement(self, movement_pattern: str) -> Dict[str, float]:
        """
        Coordinate multiple muscles for complex movements
        
        Args:
            movement_pattern: Name of predefined movement pattern
            
        Returns:
            Dictionary of muscle activations
        """
        patterns = {
            'walk': {
                'quadriceps': 0.8,
                'hamstrings': 0.6,
                'gastrocnemius': 0.7,
                'gluteus_maximus': 0.6,
                'tibialis_anterior': 0.4
            },
            'grasp': {
                'forearm_flexors': 0.9,
                'biceps_brachii': 0.5,
                'deltoids': 0.3
            },
            'jump': {
                'quadriceps': 1.0,
                'gastrocnemius': 1.0,
                'gluteus_maximus': 1.0,
                'hamstrings': 0.8
            },
            'breathe': {
                'diaphragm': 0.5,
                'intercostals': 0.3
            }
        }
        
        if movement_pattern not in patterns:
            print(f"Unknown movement pattern: {movement_pattern}")
            return {}
        
        pattern = patterns[movement_pattern]
        activations = {}
        
        for muscle_name, activation in pattern.items():
            if muscle_name in self.muscle_groups:
                self.activate_muscle(muscle_name, activation)
                activations[muscle_name] = activation
        
        print(f"Executing movement: {movement_pattern} with {len(activations)} muscles")
        return activations
    
    def apply_external_field(self, field_vector: np.ndarray, 
                            strength: float) -> None:
        """
        Apply external electromagnetic field to influence all muscles
        
        Args:
            field_vector: 3D direction vector of the field
            strength: Field strength in Tesla
        """
        normalized_vector = field_vector / np.linalg.norm(field_vector)
        
        for muscle in self.muscle_groups.values():
            for actuator in muscle.actuators:
                # Calculate torque from external field
                torque = np.cross(actuator.orientation, normalized_vector) * strength
                
                # Adjust orientation based on torque
                actuator.orientation += torque * 0.01
                actuator.orientation = actuator.orientation / np.linalg.norm(actuator.orientation)
    
    def get_muscle_status(self, muscle_name: str) -> Optional[Dict]:
        """
        Get detailed status of a muscle group
        
        Args:
            muscle_name: Name of the muscle
            
        Returns:
            Dictionary with muscle status, or None if not found
        """
        if muscle_name not in self.muscle_groups:
            return None
        
        muscle = self.muscle_groups[muscle_name]
        avg_length = sum(a.current_muscle_length for a in muscle.actuators) / len(muscle.actuators)
        avg_field = sum(a.field_strength for a in muscle.actuators) / len(muscle.actuators)
        
        return {
            'name': muscle.name,
            'state': muscle.state.value,
            'activation_level': muscle.activation_level,
            'force_output_N': muscle.force_output,
            'avg_muscle_length_cm': avg_length,
            'avg_field_strength_T': avg_field,
            'num_actuators': len(muscle.actuators)
        }
    
    def get_all_muscles_summary(self) -> Dict:
        """Get summary of all muscle groups"""
        summary = {
            'total_muscle_groups': len(self.muscle_groups),
            'active_muscles': 0,
            'total_force_output_N': 0.0,
            'by_region': {}
        }
        
        for muscle in self.muscle_groups.values():
            if muscle.activation_level > 0.0:
                summary['active_muscles'] += 1
            summary['total_force_output_N'] += muscle.force_output
        
        return summary


class FieldController:
    """
    Global electromagnetic field controller
    Coordinates fields across all muscle groups
    """
    
    def __init__(self):
        self.field_generators = []
        self.max_field_strength = 2.0  # Tesla
        self.safety_limit = 1.5  # Tesla (operational limit)
        
    def generate_field_pattern(self, pattern_type: str, 
                               frequency_hz: float) -> np.ndarray:
        """
        Generate time-varying electromagnetic field pattern
        
        Args:
            pattern_type: Type of field pattern (sinusoidal, pulsing, rotating)
            frequency_hz: Frequency in Hz
            
        Returns:
            Current field vector
        """
        t = np.currentTimeMillis() / 1000.0  # Current time in seconds
        
        if pattern_type == "sinusoidal":
            field = np.array([
                np.sin(2 * np.pi * frequency_hz * t),
                np.cos(2 * np.pi * frequency_hz * t),
                0
            ]) * self.safety_limit * 0.5
        elif pattern_type == "pulsing":
            pulse = 1.0 if (t % (1.0/frequency_hz)) < (0.5/frequency_hz) else 0.0
            field = np.array([0, 0, 1]) * pulse * self.safety_limit
        elif pattern_type == "rotating":
            angle = 2 * np.pi * frequency_hz * t
            field = np.array([
                np.cos(angle),
                np.sin(angle),
                0
            ]) * self.safety_limit * 0.7
        else:
            field = np.array([0, 0, 0])
        
        return field
    
    def safety_check(self, field_strength: float) -> bool:
        """Check if field strength is within safe limits"""
        return field_strength <= self.safety_limit
