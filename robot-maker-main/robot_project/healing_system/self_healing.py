"""
Self-Healing System for Bio-Robots
Uses a glue-like substance that flows through all parts and binds on contact
"""

import numpy as np
from typing import Dict, List, Optional
from dataclasses import dataclass
from enum import Enum


class HealingState(Enum):
    """States of the healing process"""
    INTACT = "intact"
    DAMAGED = "damaged"
    HEALING = "healing"
    REPAIRED = "repaired"


@dataclass
class DamageReport:
    """Represents damage to a robot component"""
    component_id: str
    component_type: str  # bone, muscle, organ
    damage_severity: float  # 0.0 to 1.0
    location: tuple
    timestamp: float


@dataclass
class GlueParticle:
    """Represents a particle of the self-healing glue"""
    position: np.ndarray
    velocity: np.ndarray
    active: bool
    binding_strength: float


class SelfHealingGlue:
    """
    Self-healing glue system that flows through the robot body
    and repairs damage by binding components together
    """
    
    def __init__(self, total_volume: float = 1000.0):
        """
        Initialize the self-healing glue system
        
        Args:
            total_volume: Total volume of glue in the system (ml)
        """
        self.total_volume = total_volume
        self.current_volume = total_volume
        self.particles: List[GlueParticle] = []
        self.flow_rate = 0.5  # ml per second
        self.binding_efficiency = 0.95  # 95% effective binding
        self.active = True
        
    def distribute_glue(self, anatomy_map: Dict) -> None:
        """
        Distribute glue particles throughout the robot body
        
        Args:
            anatomy_map: Dictionary mapping component IDs to positions
        """
        self.particles = []
        num_particles = int(self.total_volume / 10)  # 10ml per particle
        
        for i in range(num_particles):
            # Random initial distribution
            position = np.random.rand(3) * 100  # Assume 100x100x100 cm body
            velocity = np.random.randn(3) * 0.1
            particle = GlueParticle(
                position=position,
                velocity=velocity,
                active=True,
                binding_strength=1.0
            )
            self.particles.append(particle)
    
    def detect_damage(self, damage_report: DamageReport) -> bool:
        """
        Detect damage and initiate healing response
        
        Args:
            damage_report: Report of detected damage
            
        Returns:
            True if healing initiated, False otherwise
        """
        if not self.active:
            return False
            
        if damage_report.damage_severity < 0.1:
            return False  # Too minor to require healing
        
        # Calculate required glue volume based on damage severity
        required_volume = damage_report.damage_severity * 50  # ml
        if required_volume > self.current_volume:
            print(f"Warning: Insufficient glue volume. Need {required_volume}ml, have {self.current_volume}ml")
            return False
        
        return True
    
    def flow_to_damage(self, damage_location: np.ndarray, time_step: float = 0.1) -> np.ndarray:
        """
        Simulate glue flowing to damaged area
        
        Args:
            damage_location: 3D coordinates of damage
            time_step: Simulation time step in seconds
            
        Returns:
            Amount of glue delivered (ml)
        """
        glue_delivered = 0.0
        
        for particle in self.particles:
            if not particle.active:
                continue
                
            # Calculate distance to damage
            distance = np.linalg.norm(particle.position - damage_location)
            
            # Flow towards damage (gradient following)
            if distance > 0:
                direction = (damage_location - particle.position) / distance
                particle.velocity = direction * self.flow_rate * 0.1
                particle.position += particle.velocity * time_step
                
                # If close enough, bind to damage site
                if distance < 1.0:  # Within 1cm
                    particle.active = False
                    glue_delivered += 10.0  # Each particle is 10ml
                    
        self.current_volume -= glue_delivered
        return glue_delivered
    
    def bind_components(self, component_a: str, component_b: str, 
                       damage_severity: float) -> float:
        """
        Bind two components together at damage site
        
        Args:
            component_a: First component ID
            component_b: Second component ID
            damage_severity: Severity of damage (0.0-1.0)
            
        Returns:
            Binding strength achieved (0.0-1.0)
        """
        base_strength = self.binding_efficiency
        severity_penalty = damage_severity * 0.2
        final_strength = max(0.0, base_strength - severity_penalty)
        
        print(f"Binding {component_a} to {component_b} with strength {final_strength:.2f}")
        return final_strength
    
    def regenerate_glue(self, water_intake_ml: float) -> float:
        """
        Regenerate glue from water intake
        Splits H2O into hydrogen and oxygen for power, uses remainder for glue
        
        Args:
            water_intake_ml: Amount of water consumed (ml)
            
        Returns:
            Amount of glue regenerated (ml)
        """
        # Efficiency of conversion: 30% of water becomes glue
        conversion_efficiency = 0.30
        glue_produced = water_intake_ml * conversion_efficiency
        
        self.current_volume = min(self.total_volume, self.current_volume + glue_produced)
        
        # Energy produced from splitting water (simplified)
        hydrogen_produced = water_intake_ml * 0.111  # grams
        oxygen_produced = water_intake_ml * 0.889  # grams
        
        print(f"Regenerated {glue_produced:.1f}ml glue from {water_intake_ml}ml water")
        print(f"Produced {hydrogen_produced:.2f}g H2 and {oxygen_produced:.2f}g O2 for power")
        
        return glue_produced
    
    def heal_component(self, damage_report: DamageReport, 
                      anatomy_position: np.ndarray) -> HealingState:
        """
        Complete healing process for a damaged component
        
        Args:
            damage_report: Details of the damage
            anatomy_position: 3D position of the component
            
        Returns:
            Final healing state
        """
        if not self.detect_damage(damage_report):
            return HealingState.INTACT
        
        print(f"Initiating healing for {damage_report.component_id}")
        
        # Flow glue to damage site
        glue_delivered = self.flow_to_damage(anatomy_position)
        
        if glue_delivered < 10:
            print("Insufficient glue delivery")
            return HealingState.DAMAGED
        
        # Bind components
        binding_strength = self.bind_components(
            damage_report.component_id,
            f"{damage_report.component_id}_adjacent",
            damage_report.damage_severity
        )
        
        if binding_strength > 0.7:
            print(f"Healing complete for {damage_report.component_id}")
            return HealingState.REPAIRED
        else:
            return HealingState.HEALING
    
    def get_status(self) -> Dict:
        """Get current status of the healing system"""
        active_particles = sum(1 for p in self.particles if p.active)
        return {
            "total_volume": self.total_volume,
            "current_volume": self.current_volume,
            "active_particles": active_particles,
            "system_active": self.active,
            "binding_efficiency": self.binding_efficiency
        }


