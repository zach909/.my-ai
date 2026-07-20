"""
Muscular System - Artificial muscles for natural human-like movement.

Uses combinations of electromagnets, permanent magnets, electrical coils,
artificial muscle materials, and mechanical actuators arranged in
anatomical structures similar to human muscles.
"""

from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum
import math


class MuscleType(Enum):
    """Types of artificial muscle actuators"""
    ELECTROMAGNETIC = "electromagnetic"
    MAGNETIC_ACTUATOR = "magnetic_actuator"
    ARTIFICIAL_FIBER = "artificial_fiber"
    HYDRAULIC = "hydraulic"
    PNEUMATIC = "pneumatic"
    SHAPE_MEMORY = "shape_memory"
    HYBRID = "hybrid"


@dataclass
class MuscleFiber:
    """
    Individual artificial muscle fiber unit.
    
    Can be electromagnetic, artificial material, or hybrid.
    Multiple fibers combine to form muscle bundles.
    """
    id: str
    fiber_type: MuscleType
    max_force: float  # Newtons
    current_force: float = 0.0
    length: float = 1.0  # Normalized resting length
    current_length: float = 1.0
    activation: float = 0.0  # 0-1 activation level
    fatigue: float = 0.0
    temperature: float = 37.0
    efficiency: float = 0.85
    
    def activate(self, level: float, delta_time: float):
        """Activate muscle fiber to specified level"""
        self.activation = max(0, min(1, level))
        
        # Generate force based on activation
        target_force = self.max_force * self.activation * self.efficiency
        
        # Smooth force transition
        force_change_rate = 10.0  # Force change per second
        force_delta = (target_force - self.current_force) * force_change_rate * delta_time
        self.current_force = target_force if abs(target_force - self.current_force) < force_delta else \
                            self.current_force + force_delta * (1 if target_force > self.current_force else -1)
                            
        # Update length based on force (contraction)
        contraction_ratio = 0.2  # Maximum 20% contraction
        self.current_length = self.length * (1 - self.activation * contraction_ratio)
        
        # Increase fatigue with use
        if self.activation > 0.3:
            self.fatigue += self.activation * 0.05 * delta_time
            
        # Temperature increases with activity
        self.temperature += self.activation * 0.1 * delta_time
        
    def relax(self, delta_time: float):
        """Relax muscle fiber"""
        self.activation *= 0.9  # Gradual relaxation
        self.fatigue = max(0, self.fatigue - 0.1 * delta_time)
        self.temperature = max(37.0, self.temperature - 0.05 * delta_time)
        
    def update(self, delta_time: float):
        """Update fiber state"""
        if self.activation > 0:
            self.relax(delta_time)
            
    def get_state(self) -> Dict[str, Any]:
        return {
            'activation': self.activation,
            'force': self.current_force,
            'length': self.current_length,
            'fatigue': self.fatigue,
            'temperature': self.temperature
        }


class MuscleBundle:
    """
    Group of muscle fibers working together.
    
    Analogous to biological muscle fascicles.
    """
    
    def __init__(self, bundle_id: str, muscle_name: str, 
                 fiber_count: int = 100, fiber_type: MuscleType = MuscleType.HYBRID):
        self.id = bundle_id
        self.muscle_name = muscle_name
        self.fibers: List[MuscleFiber] = []
        self.origin_point: Tuple[float, float, float] = (0, 0, 0)
        self.insertion_point: Tuple[float, float, float] = (0, 0, 0)
        
        # Create fibers with varied properties
        for i in range(fiber_count):
            variation = 1.0 + random.uniform(-0.1, 0.1)
            fiber = MuscleFiber(
                id=f"{bundle_id}_f{i}",
                fiber_type=fiber_type,
                max_force=50.0 * variation,
                length=1.0
            )
            self.fibers.append(fiber)
            
    def activate(self, level: float, delta_time: float):
        """Activate entire bundle"""
        for fiber in self.fibers:
            # Add some variation in activation timing
            fiber_activation = level * random.uniform(0.95, 1.0)
            fiber.activate(fiber_activation, delta_time)
            
    def get_total_force(self) -> float:
        """Get combined force output"""
        return sum(f.current_force for f in self.fibers)
        
    def get_average_activation(self) -> float:
        """Get average activation level"""
        if not self.fibers:
            return 0.0
        return sum(f.activation for f in self.fibers) / len(self.fibers)
        
    def update(self, delta_time: float):
        """Update all fibers"""
        for fiber in self.fibers:
            fiber.update(delta_time)


