"""
Main Robot Controller for Bio-Robots
Integrates all systems: anatomy, healing, power, magnetics, and reproduction
"""

import sys
import os

# Add project paths
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from anatomy_data.human_anatomy import (
    AXIAL_SKELETON, APPENDICULAR_SKELETON, SKELETAL_MUSCLES, ORGANS,
    get_anatomy_summary, get_total_bone_count, get_total_organ_count
)
from healing_system.self_healing import (
    SelfHealingGlue, HealingNetwork, DamageReport, HealingState
)
from power_system.water_power import (
    WaterSplittingPowerSystem, IntegratedPowerManagement
)
from magnetics.magnetic_muscles import (
    MagneticMuscleSystem, MuscleState
)
from reproduction.reproduction_system import (
    FemaleReproductiveSystem, MaleReproductiveSystem, 
    GeneticTemplate, ReproductionCoordinator
)


class BioRobot:
    """
    Complete Bio-Robot with human-like anatomy and capabilities:
    - 206 bones (axial and appendicular skeleton)
    - Major skeletal muscle groups
    - 79 organs
    - Self-healing glue system
    - Water-splitting power generation
    - Magnetic muscle actuation
    - Reproduction capabilities
    """
    
    def __init__(self, robot_id: str, gender: str = "female"):
        """
        Initialize a bio-robot
        
        Args:
            robot_id: Unique identifier for the robot
            gender: "male" or "female" for reproductive roles
        """
        self.robot_id = robot_id
        self.gender = gender
        
        print(f"\n{'='*60}")
        print(f"BIO-ROBOT INITIALIZATION: {robot_id} ({gender})")
        print(f"{'='*60}\n")
        
        # Initialize anatomy data
        self.anatomy_summary = get_anatomy_summary()
        print(f"Anatomy loaded:")
        print(f"  - Total bones: {self.anatomy_summary['total_bones']}")
        print(f"  - Axial skeleton: {self.anatomy_summary['axial_skeleton']} bones")
        print(f"  - Appendicular skeleton: {self.anatomy_summary['appendicular_skeleton']} bones")
        print(f"  - Major muscle groups: {self.anatomy_summary['major_muscle_groups']}")
        print(f"  - Total organs: {self.anatomy_summary['total_organs']}")
        
        # Initialize healing system
        print("\nInitializing self-healing system...")
        self.healing_network = HealingNetwork()
        self.healing_network.setup_channels(self.anatomy_summary)
        print("  ✓ Self-healing glue system active")
        
        # Initialize power system
        print("\nInitializing power system...")
        self.power_manager = IntegratedPowerManagement()
        print("  ✓ Water-splitting power system active")
        print(f"    - Water capacity: {self.power_manager.power_system.water_capacity_ml}ml")
        print(f"    - Max power output: {self.power_manager.power_system.max_power_output_watts}W")
        
        # Initialize magnetic muscle system
        print("\nInitializing magnetic muscle system...")
        self.muscle_system = MagneticMuscleSystem()
        muscle_summary = self.muscle_system.get_all_muscles_summary()
        print(f"  ✓ Magnetic muscles active: {muscle_summary['total_muscle_groups']} groups")
        
        # Initialize reproductive system based on gender
        print(f"\nInitializing {gender} reproductive system...")
        if gender == "female":
            self.reproductive_system = FemaleReproductiveSystem()
        else:
            self.reproductive_system = MaleReproductiveSystem()
        print(f"  ✓ {gender.capitalize()} reproductive system active")
        
        print(f"\n{'='*60}")
        print(f"INITIALIZATION COMPLETE: {robot_id}")
        print(f"{'='*60}\n")
    
    def demonstrate_healing(self):
        """Demonstrate self-healing capability"""
        print("\n" + "="*50)
        print("DEMONSTRATION: Self-Healing System")
        print("="*50)
        
        # Create a damage report
        damage = DamageReport(
            component_id="femur_left",
            component_type="bone",
            damage_severity=0.6,
            location=(5.0, -20.0, 0.0),
            timestamp=0.0
        )
        
        print(f"\nSimulating damage to {damage.component_id}...")
        print(f"  Severity: {damage.damage_severity*100:.0f}%")
        
        # Process healing
        result = self.healing_network.process_damage(damage)
        print(f"\nHealing result: {result.value}")
        
        # Maintenance cycle with water intake
        print("\nPerforming maintenance with water intake...")
        self.healing_network.maintenance_cycle(200.0)
    
    def demonstrate_power(self):
        """Demonstrate water-splitting power system"""
        print("\n" + "="*50)
        print("DEMONSTRATION: Water-Splitting Power System")
        print("="*50)
        
        # Split some water
        print("\nSplitting water for hydrogen production...")
        result = self.power_manager.power_system.split_water(300.0)
        print(f"  H2 produced: {result['hydrogen_produced_ml']:.0f}ml")
        print(f"  O2 produced: {result['oxygen_produced_ml']:.0f}ml")
        
        # Generate power
        print("\nGenerating power from hydrogen...")
        power_result = self.power_manager.power_cycle(0.5)  # 30 minutes
        print(f"  Energy generated: {power_result['energy_generated_wh']:.2f}Wh")
        print(f"  Remaining energy: {power_result['remaining_energy_wh']:.2f}Wh")
        
        # Get status
        status = self.power_manager.power_system.get_power_status()
        print(f"\nPower system status:")
        print(f"  State: {status['state']}")
        print(f"  Water remaining: {status['water_ml']:.0f}ml")
        print(f"  H2 storage: {status['hydrogen_ml']:.0f}ml")
    
    def demonstrate_movement(self):
        """Demonstrate magnetic muscle movement"""
        print("\n" + "="*50)
        print("DEMONSTRATION: Magnetic Muscle Movement")
        print("="*50)
        
        # Execute movement patterns
        movements = ['walk', 'grasp', 'jump']
        
        for movement in movements:
            print(f"\nExecuting '{movement}' movement pattern...")
            activations = self.muscle_system.coordinate_movement(movement)
            
            if activations:
                print(f"  Activated muscles:")
                for muscle, level in activations.items():
                    status = self.muscle_system.get_muscle_status(muscle)
                    if status:
                        print(f"    - {muscle}: {level*100:.0f}% activation, {status['force_output_N']:.1f}N force")
        
        # Get overall summary
        summary = self.muscle_system.get_all_muscles_summary()
        print(f"\nMuscle system summary:")
        print(f"  Total groups: {summary['total_muscle_groups']}")
        print(f"  Active muscles: {summary['active_muscles']}")
        print(f"  Total force output: {summary['total_force_output_N']:.1f}N")
    
    def demonstrate_reproduction(self, partner_robot=None):
        """Demonstrate reproduction capability"""
        print("\n" + "="*50)
        print("DEMONSTRATION: Reproduction System")
        print("="*50)
        
        if self.gender == "female" and partner_robot and partner_robot.gender == "male":
            # Create genetic template
            template = GeneticTemplate(
                template_id="OFFSPRING_001",
                parent_ids=[self.robot_id, partner_robot.robot_id],
                bone_structure={'axial': 80, 'appendicular': 126},
                muscle_configuration={'head_neck': 5, 'torso': 7, 'upper_limbs': 7, 'lower_limbs': 9},
                organ_layout={'systems': 8},
                traits={'strength_focus': True}
            )
            
            # Coordinate reproduction
            coordinator = ReproductionCoordinator()
            result = coordinator.initiate_reproduction(
                partner_robot.reproductive_system,
                self.reproductive_system,
                template
            )
            
            print(f"\nReproduction result: {result['status']}")
            if result['status'] == 'success':
                print(f"New robot created with {result['new_robot']['bone_count']} bones")
                
        elif self.gender == "female":
            print("\nFemale robot ready for reproduction")
            print("Requires male partner for complete demonstration")
        else:
            print("\nMale robot ready for reproduction")
            print("Can produce construction material and deliver to female partner")
            
            # Demonstrate material production
            if isinstance(self.reproductive_system, MaleReproductiveSystem):
                template = GeneticTemplate(
                    template_id="TEST_TEMPLATE",
                    parent_ids=[self.robot_id],
                    bone_structure={},
                    muscle_configuration={},
                    organ_layout={},
                    traits={}
                )
                composition = self.reproductive_system.optimize_for_compatibility(template)
                material = self.reproductive_system.produce_material(1000.0, composition)
                print(f"Produced {material.volume_ml:.0f}ml construction material")
    
    def full_system_demo(self):
        """Run complete demonstration of all systems"""
        print("\n" + "#"*60)
        print("# FULL SYSTEM DEMONSTRATION")
        print("#"*60)
        
        self.demonstrate_healing()
        self.demonstrate_power()
        self.demonstrate_movement()
        self.demonstrate_reproduction()
        
        print("\n" + "#"*60)
        print("# DEMONSTRATION COMPLETE")
        print("#"*60 + "\n")
    
    def get_full_status(self):
        """Get comprehensive status of all robot systems"""
        return {
            'robot_id': self.robot_id,
            'gender': self.gender,
            'anatomy': self.anatomy_summary,
            'healing': self.healing_network.glue_system.get_status(),
            'power': self.power_manager.power_system.get_power_status(),
            'muscles': self.muscle_system.get_all_muscles_summary(),
            'reproductive_system': 'female' if isinstance(self.reproductive_system, FemaleReproductiveSystem) else 'male'
        }


