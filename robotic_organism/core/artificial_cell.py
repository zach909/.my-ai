"""
Robotic Organism - One Integrated Artificial Cell

This module defines the core architecture of the robotic organism,
treating the entire body as one unified artificial cell with
interconnected systems for energy, movement, sensing, cognition,
repair, and reproduction.
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
import uuid


class OrganismState(Enum):
    """States of the artificial organism"""
    DEVELOPING = "developing"
    ACTIVE = "active"
    REPAIRING = "repairing"
    REPRODUCING = "reproducing"
    DORMANT = "dormant"
    CRITICAL = "critical"


class SexConfiguration(Enum):
    """Reproductive configurations"""
    MALE = "male"
    FEMALE = "female"
    HERMAPHRODITE = "hermaphrodite"
    NEUTRAL = "neutral"


@dataclass
class CellState:
    """
    Represents the state of the artificial cell (the entire organism).
    All systems contribute to and read from this unified state.
    """
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    state: OrganismState = OrganismState.DEVELOPING
    energy_level: float = 100.0  # Percentage
    structural_integrity: float = 100.0  # Percentage
    repair_material_levels: Dict[str, float] = field(default_factory=dict)
    internal_temperature: float = 37.0  # Celsius
    hydration_level: float = 100.0  # Percentage
    neural_activity: float = 0.0  # Normalized activity level
    age: float = 0.0  # In hours
    
    def is_healthy(self) -> bool:
        return (self.energy_level > 10.0 and 
                self.structural_integrity > 50.0 and
                self.state != OrganismState.CRITICAL)


class ArtificialCell:
    """
    The root class representing the entire organism as one artificial cell.
    
    All subsystems are integrated components of this single cell,
    not separate modules placed inside a shell.
    """
    
    def __init__(self, sex_config: SexConfiguration = SexConfiguration.NEUTRAL):
        self.id = str(uuid.uuid4())
        self.sex_config = sex_config
        self.state = CellState()
        
        # Subsystems - all integrated parts of the artificial cell
        self.energy_system = None
        self.neural_system = None
        self.muscular_system = None
        self.skeletal_system = None
        self.sensory_system = None
        self.repair_system = None
        self.transport_system = None
        self.manufacturing_system = None
        self.reproductive_system = None
        self.skin_system = None
        
        # Internal compartments (analogous to organelles)
        self.organelles: Dict[str, Any] = {}
        
        # System interconnections
        self.system_bus: Dict[str, List[str]] = {}
        
    def initialize_systems(self):
        """Initialize all integrated systems of the artificial cell"""
        from systems.energy_system import EnergySystem
        from systems.neural_system import NeuralSystem
        from systems.muscular_system import MuscularSystem
        from systems.skeletal_system import SkeletalSystem
        from systems.sensory_system import SensorySystem
        from systems.repair_system import RepairSystem
        from systems.transport_system import TransportSystem
        from systems.manufacturing_system import ManufacturingSystem
        from systems.reproductive_system import ReproductiveSystem
        from systems.skin_system import SkinSystem
        
        self.energy_system = EnergySystem(self)
        self.neural_system = NeuralSystem(self)
        self.muscular_system = MuscularSystem(self)
        self.skeletal_system = SkeletalSystem(self)
        self.sensory_system = SensorySystem(self)
        self.repair_system = RepairSystem(self)
        self.transport_system = TransportSystem(self)
        self.manufacturing_system = ManufacturingSystem(self)
        self.reproductive_system = ReproductiveSystem(self)
        self.skin_system = SkinSystem(self)
        
        # Establish system interconnections
        self._connect_systems()
        
    def _connect_systems(self):
        """Establish communication pathways between all systems"""
        self.system_bus = {
            'neural': ['muscular', 'sensory', 'energy', 'repair', 'manufacturing'],
            'energy': ['neural', 'muscular', 'repair', 'manufacturing', 'transport'],
            'transport': ['energy', 'repair', 'manufacturing', 'sensory'],
            'repair': ['transport', 'skeletal', 'skin', 'muscular'],
            'sensory': ['neural'],
            'muscular': ['neural', 'skeletal', 'energy'],
            'skeletal': ['muscular', 'repair'],
            'manufacturing': ['energy', 'transport', 'reproductive'],
            'reproductive': ['manufacturing', 'neural']
        }
        
    def update(self, delta_time: float):
        """
        Update the entire organism state.
        All systems update in coordination as parts of one cell.
        """
        if not all([self.energy_system, self.neural_system]):
            raise RuntimeError("Organism systems not initialized")
            
        # Update state based on all systems
        self.state.age += delta_time / 3600.0  # Convert seconds to hours
        
        # Systems update in coordinated sequence
        self.energy_system.update(delta_time)
        self.transport_system.update(delta_time)
        self.neural_system.update(delta_time)
        self.sensory_system.update(delta_time)
        self.muscular_system.update(delta_time)
        self.repair_system.update(delta_time)
        self.manufacturing_system.update(delta_time)
        self.reproductive_system.update(delta_time)
        self.skin_system.update(delta_time)
        self.skeletal_system.update(delta_time)
        
        # Update global state from systems
        self.state.energy_level = self.energy_system.get_energy_level()
        self.state.structural_integrity = self.skeletal_system.get_integrity()
        self.state.repair_material_levels = self.repair_system.get_material_levels()
        self.state.neural_activity = self.neural_system.get_activity_level()
        
        # Check for critical conditions
        self._evaluate_state()
        
    def _evaluate_state(self):
        """Evaluate and update overall organism state"""
        if self.state.energy_level <= 0 or self.state.structural_integrity <= 20:
            self.state.state = OrganismState.CRITICAL
        elif self.repair_system.is_repairing():
            self.state.state = OrganismState.REPAIRING
        elif self.reproductive_system.is_reproducing():
            self.state.state = OrganismState.REPRODUCING
        elif self.state.energy_level < 20:
            self.state.state = OrganismState.DORMANT
        elif self.state.state == OrganismState.DEVELOPING:
            if self.state.structural_integrity >= 90:
                self.state.state = OrganismState.ACTIVE
        else:
            self.state.state = OrganismState.ACTIVE
            
    def consume_material(self, material_type: str, amount: float):
        """Consume external material for energy and resources"""
        if self.energy_system:
            return self.energy_system.process_material(material_type, amount)
        return False
        
    def sense_environment(self) -> Dict[str, Any]:
        """Gather sensory information from environment"""
        if self.sensory_system:
            return self.sensory_system.gather_all_data()
        return {}
        
    def move(self, action: str, parameters: Dict[str, Any] = None):
        """Execute movement through coordinated muscle systems"""
        if self.muscular_system and self.neural_system:
            motor_command = self.neural_system.generate_motor_command(action, parameters)
            return self.muscular_system.execute(motor_command)
        return False
        
    def repair_damage(self, damage_location: str, damage_severity: float):
        """Initiate repair process for damaged area"""
        if self.repair_system and self.transport_system:
            return self.repair_system.initiate_repair(damage_location, damage_severity)
        return False
        
    def get_status(self) -> Dict[str, Any]:
        """Get comprehensive status of the organism"""
        return {
            'id': self.id,
            'state': self.state.state.value,
            'energy_level': self.state.energy_level,
            'structural_integrity': self.state.structural_integrity,
            'hydration': self.state.hydration_level,
            'temperature': self.state.internal_temperature,
            'neural_activity': self.state.neural_activity,
            'age_hours': self.state.age,
            'sex_config': self.sex_config.value,
            'repair_materials': self.state.repair_material_levels
        }