class Joint:
    """
    Articulated joint controlled by multiple muscle bundles.
    """
    
    def __init__(self, joint_id: str, joint_type: str,
                 degrees_of_freedom: int = 1):
        self.id = joint_id
        self.joint_type = joint_type  # hinge, ball, pivot, etc.
        self.dof = degrees_of_freedom
        self.angle: float = 0.0  # Current angle in radians
        self.angular_velocity: float = 0.0
        self.range_limits: Tuple[float, float] = (-math.pi/4, math.pi/4)
        
        # Agonist and antagonist muscle bundles
        self.flexors: List[MuscleBundle] = []
        self.extensors: List[MuscleBundle] = []
        
    def add_flexor(self, bundle: MuscleBundle):
        """Add flexor muscle bundle"""
        self.flexors.append(bundle)
        
    def add_extensor(self, bundle: MuscleBundle):
        """Add extensor muscle bundle"""
        self.extensors.append(bundle)
        
    def apply_torque(self, torque: float, delta_time: float):
        """Apply torque to joint"""
        inertia = 0.5  # Simplified moment of inertia
        angular_acceleration = torque / inertia
        
        self.angular_velocity += angular_acceleration * delta_time
        self.angular_velocity *= 0.95  # Damping
        
        self.angle += self.angular_velocity * delta_time
        
        # Enforce range limits
        self.angle = max(self.range_limits[0], 
                        min(self.range_limits[1], self.angle))
                        
    def update(self, delta_time: float):
        """Update joint state based on muscle activity"""
        # Calculate net torque from muscles
        flexor_force = sum(b.get_total_force() for b in self.flexors)
        extensor_force = sum(b.get_total_force() for b in self.extensors)
        
        # Convert forces to torque (simplified)
        moment_arm = 0.05  # meters
        net_torque = (flexor_force - extensor_force) * moment_arm
        
        self.apply_torque(net_torque, delta_time)
        
        # Update muscle bundles
        for bundle in self.flexors + self.extensors:
            bundle.update(delta_time)


import random

