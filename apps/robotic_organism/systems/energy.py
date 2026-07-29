"""
Energy System - Stage 3 of development

Separates energy acquisition from energy distribution.

Input material → Processing → Energy extraction → Energy storage → Power distribution

Supports multiple input materials with different energy yields.
Distributes power to: Muscles, Brain, Sensors, Repair systems.
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, List, Optional
import time


class MaterialType(Enum):
    """Types of consumable materials for energy processing."""
    ORGANIC = "organic"
    INORGANIC = "inorganic"
    CHEMICAL = "chemical"
    ELECTRICAL = "electrical"


@dataclass
class Material:
    """A material that can be processed for energy."""
    name: str
    material_type: MaterialType
    energy_content: float  # Joules per gram
    mass: float  # grams
    processing_time: float  # seconds to process
    
    def __post_init__(self):
        if self.mass <= 0:
            raise ValueError("Material mass must be positive")
        if self.energy_content < 0:
            raise ValueError("Energy content cannot be negative")


@dataclass
class EnergyStore:
    """Internal energy storage (battery/capacitor equivalent)."""
    capacity: float  # Maximum joules
    current: float = 0.0  # Current stored joules
    charge_rate: float = 100.0  # Max joules/second charging
    discharge_rate: float = 200.0  # Max joules/second discharging
    efficiency: float = 0.95  # Charge/discharge efficiency
    
    @property
    def level(self) -> float:
        """Current charge level as percentage."""
        return self.current / self.capacity if self.capacity > 0 else 0.0
    
    @property
    def available(self) -> float:
        """Available energy in joules."""
        return self.current
    
    def charge(self, joules: float, dt: float = 1.0) -> float:
        """
        Add energy to storage. Returns actual energy stored.
        """
        max_charge = self.charge_rate * dt * self.efficiency
        actual = min(joules, max_charge, self.capacity - self.current)
        self.current = min(self.current + actual, self.capacity)
        return actual
    
    def discharge(self, joules: float, dt: float = 1.0) -> float:
        """
        Remove energy from storage. Returns actual energy delivered.
        """
        max_discharge = self.discharge_rate * dt
        actual = min(joules, max_discharge, self.current)
        self.current = max(self.current - actual, 0.0)
        return actual


@dataclass
class PowerConsumer:
    """A subsystem that consumes power."""
    name: str
    priority: int  # Lower = higher priority (1=critical, 5=optional)
    base_consumption: float  # Watts (joules/second)
    current_consumption: float = 0.0
    active: bool = True
    
    def request_power(self, dt: float = 1.0) -> float:
        """Request power for one timestep."""
        if not self.active:
            return 0.0
        return self.current_consumption * dt


class EnergySystem:
    """
    Complete energy system for the artificial organism.
    
    Handles:
    - Material intake and processing
    - Energy extraction and conversion
    - Energy storage
    - Priority-based power distribution
    """
    
    def __init__(self, storage_capacity: float = 10000.0):
        # Material processing
        self.material_buffer: List[Material] = []
        self.processing_queue: List[Material] = []
        self.currently_processing: Optional[Material] = None
        self.process_progress: float = 0.0
        
        # Energy storage
        self.battery = EnergyStore(capacity=storage_capacity)
        
        # Power consumers (subsystems)
        self.consumers: Dict[str, PowerConsumer] = {}
        
        # Statistics
        self.total_energy_processed = 0.0
        self.total_energy_consumed = 0.0
        self.waste_heat = 0.0
        
        # Default consumers
        self.register_consumer("neural", priority=1, base_consumption=5.0)
        self.register_consumer("sensors", priority=2, base_consumption=3.0)
        self.register_consumer("repair", priority=2, base_consumption=10.0)
        self.register_consumer("muscles", priority=3, base_consumption=20.0)
        self.register_consumer("transport", priority=3, base_consumption=5.0)
        self.register_consumer("manufacturing", priority=4, base_consumption=50.0)
    
    def register_consumer(self, name: str, priority: int, base_consumption: float):
        """Register a power-consuming subsystem."""
        self.consumers[name] = PowerConsumer(
            name=name,
            priority=priority,
            base_consumption=base_consumption,
            current_consumption=base_consumption
        )
    
    def set_consumer_activity(self, name: str, active: bool):
        """Activate or deactivate a consumer."""
        if name in self.consumers:
            self.consumers[name].active = active
            if not active:
                self.consumers[name].current_consumption = 0.0
            else:
                self.consumers[name].current_consumption = self.consumers[name].base_consumption
    
    def set_consumer_load(self, name: str, load_factor: float):
        """Set consumer load as factor of base consumption (0.0 to 2.0)."""
        if name in self.consumers:
            consumer = self.consumers[name]
            consumer.current_consumption = consumer.base_consumption * load_factor
    
    def consume_material(self, material: Material):
        """Add material to the intake buffer."""
        self.material_buffer.append(material)
    
    def start_processing(self, material: Material):
        """Begin processing a material for energy extraction."""
        self.processing_queue.append(material)
    
    def update(self, dt: float = 1.0) -> Dict:
        """
        Update energy system for one timestep.
        
        Returns status dictionary.
        """
        status = {
            'battery_level': self.battery.level,
            'battery_available': self.battery.available,
            'processing': None,
            'power_distribution': {},
            'warnings': []
        }

        # material_buffer otherwise grows forever: consume_material() only
        # ever appended to it, with nothing anywhere ever draining or
        # capping it. Move intake into the queue that actually processes it.
        if self.material_buffer:
            self.processing_queue.extend(self.material_buffer)
            self.material_buffer.clear()

        # Process material (energy acquisition)
        if self.currently_processing is None and self.processing_queue:
            self.currently_processing = self.processing_queue.pop(0)
            self.process_progress = 0.0
        
        if self.currently_processing:
            self.process_progress += dt / self.currently_processing.processing_time
            
            if self.process_progress >= 1.0:
                # Processing complete - extract energy
                energy_extracted = (
                    self.currently_processing.energy_content * 
                    self.currently_processing.mass * 
                    0.8  # 80% conversion efficiency
                )
                stored = self.battery.charge(energy_extracted, dt)
                self.total_energy_processed += energy_extracted
                self.waste_heat += energy_extracted - stored
                
                status['processing'] = {
                    'material': self.currently_processing.name,
                    'complete': True,
                    'energy_extracted': energy_extracted,
                    'energy_stored': stored
                }
                
                self.currently_processing = None
                self.process_progress = 0.0
            else:
                status['processing'] = {
                    'material': self.currently_processing.name,
                    'progress': self.process_progress,
                    'complete': False
                }
        
        # Distribute power (energy distribution)
        # Sort consumers by priority
        sorted_consumers = sorted(
            [c for c in self.consumers.values() if c.active],
            key=lambda c: c.priority
        )
        
        total_requested = sum(c.current_consumption * dt for c in sorted_consumers)
        
        for consumer in sorted_consumers:
            requested = consumer.current_consumption * dt
            available = self.battery.available
            
            if available >= requested:
                # Full power
                delivered = self.battery.discharge(requested, dt)
                self.total_energy_consumed += delivered
                status['power_distribution'][consumer.name] = {
                    'requested': requested,
                    'delivered': delivered,
                    'fraction': 1.0
                }
            elif available > 0:
                # Partial power - critical consumers get priority
                delivered = self.battery.discharge(available, dt)
                self.total_energy_consumed += delivered
                fraction = delivered / requested if requested > 0 else 0.0
                status['power_distribution'][consumer.name] = {
                    'requested': requested,
                    'delivered': delivered,
                    'fraction': fraction
                }
                
                if consumer.priority <= 2:
                    status['warnings'].append(
                        f"Low power: {consumer.name} receiving {fraction:.1%}"
                    )
            else:
                # No power available
                status['power_distribution'][consumer.name] = {
                    'requested': requested,
                    'delivered': 0.0,
                    'fraction': 0.0
                }
                if consumer.priority == 1:
                    status['warnings'].append(
                        f"CRITICAL: {consumer.name} has no power!"
                    )
        
        return status
    
    def get_status(self) -> Dict:
        """Get detailed status of the energy system."""
        return {
            'battery': {
                'level': self.battery.level,
                'capacity': self.battery.capacity,
                'available': self.battery.available,
                'charge_rate': self.battery.charge_rate,
                'discharge_rate': self.battery.discharge_rate
            },
            'processing': {
                'buffer_count': len(self.material_buffer),
                'queue_count': len(self.processing_queue),
                'current': self.currently_processing.name if self.currently_processing else None,
                'progress': self.process_progress
            },
            'consumers': {
                name: {
                    'priority': c.priority,
                    'consumption': c.current_consumption,
                    'active': c.active
                }
                for name, c in self.consumers.items()
            },
            'statistics': {
                'total_processed': self.total_energy_processed,
                'total_consumed': self.total_energy_consumed,
                'waste_heat': self.waste_heat
            }
        }