class HealingNetwork:
    """
    Network of healing channels throughout the robot body
    Ensures glue can reach all 206 bones, muscles, and 79 organs
    """
    
    def __init__(self):
        self.channels = {}
        self.glue_system = SelfHealingGlue()
        self.damage_history = []
        
    def setup_channels(self, anatomy_data: Dict) -> None:
        """
        Set up healing channels based on anatomy
        
        Args:
            anatomy_data: Complete anatomy data structure
        """
        # Create channels for axial skeleton (80 bones)
        self.channels['axial_skeleton'] = {
            'skull': {'capacity': 50, 'flow_rate': 0.3},
            'vertebral_column': {'capacity': 100, 'flow_rate': 0.5},
            'thoracic_cage': {'capacity': 75, 'flow_rate': 0.4}
        }
        
        # Create channels for appendicular skeleton (126 bones)
        self.channels['appendicular_skeleton'] = {
            'pectoral_girdle': {'capacity': 40, 'flow_rate': 0.3},
            'upper_limbs': {'capacity': 80, 'flow_rate': 0.4},
            'pelvic_girdle': {'capacity': 50, 'flow_rate': 0.3},
            'lower_limbs': {'capacity': 100, 'flow_rate': 0.5}
        }
        
        # Create channels for organs (79 organs)
        self.channels['organs'] = {
            'nervous_system': {'capacity': 60, 'flow_rate': 0.6},
            'cardiovascular': {'capacity': 80, 'flow_rate': 0.5},
            'digestive': {'capacity': 70, 'flow_rate': 0.4},
            'other': {'capacity': 90, 'flow_rate': 0.4}
        }
        
        # Initialize glue distribution
        self.glue_system.distribute_glue(self.channels)
    
    def process_damage(self, damage_report: DamageReport) -> HealingState:
        """Process damage report and initiate healing"""
        self.damage_history.append(damage_report)
        return self.glue_system.heal_component(
            damage_report,
            damage_report.location
        )
    
    def maintenance_cycle(self, water_intake: float) -> None:
        """
        Perform maintenance cycle: regenerate glue and check systems
        
        Args:
            water_intake: Amount of water available for glue regeneration
        """
        glue_regenerated = self.glue_system.regenerate_glue(water_intake)
        status = self.glue_system.get_status()
        print(f"Maintenance complete. Glue regenerated: {glue_regenerated}ml")
        print(f"System status: {status}")
