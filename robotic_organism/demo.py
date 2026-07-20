"""
Demo script showing the robotic organism in action.
"""

import sys
sys.path.insert(0, '/workspace/robotic_organism')

from core.artificial_cell import ArtificialCell, SexConfiguration


def main():
    print("=" * 60)
    print("ROBOTIC ORGANISM DEMONSTRATION")
    print("=" * 60)
    
    # Create a new organism
    print("\n[1] Creating artificial organism...")
    organism = ArtificialCell(SexConfiguration.NEUTRAL)
    print(f"    Organism ID: {organism.id}")
    
    # Initialize all systems
    print("\n[2] Initializing integrated systems...")
    organism.initialize_systems()
    print("    Systems initialized:")
    print("    - Energy System (converters and storage)")
    print("    - Neural System (brain with multiple regions)")
    print("    - Muscular System (artificial muscles and joints)")
    print("    - Skeletal System (internal framework)")
    print("    - Sensory System (eyes, ears, touch)")
    print("    - Repair System (nanobots and materials)")
    print("    - Transport System (circulatory network)")
    print("    - Manufacturing System (fabricators)")
    print("    - Reproductive System")
    print("    - Skin System")
    
    # Show initial status
    print("\n[3] Initial organism status:")
    status = organism.get_status()
    for key, value in status.items():
        print(f"    {key}: {value}")
    
    # Simulate time passing
    print("\n[4] Simulating organism operation (10 seconds)...")
    delta_time = 0.1  # 100ms steps
    steps = 100
    
    for i in range(steps):
        organism.update(delta_time)
        
    # Show status after simulation
    print("\n[5] Status after simulation:")
    status = organism.get_status()
    for key, value in status.items():
        print(f"    {key}: {value}")
    
    # Consume some material
    print("\n[6] Consuming organic material...")
    organism.consume_material("organic", 50.0)
    print("    Material accepted for processing")
    
    # Run a few more updates
    for i in range(50):
        organism.update(delta_time)
    
    # Check energy status
    print("\n[7] Energy system status:")
    energy_status = organism.energy_system.get_status()
    for key, value in energy_status.items():
        print(f"    {key}: {value}")
    
    # Execute a movement
    print("\n[8] Executing movement command (walk)...")
    organism.move("walk", {"speed": 1.0, "direction": "forward"})
    print("    Motor command sent to muscular system")
    
    # Update and check muscle status
    for i in range(10):
        organism.update(delta_time)
    
    print("\n[9] Muscular system status:")
    muscle_status = organism.muscular_system.get_status()
    print(f"    Total active force: {muscle_status['total_active_force']:.2f} N")
    print(f"    Average activation: {muscle_status['average_activation']:.2%}")
    print(f"    Active movements: {muscle_status['active_movements']}")
    
    # Neural system status
    print("\n[10] Neural system status:")
    neural_status = organism.neural_system.get_status()
    print(f"    Global activity: {neural_status['global_activity']:.4f}")
    print(f"    Total neurons: {neural_status['total_neurons']}")
    print(f"    Memory traces: {neural_status['memory_count']}")
    
    # Sensory data
    print("\n[11] Gathering sensory data...")
    sensory_data = organism.sense_environment()
    print(f"    Vision systems: {len(sensory_data.get('vision', {}))} eyes active")
    print(f"    Audio systems: {len(sensory_data.get('audio', {}))} ears active")
    print(f"    Touch sensors: {len(sensory_data.get('touch', {}))} sensors")
    
    # Final comprehensive status
    print("\n[12] Final organism status:")
    final_status = organism.get_status()
    print(f"    State: {final_status['state']}")
    print(f"    Energy: {final_status['energy_level']:.1f}%")
    print(f"    Structural integrity: {final_status['structural_integrity']:.1f}%")
    print(f"    Age: {final_status['age_hours']:.3f} hours")
    
    print("\n" + "=" * 60)
    print("DEMONSTRATION COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    main()
