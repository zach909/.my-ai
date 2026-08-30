import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import random
import time
import threading

class JarvusProInterface:
    def __init__(self, root):
        self.root = root
        self.root.title("JARVUS PRO: MAKE HUMAN - Control Interface")
        self.root.geometry("1200x800")
        self.root.configure(bg="#1a1a1a")

        # State Variables
        self.glue_level = 100
        self.water_level = 100
        self.power_level = 100
        self.mold_status = "Ready"
        self.reproduction_active = False
        self.instinct_triggered = False

        # Styles
        style = ttk.Style()
        style.theme_use('clam')
        style.configure("TFrame", background="#1a1a1a")
        style.configure("TLabel", background="#1a1a1a", foreground="#00ffcc", font=("Consolas", 10))
        style.configure("Header.TLabel", font=("Consolas", 14, "bold"), foreground="#ffffff")
        style.configure("Red.TLabel", foreground="#ff4444")
        style.configure("Green.TLabel", foreground="#00ff00")
        
        style.configure("TButton", font=("Consolas", 10, "bold"), padding=5)
        style.map("TButton", background=[("active", "#005555")])
        
        style.configure("Vertical.TProgressbar", troughcolor='#333333', background='#00ffcc')
        style.configure("Horizontal.TProgressbar", troughcolor='#333333', background='#00ffcc')

        self.setup_layout()
        self.update_loop()

    def setup_layout(self):
        # Main Container
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.pack(fill=tk.BOTH, expand=True)

        # Header
        header = ttk.Label(main_frame, text="JARVUS PRO: SYNTHETIC HUMAN CONTROL SYSTEM", style="Header.TLabel")
        header.pack(pady=(0, 20))

        # Top Panel: Status & Vitals
        top_frame = ttk.Frame(main_frame)
        top_frame.pack(fill=tk.X, pady=10)

        # Left: System Vitals
        vitals_frame = ttk.LabelFrame(top_frame, text="SYSTEM VITALS", padding=10)
        vitals_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=5)

        self.create_progress(vitals_frame, "Self-Healing Glue", 0, 0)
        self.create_progress(vitals_frame, "Water Reserve (H2O)", 1, 0)
        self.create_progress(vitals_frame, "Power (H2/O2 Electrolysis)", 2, 0)

        # Right: Unit Selection & Anatomy Summary
        unit_frame = ttk.LabelFrame(top_frame, text="ACTIVE UNITS", padding=10)
        unit_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=5)

        self.unit_var = tk.StringVar(value="EVE-01 (Female)")
        unit_combo = ttk.Combobox(unit_frame, textvariable=self.unit_var, values=["EVE-01 (Female)", "ADAM-01 (Male)"], state="readonly")
        unit_combo.pack(pady=5)
        unit_combo.bind("<<ComboboxSelected>>", self.on_unit_change)

        self.anatomy_label = ttk.Label(unit_frame, text="", wraplength=300, justify=tk.LEFT)
        self.anatomy_label.pack(pady=10, fill=tk.X)
        self.update_anatomy_summary()

        # Middle Panel: Controls & Simulation
        mid_frame = ttk.Frame(main_frame)
        mid_frame.pack(fill=tk.BOTH, expand=True, pady=10)

        # Left: Manual Controls
        control_frame = ttk.LabelFrame(mid_frame, text="MANUAL OVERRIDE", padding=10)
        control_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=5)

        ttk.Button(control_frame, text="Inject Healing Glue", command=self.inject_glue).pack(fill=tk.X, pady=5)
        ttk.Button(control_frame, text="Split Water (Electrolysis)", command=self.split_water).pack(fill=tk.X, pady=5)
        ttk.Button(control_frame, text="Activate Magnetic Muscles", command=self.activate_muscles).pack(fill=tk.X, pady=5)
        ttk.Button(control_frame, text="Run Diagnostic (206 Bones/79 Organs)", command=self.run_diagnostic).pack(fill=tk.X, pady=5)

        # Right: Reproduction Chamber (The Core Feature)
        repro_frame = ttk.LabelFrame(mid_frame, text="REPRODUCTION CHAMBER (INSTINCT MODE)", padding=10, borderwidth=2, relief=tk.GROOVE)
        repro_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=5)

        ttk.Label(repro_frame, text="WARNING: Touch triggers involuntary reproductive instinct.", style="Red.TLabel", wraplength=250).pack(pady=5)
        
        self.status_display = ttk.Label(repro_frame, text="STATUS: IDLE", font=("Consolas", 12, "bold"), foreground="#ffffff")
        self.status_display.pack(pady=10)

        self.touch_btn = ttk.Button(repro_frame, text="SIMULATE TOUCH (TRIGGER INSTINCT)", command=self.trigger_instinct)
        self.touch_btn.pack(fill=tk.X, pady=10)
        
        self.progress_repro = ttk.Progressbar(repro_frame, orient=tk.HORIZONTAL, length=300, mode='determinate')
        self.progress_repro.pack(pady=10)

        # Bottom Panel: Logs
        log_frame = ttk.LabelFrame(main_frame, text="SYSTEM LOGS", padding=5)
        log_frame.pack(fill=tk.BOTH, expand=True, pady=5)

        self.log_text = scrolledtext.ScrolledText(log_frame, height=10, bg="#000000", fg="#00ffcc", font=("Consolas", 9))
        self.log_text.pack(fill=tk.BOTH, expand=True)
        self.log("System Initialized. Janus AI Brain Online. Z-Anatomy Maps Loaded.")
        self.log("MakeHuman Mold Generator Ready.")
        self.log("Waiting for user input...")

    def create_progress(self, parent, label, row, col):
        ttk.Label(parent, text=label).grid(row=row, column=col, sticky=tk.W, pady=2)
        bar = ttk.Progressbar(parent, orient=tk.HORIZONTAL, length=200, mode='determinate')
        bar.grid(row=row, column=col+1, padx=10, pady=2)
        setattr(self, f"{label.split()[0].lower()}_bar", bar)
        self.update_bars()

    def update_bars(self):
        self.glue_bar['value'] = self.glue_level
        self.water_bar['value'] = self.water_level
        self.power_bar['value'] = self.power_level
        
        if self.glue_level < 30: self.glue_bar.configure(style="Red.Horizontal.TProgressbar")
        else: self.glue_bar.configure(style="Horizontal.TProgressbar")

    def on_unit_change(self, event):
        self.update_anatomy_summary()
        self.log(f"Switched view to {self.unit_var.get()}")

    def update_anatomy_summary(self):
        unit = self.unit_var.get()
        if "Female" in unit:
            text = "UNIT: EVE-01\n\n"
            text += "SKELETON: 206 Bones (Axial/Appendicular)\n"
            text += "MUSCLES: Magnetic Actuator Array\n"
            text += "ORGANS: 79 Total\n"
            text += "REPRODUCTIVE:\n"
            text += "- Breasts (Synthetic Mammary Glands)\n"
            text += "- Uterus (Mold Chamber)\n"
            text += "- Ovaries, Fallopian Tubes, Vagina\n"
            text += "- Role: Mold Creator / Builder"
        else:
            text = "UNIT: ADAM-01\n\n"
            text += "SKELETON: 206 Bones (Axial/Appendicular)\n"
            text += "MUSCLES: Magnetic Actuator Array\n"
            text += "ORGANS: 79 Total\n"
            text += "REPRODUCTIVE:\n"
            text += "- Penis (Injection Port)\n"
            text += "- Testicles (Glue/H2 Generator)\n"
            text += "- Prostate, Seminal Vesicles\n"
            text += "- Role: Genetic/Material Donor"
        
        self.anatomy_label.config(text=text)

    def log(self, message):
        timestamp = time.strftime("%H:%M:%S")
        self.log_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.log_text.see(tk.END)

    # --- Actions ---

    def inject_glue(self):
        if self.glue_level < 100:
            self.glue_level = min(100, self.glue_level + 20)
            self.log("Manual Glue Injection initiated. Binding agents active.")
            self.update_bars()
        else:
            self.log("Glue reservoir full.")

    def split_water(self):
        if self.water_level > 5:
            self.water_level -= 5
            self.power_level = min(100, self.power_level + 15)
            self.glue_level = min(100, self.glue_level + 5) # Byproduct
            self.log("Electrolysis Active: H2O -> H2 (Fuel) + O2 (Oxidizer). Glue byproduct generated.")
            self.update_bars()
        else:
            self.log("WARNING: Water levels critical! Cannot split.")

    def activate_muscles(self):
        self.log("Magnetic Muscles Engaged. Electromagnetic pulses sent to all 600+ muscle groups.")
        self.log("Movement simulation: Flexion/Extension nominal.")

    def run_diagnostic(self):
        self.log("Running Full Z-Anatomy Diagnostic...")
        self.log("- Scanning 206 Bones... OK")
        self.log("- Scanning 79 Organs... OK")
        self.log("- Checking Reproductive Systems... OK")
        self.log("- Janus Neural Net Integrity... 100%")

    def trigger_instinct(self):
        if self.reproduction_active:
            return
        
        self.reproduction_active = True
        self.instinct_triggered = True
        self.touch_btn.config(state=tk.DISABLED)
        self.log("!!! CRITICAL EVENT: PHYSICAL TOUCH DETECTED !!!")
        self.log("Instinctive Reproductive Protocol Initiated. Override disabled.")
        
        # Start the simulation thread
        thread = threading.Thread(target=self.reproduction_sequence)
        thread.start()

    def reproduction_sequence(self):
        steps = [
            ("Pheromone/Sensor Lock", 10),
            ("Magnetic Muscle Lock (Hip/Pelvis)", 20),
            ("Female: Uterus Mold Chamber Heating", 30),
            ("Male: Penis Extension & Pressure Build", 40),
            ("Connection Established", 50),
            ("Injecting Binding Glue & Hydrogen Seed", 70),
            ("Mold Filling: Skeleton Formation", 85),
            ("Organ Synthesis (79 Organs)", 95),
            ("New Unit Sealed. Cycle Complete.", 100)
        ]

        for step, progress in steps:
            time.sleep(0.8) # Simulate processing time
            self.progress_repro['value'] = progress
            self.status_display.config(text=f"STATUS: {step}")
            self.log(f"Auto-Process: {step}")
            
            # Consume resources
            self.glue_level = max(0, self.glue_level - 2)
            self.power_level = max(0, self.power_level - 2)
            self.update_bars()

        self.reproduction_active = False
        self.touch_btn.config(state=tk.NORMAL)
        self.status_display.config(text="STATUS: IDLE (Cycle Complete)")
        self.log("SUCCESS: New Synthetic Human Mold Created.")
        messagebox.showinfo("Reproduction Complete", "A new synthetic human has been successfully assembled via instinctive touch protocol.")

    def update_loop(self):
        # Passive resource consumption
        if self.power_level > 0:
            self.power_level -= 0.1
        if self.glue_level > 0 and not self.reproduction_active:
            self.glue_level -= 0.05
        
        self.update_bars()
        self.root.after(1000, self.update_loop)

if __name__ == "__main__":
    root = tk.Tk()
    app = JarvusProInterface(root)
    root.mainloop()