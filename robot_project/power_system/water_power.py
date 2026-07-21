"""
Power System for Bio-Robots
Generates energy by splitting water (H2O) into hydrogen and oxygen
"""

import numpy as np
from typing import Dict, List, Optional
from dataclasses import dataclass
from enum import Enum
from datetime import datetime


class PowerState(Enum):
    """Power system states"""
    CHARGING = "charging"
    DISCHARGING = "discharging"
    IDLE = "idle"
    LOW_POWER = "low_power"
    CRITICAL = "critical"


@dataclass
class EnergyCell:
    """Represents a fuel cell unit"""
    cell_id: str
    capacity_mah: float
    current_charge_mah: float
    health: float  # 0.0 to 1.0
    temperature: float  # Celsius


class WaterSplittingPowerSystem:
    """
    Power system that generates electricity by splitting water
    into hydrogen and oxygen through electrolysis
    """
    
    def __init__(self, water_capacity_ml: float = 2000.0):
        """
        Initialize the power system
        
        Args:
            water_capacity_ml: Maximum water storage capacity (ml)
        """
        self.water_capacity_ml = water_capacity_ml
        self.current_water_ml = water_capacity_ml
        self.hydrogen_storage_ml = 0.0
        self.oxygen_storage_ml = 0.0
        
        # Fuel cell array (multiple cells for redundancy)
        self.fuel_cells: List[EnergyCell] = []
        self._initialize_fuel_cells()
        
        # System parameters
        self.electrolysis_efficiency = 0.85  # 85% efficient
        self.fuel_cell_efficiency = 0.60  # 60% efficient
        self.max_power_output_watts = 500.0
        self.current_power_output_watts = 0.0
        self.state = PowerState.IDLE
        
        # Energy constants
        self.h2_energy_density_wh_per_ml = 0.0033  # Wh per ml of H2
        self.water_to_h2_conversion = 0.111  # grams of H2 per ml of water
        
    def _initialize_fuel_cells(self, num_cells: int = 8) -> None:
        """Initialize fuel cell array"""
        for i in range(num_cells):
            cell = EnergyCell(
                cell_id=f"FC_{i:02d}",
                capacity_mah=5000.0,
                current_charge_mah=5000.0,
                health=1.0,
                temperature=25.0
            )
            self.fuel_cells.append(cell)
    
    def split_water(self, water_volume_ml: float) -> Dict[str, float]:
        """
        Split water into hydrogen and oxygen through electrolysis
        
        Args:
            water_volume_ml: Volume of water to split (ml)
            
        Returns:
            Dictionary with amounts of H2 and O2 produced
        """
        if water_volume_ml > self.current_water_ml:
            print(f"Warning: Insufficient water. Requested {water_volume_ml}ml, have {self.current_water_ml}ml")
            water_volume_ml = self.current_water_ml
        
        # Calculate products (with efficiency loss)
        effective_volume = water_volume_ml * self.electrolysis_efficiency
        
        # H2O → H2 + ½O2
        h2_produced_grams = effective_volume * self.water_to_h2_conversion
        o2_produced_grams = effective_volume * 0.889  # grams of O2 per ml of water
        
        # Convert to volume (at STP)
        h2_volume_ml = h2_produced_grams * 11.2 * 1000  # 1g H2 = 11.2L at STP
        o2_volume_ml = o2_produced_grams * 0.7 * 1000  # 1g O2 = 0.7L at STP
        
        # Update storage
        self.current_water_ml -= water_volume_ml
        self.hydrogen_storage_ml += h2_volume_ml
        self.oxygen_storage_ml += o2_volume_ml
        
        print(f"Split {water_volume_ml:.1f}ml H2O → {h2_volume_ml:.1f}ml H2 + {o2_volume_ml:.1f}ml O2")
        
        return {
            'water_consumed': water_volume_ml,
            'hydrogen_produced_ml': h2_volume_ml,
            'oxygen_produced_ml': o2_volume_ml,
            'energy_cost_joules': water_volume_ml * 15.0  # Approximate energy for electrolysis
        }
    
    def generate_power(self, power_demand_watts: float, duration_seconds: float) -> Dict[str, float]:
        """
        Generate electrical power from hydrogen fuel cells
        
        Args:
            power_demand_watts: Required power output (Watts)
            duration_seconds: Duration of power demand (seconds)
            
        Returns:
            Power generation statistics
        """
        if power_demand_watts > self.max_power_output_watts:
            print(f"Warning: Power demand exceeds maximum ({power_demand_watts}W > {self.max_power_output_watts}W)")
            power_demand_watts = self.max_power_output_watts
        
        # Calculate hydrogen consumption
        energy_required_wh = power_demand_watts * (duration_seconds / 3600.0)
        h2_required_ml = energy_required_wh / self.h2_energy_density_wh_per_ml / self.fuel_cell_efficiency
        
        if h2_required_ml > self.hydrogen_storage_ml:
            print(f"Warning: Insufficient hydrogen. Need {h2_required_ml:.1f}ml, have {self.hydrogen_storage_ml:.1f}ml")
            # Use available hydrogen
            h2_used_ml = self.hydrogen_storage_ml
            actual_energy_wh = h2_used_ml * self.h2_energy_density_wh_per_ml * self.fuel_cell_efficiency
            actual_duration = (actual_energy_wh / power_demand_watts) * 3600.0
        else:
            h2_used_ml = h2_required_ml
            actual_energy_wh = energy_required_wh
            actual_duration = duration_seconds
        
        # Update storage
        self.hydrogen_storage_ml -= h2_used_ml
        self.oxygen_storage_ml -= h2_used_ml * 0.5  # O2 consumed at half the rate
        
        # Update fuel cell states
        self.current_power_output_watts = power_demand_watts
        self.state = PowerState.DISCHARGING
        
        # Distribute load across fuel cells
        charge_depletion = (actual_energy_wh / len(self.fuel_cells)) / 3.7  # Convert Wh to mAh at 3.7V
        for cell in self.fuel_cells:
            cell.current_charge_mah = max(0, cell.current_charge_mah - charge_depletion)
            cell.temperature += 0.1  # Slight temperature increase during operation
        
        print(f"Generated {actual_energy_wh:.2f}Wh over {actual_duration:.1f}s using {h2_used_ml:.1f}ml H2")
        
        return {
            'power_output_watts': power_demand_watts,
            'energy_generated_wh': actual_energy_wh,
            'duration_seconds': actual_duration,
            'hydrogen_consumed_ml': h2_used_ml,
            'oxygen_consumed_ml': h2_used_ml * 0.5
        }
    
    def recharge_water(self, water_intake_ml: float) -> None:
        """
        Replenish water supply
        
        Args:
            water_intake_ml: Amount of water to add (ml)
        """
        available_capacity = self.water_capacity_ml - self.current_water_ml
        water_added = min(water_intake_ml, available_capacity)
        
        self.current_water_ml += water_added
        
        if water_intake_ml > available_capacity:
            print(f"Note: Only {water_added:.1f}ml added (capacity limit)")
        else:
            print(f"Recharged {water_added:.1f}ml water")
    
    def get_total_energy_capacity(self) -> float:
        """Get total energy capacity in Wh"""
        return self.hydrogen_storage_ml * self.h2_energy_density_wh_per_ml * self.fuel_cell_efficiency
    
    def get_power_status(self) -> Dict:
        """Get comprehensive power system status"""
        total_cell_capacity = sum(cell.capacity_mah for cell in self.fuel_cells)
        total_cell_charge = sum(cell.current_charge_mah for cell in self.fuel_cells)
        avg_cell_health = sum(cell.health for cell in self.fuel_cells) / len(self.fuel_cells)
        avg_temperature = sum(cell.temperature for cell in self.fuel_cells) / len(self.fuel_cells)
        
        return {
            'state': self.state.value,
            'water_ml': self.current_water_ml,
            'water_capacity_ml': self.water_capacity_ml,
            'hydrogen_ml': self.hydrogen_storage_ml,
            'oxygen_ml': self.oxygen_storage_ml,
            'total_energy_wh': self.get_total_energy_capacity(),
            'fuel_cell_charge_percent': (total_cell_charge / total_cell_capacity) * 100,
            'avg_fuel_cell_health': avg_cell_health,
            'avg_temperature_celsius': avg_temperature,
            'current_power_output_watts': self.current_power_output_watts,
            'max_power_output_watts': self.max_power_output_watts
        }
    
    def optimize_power_distribution(self, priority_systems: List[str]) -> None:
        """
        Optimize power distribution to priority systems
        
        Args:
            priority_systems: List of system names to prioritize
        """
        print(f"Optimizing power distribution for: {', '.join(priority_systems)}")
        
        # Reduce power to non-essential systems
        non_essential_load_reduction = 0.3  # 30% reduction
        
        # Increase fuel cell output for priority systems
        for cell in self.fuel_cells:
            if cell.health > 0.8:
                cell.current_charge_mah = min(cell.capacity_mah, cell.current_charge_mah * 1.1)
        
        print("Power optimization complete")
    
    def maintenance_check(self) -> List[str]:
        """
        Perform maintenance check on all fuel cells
        
        Returns:
            List of maintenance recommendations
        """
        recommendations = []
        
        for cell in self.fuel_cells:
            if cell.health < 0.5:
                recommendations.append(f"{cell.cell_id}: Replace fuel cell (health: {cell.health:.1%})")
            elif cell.health < 0.8:
                recommendations.append(f"{cell.cell_id}: Schedule maintenance (health: {cell.health:.1%})")
            
            if cell.temperature > 45.0:
                recommendations.append(f"{cell.cell_id}: Overheating detected ({cell.temperature:.1f}°C)")
            
            if cell.current_charge_mah < cell.capacity_mah * 0.2:
                recommendations.append(f"{cell.cell_id}: Low charge ({cell.current_charge_mah:.0f}/{cell.capacity_mah:.0f} mAh)")
        
        if not recommendations:
            recommendations.append("All systems nominal")
        
        return recommendations


