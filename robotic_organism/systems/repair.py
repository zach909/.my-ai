"""
Repair System - Stage 6 of development

Build self-repair before reproduction.

The organism detects damage and deploys appropriate repair methods:
1. Seal damage (punctures)
2. Patch damage (tears)
3. Reinforce damage (structural)
4. Replace damaged component
5. Manufacture replacement component

Different damage types require different repair materials and methods.
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
import time


class DamageType(Enum):
    """Types of damage the organism can experience."""
    PUNCTURE = "puncture"  # Small hole - needs sealing
    TEAR = "tear"  # Rip in material - needs adhesive
    STRUCTURAL = "structural"  # Broken support - needs reinforcement
    ELECTRICAL = "electrical"  # Damaged wiring - needs reconnection
    SENSOR = "sensor"  # Damaged sensor - needs replacement
    ACTUATOR = "actuator"  # Damaged muscle/actuator - needs repair


class RepairMethod(Enum):
    """Available repair methods."""
    SEAL = "seal"  # Apply sealant to punctures
    PATCH = "patch"  # Apply adhesive patch to tears
    REINFORCE = "reinforce"  # Add structural reinforcement
    RECONNECT = "reconnect"  # Reconnect electrical pathways
    REPLACE = "replace"  # Replace component entirely
    MANUFACTURE = "manufacture"  # Manufacture new component


@dataclass
class RepairMaterial:
    """A specialized repair material."""
    name: str
    method: RepairMethod
    volume_remaining: float  # m³
    max_volume: float  # m³
    application_rate: float  # m³/s
    curing_time: float  # seconds to set/cure
    strength_factor: float  # 0.0 to 1.0
    
    @property
    def level(self) -> float:
        """Remaining material as percentage."""
        return self.volume_remaining / self.max_volume if self.max_volume > 0 else 0.0


@dataclass
class Nanobot:
    """A mobile repair nanobot."""
    id: str
    location: Tuple[float, float, float] = (0.0, 0.0, 0.0)
    target_location: Optional[Tuple[float, float, float]] = None
    carrying_material: Optional[str] = None
    active: bool = True
    progress: float = 0.0
    
    def move_to(self, x: float, y: float, z: float):
        """Set target location."""
        self.target_location = (x, y, z)
    
    def update_position(self, dt: float = 1.0, speed: float = 0.01):
        """Move toward target location."""
        if self.target_location is None or not self.active:
            return
        
        import math
        dx = self.target_location[0] - self.location[0]
        dy = self.target_location[1] - self.location[1]
        dz = self.target_location[2] - self.location[2]
        
        dist = math.sqrt(dx**2 + dy**2 + dz**2)
        
        if dist < speed * dt:
            self.location = self.target_location
            self.target_location = None
            self.progress = 1.0
        else:
            factor = (speed * dt) / dist
            self.location = (
                self.location[0] + dx * factor,
                self.location[1] + dy * factor,
                self.location[2] + dz * factor
            )
            self.progress = 1.0 - (dist - speed * dt) / dist


@dataclass
class DamageReport:
    """Detailed report of detected damage."""
    id: str
    damage_type: DamageType
    location: Tuple[float, float, float]
    severity: float  # 0.0 to 1.0
    timestamp: float
    size: float  # Approximate size in meters
    depth: float = 0.0  # Depth of damage
    affected_systems: List[str] = field(default_factory=list)
    
    # Repair status
    repair_method: Optional[RepairMethod] = None
    repair_progress: float = 0.0
    repair_complete: bool = False
    assigned_nanobots: List[str] = field(default_factory=list)


class RepairSystem:
    """
    Internal self-repair system for the artificial organism.
    
    Capabilities:
    - Detect damage through sensors
    - Classify damage type and severity
    - Select appropriate repair method
    - Deploy repair materials via transport system
    - Coordinate nanobots for precise repairs
    - Track repair progress
    """
    
    def __init__(self, nanobot_count: int = 50):
        # Repair materials inventory
        self.materials: Dict[RepairMethod, RepairMaterial] = {
            RepairMethod.SEAL: RepairMaterial(
                name="QuickSeal",
                method=RepairMethod.SEAL,
                volume_remaining=0.0005,
                max_volume=0.001,
                application_rate=0.00001,
                curing_time=5.0,
                strength_factor=0.9
            ),
            RepairMethod.PATCH: RepairMaterial(
                name="StructuralBond",
                method=RepairMethod.PATCH,
                volume_remaining=0.0005,
                max_volume=0.001,
                application_rate=0.000008,
                curing_time=10.0,
                strength_factor=0.95
            ),
            RepairMethod.REINFORCE: RepairMaterial(
                name="ReinforceMesh",
                method=RepairMethod.REINFORCE,
                volume_remaining=0.0003,
                max_volume=0.0005,
                application_rate=0.000005,
                curing_time=15.0,
                strength_factor=1.0
            ),
            RepairMethod.RECONNECT: RepairMaterial(
                name="ConductivePaste",
                method=RepairMethod.RECONNECT,
                volume_remaining=0.0002,
                max_volume=0.0003,
                application_rate=0.000003,
                curing_time=3.0,
                strength_factor=0.85
            ),
            RepairMethod.REPLACE: RepairMaterial(
                name="ReplacementParts",
                method=RepairMethod.REPLACE,
                volume_remaining=0.001,
                max_volume=0.002,
                application_rate=0.00001,
                curing_time=0.0,  # Instant
                strength_factor=1.0
            )
        }
        
        # Nanobot swarm
        self.nanobots: List[Nanobot] = [
            Nanobot(id=f"nanobot_{i}")
            for i in range(nanobot_count)
        ]
        
        # Damage tracking
        self.detected_damage: List[DamageReport] = []
        self.repair_history: List[DamageReport] = []
        self.active_repairs: Dict[str, DamageReport] = {}
        
        # Statistics
        self.total_repairs = 0
        self.successful_repairs = 0
        self.failed_repairs = 0
        self.material_used = {m: 0.0 for m in RepairMethod}
        
        # Damage detection threshold
        self.detection_sensitivity = 0.1
    
    def detect_damage(self, location: Tuple[float, float, float],
                      damage_type: str, severity: float,
                      size: float = 0.01, depth: float = 0.001,
                      affected_systems: Optional[List[str]] = None) -> Optional[DamageReport]:
        """
        Detect and register new damage.
        
        Returns DamageReport if damage exceeds detection threshold.
        """
        if severity < self.detection_sensitivity:
            return None
        
        # Convert string to enum
        try:
            dtype = DamageType(damage_type)
        except ValueError:
            dtype = DamageType.TEAR  # Default
        
        damage_id = f"dmg_{int(time.time() * 1000)}_{len(self.detected_damage)}"
        
        report = DamageReport(
            id=damage_id,
            damage_type=dtype,
            location=location,
            severity=severity,
            timestamp=time.time(),
            size=size,
            depth=depth,
            affected_systems=affected_systems or []
        )
        
        # Determine repair method based on damage type
        method_map = {
            DamageType.PUNCTURE: RepairMethod.SEAL,
            DamageType.TEAR: RepairMethod.PATCH,
            DamageType.STRUCTURAL: RepairMethod.REINFORCE,
            DamageType.ELECTRICAL: RepairMethod.RECONNECT,
            DamageType.SENSOR: RepairMethod.REPLACE,
            DamageType.ACTUATOR: RepairMethod.REPLACE
        }
        report.repair_method = method_map.get(dtype, RepairMethod.PATCH)
        
        self.detected_damage.append(report)
        self.active_repairs[damage_id] = report
        
        return report
    
    def assign_nanobots(self, damage_id: str, count: int = 5) -> List[str]:
        """Assign nanobots to a repair job."""
        if damage_id not in self.active_repairs:
            return []
        
        damage = self.active_repairs[damage_id]
        assigned = []
        
        # Find available nanobots
        for nanobot in self.nanobots:
            if len(assigned) >= count:
                break
            
            # Check if nanobot is available
            if nanobot.target_location is None and nanobot.active:
                nanobot.move_to(*damage.location)
                nanobot.carrying_material = damage.repair_method.value if damage.repair_method else None
                damage.assigned_nanobots.append(nanobot.id)
                assigned.append(nanobot.id)
        
        return assigned
    
    def update_repairs(self, dt: float = 1.0) -> List[str]:
        """Update all active repairs. Returns completed repair IDs."""
        completed = []
        
        for damage_id, damage in list(self.active_repairs.items()):
            if damage.repair_complete:
                completed.append(damage_id)
                continue
            
            # Update nanobot positions
            nanobots_assigned = len(damage.assigned_nanobots)
            
            if nanobots_assigned == 0:
                # Assign nanobots automatically
                count = max(3, int(damage.severity * 10))
                self.assign_nanobots(damage_id, count)
                continue
            
            # Calculate repair progress
            # More nanobots = faster repair, higher severity = slower repair
            nanobots_active = sum(
                1 for nb in self.nanobots 
                if nb.id in damage.assigned_nanobots and nb.active
            )
            
            base_rate = 0.1 * nanobots_active
            progress_increment = base_rate * dt / (damage.severity + 0.1)
            
            damage.repair_progress += progress_increment
            
            # Consume repair material
            if damage.repair_method:
                material = self.materials.get(damage.repair_method)
                if material:
                    consumption = progress_increment * damage.size * damage.depth
                    actual_consumption = min(consumption, material.volume_remaining)
                    material.volume_remaining -= actual_consumption
                    self.material_used[damage.repair_method] += actual_consumption
            
            if damage.repair_progress >= 1.0:
                damage.repair_complete = True
                damage.repair_progress = 1.0
                self.successful_repairs += 1
                self.total_repairs += 1
                completed.append(damage_id)
                
                # Move to history
                self.repair_history.append(damage)
        
        # Remove completed from active
        for damage_id in completed:
            if damage_id in self.active_repairs:
                del self.active_repairs[damage_id]
        
        # Update nanobots
        for nanobot in self.nanobots:
            if nanobot.active:
                nanobot.update_position(dt)
                if nanobot.target_location is None and nanobot.progress >= 1.0:
                    nanobot.progress = 0.0  # Reset for next job
        
        return completed
    
    def get_repair_priority(self) -> List[DamageReport]:
        """Get damage reports sorted by priority (severity × affected systems)."""
        def priority_score(d: DamageReport) -> float:
            system_weight = len(d.affected_systems) * 0.2
            return d.severity * (1.0 + system_weight)
        
        return sorted(self.detected_damage, key=priority_score, reverse=True)
    
    def update(self, dt: float = 1.0) -> Dict:
        """Update repair system for one timestep."""
        completed = self.update_repairs(dt)
        
        return {
            'active_repairs': len(self.active_repairs),
            'completed_this_step': len(completed),
            'nanobots_active': sum(1 for nb in self.nanobots if nb.active),
            'nanobots_busy': sum(
                1 for nb in self.nanobots 
                if nb.target_location is not None
            ),
            'material_levels': {
                m.name: f"{mat.level:.1%}" 
                for m, mat in self.materials.items()
            },
            'priority_repairs': [
                {'id': d.id, 'type': d.damage_type.value, 'severity': d.severity}
                for d in self.get_repair_priority()[:5]
            ]
        }
    
    def get_status(self) -> Dict:
        """Get detailed status of repair system."""
        return {
            'materials': {
                m.name: {
                    'level': f"{mat.level:.1%}",
                    'remaining': f"{mat.volume_remaining*1e9:.1f} mm³",
                    'curing_time': mat.curing_time,
                    'strength': mat.strength_factor
                }
                for m, mat in self.materials.items()
            },
            'nanobots': {
                'total': len(self.nanobots),
                'active': sum(1 for nb in self.nanobots if nb.active),
                'busy': sum(1 for nb in self.nanobots if nb.target_location),
                'locations': [
                    {'id': nb.id, 'pos': nb.location, 'target': nb.target_location}
                    for nb in self.nanobots[:5]  # First 5 only
                ]
            },
            'damage': {
                'detected': len(self.detected_damage),
                'active': len(self.active_repairs),
                'history': len(self.repair_history)
            },
            'statistics': {
                'total_repairs': self.total_repairs,
                'successful': self.successful_repairs,
                'failed': self.failed_repairs,
                'success_rate': f"{self.successful_repairs/max(1,self.total_repairs)*100:.1f}%",
                'material_used': {
                    m.name: f"{v*1e9:.1f} mm³"
                    for m, v in self.material_used.items()
                }
            }
        }
