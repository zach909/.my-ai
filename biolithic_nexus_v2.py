import json
import time
import random
from datetime import datetime

class SelfHealingGlue:
    """Simulates the 'Glue' substance that acts as blood and repair material."""
    def __init__(self):
        self.viscosity = 1.0  # Flow state
        self.hardening_rate = 0.5
        self.volume = 0.0
    
    def synthesize(self, food_energy, water_input):
        """Converts food and water into 'Glue' (Hydrogen/Oxygen separation simulation)."""
        # Simulate electrolysis: Water -> Hydrogen + Oxygen + Energy storage
        h2_output = water_input * 0.11  # Theoretical H2 yield
        o2_output = water_input * 0.89  # Theoretical O2 yield
        
        # Convert food energy + chemical reaction into new Glue volume
        # Increased efficiency: Food and water create substantial glue for life functions
        new_volume = (food_energy * 5.0) + (water_input * 2.0) + (h2_output * 3.0)
        self.volume += new_volume
        return {
            "hydrogen_generated": h2_output,
            "oxygen_generated": o2_output,
            "glue_produced": new_volume,
            "status": "Synthesis Complete"
        }

    def apply_healing(self, damage_level):
        """Uses glue to heal damage."""
        if self.volume >= damage_level:
            self.volume -= damage_level
            return {"healed": True, "remaining_glue": self.volume}
        return {"healed": False, "error": "Insufficient glue volume"}

class ElectromagneticDrive:
    """Simulates movement via electric magnets."""
    def __init__(self):
        self.magnet_strength = 0
        self.position = [0, 0, 0]
    
    def activate_sequence(self, electricity_input):
        """Moves small magnets to create locomotion."""
        self.magnet_strength = electricity_input * 10
        # Simulate magnetic field shifting causing movement
        move_vector = [
            random.uniform(-1, 1) * (self.magnet_strength/100),
            random.uniform(-1, 1) * (self.magnet_strength/100),
            0 # Grounded
        ]
        self.position = [self.position[i] + move_vector[i] for i in range(3)]
        return {"new_position": self.position, "magnet_flux": self.magnet_strength}

class BiolithicUnit:
    def __init__(self, unit_id, gender):
        self.id = unit_id
        self.gender = gender
        self.glue_system = SelfHealingGlue()
        self.drive = ElectromagneticDrive()
        self.energy_reserve = 0
        self.water_reserve = 0
        self.status = "Active"
        self.reproductive_mold = None

    def consume(self, food_units, water_units):
        """Eats food and processes water."""
        self.energy_reserve += food_units * 100 # Calories to Energy
        self.water_reserve += water_units
        print(f"[{self.id}] Consumed {food_units} food, {water_units} water.")
        
        # Auto-convert to Glue
        conversion = self.glue_system.synthesize(food_units, water_units)
        return conversion

    def self_repair(self, damage):
        """Automatic healing using the glue."""
        result = self.glue_system.apply_healing(damage)
        if result['healed']:
            print(f"[{self.id}] Self-healed using bio-glue. Damage: {damage}")
        else:
            print(f"[{self.id}] CRITICAL: Cannot heal. Glue empty.")
        return result

    def reproduce(self, partner=None):
        """Female creates a mold, uses glue to make children."""
        if self.gender != "female":
            return {"error": "Only female units can gestate molds."}
        
        if self.glue_system.volume < 50:
            return {"error": "Insufficient glue volume to create life."}
        
        # Phase 1: Create Mold
        self.reproductive_mold = {
            "structure": "Synthetic Womb Matrix",
            "integrity": 100,
            "created_at": datetime.now().isoformat()
        }
        print(f"[{self.id}] Reproductive mold created.")
        
        # Phase 2: Use Glue to form child
        glue_cost = 50
        self.glue_system.volume -= glue_cost
        
        child_unit = BiolithicUnit(unit_id=f"Child-{random.randint(1000,9999)}", gender=random.choice(["male", "female"]))
        
        return {
            "status": "Reproduction Successful",
            "mold_used": True,
            "glue_consumed": glue_cost,
            "child_id": child_unit.id,
            "child_gender": child_unit.gender
        }

    def move(self, power_input):
        """Move using electromagnetic magnets."""
        if self.energy_reserve < power_input:
            return {"error": "Low energy"}
        
        self.energy_reserve -= power_input
        return self.drive.activate_sequence(power_input)

# --- SIMULATION RUN ---
def run_biolithic_simulation():
    print("=== BIOLITHIC NEXUS: SELF-HEALING & REPRODUCTION SIMULATION ===\n")
    
    # Create Donors
    male = BiolithicUnit("Donor-M-01", "male")
    female = BiolithicUnit("Donor-F-01", "female")
    
    # 1. Metabolism: Eating and Water Conversion
    print("--- Phase 1: Metabolism & Glue Synthesis ---")
    male.consume(food_units=10, water_units=50)
    female.consume(food_units=15, water_units=60) # Female needs more for reproduction
    
    # 2. Movement: Electromagnetic Drive
    print("\n--- Phase 2: Electromagnetic Locomotion ---")
    move_result = female.move(power_input=20)
    print(f"Female Unit Movement: {move_result}")
    
    # 3. Self-Healing Demonstration
    print("\n--- Phase 3: Damage & Self-Healing ---")
    fake_damage = 10
    female.self_repair(fake_damage)
    
    # 4. Reproduction: Mold & Glue Child Creation
    print("\n--- Phase 4: Reproduction (Mold & Glue) ---")
    # Transfer genetic data (simulated)
    print(f"[System] Genetic handshake between {male.id} and {female.id}... OK.")
    
    baby_data = female.reproduce()
    if "error" not in baby_data:
        print(f"SUCCESS: New unit {baby_data['child_id']} ({baby_data['child_gender']}) created via Bio-Glue Mold.")
        
        # Save to file
        output_data = {
            "timestamp": datetime.now().isoformat(),
            "parent_female": female.id,
            "parent_male": male.id,
            "reproduction_event": baby_data,
            "glue_status": female.glue_system.volume,
            "mechanism": "Electro-Magnetic / Bio-Glue Synthesis"
        }
        
        with open("biolithic_reproduction_log.json", "w") as f:
            json.dump(output_data, f, indent=2)
        print("\nData saved to biolithic_reproduction_log.json")
    else:
        print(f"Reproduction Failed: {baby_data['error']}")

if __name__ == "__main__":
    run_biolithic_simulation()