class MuscularSystem:
    """
    Complete muscular system for the artificial organism.
    
    Contains all muscle bundles and joints, coordinated by
    the neural system for natural movement.
    """
    
    def __init__(self, organism):
        self.organism = organism
        self.bundles: Dict[str, MuscleBundle] = {}
        self.joints: Dict[str, Joint] = {}
        self.active_movements: Dict[str, Dict] = {}
        
        # Initialize anatomical structure
        self._initialize_anatomy()
        
    def _initialize_anatomy(self):
        """Create complete muscular anatomy"""
        # Upper body muscles
        self._create_arm_muscles('left')
        self._create_arm_muscles('right')
        self._create_shoulder_muscles('left')
        self._create_shoulder_muscles('right')
        self._create_torso_muscles()
        
        # Lower body muscles
        self._create_leg_muscles('left')
        self._create_leg_muscles('right')
        
        # Create joints
        self._create_joints()
        
    def _create_arm_muscles(self, side: str):
        """Create arm muscle groups"""
        prefix = f"{side}_arm"
        
        # Biceps
        self.bundles[f"{prefix}_biceps"] = MuscleBundle(
            f"{prefix}_biceps", "biceps", fiber_count=150,
            fiber_type=MuscleType.HYBRID
        )
        
        # Triceps
        self.bundles[f"{prefix}_triceps"] = MuscleBundle(
            f"{prefix}_triceps", "triceps", fiber_count=180,
            fiber_type=MuscleType.HYBRID
        )
        
        # Forearm flexors
        self.bundles[f"{prefix}_forearm_flexors"] = MuscleBundle(
            f"{prefix}_forearm_flexors", "forearm_flexors", fiber_count=100
        )
        
        # Forearm extensors
        self.bundles[f"{prefix}_forearm_extensors"] = MuscleBundle(
            f"{prefix}_forearm_extensors", "forearm_extensors", fiber_count=100
        )
        
    def _create_shoulder_muscles(self, side: str):
        """Create shoulder muscle groups"""
        prefix = f"{side}_shoulder"
        
        # Deltoid
        self.bundles[f"{prefix}_deltoid"] = MuscleBundle(
            f"{prefix}_deltoid", "deltoid", fiber_count=200
        )
        
        # Rotator cuff muscles
        self.bundles[f"{prefix}_supraspinatus"] = MuscleBundle(
            f"{prefix}_supraspinatus", "supraspinatus", fiber_count=60
        )
        self.bundles[f"{prefix}_infraspinatus"] = MuscleBundle(
            f"{prefix}_infraspinatus", "infraspinatus", fiber_count=60
        )
        
    def _create_torso_muscles(self):
        """Create torso muscle groups"""
        # Pectorals
        self.bundles["chest_pectoral_left"] = MuscleBundle(
            "chest_pectoral_left", "pectoralis_major", fiber_count=250
        )
        self.bundles["chest_pectoral_right"] = MuscleBundle(
            "chest_pectoral_right", "pectoralis_major", fiber_count=250
        )
        
        # Abdominals
        self.bundles["torso_abs"] = MuscleBundle(
            "torso_abs", "abdominals", fiber_count=200
        )
        
        # Back muscles
        self.bundles["back_latissimus_left"] = MuscleBundle(
            "back_latissimus_left", "latissimus_dorsi", fiber_count=280
        )
        self.bundles["back_latissimus_right"] = MuscleBundle(
            "back_latissimus_right", "latissimus_dorsi", fiber_count=280
        )
        self.bundles["back_erector_spinae"] = MuscleBundle(
            "back_erector_spinae", "erector_spinae", fiber_count=300
        )
        
    def _create_leg_muscles(self, side: str):
        """Create leg muscle groups"""
        prefix = f"{side}_leg"
        
        # Quadriceps
        self.bundles[f"{prefix}_quadriceps"] = MuscleBundle(
            f"{prefix}_quadriceps", "quadriceps", fiber_count=350
        )
        
        # Hamstrings
        self.bundles[f"{prefix}_hamstrings"] = MuscleBundle(
            f"{prefix}_hamstrings", "hamstrings", fiber_count=320
        )
        
        # Calves
        self.bundles[f"{prefix}_gastrocnemius"] = MuscleBundle(
            f"{prefix}_gastrocnemius", "gastrocnemius", fiber_count=200
        )
        
        # Hip flexors
        self.bundles[f"{prefix}_hip_flexors"] = MuscleBundle(
            f"{prefix}_hip_flexors", "hip_flexors", fiber_count=180
        )
        
        # Glutes
        self.bundles[f"{prefix}_gluteus"] = MuscleBundle(
            f"{prefix}_gluteus", "gluteus_maximus", fiber_count=400
        )
        
    def _create_joints(self):
        """Create all body joints"""
        # Arm joints
        self.joints["left_elbow"] = Joint("left_elbow", "hinge", 1)
        self.joints["right_elbow"] = Joint("right_elbow", "hinge", 1)
        self.joints["left_shoulder"] = Joint("left_shoulder", "ball", 3)
        self.joints["right_shoulder"] = Joint("right_shoulder", "ball", 3)
        self.joints["left_wrist"] = Joint("left_wrist", "pivot", 2)
        self.joints["right_wrist"] = Joint("right_wrist", "pivot", 2)
        
        # Connect muscles to joints
        self.joints["left_elbow"].add_flexor(self.bundles["left_arm_biceps"])
        self.joints["left_elbow"].add_extensor(self.bundles["left_arm_triceps"])
        self.joints["right_elbow"].add_flexor(self.bundles["right_arm_biceps"])
        self.joints["right_elbow"].add_extensor(self.bundles["right_arm_triceps"])
        
        # Leg joints
        self.joints["left_knee"] = Joint("left_knee", "hinge", 1)
        self.joints["right_knee"] = Joint("right_knee", "hinge", 1)
        self.joints["left_hip"] = Joint("left_hip", "ball", 3)
        self.joints["right_hip"] = Joint("right_hip", "ball", 3)
        self.joints["left_ankle"] = Joint("left_ankle", "hinge", 2)
        self.joints["right_ankle"] = Joint("right_ankle", "hinge", 2)
        
        # Connect leg muscles to joints
        self.joints["left_knee"].add_flexor(self.bundles["left_leg_hamstrings"])
        self.joints["left_knee"].add_extensor(self.bundles["left_leg_quadriceps"])
        self.joints["right_knee"].add_flexor(self.bundles["right_leg_hamstrings"])
        self.joints["right_knee"].add_extensor(self.bundles["right_leg_quadriceps"])
        
        # Spine joints
        self.joints["spine_lumbar"] = Joint("spine_lumbar", "pivot", 3)
        self.joints["spine_thoracic"] = Joint("spine_thoracic", "pivot", 3)
        self.joints["spine_cervical"] = Joint("spine_cervical", "pivot", 3)
        
    def execute(self, motor_command: Dict[str, Any]) -> bool:
        """
        Execute a motor command from the neural system.
        
        Args:
            motor_command: Command dictionary with action and parameters
            
        Returns:
            True if execution started successfully
        """
        action = motor_command.get('action', '')
        parameters = motor_command.get('parameters', {})
        pattern = motor_command.get('pattern', [])
        
        # Store active movement
        self.active_movements[action] = {
            'start_time': self.organism.state.age if hasattr(self.organism, 'state') else 0,
            'parameters': parameters,
            'pattern': pattern
        }
        
        # Activate appropriate muscle groups based on action
        if action == 'walk':
            self._execute_walk(parameters)
        elif action == 'reach':
            self._execute_reach(parameters)
        elif action == 'grasp':
            self._execute_grasp(parameters)
        elif action == 'turn':
            self._execute_turn(parameters)
        else:
            self._execute_generic(action, parameters)
            
        return True
        
    def _execute_walk(self, parameters: Dict):
        """Execute walking gait"""
        speed = parameters.get('speed', 1.0)
        direction = parameters.get('direction', 'forward')
        
        # Alternating leg activation pattern
        gait_phase = 0.0  # Would track over time
        
        # Left leg
        left_q = self.bundles.get('left_leg_quadriceps')
        left_h = self.bundles.get('left_leg_hamstrings')
        left_g = self.bundles.get('left_leg_gluteus')
        
        # Right leg
        right_q = self.bundles.get('right_leg_quadriceps')
        right_h = self.bundles.get('right_leg_hamstrings')
        right_g = self.bundles.get('right_leg_gluteus')
        
        if left_q and left_h:
            left_q.activate(0.6 * speed, 0.016)
            left_h.activate(0.3 * speed, 0.016)
            
        if right_q and right_h:
            right_q.activate(0.3 * speed, 0.016)
            right_h.activate(0.6 * speed, 0.016)
            
    def _execute_reach(self, parameters: Dict):
        """Execute reaching motion"""
        arm = parameters.get('arm', 'right')
        target = parameters.get('target', (0.5, 0.5, 0.5))
        
        prefix = f"{arm}_arm"
        
        # Activate shoulder and arm muscles
        deltoid = self.bundles.get(f"{prefix}_deltoid")
        biceps = self.bundles.get(f"{prefix}_biceps")
        triceps = self.bundles.get(f"{prefix}_triceps")
        
        if deltoid:
            deltoid.activate(0.7, 0.016)
        if biceps:
            biceps.activate(0.5, 0.016)
        if triceps:
            triceps.activate(0.3, 0.016)
            
    def _execute_grasp(self, parameters: Dict):
        """Execute grasping motion"""
        hand = parameters.get('hand', 'right')
        grip_strength = parameters.get('strength', 0.8)
        
        prefix = f"{hand}_arm"
        
        forearm_flexors = self.bundles.get(f"{prefix}_forearm_flexors")
        if forearm_flexors:
            forearm_flexors.activate(grip_strength, 0.016)
            
    def _execute_turn(self, parameters: Dict):
        """Execute turning motion"""
        direction = parameters.get('direction', 'left')
        angle = parameters.get('angle', 0.5)
        
        # Activate torso and leg muscles for rotation
        if direction == 'left':
            left_glute = self.bundles.get('left_leg_gluteus')
            right_oblique = self.bundles.get('torso_abs')
            if left_glute:
                left_glute.activate(0.8, 0.016)
        else:
            right_glute = self.bundles.get('right_leg_gluteus')
            if right_glute:
                right_glute.activate(0.8, 0.016)
                
    def _execute_generic(self, action: str, parameters: Dict):
        """Execute generic movement pattern"""
        # Use pattern from motor command if available
        pattern = parameters.get('pattern', [])
        
        # Distribute activation across relevant muscles
        for i, bundle_name in enumerate(self.bundles.keys()):
            if i < len(pattern):
                bundle = self.bundles[bundle_name]
                bundle.activate(pattern[i], 0.016)
                
    def update(self, delta_time: float):
        """Update all muscles and joints"""
        # Update all muscle bundles
        for bundle in self.bundles.values():
            bundle.update(delta_time)
            
        # Update all joints
        for joint in self.joints.values():
            joint.update(delta_time)
            
        # Process active movements
        for action, movement in list(self.active_movements.items()):
            elapsed = (self.organism.state.age if hasattr(self.organism, 'state') else 0) - movement['start_time']
            if elapsed > 2.0:  # Movement duration limit
                del self.active_movements[action]
                
    def get_joint_angle(self, joint_id: str) -> float:
        """Get current angle of a joint"""
        if joint_id in self.joints:
            return self.joints[joint_id].angle
        return 0.0
        
    def get_muscle_activation(self, bundle_name: str) -> float:
        """Get activation level of a muscle bundle"""
        if bundle_name in self.bundles:
            return self.bundles[bundle_name].get_average_activation()
        return 0.0
        
    def get_status(self) -> Dict[str, Any]:
        """Get muscular system status"""
        total_force = sum(b.get_total_force() for b in self.bundles.values())
        avg_activation = sum(b.get_average_activation() for b in self.bundles.values()) / max(1, len(self.bundles))
        
        joint_angles = {j_id: j.angle for j_id, j in self.joints.items()}
        
        return {
            'total_active_force': total_force,
            'average_activation': avg_activation,
            'active_movements': list(self.active_movements.keys()),
            'joint_angles': joint_angles,
            'muscle_count': len(self.bundles),
            'joint_count': len(self.joints)
        }
