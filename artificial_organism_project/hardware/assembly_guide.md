# Assembly Guide - Stage 2 Prototype

## Overview
This guide walks you through building a palm-sized artificial organism prototype that demonstrates:
- Energy processing and storage
- Fluid transport (circulatory system)
- Artificial muscle contraction
- Self-repair material delivery
- Neural network control

**Total Build Time:** 40-60 hours over 6-12 weeks

---

## Phase 1: Preparation (Week 1-2)

### Step 1.1: Order All Components
Use the BOM.csv to order all parts. Lead times vary:
- Electronics: 3-7 days
- SMA wire: 5-10 days (specialty item)
- 3D printed parts: 2-5 days (if outsourcing)
- Pumps/valves: 5-14 days

### Step 1.2: Prepare Workspace
Set up a clean, well-lit workbench with:
- Anti-static mat
- Good ventilation (for resin work)
- Power outlets
- Storage containers for small parts

### Step 1.3: 3D Print Parts
Print the following from CAD files:
1. **organism_body.stl** - Main chassis (PLA, 0.2mm layer height)
2. **channel_network.stl** - Fluid pathways (TPE flexible filament)
3. **muscle_mounts.stl** - SMA anchors (PLA, high infill 80%)
4. **electronics_bay.stl** - Controller housing (PLA)

**Print Settings:**
- Nozzle temp: 210°C (PLA), 230°C (TPE)
- Bed temp: 60°C
- Infill: 40% (body), 100% (mounts)
- Supports: Yes for overhangs

---

## Phase 2: Electronics Assembly (Week 3-4)

### Step 2.1: Prepare ESP32 Controller
1. Solder header pins to ESP32 DevKit
2. Install Arduino IDE or PlatformIO
3. Test basic functionality with Blink example

### Step 2.2: Wire Power System
```
Battery (+) → TP4056 B+ → Buck Converter VIN
Buck Converter VOUT → ESP32 VIN (5V)
Buck Converter VOUT → 3.3V LDO → ESP32 3.3V pin
Supercapacitor (+) → Battery (+) via 10Ω resistor
Supercapacitor (-) → Battery (-)
```

**Test:** Measure 3.3V at ESP32 pin before proceeding.

### Step 2.3: Connect Motor Drivers
1. Mount L298N modules in electronics bay
2. Wire pump outputs:
   - OUT1/OUT2 → Pump 1 (main circulation)
   - OUT3/OUT4 → Pump 2 (repair fluid)
3. Connect control signals to ESP32:
   - IN1 → GPIO 26
   - IN2 → GPIO 27
   - IN3 → GPIO 14
   - IN4 → GPIO 12

### Step 2.4: Install MOSFET Module for SMA
1. Mount 4-channel MOSFET board
2. Wire SMA connections:
   - Channel 1 → Muscle Front-Left
   - Channel 2 → Muscle Front-Right
   - Channel 3 → Muscle Back-Left
   - Channel 4 → Muscle Back-Right
3. Connect gate signals:
   - G1 → GPIO 25
   - G2 → GPIO 33
   - G3 → GPIO 32
   - G4 → GPIO 23

### Step 2.5: Add Sensors
**Current Sensors (INA219):**
- Wire one per muscle channel
- I2C address: 0x40, 0x41, 0x44, 0x45
- Shared SDA/SCL bus

**IMU (MPU6050):**
- VCC → 3.3V
- GND → GND
- SDA → GPIO 21
- SCL → GPIO 22
- INT → GPIO 4 (optional)

**OLED Display:**
- VCC → 3.3V
- GND → GND
- SDA → GPIO 21 (shared with sensors)
- SCL → GPIO 22 (shared with sensors)

---

## Phase 3: Mechanical Assembly (Week 5-6)

### Step 3.1: Install SMA Muscles
**Training SMA Wire (Critical Step):**
1. Cut 4 pieces of Nitinol wire, 30cm each
2. Stretch wire to 3-5% elongation
3. Heat to 400-450°C for 10 minutes
4. Cool slowly (furnace cool or insulate)
5. This "remembers" the stretched length

**Mounting:**
1. Thread wire through muscle_mounts.stl
2. Secure ends with set screws
3. Pre-tension to 2-3% strain
4. Route wires to MOSFET terminals

### Step 3.2: Build Microfluidic Network
1. Cut silicone tubing to lengths:
   - Main artery: 15cm
   - Branch channels: 4x 8cm
   - Return veins: 4x 10cm
2. Insert tubing into 3D printed channel_network.stl
3. Use superglue or silicone sealant at joints
4. Pressure test with water (no leaks!)

