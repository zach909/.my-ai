"""
Artificial Organism - Core Integration

The main organism class that integrates all subsystems into one unified artificial cell.

This implements Stage 1 (artificial-cell architecture) and Stage 2 (small prototype organism).
All subsystems communicate through a common internal infrastructure.

Architecture:
    Food/material input → Energy + raw materials → Internal transport network
                                                      ↓
                    Brain ←→ Sensors ←→ Body-state model
                      ↓           ↓              ↓
                   Muscles    Repair      Internal conditions
"""

from typing import Dict, List, Optional
import time

from robotic_organism.systems.energy import EnergySystem, Material, MaterialType
from robotic_organism.systems.transport import TransportSystem
from robotic_organism.systems.repair import RepairSystem
from robotic_organism.systems.muscle import ArtificialMuscleSystem
from robotic_organism.systems.sensors import SensorArray
from robotic_organism.systems.neural import NeuralController


class ArtificialOrganism:
    """
    A complete artificial organism - one integrated artificial cell.
    
    All subsystems work together as parts of one unified organism:
    - Energy system: Obtain and distribute power
    - Transport system: Move materials internally
    - Repair system: Detect and fix damage
    - Muscle system: Enable movement
    - Sensor array: Perceive environment and body state
    - Neural controller: Process information and make decisions
    
    The organism maintains an internal model of itself and acts as one entity.
    """
    
    def __init__(self, name: str = "Organism"):
        self.name = name
        self.creation_time = time.time()
        self.alive = True
        
        # Initialize all subsystems
        self.energy_system = EnergySystem(storage_capacity=10000.0)
        self.transport_system = TransportSystem()
        self.repair_system = RepairSystem(nanobot_count=50)
        self.muscle_system = ArtificialMuscleSystem()
        self.sensor_array = SensorArray()
        self.neural_controller = NeuralController(neuron_count=1088)
        
        # System bus for inter-system communication
        self.system_bus: List[Dict] = []
        
        # State
        self.state = "initializing"
        self.age = 0.0  # Seconds since creation
        self.metabolic_rate = 1.0  # Multiplier for energy consumption
        
        # Statistics
        self.update_count = 0
        self.total_energy_consumed = 0.0
        self.repairs_performed = 0
        self.decisions_made = 0
        
        # Log startup
        self._log_system("INIT", f"{name} initializing...")
    
    def _log_system(self, category: str, message: str):
        """Log a system event."""
        self.system_bus.append({
            'timestamp': time.time(),
            'category': category,
            'message': message
        })
        
        # Keep log manageable
        if len(self.system_bus) > 100:
            self.system_bus = self.system_bus[-100:]
    
    def consume_material(self, material_name: str, material_type: str,
                        mass: float, energy_content: float):
        """
        Consume material for energy processing.
        
        Args:
            material_name: Name of the material
            material_type: Type (organic, inorganic, chemical, electrical)
            mass: Mass in grams
            energy_content: Energy per gram in joules
        """
        try:
            mtype = MaterialType(material_type)
        except ValueError:
            mtype = MaterialType.ORGANIC
        
        material = Material(
            name=material_name,
            material_type=mtype,
            energy_content=energy_content,
            mass=mass,
            processing_time=10.0  # seconds
        )
        
        # consume_material() buffers the intake; EnergySystem.update() drains
        # the buffer into processing_queue itself, so this shouldn't also
        # call start_processing() directly -- that queued the same material
        # a second time on top of the (already-redundant) buffered copy.
        self.energy_system.consume_material(material)

        self._log_system("METABOLISM", f"Consumed {material_name} ({mass}g)")
    
    def detect_damage(self, location: tuple, damage_type: str, severity: float):
        """Report damage to the organism."""
        # Report to the sensor array too -- the brain's own damage-sensor
        # readings (sensor_array.update()/get_status()'s "damage_reports"/
        # "recent_damage" counts) are separate bookkeeping from the repair
        # system's queue below, and only sensor_array.detect_damage() appends
        # to it. Without this call those counts stay permanently at 0
        # regardless of real damage, contradicting sensors.py's own "the
        # brain receives information about the entire body" docstring.
        self.sensor_array.detect_damage(location=location, severity=severity)

        # Report to repair system
        self.repair_system.detect_damage(
            location=location,
            damage_type=damage_type,
            severity=severity,
            size=0.01 * severity,
            depth=0.001 * severity
        )
        
        # Report to transport system for material routing
        self.transport_system.report_damage(
            x=location[0],
            y=location[1],
            z=location[2],
            damage_type=damage_type,
            severity=severity,
            timestamp=time.time()
        )
        
        # Update neural controller about damage
        self.neural_controller.drives['safety'] = min(
            1.0, 
            self.neural_controller.drives['safety'] + severity * 0.3
        )
        
        self._log_system("DAMAGE", f"{damage_type} at {location}, severity {severity}")
    
    def update(self, dt: float = 0.01) -> Dict:
        """
        Update the entire organism for one timestep.
        
        This is the main integration point where all systems are updated
        and coordinated.
        
        Args:
            dt: Time step in seconds
            
        Returns:
            Dictionary with organism status
        """
        if not self.alive:
            return {'status': 'dead', 'message': 'Organism is not alive'}
        
        self.age += dt
        self.update_count += 1
        
        # === SENSORY PHASE ===
        # Get sensory data from all sensors
        joint_angles = {
            j_id: j.current_angle 
            for j_id, j in self.muscle_system.joints.items()
        }
        muscle_activations = {
            b_id: b.average_position 
            for b_id, b in self.muscle_system.bundles.items()
        }
        
        sensory_data = self.sensor_array.update(
            dt=dt,
            joint_angles=joint_angles,
            muscle_activations=muscle_activations
        )
        
        # === NEURAL PHASE ===
        # Process sensory data and generate commands
        neural_output = self.neural_controller.update(dt, sensory_data)
        self.decisions_made = neural_output['statistics']['decisions']
        
        # === MOTOR PHASE ===
        # Execute motor commands
        for joint_id, activation in neural_output['commands']['motor'].items():
            if joint_id in self.muscle_system.joints:
                # Apply neural command to joint
                agonist = max(0, activation)
                antagonist = max(0, -activation)
                self.muscle_system.activate_joint(joint_id, agonist, antagonist)
        
        # Update muscle system
        muscle_output = self.muscle_system.update(dt)
        
        # === METABOLIC PHASE ===
        # Update energy system based on activity
        muscle_load = 1.0 + sum(
            b.total_force / 100.0 
            for b in self.muscle_system.bundles.values()
        )
        self.energy_system.set_consumer_load('muscles', muscle_load)
        
        energy_output = self.energy_system.update(dt)
        self.total_energy_consumed = self.energy_system.total_energy_consumed
        
        # Adjust metabolic rate based on activity
        if muscle_load > 1.5:
            self.metabolic_rate = min(2.0, self.metabolic_rate + 0.01)
        else:
            self.metabolic_rate = max(0.5, self.metabolic_rate - 0.005)
        
        # === TRANSPORT PHASE ===
        # Move materials through body
        transport_output = self.transport_system.update(dt)
        
        # === REPAIR PHASE ===
        # Check for and repair damage
        repair_output = self.repair_system.update(dt)
        self.repairs_performed = self.repair_system.total_repairs
        
        # If low on energy, reduce non-essential activity
        if energy_output['battery_level'] < 0.2:
            self._enter_power_save_mode()
            self._log_system("POWER", "Entering power save mode")
        
        # Update state
        if energy_output['battery_level'] < 0.05:
            self.state = "critical"
        elif repair_output['active_repairs'] > 0:
            self.state = "repairing"
        elif neural_output['high_level']['goals']:
            self.state = "active"
        else:
            self.state = "normal"
        
        return {
            'status': self.state,
            'age': self.age,
            'energy': {
                'battery_level': energy_output['battery_level'],
                'available_joules': energy_output['battery_available'],
                'processing': energy_output.get('processing')
            },
            'neural': {
                'state': 'processing',
                'goals': neural_output['high_level']['goals'],
                'decisions': self.decisions_made,
                'drives': neural_output['fast_control']['drives']
            },
            'muscles': {
                'joints': len(muscle_output['joints']),
                'active_patterns': muscle_output['active_patterns']
            },
            'sensors': {
                'reads': sensory_data['statistics']['total_reads']
            },
            'repair': {
                'active': repair_output['active_repairs'],
                'completed': self.repairs_performed
            },
            'transport': {
                'damage_sites': transport_output['active_damage'],
                'routes_active': transport_output['active_routes']
            }
        }
    
    def _enter_power_save_mode(self):
        """Reduce power consumption in critical state."""
        # Reduce non-essential systems
        self.energy_system.set_consumer_activity('manufacturing', False)
        self.energy_system.set_consumer_load('muscles', 0.5)
        
        # Reduce neural activity
        self.neural_controller.drives['curiosity'] = 0.1
        self.neural_controller.drives['rest'] = 0.9
    
    def get_status(self) -> Dict:
        """Get comprehensive status of the organism."""
        return {
            'identity': {
                'name': self.name,
                'age_seconds': self.age,
                'state': self.state,
                'alive': self.alive,
                'update_count': self.update_count
            },
            'energy': self.energy_system.get_status(),
            'transport': self.transport_system.get_status(),
            'repair': self.repair_system.get_status(),
            'muscles': self.muscle_system.get_status(),
            'sensors': self.sensor_array.get_status(),
            'neural': self.neural_controller.get_status(),
            'system_bus': self.system_bus[-10:],  # Last 10 events
            'statistics': {
                'total_energy_consumed': self.total_energy_consumed,
                'repairs_performed': self.repairs_performed,
                'decisions_made': self.decisions_made,
                'metabolic_rate': self.metabolic_rate
            }
        }
    
    def run_simulation(self, duration: float = 10.0, dt: float = 0.1,
                       verbose: bool = True) -> List[Dict]:
        """
        Run a simulation of the organism for a specified duration.
        
        Args:
            duration: Simulation duration in seconds
            dt: Time step in seconds
            verbose: Print progress updates
            
        Returns:
            List of status snapshots
        """
        snapshots = []
        
        if verbose:
            print(f"\n{'='*60}")
            print(f"Starting simulation: {self.name}")
            print(f"Duration: {duration}s, Step: {dt}s")
            print(f"{'='*60}\n")
        
        # Start with some energy
        self.consume_material(
            material_name="nutrient_pack",
            material_type="organic",
            mass=100.0,
            energy_content=500.0  # J/g
        )
        
        steps = int(duration / dt)
        for i in range(steps):
            status = self.update(dt)
            
            if i % 10 == 0 and verbose:
                print(f"t={i*dt:5.1f}s | State: {status['status']:10s} | "
                      f"Battery: {status['energy']['battery_level']*100:5.1f}% | "
                      f"Goals: {status['neural']['goals']} | "
                      f"Repairs: {status['repair']['active']}")
            
            snapshots.append(status)
        
        if verbose:
            print(f"\n{'='*60}")
            print(f"Simulation complete")
            print(f"Final state: {self.state}")
            print(f"Total updates: {self.update_count}")
            print(f"Energy consumed: {self.total_energy_consumed:.1f} J")
            print(f"Repairs performed: {self.repairs_performed}")
            print(f"{'='*60}\n")
        
        return snapshots


__all__ = ['ArtificialOrganism']
