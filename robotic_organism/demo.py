"""
Robotic Organism Demo

Demonstrates the staged development approach:
1. Artificial cell architecture with interconnected subsystems
2. Small prototype organism (not full humanoid yet)
3. Energy system (acquisition + distribution)
4. Transport system (multi-fluid circulatory network)
5. Repair system (self-repair before reproduction)
6. Artificial muscles (single → group → joint → limb)
7. Sensors (vision, audio, tactile, proprioception)
8. Neural controller (fast control + high-level AI)
9. Integrated organism simulation
"""

import sys
import time

# Add parent directory to path for imports
sys.path.insert(0, '/workspace')

from robotic_organism.core.organism import ArtificialOrganism
from robotic_organism.systems.energy import Material, MaterialType


def demo_basic_organism():
    """Demonstrate basic artificial organism functionality."""
    
    print("\n" + "="*70)
    print("ROBOTIC ORGANISM - STAGED DEVELOPMENT DEMO")
    print("="*70)
    
    # Create organism
    organism = ArtificialOrganism(name="Proto-1")
    
    print("\n[1] ARTIFICIAL CELL ARCHITECTURE")
    print("-" * 40)
    print("Creating integrated organism with interconnected subsystems...")
    print(f"  - Energy System: ✓")
    print(f"  - Transport System: ✓ ({len(organism.transport_system.nodes)} nodes)")
    print(f"  - Repair System: ✓ ({len(organism.repair_system.nanobots)} nanobots)")
    print(f"  - Muscle System: ✓ ({len(organism.muscle_system.fibers)} fibers)")
    print(f"  - Sensor Array: ✓ (vision, audio, tactile, proprioception)")
    print(f"  - Neural Controller: ✓ ({len(organism.neural_controller.neurons)} neurons)")
    
    print("\n[2] ENERGY SYSTEM TEST")
    print("-" * 40)
    print("Consuming material for energy processing...")
    
    organism.consume_material(
        material_name="glucose_pack",
        material_type="organic",
        mass=50.0,
        energy_content=400.0  # J/g
    )
    
    # Run a few updates to process energy
    for _ in range(5):
        organism.update(dt=0.1)
    
    status = organism.energy_system.get_status()
    print(f"  Battery Level: {status['battery']['level']*100:.1f}%")
    print(f"  Available Energy: {status['battery']['available']:.1f} J")
    print(f"  Processing: {status['processing']['current']}")
    
    print("\n[3] TRANSPORT SYSTEM TEST")
    print("-" * 40)
    ts_status = organism.transport_system.get_status()
    print(f"  Network Nodes: {ts_status['network']['nodes']}")
    print(f"  Channels: {ts_status['network']['channels']}")
    print(f"  Pumps: {ts_status['network']['pumps']}")
    print(f"  Fluid Reserves:")
    for fluid, vol in list(ts_status['fluid_reserves'].items())[:3]:
        print(f"    - {fluid}: {vol}")
    
    print("\n[4] REPAIR SYSTEM TEST")
    print("-" * 40)
    print("Simulating damage detection and repair...")
    
    organism.detect_damage(
        location=(0.05, 0.3, 0.0),
        damage_type="puncture",
        severity=0.6
    )
    
    # Run updates to process repair
    for _ in range(10):
        organism.update(dt=0.1)
    
    rs_status = organism.repair_system.get_status()
    print(f"  Nanobots: {rs_status['nanobots']['total']} total, "
          f"{rs_status['nanobots']['busy']} busy")
    print(f"  Materials Available:")
    for mat, info in list(rs_status['materials'].items())[:3]:
        print(f"    - {mat}: {info['level']}")
    print(f"  Repairs Completed: {rs_status['statistics']['successful']}")
    
    print("\n[5] MUSCLE SYSTEM TEST")
    print("-" * 40)
    ms_status = organism.muscle_system.get_status()
    print(f"  Muscle Fibers: {ms_status['fibers']['total']}")
    print(f"  Bundles: {ms_status['bundles']['total']}")
    print(f"  Joints: {ms_status['joints']['total']}")
    print(f"  Joint Details:")
    for j_id, j_info in ms_status['joints']['details'].items():
        print(f"    - {j_id}: {j_info['type']}, angle={j_info['angle']}")
    
    print("\n[6] NEURAL CONTROLLER TEST")
    print("-" * 40)
    ns_status = organism.neural_controller.get_status()
    print(f"  Total Neurons: {ns_status['architecture']['total_neurons']}")
    print(f"  Brain Regions:")
    for region, stats in ns_status['architecture']['regions'].items():
        print(f"    - {region}: {stats['neurons']} neurons, "
              f"{stats['active']} active")
    print(f"  Drives: hunger={ns_status['goals']['drives']['hunger']:.2f}, "
          f"safety={ns_status['goals']['drives']['safety']:.2f}, "
          f"curiosity={ns_status['goals']['drives']['curiosity']:.2f}")
    print(f"  Memories: {ns_status['memory']['count']}")
    
    print("\n[7] FULL ORGANISM SIMULATION")
    print("-" * 40)
    print("Running 5-second integrated simulation...\n")
    
    snapshots = organism.run_simulation(duration=5.0, dt=0.1, verbose=True)
    
    print("\n[8] FINAL STATUS")
    print("-" * 40)
    final_status = organism.get_status()
    print(f"  Organism State: {final_status['identity']['state']}")
    print(f"  Age: {final_status['identity']['age_seconds']:.1f}s")
    print(f"  Total Updates: {final_status['identity']['update_count']}")
    print(f"  Energy Consumed: {final_status['statistics']['total_energy_consumed']:.1f} J")
    print(f"  Repairs Performed: {final_status['statistics']['repairs_performed']}")
    print(f"  Decisions Made: {final_status['statistics']['decisions_made']}")
    
    print("\n" + "="*70)
    print("DEMO COMPLETE")
    print("="*70)
    print("\nKey achievements:")
    print("  ✓ Interconnected subsystem architecture")
    print("  ✓ Energy acquisition and distribution")
    print("  ✓ Multi-fluid transport network")
    print("  ✓ Damage detection and self-repair")
    print("  ✓ Artificial muscles with feedback")
    print("  ✓ Multi-modal sensory system")
    print("  ✓ Two-layer neural controller")
    print("  ✓ Integrated organism simulation")
    print("\nNext stages (not implemented):")
    print("  → Larger muscle system (more joints)")
    print("  → Advanced sensory processing")
    print("  → Learning and adaptation")
    print("  → Internal manufacturing")
    print("  → Humanoid body structure")
    print("  → Reproduction system")
    print()
    
    return organism


if __name__ == "__main__":
    demo_basic_organism()
