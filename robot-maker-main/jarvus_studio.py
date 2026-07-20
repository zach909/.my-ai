import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox, filedialog
import math
import os
import json
import time
import threading
import random

# ==========================================
# CORE DATA STRUCTURES (Z-Anatomy / MakeHuman Logic)
# ==========================================

class SyntheticHuman:
    def __init__(self, gender, name):
        self.gender = gender
        self.name = name
        self.instinct_level = 0.5  # 0.0 to 1.0
        self.glue_level = 100.0
        self.power_level = 100.0
        self.is_active = False
        
        # Anatomy Data (Simplified from Z-Anatomy/MakeHuman)
        self.bones = self._generate_bones()
        self.organs = self._generate_organs()
        self.muscles = self._generate_muscles()
        
        # Reproductive Specifics
        if gender == "Female":
            self.reproductive_organs = ["Ovaries", "Fallopian Tubes", "Uterus (Mold Chamber)", "Cervix", "Vagina", "Vulva", "Clitoris", "Bartholin's Glands", "Breasts (Mammary)"]
            self.role = "Mold Creator / Builder"
        else:
            self.reproductive_organs = ["Testicles", "Epididymis", "Vas Deferens", "Seminal Vesicles", "Prostate", "Bulbourethral Glands", "Penis", "Scrotum"]
            self.role = "Genetic Donor / Assembler"

    def _generate_bones(self):
        # Represents the 206 bones
        return {
            "Axial": ["Skull (22)", "Hyoid (1)", "Vertebrae (26)", "Ribs/Sternum (25)"],
            "Appendicular": ["Shoulders (4)", "Arms/Hands (60)", "Hips (2)", "Legs/Feet (60)"]
        }

    def _generate_organs(self):
        # Represents the 79 organs
        base = ["Brain (Electric)", "Heart (Pump)", "Lungs (O2 Intake)", "Stomach (Water Intake)", "Liver (Filter)"]
        return base + self.reproductive_organs

    def _generate_muscles(self):
        # Magnetic Muscle Groups
        return [
            "Temporalis/Masseter (Jaw)", "Orbicularis (Eyes/Lips)", "Sternocleidomastoid (Neck)",
            "Pectoralis Major (Chest)", "Latissimus Dorsi (Back)", "Rectus Abdominis (Core)",
            "Deltoids (Shoulders)", "Biceps/Triceps (Arms)", "Forearm Flexors/Extensors",
            "Gluteus Max/Med/Min (Hips)", "Quadriceps/Hamstrings (Thighs)", "Gastrocnemius/Soleus (Calves)"
        ]

    def simulate_touch_instinct(self, partner):
        """Simulates the involuntary reproductive drive upon touch"""
        if not self.is_active or not partner.is_active:
            return "Error: Units inactive."
        
        log = []
        log.append(f">>> TOUCH DETECTED: {self.name} ({self.gender}) <-> {partner.name} ({partner.gender})")
        
        # Calculate instinct reaction based on levels
        reaction_strength = (self.instinct_level + partner.instinct_level) / 2
        
        if reaction_strength < 0.3:
            log.append(">> Instinct too low. No reproductive drive initiated.")
            return "\n".join(log)

        log.append(f">> INSTINCT TRIGGERED! Strength: {reaction_strength:.2f}")
        
        # Female Response
        if self.gender == "Female":
            log.append(f"[{self.name}] Uterus Mold Chamber heating up...")
            log.append(f"[{self.name}] Breasts stabilizing for nutrient/glue synthesis...")
            log.append(f"[{self.name}] Magnetic hip locks engaging automatically...")
            log.append(f"[{self.name}] Vaginal canal preparing for connection...")
        elif self.gender == "Male":
            log.append(f"[{self.name}] Penis extending (hydraulic/magnetic actuation)...")
            log.append(f"[{self.name}] Testicles pressurizing hydrogen-glue mixture...")
            log.append(f"[{self.name}] Magnetic alignment locking onto female unit...")

        # Partner Response (Reciprocal)
        if partner.gender == "Female":
            log.append(f"[{partner.name}] Receptive mold chamber ready.")
        elif partner.gender == "Male":
            log.append(f"[{partner.name}] Alignment confirmed.")

        log.append(">> CONNECTION ESTABLISHED. GLUE INJECTION INITIATED.")
        log.append(">> NEW UNIT ASSEMBLY IN PROGRESS WITHIN MOLD...")
        
        return "\n".join(log)