def main():
    """Main demonstration function"""
    print("""
    ╔═══════════════════════════════════════════════════════════╗
    ║           BIO-ROBOT PROJECT - FULL DEMONSTRATION          ║
    ╠═══════════════════════════════════════════════════════════╣
    ║  Features:                                                ║
    ║  • Human Anatomy: 206 bones, major muscles, 79 organs     ║
    ║  • Self-Healing: Glue-based repair system                 ║
    ║  • Power: Water-splitting (H2O → H2 + O2) fuel cells      ║
    ║  • Movement: Electromagnetic muscle actuation             ║
    ║  • Reproduction: Mold-based robot creation                ║
    ╚═══════════════════════════════════════════════════════════╝
    """)
    
    # Create female robot
    female_robot = BioRobot("ROBOT_F001", gender="female")
    
    # Create male robot
    male_robot = BioRobot("ROBOT_M001", gender="male")
    
    # Run full demonstration on female robot
    female_robot.full_system_demo()
    
    # Demonstrate reproduction between robots
    print("\n" + "="*60)
    print("INTER-ROBOT REPRODUCTION DEMONSTRATION")
    print("="*60)
    female_robot.demonstrate_reproduction(partner_robot=male_robot)
    
    # Get final status
    print("\n" + "="*60)
    print("FINAL SYSTEM STATUS")
    print("="*60)
    status = female_robot.get_full_status()
    print(f"\nRobot: {status['robot_id']} ({status['gender']})")
    print(f"Anatomy: {status['anatomy']['total_bones']} bones, {status['anatomy']['total_organs']} organs")
    print(f"Healing: {status['healing']['current_volume']:.0f}ml glue available")
    print(f"Power: {status['power']['total_energy_wh']:.2f}Wh remaining")
    print(f"Muscles: {status['muscles']['total_muscle_groups']} groups")


if __name__ == "__main__":
    main()
