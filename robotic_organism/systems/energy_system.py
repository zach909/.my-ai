"""
Energy System - Obtains, converts, and distributes energy throughout the organism.

The energy system processes consumed materials to extract usable energy,
converts it to electrical power, and stores it for later use.
"""

from typing import Dict, List, Optional, Any
from enum import Enum
from dataclasses import dataclass, field


class MaterialType(Enum):
    """Types of consumable materials"""
    ORGANIC = "organic"
    INORGANIC = "inorganic"
    WATER = "water"
    HYDROCARBON = "hydrocarbon"
    METAL = "metal"
    POLYMER = "polymer"
    MIXED = "mixed"


@dataclass
class EnergyStore:
    """Represents an energy storage unit"""
    id: str
    capacity: float  # Maximum energy in joules
    current_level: float = 0.0
    charge_rate: float = 0.0  # Joules per second
    discharge_rate: float = 0.0
    efficiency: float = 0.95  # Energy retention efficiency
    
    def charge(self, amount: float, delta_time: float) -> float:
        """Add energy to storage, return overflow"""
        actual_charge = amount * self.efficiency * delta_time
        overflow = 0.0
        if self.current_level + actual_charge > self.capacity:
            overflow = (self.current_level + actual_charge) - self.capacity
            self.current_level = self.capacity
        else:
            self.current_level += actual_charge
        return overflow
        
    def discharge(self, amount: float, delta_time: float) -> float:
        """Remove energy from storage, return actual amount provided"""
        available = self.current_level
        requested = amount * delta_time
        if requested <= available:
            self.current_level -= requested
            return requested / delta_time if delta_time > 0 else 0
        else:
            self.current_level = 0
            return available / delta_time if delta_time > 0 else 0
            
    def get_percentage(self) -> float:
        return (self.current_level / self.capacity) * 100.0 if self.capacity > 0 else 0.0


class EnergyConverter:
    """
    Converts consumed materials into electrical energy.
    Different converter types handle different material types.
    """
    
    def __init__(self, converter_type: str, efficiency: float = 0.7):
        self.converter_type = converter_type
        self.efficiency = efficiency
        self.active = False
        self.processing_material: Optional[MaterialType] = None
        self.process_progress: float = 0.0
        self.conversion_rate: float = 100.0  # Units per second
        
    def start_processing(self, material_type: MaterialType):
        """Begin processing a material type"""
        self.processing_material = material_type
        self.active = True
        self.process_progress = 0.0
        
    def update(self, delta_time: float) -> float:
        """
        Process material and return energy generated.
        Returns energy in joules.
        """
        if not self.active or self.processing_material is None:
            return 0.0
            
        self.process_progress += self.conversion_rate * delta_time
        
        # Energy yield depends on material type
        energy_yields = {
            MaterialType.ORGANIC: 500.0,
            MaterialType.INORGANIC: 200.0,
            MaterialType.WATER: 50.0,
            MaterialType.HYDROCARBON: 800.0,
            MaterialType.METAL: 300.0,
            MaterialType.POLYMER: 600.0,
            MaterialType.MIXED: 400.0
        }
        
        base_yield = energy_yields.get(self.processing_material, 100.0)
        energy_generated = base_yield * self.efficiency * delta_time
        
        # Complete processing cycle
        if self.process_progress >= 100.0:
            self.process_progress = 0.0
            # Could trigger material consumption here
            
        return energy_generated
        
    def stop_processing(self):
        """Stop current processing"""
        self.active = False
        self.processing_material = None
        self.process_progress = 0.0


