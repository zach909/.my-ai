"""
Skeletal System - Internal structural framework.

Provides structural support, protection for internal systems,
and attachment points for muscles.
"""

from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
import math


@dataclass
class Bone:
    """Individual bone segment"""
    id: str
    name: str
    length: float  # meters
    density: float  # kg/m^3
    strength: float  # Maximum stress tolerance
    current_stress: float = 0.0
    integrity: float = 100.0  # Percentage
    position: Tuple[float, float, float] = (0, 0, 0)
    rotation: Tuple[float, float, float] = (0, 0, 0)
    
    def apply_stress(self, stress: float):
        """Apply mechanical stress to bone"""
        self.current_stress = stress
        if stress > self.strength * 0.8:
            self.integrity -= (stress - self.strength * 0.8) * 0.01
        self.integrity = max(0, min(100, self.integrity))


@dataclass
class JointSocket:
    """Joint connection point on bone"""
    id: str
    bone_id: str
    joint_type: str  # ball, hinge, pivot
    position: Tuple[float, float, float]


class SkeletalSystem:
    """
    Complete skeletal structure providing framework for the organism.
    """
    
    def __init__(self, organism):
        self.organism = organism
        self.bones: Dict[str, Bone] = {}
        self.joints: Dict[str, JointSocket] = {}
        self.connections: Dict[str, List[str]] = {}
        
        self._initialize_skeleton()
        
    def _initialize_skeleton(self):
        """Create complete human-like skeleton"""
        # Skull
        self.bones["skull"] = Bone("skull", "cranium", 0.25, 1800, 150.0)
        
        # Spine segments
        self.bones["cervical_spine"] = Bone("cervical_spine", "cervical vertebrae", 0.12, 1500, 100.0)
        self.bones["thoracic_spine"] = Bone("thoracic_spine", "thoracic vertebrae", 0.30, 1500, 120.0)
        self.bones["lumbar_spine"] = Bone("lumbar_spine", "lumbar vertebrae", 0.18, 1600, 140.0)
        self.bones["sacrum"] = Bone("sacrum", "sacrum", 0.10, 1700, 130.0)
        
        # Rib cage
        for i in range(12):
            side = "left" if i % 2 == 0 else "right"
            rib_num = (i // 2) + 1
            self.bones[f"rib_{side}_{rib_num}"] = Bone(
                f"rib_{side}_{rib_num}", f"rib {rib_num}", 0.25, 1400, 80.0
            )
            
        # Sternum
        self.bones["sternum"] = Bone("sternum", "sternum", 0.18, 1500, 90.0)
        
        # Clavicles
        self.bones["clavicle_left"] = Bone("clavicle_left", "left clavicle", 0.15, 1600, 100.0)
        self.bones["clavicle_right"] = Bone("clavicle_right", "right clavicle", 0.15, 1600, 100.0)
        
        # Scapulae
        self.bones["scapula_left"] = Bone("scapula_left", "left scapula", 0.18, 1500, 95.0)
        self.bones["scapula_right"] = Bone("scapula_right", "right scapula", 0.18, 1500, 95.0)
        
        # Arms
        self.bones["humerus_left"] = Bone("humerus_left", "left humerus", 0.32, 1700, 110.0)
        self.bones["humerus_right"] = Bone("humerus_right", "right humerus", 0.32, 1700, 110.0)
        self.bones["radius_left"] = Bone("radius_left", "left radius", 0.26, 1650, 100.0)
        self.bones["radius_right"] = Bone("radius_right", "right radius", 0.26, 1650, 100.0)
        self.bones["ulna_left"] = Bone("ulna_left", "left ulna", 0.27, 1650, 100.0)
        self.bones["ulna_right"] = Bone("ulna_right", "right ulna", 0.27, 1650, 100.0)
        
        # Hands (simplified)
        for side in ["left", "right"]:
            for i in range(5):
                self.bones[f"metacarpal_{side}_{i}"] = Bone(
                    f"metacarpal_{side}_{i}", f"{side} metacarpal {i}", 0.06, 1500, 60.0
                )
                
        # Pelvis
        self.bones["pelvis"] = Bone("pelvis", "pelvis", 0.20, 1800, 150.0)
        
        # Legs
        self.bones["femur_left"] = Bone("femur_left", "left femur", 0.45, 1750, 160.0)
        self.bones["femur_right"] = Bone("femur_right", "right femur", 0.45, 1750, 160.0)
        self.bones["tibia_left"] = Bone("tibia_left", "left tibia", 0.38, 1700, 140.0)
        self.bones["tibia_right"] = Bone("tibia_right", "right tibia", 0.38, 1700, 140.0)
        self.bones["fibula_left"] = Bone("fibula_left", "left fibula", 0.37, 1600, 100.0)
        self.bones["fibula_right"] = Bone("fibula_right", "right fibula", 0.37, 1600, 100.0)
        
        # Feet (simplified)
        for side in ["left", "right"]:
            self.bones[f"tarsus_{side}"] = Bone(f"tarsus_{side}", f"{side} tarsus", 0.10, 1600, 120.0)
            for i in range(5):
                self.bones[f"phalanx_{side}_{i}"] = Bone(
                    f"phalanx_{side}_{i}", f"{side} phalanx {i}", 0.04, 1500, 50.0
                )
                
        # Define bone connections
        self.connections = {
            "skull": ["cervical_spine"],
            "cervical_spine": ["skull", "thoracic_spine"],
            "thoracic_spine": ["cervical_spine", "lumbar_spine"],
            "lumbar_spine": ["thoracic_spine", "sacrum"],
            "sacrum": ["lumbar_spine", "pelvis"],
            "pelvis": ["sacrum", "femur_left", "femur_right"],
            "sternum": ["clavicle_left", "clavicle_right"],
            "clavicle_left": ["sternum", "scapula_left"],
            "clavicle_right": ["sternum", "scapula_right"],
            "scapula_left": ["clavicle_left", "humerus_left"],
            "scapula_right": ["clavicle_right", "humerus_right"],
            "humerus_left": ["scapula_left", "radius_left", "ulna_left"],
            "humerus_right": ["scapula_right", "radius_right", "ulna_right"],
            "femur_left": ["pelvis", "tibia_left"],
            "femur_right": ["pelvis", "tibia_right"]
        }
        
    def get_integrity(self) -> float:
        """Get overall skeletal integrity as percentage"""
        if not self.bones:
            return 100.0
        total = sum(b.integrity for b in self.bones.values())
        return total / len(self.bones)
        
    def apply_force(self, bone_id: str, force: float, direction: Tuple[float, float, float]):
        """Apply force to a specific bone"""
        if bone_id in self.bones:
            bone = self.bones[bone_id]
            # Simplified stress calculation
            stress = abs(force) / 0.001  # Stress per unit area
            bone.apply_stress(stress)
            
    def detect_fractures(self) -> List[str]:
        """Detect bones with critical damage"""
        fractures = []
        for bone_id, bone in self.bones.items():
            if bone.integrity < 50:
                fractures.append(bone_id)
        return fractures
        
    def get_status(self) -> Dict[str, Any]:
        """Get skeletal system status"""
        return {
            'total_bones': len(self.bones),
            'overall_integrity': self.get_integrity(),
            'fractures': self.detect_fractures(),
            'bone_health': {k: v.integrity for k, v in self.bones.items()}
        }
        
    def update(self, delta_time: float):
        """Update skeletal system state"""
        pass  # Skeletal system is mostly static