class IntegratedPowerManagement:
    """
    Integrated power management system coordinating:
    - Water intake and storage
    - Electrolysis for H2/O2 production
    - Fuel cell power generation
    - Power distribution to all robot systems
    """
    
    def __init__(self):
        self.power_system = WaterSplittingPowerSystem()
        self.system_loads = {
            'locomotion': 150.0,  # Watts
            'manipulation': 100.0,
            'sensing': 50.0,
            'computation': 75.0,
            'healing_system': 25.0,
            'life_support': 30.0
        }
        self.active_systems = list(self.system_loads.keys())
        
    def calculate_total_load(self) -> float:
        """Calculate total power load from active systems"""
        return sum(self.system_loads[system] for system in self.active_systems)
    
    def power_cycle(self, duration_hours: float = 1.0) -> Dict:
        """
        Run a complete power cycle
        
        Args:
            duration_hours: Duration of the cycle in hours
            
        Returns:
            Cycle statistics
        """
        total_load = self.calculate_total_load()
        duration_seconds = duration_hours * 3600.0
        
        print(f"\n=== Power Cycle ({duration_hours}h) ===")
        print(f"Total load: {total_load:.1f}W")
        
        # Check if we need to split more water
        if self.power_system.hydrogen_storage_ml < total_load * duration_hours * 0.5:
            print("Initiating water electrolysis...")
            water_to_split = min(500.0, self.power_system.current_water_ml)
            self.power_system.split_water(water_to_split)
        
        # Generate power
        power_stats = self.power_system.generate_power(total_load, duration_seconds)
        
        # Update status
        status = self.power_system.get_power_status()
        
        print(f"\nCycle complete:")
        print(f"  Energy generated: {power_stats['energy_generated_wh']:.2f}Wh")
        print(f"  H2 consumed: {power_stats['hydrogen_consumed_ml']:.1f}ml")
        print(f"  Remaining energy: {status['total_energy_wh']:.2f}Wh")
        
        return {
            'duration_hours': duration_hours,
            'total_load_watts': total_load,
            'energy_generated_wh': power_stats['energy_generated_wh'],
            'remaining_energy_wh': status['total_energy_wh'],
            'system_status': status
        }
    
    def emergency_protocol(self) -> None:
        """Activate emergency power conservation protocol"""
        print("\n!!! EMERGENCY POWER PROTOCOL !!!")
        
        # Shut down non-essential systems
        essential_systems = ['life_support', 'computation', 'sensing']
        self.active_systems = essential_systems
        
        # Reduce power to essential systems
        for system in essential_systems:
            self.system_loads[system] *= 0.5
        
        print(f"Active systems reduced to: {', '.join(essential_systems)}")
        print("Power conservation mode active")