class EnergySystem:
    """
    Main energy management system for the artificial organism.
    
    Coordinates material processing, energy conversion, storage,
    and distribution to all other systems.
    """
    
    def __init__(self, organism):
        self.organism = organism
        self.converters: List[EnergyConverter] = []
        self.stores: List[EnergyStore] = []
        self.pending_materials: Dict[MaterialType, float] = {}
        self.distribution_priority: Dict[str, float] = {}
        self.total_energy_generated: float = 0.0
        self.total_energy_consumed: float = 0.0
        
        # Initialize default converters and stores
        self._initialize_default_components()
        
    def _initialize_default_components(self):
        """Set up initial energy infrastructure"""
        # Primary chemical converter for organic materials
        self.converters.append(EnergyConverter("chemical_primary", 0.75))
        
        # Secondary converter for inorganic/metallic materials
        self.converters.append(EnergyConverter("electrochemical_secondary", 0.65))
        
        # Water processing unit
        self.converters.append(EnergyConverter("water_processor", 0.55))
        
        # Main energy stores (like mitochondria)
        primary_store = EnergyStore(
            id="primary_energy_reservoir",
            capacity=100000.0,  # 100 kJ
            current_level=80000.0
        )
        self.stores.append(primary_store)
        
        # Backup store
        backup_store = EnergyStore(
            id="backup_reservoir",
            capacity=50000.0,
            current_level=40000.0,
            efficiency=0.98
        )
        self.stores.append(backup_store)
        
        # Set distribution priorities
        self.distribution_priority = {
            'neural': 1.0,      # Highest priority - brain function
            'sensory': 0.9,     # High priority - sensing
            'muscular': 0.8,    # Movement
            'repair': 0.85,     # Repair when needed
            'manufacturing': 0.6,
            'reproductive': 0.5,
            'transport': 0.7
        }
        
    def process_material(self, material_type_str: str, amount: float) -> bool:
        """
        Accept and begin processing external material.
        
        Args:
            material_type_str: String name of material type
            amount: Quantity of material in arbitrary units
            
        Returns:
            True if material accepted, False otherwise
        """
        try:
            material_type = MaterialType(material_type_str.lower())
        except ValueError:
            material_type = MaterialType.MIXED
            
        self.pending_materials[material_type] = \
            self.pending_materials.get(material_type, 0.0) + amount
        return True
        
    def update(self, delta_time: float):
        """Update energy system state"""
        total_generated = 0.0
        
        # Process pending materials through available converters
        for converter in self.converters:
            if not converter.active and self.pending_materials:
                # Find best matching material for this converter
                for material_type, amount in self.pending_materials.items():
                    if amount > 0:
                        converter.start_processing(material_type)
                        break
                        
            if converter.active:
                energy = converter.update(delta_time)
                total_generated += energy
                
                # Consume material based on energy produced
                if converter.processing_material:
                    consumption_rate = 0.1  # Units per joule
                    consumed = energy * consumption_rate * delta_time
                    mat = converter.processing_material
                    if mat in self.pending_materials:
                        self.pending_materials[mat] = max(0, 
                            self.pending_materials[mat] - consumed)
                        
        self.total_energy_generated += total_generated
        
        # Store generated energy
        if total_generated > 0:
            for store in self.stores:
                overflow = store.charge(total_generated / len(self.stores), delta_time)
                if overflow > 0 and store != self.stores[-1]:
                    # Pass overflow to next store
                    pass
                    
        # Distribute energy to systems based on priority
        self._distribute_energy(delta_time)
        
    def _distribute_energy(self, delta_time: float):
        """Distribute stored energy to organism systems"""
        # Calculate total power demand from all systems
        demands = {
            'neural': 50.0,      # Base neural processing
            'sensory': 30.0,
            'muscular': 100.0,   # Variable based on activity
            'repair': 20.0,
            'manufacturing': 80.0,
            'reproductive': 40.0,
            'transport': 25.0
        }
        
        # Adjust demands based on current activity
        if hasattr(self.organism, 'neural_system') and self.organism.neural_system:
            neural_activity = self.organism.neural_system.get_activity_level()
            demands['neural'] *= (0.5 + neural_activity)
            
        # Total weighted demand
        total_weighted_demand = sum(
            demands[system] * self.distribution_priority.get(system, 0.5)
            for system in demands
        )
        
        # Allocate energy from stores
        for store in self.stores:
            allocation = store.discharge(total_weighted_demand, delta_time)
            self.total_energy_consumed += allocation * delta_time
            
    def get_energy_level(self) -> float:
        """Get current total energy level as percentage"""
        if not self.stores:
            return 0.0
        total_capacity = sum(s.capacity for s in self.stores)
        total_current = sum(s.current_level for s in self.stores)
        return (total_current / total_capacity) * 100.0 if total_capacity > 0 else 0.0
        
    def get_available_power(self) -> float:
        """Get current available power output in watts"""
        return sum(s.current_level for s in self.stores) * 0.1  # Simplified
        
    def request_energy(self, system_name: str, amount: float, 
                       delta_time: float) -> float:
        """
        Request energy for a specific system.
        
        Returns actual energy provided.
        """
        priority = self.distribution_priority.get(system_name, 0.3)
        requested = amount * priority * delta_time
        
        provided = 0.0
        for store in self.stores:
            if store.current_level >= requested - provided:
                provided += store.discharge(requested - provided, delta_time) * delta_time
            else:
                provided += store.current_level
                store.current_level = 0
                
        return provided
        
    def add_storage(self, capacity: float) -> str:
        """Add new energy storage unit"""
        store_id = f"energy_store_{len(self.stores)}"
        new_store = EnergyStore(id=store_id, capacity=capacity)
        self.stores.append(new_store)
        return store_id
        
    def get_status(self) -> Dict[str, Any]:
        """Get detailed energy system status"""
        return {
            'total_energy_level': self.get_energy_level(),
            'available_power': self.get_available_power(),
            'pending_materials': {k.value: v for k, v in self.pending_materials.items()},
            'active_converters': sum(1 for c in self.converters if c.active),
            'total_stores': len(self.stores),
            'generated_total': self.total_energy_generated,
            'consumed_total': self.total_energy_consumed
        }
