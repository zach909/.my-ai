"""
Artificial Organism Simulation Framework
Stage 1: Software Organism - Core System Simulation

This module provides the foundation for simulating all subsystems
of the artificial organism before physical implementation.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from enum import Enum
import time


class DamageType(Enum):
    """Classification of damage types for repair system"""
    SMALL_PUNCTURE = "small_puncture"
    TORN_FLEXIBLE = "torn_flexible"
    BROKEN_STRUCTURAL = "broken_structural"
    DAMAGED_ELECTRICAL = "damaged_electrical"
    DAMAGED_SENSOR = "damaged_sensor"


class EnergyType(Enum):
    """Types of energy in the system"""
    ELECTRICAL = "electrical"
    CHEMICAL = "chemical"
    STORED = "stored"


@dataclass
class EnergyState:
    """Tracks energy acquisition, storage, and distribution"""
    input_rate: float = 0.0  # Energy input per second
    conversion_efficiency: float = 0.85  # 85% default efficiency
    storage_capacity: float = 1000.0  # Maximum storage
    current_storage: float = 500.0  # Current energy level
    distribution_latency: float = 0.01  # Seconds to distribute power
    
    def extract_energy(self, input_material: float) -> float:
        """Extract energy from input material"""
        extracted = input_material * self.conversion_efficiency
        self.current_storage = min(
            self.current_storage + extracted,
            self.storage_capacity
        )
        return extracted
    
    def consume_energy(self, amount: float) -> bool:
        """Consume energy for operations"""
        if self.current_storage >= amount:
            self.current_storage -= amount
            return True
        return False
    
    def get_status(self) -> Dict:
        """Return current energy status"""
        return {
            "storage_level": self.current_storage,
            "capacity": self.storage_capacity,
            "fill_percentage": (self.current_storage / self.storage_capacity) * 100,
            "input_rate": self.input_rate,
            "efficiency": self.conversion_efficiency
        }


@dataclass
class MuscleUnit:
    """Single artificial muscle unit with feedback"""
    id: str
    max_force: float = 100.0  # Newtons
    current_length: float = 1.0  # Normalized length
    target_length: float = 1.0
    contraction_speed: float = 0.5  # Length units per second
    position_sensor: float = 1.0
    resistance_sensor: float = 0.0
    is_contracting: bool = False
    
    def contract(self, target: float) -> None:
        """Initiate contraction to target length"""
        self.target_length = max(0.0, min(1.0, target))
        self.is_contracting = True
    
    def relax(self) -> None:
        """Relax muscle to resting state"""
        self.target_length = 1.0
        self.is_contracting = False
    
    def update(self, dt: float) -> None:
        """Update muscle state based on contraction"""
        if self.is_contracting:
            direction = -1 if self.target_length < self.current_length else 1
            change = direction * self.contraction_speed * dt
            self.current_length += change
            
            # Check if reached target
            if abs(self.current_length - self.target_length) < 0.01:
                self.current_length = self.target_length
                self.is_contracting = False
        
        # Update sensors
        self.position_sensor = self.current_length
        self.resistance_sensor = abs(self.target_length - self.current_length)
    
    def get_feedback(self) -> Dict:
        """Return sensor feedback"""
        return {
            "id": self.id,
            "position": self.position_sensor,
            "resistance": self.resistance_sensor,
            "is_active": self.is_contracting
        }


@dataclass
class TransportChannel:
    """Multi-fluid transport channel"""
    id: str
    fluid_type: str  # energy_fluid, repair_material, structural_material, waste
    flow_rate: float = 0.0  # Current flow rate
    pressure: float = 1.0  # Internal pressure
    blockage: float = 0.0  # 0 = clear, 1 = fully blocked
    
    def route_material(self, amount: float) -> bool:
        """Route material through channel"""
        if self.blockage < 1.0:
            effective_flow = amount * (1.0 - self.blockage)
            self.flow_rate = effective_flow
            return True
        return False
    
    def detect_blockage(self) -> float:
        """Detect level of blockage"""
        return self.blockage


@dataclass
class DamageReport:
    """Report of detected damage"""
    location: Tuple[float, float, float]  # 3D coordinates
    damage_type: DamageType
    severity: float  # 0.0 to 1.0
    timestamp: float = field(default_factory=time.time)
    repaired: bool = False


class RepairSystem:
    """Self-repair capability manager"""
    
    def __init__(self):
        self.repair_reservoir: float = 100.0  # Available repair material
        self.damage_reports: List[DamageReport] = []
        self.repair_queue: List[DamageReport] = []
        
        # Capability levels (0-5)
        self.capability_level = 0
        self.capabilities = {
            1: "seal_damage",
            2: "patch_damage", 
            3: "reinforce_damage",
            4: "replace_component",
            5: "manufacture_replacement"
        }
    
    def report_damage(self, location: Tuple[float, float, float], 
                     damage_type: DamageType, severity: float) -> None:
        """Register new damage"""
        report = DamageReport(location, damage_type, severity)
        self.damage_reports.append(report)
        self.repair_queue.append(report)
    
    def prioritize_repairs(self) -> None:
        """Sort repair queue by severity"""
        self.repair_queue.sort(key=lambda x: x.severity, reverse=True)
    
    def execute_repair(self, dt: float) -> Optional[DamageReport]:
        """Execute repair on highest priority damage"""
        if not self.repair_queue or self.repair_reservoir <= 0:
            return None
        
        # Check capability level
        if self.capability_level == 0:
            return None
        
        damage = self.repair_queue[0]
        material_needed = damage.severity * 10.0  # Simplified calculation
        
        if self.repair_reservoir >= material_needed:
            self.repair_reservoir -= material_needed
            damage.repaired = True
            self.repair_queue.pop(0)
            return damage
        
        return None
    
    def get_status(self) -> Dict:
        """Return repair system status"""
        return {
            "reservoir_level": self.repair_reservoir,
            "pending_repairs": len(self.repair_queue),
            "total_damage_reports": len(self.damage_reports),
            "capability_level": self.capability_level,
            "current_capability": self.capabilities.get(self.capability_level, "none")
        }


class NeuralControlLayer:
    """Fast biological-like control layer"""
    
    def __init__(self):
        self.reflexes_active = True
        self.balance_state = 0.0
        self.temperature = 37.0  # Celsius
        self.muscle_coordination: Dict[str, float] = {}
    
    def process_reflex(self, stimulus: str, intensity: float) -> Dict:
        """Process reflexive response"""
        if not self.reflexes_active:
            return {}
        
        # Simplified reflex mapping
        reflex_map = {
            "pain": "withdraw",
            "loss_of_balance": "stabilize",
            "excessive_heat": "cool",
            "excessive_cold": "warm"
        }
        
        response = reflex_map.get(stimulus, "monitor")
        return {"reflex": response, "intensity": intensity}
    
    def update_body_state(self, sensor_data: Dict) -> None:
        """Update internal body model"""
        if "balance" in sensor_data:
            self.balance_state = sensor_data["balance"]
        if "temperature" in sensor_data:
            self.temperature = sensor_data["temperature"]
        if "muscle_positions" in sensor_data:
            self.muscle_coordination = sensor_data["muscle_positions"]


class HighLevelAI:
    """High-level reasoning and planning layer"""
    
    def __init__(self):
        self.goals: List[str] = []
        self.current_plan: List[str] = []
        self.memory: List[Dict] = []
        self.learning_rate = 0.1
    
    def add_goal(self, goal: str) -> None:
        """Add new goal"""
        self.goals.append(goal)
    
    def create_plan(self, goal: str) -> List[str]:
        """Create plan to achieve goal"""
        # Simplified planning logic
        plan = [
            f"Assess current state for: {goal}",
            "Identify required resources",
            "Execute actions",
            "Monitor progress",
            f"Achieve: {goal}"
        ]
        self.current_plan = plan
        return plan
    
    def learn_from_experience(self, experience: Dict) -> None:
        """Store and learn from experience"""
        self.memory.append(experience)
        # Keep memory bounded
        if len(self.memory) > 1000:
            self.memory = self.memory[-500:]


class ArtificialOrganismSimulator:
    """Main simulator integrating all systems"""
    
    def __init__(self):
        # Initialize subsystems
        self.energy_system = EnergyState()
        self.muscles: Dict[str, MuscleUnit] = {}
        self.transport_channels: Dict[str, TransportChannel] = {}
        self.repair_system = RepairSystem()
        self.fast_control = NeuralControlLayer()
        self.high_level_ai = HighLevelAI()
        
        # Simulation state
        self.simulation_time = 0.0
        self.is_running = False
        
        # Initialize default components
        self._initialize_default_components()
    
    def _initialize_default_components(self):
        """Set up initial organism components"""
        # Add some default muscles
        for i in range(4):
            muscle_id = f"muscle_{i}"
            self.muscles[muscle_id] = MuscleUnit(id=muscle_id)
        
        # Add transport channels
        channel_types = ["energy_fluid", "repair_material", 
                        "structural_material", "waste"]
        for i, fluid_type in enumerate(channel_types):
            channel_id = f"channel_{i}"
            self.transport_channels[channel_id] = TransportChannel(
                id=channel_id, fluid_type=fluid_type
            )
    
    def add_muscle(self, muscle_id: str, max_force: float = 100.0) -> None:
        """Add new muscle unit"""
        self.muscles[muscle_id] = MuscleUnit(id=muscle_id, max_force=max_force)
    
    def simulate_step(self, dt: float = 0.01) -> Dict:
        """Run one simulation step"""
        self.simulation_time += dt
        
        # Update all muscles
        muscle_states = {}
        for muscle_id, muscle in self.muscles.items():
            muscle.update(dt)
            muscle_states[muscle_id] = muscle.get_feedback()
        
        # Process any pending repairs
        repaired = self.repair_system.execute_repair(dt)
        
        # Gather system states
        state = {
            "time": self.simulation_time,
            "energy": self.energy_system.get_status(),
            "muscles": muscle_states,
            "repair": self.repair_system.get_status(),
            "repaired_damage": repaired is not None
        }
        
        return state
    
    def receive_sensory_input(self, sensor_data: Dict) -> None:
        """Process sensory input from environment"""
        # Fast control layer processes first
        if "stimulus" in sensor_data:
            reflex = self.fast_control.process_reflex(
                sensor_data["stimulus"],
                sensor_data.get("intensity", 1.0)
            )
        
        # Update body state model
        self.fast_control.update_body_state(sensor_data)
        
        # High-level AI can process complex inputs
        if "event" in sensor_data:
            self.high_level_ai.learn_from_experience(sensor_data)
    
    def command_muscle(self, muscle_id: str, target_length: float) -> bool:
        """Command specific muscle to contract/relax"""
        if muscle_id in self.muscles:
            if target_length < 1.0:
                self.muscles[muscle_id].contract(target_length)
            else:
                self.muscles[muscle_id].relax()
            return True
        return False
    
    def report_damage(self, location: Tuple[float, float, float],
                     damage_type: DamageType, severity: float) -> None:
        """Report damage to repair system"""
        self.repair_system.report_damage(location, damage_type, severity)
    
    def set_goal(self, goal: str) -> List[str]:
        """Set high-level goal and get plan"""
        self.high_level_ai.add_goal(goal)
        return self.high_level_ai.create_plan(goal)
    
    def get_full_status(self) -> Dict:
        """Get complete organism status"""
        return {
            "simulation_time": self.simulation_time,
            "energy": self.energy_system.get_status(),
            "repair": self.repair_system.get_status(),
            "muscle_count": len(self.muscles),
            "channel_count": len(self.transport_channels),
            "ai_goals": len(self.high_level_ai.goals),
            "ai_memory_size": len(self.high_level_ai.memory)
        }


def run_simulation_demo():
    """Demonstrate basic simulation capabilities"""
    print("=" * 60)
    print("ARTIFICIAL ORGANISM SIMULATION - STAGE 1 DEMO")
    print("=" * 60)
    
    # Create simulator
    organism = ArtificialOrganismSimulator()
    
    print("\n[INIT] Organism initialized with default components")
    print(f"  - Muscles: {len(organism.muscles)}")
    print(f"  - Transport channels: {len(organism.transport_channels)}")
    
    # Set a goal
    print("\n[GOAL] Setting objective: 'Maintain energy levels'")
    plan = organism.set_goal("Maintain energy levels")
    print("  Plan:")
    for step in plan:
        print(f"    - {step}")
    
    # Simulate energy extraction
    print("\n[ENERGY] Extracting energy from input material...")
    organism.energy_system.extract_energy(100.0)
    print(f"  Status: {organism.energy_system.get_status()}")
    
    # Command muscles
    print("\n[MUSCLES] Testing muscle contraction...")
    organism.command_muscle("muscle_0", 0.5)
    organism.command_muscle("muscle_1", 0.7)
    
    # Run simulation steps
    print("\n[SIMULATION] Running 10 simulation steps...")
    for i in range(10):
        state = organism.simulate_step(dt=0.1)
        if i == 9:  # Print last state
            print(f"  Time: {state['time']:.2f}s")
            print(f"  Energy: {state['energy']['fill_percentage']:.1f}%")
            print(f"  Active muscles: {sum(1 for m in state['muscles'].values() if m['is_active'])}")
    
    # Simulate damage and repair
    print("\n[DAMAGE] Simulating damage event...")
    organism.report_damage(
        location=(1.0, 2.0, 0.5),
        damage_type=DamageType.SMALL_PUNCTURE,
        severity=0.3
    )
    print(f"  Repair queue: {organism.repair_system.get_status()['pending_repairs']} pending")
    
    # Increase repair capability
    organism.repair_system.capability_level = 2
    print("\n[REPAIR] Executing repair...")
    for i in range(5):
        organism.simulate_step(dt=0.5)
    
    status = organism.repair_system.get_status()
    print(f"  Pending repairs: {status['pending_repairs']}")
    print(f"  Capability: {status['current_capability']}")
    
    # Final status
    print("\n[STATUS] Final organism state:")
    final_status = organism.get_full_status()
    for key, value in final_status.items():
        print(f"  {key}: {value}")
    
    print("\n" + "=" * 60)
    print("SIMULATION COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    run_simulation_demo()
