"""
Repair System - Internal damage detection and repair.

Produces specialized artificial repair materials that are transported
throughout the body to seal punctures, bond structures, and rebuild
damaged areas.
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from enum import Enum


class RepairMaterialType(Enum):
    """Types of specialized repair materials"""
    SEALANT = "sealant"           # Seals punctures and leaks
    ADHESIVE = "adhesive"         # Structural bonding agent
    REINFORCEMENT = "reinforcement"  # Strengthens damaged areas
    FILLER = "filler"             # Fills gaps and voids
    CONDUCTIVE = "conductive"     # Repairs electrical connections
    CATALYST = "catalyst"         # Accelerates other repair processes


@dataclass
class DamageReport:
    """Report of detected damage"""
    location: str
    severity: float  # 0-1
    damage_type: str  # puncture, fracture, tear, etc.
    timestamp: float
    estimated_repair_time: float
    required_materials: Dict[RepairMaterialType, float]


@dataclass
class RepairMaterial:
    """Specialized repair material"""
    id: str
    material_type: RepairMaterialType
    quantity: float  # Volume in mL
    viscosity: float
    curing_time: float  # Seconds to fully cure
    bond_strength: float
    
    def consume(self, amount: float) -> float:
        """Consume material, return actual amount provided"""
        provided = min(amount, self.quantity)
        self.quantity -= provided
        return provided


class RepairNanobot:
    """
    Microscopic repair unit that transports materials to damage sites.
    """
    
    def __init__(self, bot_id: str):
        self.id = bot_id
        self.position: tuple = (0, 0, 0)
        self.target_location: Optional[tuple] = None
        self.carrying: Dict[str, float] = {}  # material_type -> quantity
        self.active: bool = False
        self.speed: float = 0.05  # meters per second
        
    def load_material(self, material_type: str, quantity: float):
        """Load repair material"""
        self.carrying[material_type] = \
            self.carrying.get(material_type, 0.0) + quantity
            
    def unload_material(self, material_type: str, quantity: float) -> float:
        """Unload material at target location"""
        if material_type in self.carrying:
            unloaded = min(quantity, self.carrying[material_type])
            self.carrying[material_type] -= unloaded
            return unloaded
        return 0.0
        
    def move_to(self, location: tuple):
        """Set target destination"""
        self.target_location = location
        self.active = True
        
    def update(self, delta_time: float) -> bool:
        """
        Move toward target. Returns True if arrived.
        """
        if not self.active or self.target_location is None:
            return False
            
        # Simplified movement
        distance_moved = self.speed * delta_time
        
        # Check arrival (simplified)
        # In full implementation, would calculate actual distance
        return True  # Assume arrival for simplicity


class RepairSystem:
    """
    Complete internal repair system for the artificial organism.
    
    Detects damage, dispatches repair nanobots with appropriate
    materials, and monitors repair progress.
    """
    
    def __init__(self, organism):
        self.organism = organism
        self.material_stores: Dict[RepairMaterialType, RepairMaterial] = {}
        self.nanobots: List[RepairNanobot] = []
        self.active_repairs: Dict[str, DamageReport] = {}
        self.completed_repairs: List[DamageReport] = []
        self.repair_queue: List[DamageReport] = []
        
        self._initialize_materials()
        self._initialize_nanobots()
        
    def _initialize_materials(self):
        """Initialize repair material stores"""
        self.material_stores[RepairMaterialType.SEALANT] = RepairMaterial(
            id="sealant_main",
            material_type=RepairMaterialType.SEALANT,
            quantity=500.0,
            viscosity=0.8,
            curing_time=30.0,
            bond_strength=0.9
        )
        
        self.material_stores[RepairMaterialType.ADHESIVE] = RepairMaterial(
            id="adhesive_main",
            material_type=RepairMaterialType.ADHESIVE,
            quantity=400.0,
            viscosity=0.6,
            curing_time=60.0,
            bond_strength=0.95
        )
        
        self.material_stores[RepairMaterialType.REINFORCEMENT] = RepairMaterial(
            id="reinforcement_main",
            material_type=RepairMaterialType.REINFORCEMENT,
            quantity=300.0,
            viscosity=0.4,
            curing_time=120.0,
            bond_strength=0.98
        )
        
        self.material_stores[RepairMaterialType.FILLER] = RepairMaterial(
            id="filler_main",
            material_type=RepairMaterialType.FILLER,
            quantity=350.0,
            viscosity=0.7,
            curing_time=45.0,
            bond_strength=0.85
        )
        
        self.material_stores[RepairMaterialType.CONDUCTIVE] = RepairMaterial(
            id="conductive_main",
            material_type=RepairMaterialType.CONDUCTIVE,
            quantity=200.0,
            viscosity=0.5,
            curing_time=20.0,
            bond_strength=0.9
        )
        
    def _initialize_nanobots(self):
        """Create repair nanobot fleet"""
        for i in range(50):
            bot = RepairNanobot(f"repair_bot_{i}")
            self.nanobots.append(bot)
            
    def detect_damage(self, location: str, severity: float, 
                      damage_type: str = "unknown") -> Optional[DamageReport]:
        """
        Detect and report damage.
        
        Args:
            location: Body location of damage
            severity: Severity level 0-1
            damage_type: Type of damage
            
        Returns:
            DamageReport if damage detected, None otherwise
        """
        if severity < 0.1:  # Ignore minor wear
            return None
            
        timestamp = self.organism.state.age if hasattr(self.organism, 'state') else 0
        
        # Determine required materials based on damage type
        required_materials = self._calculate_required_materials(
            damage_type, severity
        )
        
        # Estimate repair time
        base_time = 30.0  # seconds
        estimated_time = base_time * severity * len(required_materials)
        
        report = DamageReport(
            location=location,
            severity=severity,
            damage_type=damage_type,
            timestamp=timestamp,
            estimated_repair_time=estimated_time,
            required_materials=required_materials
        )
        
        return report
        
    def _calculate_required_materials(self, damage_type: str, 
                                       severity: float) -> Dict[RepairMaterialType, float]:
        """Calculate materials needed for repair"""
        materials = {}
        
        if damage_type in ["puncture", "tear", "cut"]:
            materials[RepairMaterialType.SEALANT] = severity * 50.0
            materials[RepairMaterialType.ADHESIVE] = severity * 30.0
            
        elif damage_type in ["fracture", "crack", "break"]:
            materials[RepairMaterialType.ADHESIVE] = severity * 40.0
            materials[RepairMaterialType.REINFORCEMENT] = severity * 60.0
            materials[RepairMaterialType.FILLER] = severity * 20.0
            
        elif damage_type in ["electrical", "circuit"]:
            materials[RepairMaterialType.CONDUCTIVE] = severity * 30.0
            materials[RepairMaterialType.ADHESIVE] = severity * 20.0
            
        elif damage_type in ["structural", "compression"]:
            materials[RepairMaterialType.REINFORCEMENT] = severity * 70.0
            materials[RepairMaterialType.FILLER] = severity * 30.0
            
        else:  # Unknown damage type
            materials[RepairMaterialType.ADHESIVE] = severity * 40.0
            materials[RepairMaterialType.FILLER] = severity * 30.0
            
        return materials
        
    def initiate_repair(self, location: str, severity: float,
                        damage_type: str = "unknown") -> bool:
        """
        Initiate repair process for detected damage.
        
        Args:
            location: Location of damage
            severity: Severity 0-1
            damage_type: Type of damage
            
        Returns:
            True if repair initiated successfully
        """
        report = self.detect_damage(location, severity, damage_type)
        if not report:
            return False
            
        # Check material availability
        if not self._check_materials_available(report.required_materials):
            # Queue for later repair
            self.repair_queue.append(report)
            return False
            
        # Add to active repairs
        self.active_repairs[f"{location}_{report.timestamp}"] = report
        
        # Dispatch nanobots
        bots_needed = max(1, int(severity * 10))
        available_bots = [b for b in self.nanobots if not b.active][:bots_needed]
        
        for bot in available_bots:
            # Load bot with required materials
            for mat_type, quantity in report.required_materials.items():
                if mat_type in self.material_stores:
                    material = self.material_stores[mat_type]
                    loaded = material.consume(quantity / len(available_bots))
                    bot.load_material(mat_type.value, loaded)
                    
            # Send to damage location
            bot.move_to(location)  # Simplified - location as tuple
            
        return True
        
    def _check_materials_available(self, 
                                    required: Dict[RepairMaterialType, float]) -> bool:
        """Check if sufficient materials are available"""
        for mat_type, quantity in required.items():
            if mat_type not in self.material_stores:
                return False
            if self.material_stores[mat_type].quantity < quantity:
                return False
        return True
        
    def is_repairing(self) -> bool:
        """Check if any repairs are in progress"""
        return len(self.active_repairs) > 0
        
    def get_material_levels(self) -> Dict[str, float]:
        """Get current levels of all repair materials"""
        return {
            mat_type.value: mat.quantity 
            for mat_type, mat in self.material_stores.items()
        }
        
    def update(self, delta_time: float):
        """Update repair system state"""
        # Update nanobots
        arrived_bots = []
        for bot in self.nanobots:
            if bot.active:
                if bot.update(delta_time):
                    arrived_bots.append(bot)
                    
        # Process completed repairs
        completed = []
        for repair_id, report in list(self.active_repairs.items()):
            report.estimated_repair_time -= delta_time
            if report.estimated_repair_time <= 0:
                completed.append(repair_id)
                
        for repair_id in completed:
            report = self.active_repairs.pop(repair_id)
            self.completed_repairs.append(report)
            
            # Return nanobots to depot
            for bot in self.nanobots:
                if bot.active:
                    bot.active = False
                    bot.target_location = None
                    
        # Check queue for pending repairs
        if self.active_repairs or len(self.active_repairs) < 5:
            if self.repair_queue:
                next_repair = self.repair_queue.pop(0)
                if self._check_materials_available(next_repair.required_materials):
                    self.active_repairs[f"{next_repair.location}_{next_repair.timestamp}"] = next_repair
                    
    def produce_material(self, material_type: RepairMaterialType, 
                         quantity: float) -> bool:
        """Produce more repair material using manufacturing system"""
        if material_type in self.material_stores:
            self.material_stores[material_type].quantity += quantity
            return True
        return False
        
    def get_status(self) -> Dict[str, Any]:
        """Get repair system status"""
        return {
            'active_repairs': len(self.active_repairs),
            'queued_repairs': len(self.repair_queue),
            'completed_repairs': len(self.completed_repairs),
            'available_nanobots': sum(1 for b in self.nanobots if not b.active),
            'material_levels': self.get_material_levels()
        }