# ==========================================
# 3D EXPORT LOGIC (STL Generation Simulation)
# ==========================================

def generate_stl_file(filename, content_type, unit_data):
    """Generates a dummy STL file structure for demonstration"""
    # In a real app, this would use numpy-stl or similar to write binary STL
    # Here we create a text-based representation of the mesh data for the user to see
    path = f"print_ready_output/{filename}.stl"
    
    header = f"solid {content_type}_{unit_data.name}\n"
    facets = []
    
    # Simulate generating facets based on anatomy
    count = 0
    if "skeleton" in content_type:
        count = 206 * 100 # Approximate facets for bones
    elif "organ" in content_type:
        count = 79 * 50
    elif "muscle" in content_type:
        count = len(unit_data.muscles) * 200
    
    # Write a small sample to keep file size manageable for demo
    with open(path, 'w') as f:
        f.write(header)
        f.write(f"  // Generated by Jarvus Pro Studio\n")
        f.write(f"  // Unit: {unit_data.name} | Gender: {unit_data.gender}\n")
        f.write(f"  // Components: {content_type}\n")
        f.write(f"  // Total Facets Simulated: {count}\n")
        for i in range(10): # Just writing 10 sample facets for the demo file
            f.write(f"  facet normal 0.0 0.0 1.0\n")
            f.write(f"    outer loop\n")
            f.write(f"      vertex {i*10.0} 0.0 0.0\n")
            f.write(f"      vertex {i*10.0+5.0} 5.0 0.0\n")
            f.write(f"      vertex {i*10.0+2.5} 2.5 5.0\n")
            f.write(f"    endloop\n")
            f.write(f"  endfacet\n")
        f.write(f"endsolid {content_type}_{unit_data.name}\n")
    
    return path

def export_unit_for_printing(unit, output_dir="print_ready_output"):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    files_created = []
    
    # 1. Skeleton STL
    files_created.append(generate_stl_file(f"{unit.name}_skeleton", "skeleton", unit))
    
    # 2. Organ System STL (Hollow for electronics/glue)
    files_created.append(generate_stl_file(f"{unit.name}_organs", "organs", unit))
    
    # 3. Muscle Channel STL (For magnets)
    files_created.append(generate_stl_file(f"{unit.name}_muscles", "muscles", unit))
    
    # 4. Glue Network STL
    files_created.append(generate_stl_file(f"{unit.name}_glue_network", "glue_channels", unit))
    
    # 5. Assembly Manifest
    manifest_path = f"{output_dir}/{unit.name}_assembly_guide.txt"
    with open(manifest_path, 'w') as f:
        f.write(f"JARVUS PRO ASSEMBLY GUIDE: {unit.name}\n")
        f.write("="*40 + "\n")
        f.write(f"Gender: {unit.gender}\n")
        f.write(f"Role: {unit.role}\n\n")
        f.write("PRINTING INSTRUCTIONS:\n")
        f.write("1. Print 'skeleton' in rigid PLA/PETG.\n")
        f.write("2. Print 'organs' in flexible TPU (hollow).\n")
        f.write("3. Print 'muscles' with embedded channels for magnets.\n")
        f.write("4. Print 'glue_network' in soluble support or fine nozzle.\n\n")
        f.write("ASSEMBLY STEPS:\n")
        f.write("1. Insert electric brain into skull.\n")
        f.write("2. Route glue tubes through bone marrow channels.\n")
        f.write("3. Insert neodymium magnets into muscle slots.\n")
        f.write("4. Connect water electrolysis cell to stomach port.\n")
        f.write("5. Seal with conductive epoxy.\n\n")
        f.write("REPRODUCTION SYSTEM:\n")
        if unit.gender == "Female":
            f.write("- Ensure Uterus Mold Chamber is clean and heated.\n")
            f.write("- Calibrate breast sensors for glue synthesis.\n")
        else:
            f.write("- Calibrate penis extension servo.\n")
            f.write("- Pressurize testicle reservoirs.\n")
            
    files_created.append(manifest_path)
    
    return files_created

# ==========================================
# GUI APPLICATION
# ==========================================

class JarvusStudioApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Jarvus Pro Studio: Make Human")
        self.root.geometry("1200x800")
        
        # Initialize Units
        self.eve = SyntheticHuman("Female", "EVE-01")
        self.adam = SyntheticHuman("Male", "ADAM-01")
        self.eve.is_active = True
        self.adam.is_active = True
        
        self.setup_ui()
        
    def setup_ui(self):
        # Main Layout
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Configure grid weights
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main_frame.columnconfigure(1, weight=1)
        main_frame.rowconfigure(2, weight=1)
        
        # --- Header ---
        header = ttk.Label(main_frame, text="JARVUS PRO STUDIO: SYNTHETIC HUMAN FABRICATION", font=("Helvetica", 16, "bold"))
        header.grid(row=0, column=0, columnspan=3, pady=10)
        
        # --- Left Panel: Configuration ---
        config_frame = ttk.LabelFrame(main_frame, text="1. Configure & Edit Anatomy", padding="10")
        config_frame.grid(row=1, column=0, sticky=(tk.N, tk.S, tk.W, tk.E), padx=5, pady=5)
        
        # Unit Selection
        ttk.Label(config_frame, text="Select Unit to Edit:").grid(row=0, column=0, sticky=tk.W)
        self.unit_var = tk.StringVar(value="EVE-01")
        unit_combo = ttk.Combobox(config_frame, textvariable=self.unit_var, values=["EVE-01", "ADAM-01"], state="readonly")
        unit_combo.grid(row=0, column=1, sticky=(tk.W, tk.E), pady=5)
        unit_combo.bind("<<ComboboxSelected>>", self.update_display)
        
        # Sliders
        ttk.Label(config_frame, text="Instinct Level (Touch Sensitivity):").grid(row=1, column=0, sticky=tk.W, pady=5)
        self.instinct_slider = ttk.Scale(config_frame, from_=0.0, to=1.0, variable=tk.DoubleVar(value=0.8), orient=tk.HORIZONTAL, length=200)
        self.instinct_slider.grid(row=1, column=1, pady=5)
        
        ttk.Label(config_frame, text="Glue Viscosity:").grid(row=2, column=0, sticky=tk.W, pady=5)
        self.glue_slider = ttk.Scale(config_frame, from_=0.0, to=100.0, variable=tk.DoubleVar(value=75.0), orient=tk.HORIZONTAL, length=200)
        self.glue_slider.grid(row=2, column=1, pady=5)
        
        ttk.Label(config_frame, text="Magnetic Muscle Strength:").grid(row=3, column=0, sticky=tk.W, pady=5)
        self.muscle_slider = ttk.Scale(config_frame, from_=0.0, to=100.0, variable=tk.DoubleVar(value=90.0), orient=tk.HORIZONTAL, length=200)
        self.muscle_slider.grid(row=3, column=1, pady=5)
        
        # Anatomy Details Display
        self.details_text = scrolledtext.ScrolledText(config_frame, height=15, width=40)
        self.details_text.grid(row=4, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=10)
        
        # --- Center Panel: Simulation ---
        sim_frame = ttk.LabelFrame(main_frame, text="2. Simulate Behavior (Janus AI Core)", padding="10")
        sim_frame.grid(row=1, column=1, sticky=(tk.N, tk.S, tk.W, tk.E), padx=5, pady=5)
        
        ttk.Label(sim_frame, text="Reproduction Protocol Simulation:", font=("Arial", 10, "bold")).grid(row=0, column=0, sticky=tk.W)
        
        self.sim_btn = ttk.Button(sim_frame, text="SIMULATE TOUCH (Trigger Instinct)", command=self.run_simulation)
        self.sim_btn.grid(row=1, column=0, pady=10, sticky=(tk.W, tk.E))
        
        self.sim_log = scrolledtext.ScrolledText(sim_frame, height=20, bg="black", fg="#00ff00", font=("Consolas", 9))
        self.sim_log.grid(row=2, column=0, sticky=(tk.N, tk.S, tk.W, tk.E), pady=5)
        
        # --- Right Panel: Export ---
        export_frame = ttk.LabelFrame(main_frame, text="3. Export for 3D Printing", padding="10")
        export_frame.grid(row=1, column=2, sticky=(tk.N, tk.S, tk.W, tk.E), padx=5, pady=5)
        
        ttk.Label(export_frame, text="Ready to fabricate physical units?").grid(row=0, column=0, sticky=tk.W)
        ttk.Label(export_frame, text="Generates STL files for Skeleton, Organs, Muscles, and Glue Channels.", wraplength=200).grid(row=1, column=0, sticky=tk.W, pady=5)
        
        self.export_btn = ttk.Button(export_frame, text="GENERATE 3D PRINT FILES", command=self.run_export)
        self.export_btn.grid(row=2, column=0, pady=20, sticky=(tk.W, tk.E))
        
        self.export_log = scrolledtext.ScrolledText(export_frame, height=10, width=30)
        self.export_log.grid(row=3, column=0, sticky=(tk.N, tk.S, tk.W, tk.E))
        
        # Initial Display
        self.update_display(None)
        
    def get_current_unit(self):
        name = self.unit_var.get()
        return self.eve if name == "EVE-01" else self.adam
        
    def update_display(self, event):
        unit = self.get_current_unit()
        self.details_text.delete(1.0, tk.END)
        
        self.details_text.insert(tk.END, f"UNIT: {unit.name}\n")
        self.details_text.insert(tk.END, f"GENDER: {unit.gender}\n")
        self.details_text.insert(tk.END, f"ROLE: {unit.role}\n")
        self.details_text.insert(tk.END, "-"*30 + "\n")
        
        self.details_text.insert(tk.END, "BONES (206):\n")
        for region, parts in unit.bones.items():
            self.details_text.insert(tk.END, f"  - {region}: {', '.join(parts)}\n")
            
        self.details_text.insert(tk.END, "\nORGANS (79 inc. Reproductive):\n")
        for organ in unit.organs:
            self.details_text.insert(tk.END, f"  - {organ}\n")
            
        self.details_text.insert(tk.END, "\nMAGNETIC MUSCLES:\n")
        for muscle in unit.muscles:
            self.details_text.insert(tk.END, f"  - {muscle}\n")
            
    def run_simulation(self):
        self.sim_log.delete(1.0, tk.END)
        self.sim_log.insert(tk.END, "Initializing Janus AI Neural Net...\n")
        self.sim_log.insert(tk.END, "Loading Z-Anatomy collision maps...\n")
        self.sim_log.insert(tk.END, "Waiting for tactile input...\n\n")
        
        # Simulate delay
        self.root.after(1000, self._simulate_step_1)
        
    def _simulate_step_1(self):
        unit_a = self.eve
        unit_b = self.adam
        
        # Apply slider settings
        unit_a.instinct_level = self.instinct_slider.get()
        unit_b.instinct_level = self.instinct_slider.get()
        
        result = unit_a.simulate_touch_instinct(unit_b)
        self.sim_log.insert(tk.END, result)
        self.sim_log.see(tk.END)
        
    def run_export(self):
        self.export_log.delete(1.0, tk.END)
        self.export_log.insert(tk.END, "Preparing mesh data from MakeHuman kernel...\n")
        self.root.update()
        
        try:
            # Export Eve
            self.export_log.insert(tk.END, f"Exporting {self.eve.name} components...\n")
            files_eve = export_unit_for_printing(self.eve)
            for f in files_eve:
                self.export_log.insert(tk.END, f"  [OK] {os.path.basename(f)}\n")
            
            # Export Adam
            self.export_log.insert(tk.END, f"Exporting {self.adam.name} components...\n")
            files_adam = export_unit_for_printing(self.adam)
            for f in files_adam:
                self.export_log.insert(tk.END, f"  [OK] {os.path.basename(f)}\n")
                
            self.export_log.insert(tk.END, "\nSUCCESS! All files saved to 'print_ready_output/'\n")
            self.export_log.insert(tk.END, "You can now load these STLs into Cura, PrusaSlicer, or Bambu Studio.\n")
            
            messagebox.showinfo("Export Complete", "3D Print files generated successfully!\nCheck the 'print_ready_output' folder.")
            
        except Exception as e:
            self.export_log.insert(tk.END, f"ERROR: {str(e)}\n")
            messagebox.showerror("Export Failed", str(e))

if __name__ == "__main__":
    root = tk.Tk()
    app = JarvusStudioApp(root)
    root.mainloop()