### Step 3.3: Install Peristaltic Pumps
1. Mount pumps in designated slots
2. Connect tubing:
   - Pump 1: Main circulation loop
   - Pump 2: Repair reservoir → damage sites
   - Pump 3-4: Auxiliary flow (optional)
3. Prime pumps with water before final assembly

### Step 3.4: Assemble Body
1. Place electronics bay in lower compartment
2. Route all wires through cable guides
3. Install channel network in upper body
4. Attach muscle mounts to outer shell
5. Close body halves with M2 screws
6. Leave access panel for maintenance

---

## Phase 4: Firmware Installation (Week 7)

### Step 4.1: Flash Base Firmware
1. Clone repository or copy firmware folder
2. Open `organism_controller.ino` in Arduino IDE
3. Install required libraries:
   - Adafruit GFX
   - Adafruit SSD1306
   - MPU6050_tockn
   - INA219_WE
4. Select board: "ESP32 Dev Module"
5. Upload via USB

### Step 4.2: Configure Parameters
Edit `config.h`:
```cpp
#define ENERGY_CAPACITY_MAH 2000
#define MUSCLE_COUNT 4
#define PUMP_SPEED_PWM 180
#define REPAIR_THRESHOLD 0.3
#define SMA_MAX_CURRENT_A 1.5
```

### Step 4.3: Calibrate Sensors
Run calibration sketch:
1. Zero current sensors (no load)
2. Calibrate IMU (flat surface, 10 seconds)
3. Test pump speeds (PWM 0-255)
4. Verify muscle activation (brief pulses)

---

## Phase 5: Testing & Validation (Week 8-9)

### Step 5.1: Energy System Test
1. Charge battery to 100%
2. Run pumps at 50% for 10 minutes
3. Monitor voltage drop
4. Verify supercapacitor buffering

**Expected:** Voltage stable within ±0.2V

### Step 5.2: Muscle Contraction Test
1. Activate each muscle individually
2. Measure contraction distance (target: 3-5%)
3. Check current draw (target: <1.5A per muscle)
4. Verify temperature rise (<60°C safe)

### Step 5.3: Transport System Test
1. Fill circulation loop with colored water
2. Run main pump at various speeds
3. Check for leaks at all joints
4. Measure flow rate (target: 50-100 mL/min)

### Step 5.4: Repair System Test
1. Simulate damage (loosen fitting slightly)
2. Trigger repair mode via serial command
3. Inject epoxy simulant (colored water for testing)
4. Verify delivery to damage site

### Step 5.5: Neural Control Test
1. Send movement commands via serial
2. Observe coordinated muscle activation
3. Test reflex responses (IMU-triggered)
4. Verify AI goal execution

---

## Phase 6: Demonstration (Week 10+)

### Demo Sequence
Run this sequence to showcase all systems:

1. **Startup** - OLED displays energy level,自检 complete
2. **Energy Harvest** - Show input simulation, storage increase
3. **Movement** - Contract muscles in wave pattern
4. **Damage Event** - Simulate puncture (button press)
5. **Repair Response** - Pump activates, delivers "repair fluid"
6. **Recovery** - Return to normal operation

### Success Criteria
✅ Energy level maintained above 50%
✅ All 4 muscles contract on command
✅ Fluid flows without leaks
✅ Repair material reaches target in <30 seconds
✅ Controller responds to sensor feedback
✅ System runs autonomously for 10+ minutes

---

## Troubleshooting

| Problem | Likely Cause | Solution |
|---------|--------------|----------|
| Muscles don't contract | Insufficient current | Check MOSFET wiring, increase PWM |
| Pumps not priming | Air bubbles | Tap tubing, run reverse briefly |
| ESP32 resets randomly | Power sag | Add capacitor near VIN, check battery |
| I2C devices not found | Address conflict | Check pullup resistors, verify addresses |
| Leaks at joints | Poor seal | Re-glue with silicone, tighten fittings |
| SMA overheats | Duty cycle too high | Reduce ON time, add cooling pauses |

---

## Next Steps After Completion

1. Document your build with photos/video
2. Run extended endurance tests (hours/days)
3. Experiment with different gaits/movements
4. Add more sensors (temperature, pressure)
5. Implement machine learning for adaptive control
6. Scale up to larger prototype (Stage 3)

---

## Safety Reminders

- 🔥 SMA wires get HOT (60-80°C) - avoid contact
- ⚡ Li-ion batteries can catch fire if damaged
- 🧪 Epoxy resin requires ventilation and gloves
- 🔪 Sharp tools when cutting tubing/wire
- 👓 Always wear safety glasses during assembly

**Congratulations! You've built a working artificial organism prototype.**
