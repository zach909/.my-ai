# Test Procedures - Stage 2 Prototype

## Overview
This document contains validation tests for each subsystem of the artificial organism prototype. Run these tests after assembly to verify correct operation.

---

## Test 1: Energy System Validation

**File:** `energy_test.md`

### Objective
Verify energy storage, monitoring, and distribution systems function correctly.

### Equipment Needed
- Multimeter
- Serial monitor (115200 baud)
- Variable load (optional)

### Procedure

#### 1.1 Voltage Check
1. Power on organism
2. Measure battery voltage at TP1 (test point)
3. Expected: 3.7V - 4.2V (depending on charge level)

#### 1.2 Regulation Check
1. Measure 5V rail at ESP32 VIN pin
2. Expected: 5.0V ±0.2V
3. Measure 3.3V rail at ESP32 3V3 pin
4. Expected: 3.3V ±0.1V

#### 1.3 Capacity Test
1. Note initial energy percentage from OLED
2. Run all pumps at 100% for 10 minutes
3. Run all muscles at 50% for 5 minutes
4. Record final energy percentage
5. Expected: ~15-25% decrease

#### 1.4 Low Energy Warning
1. Discharge battery to ~15% (or simulate via software)
2. Check OLED for low energy warning
3. Expected: "LOW ENERGY" message appears

### Pass Criteria
- ✅ All voltages within spec
- ✅ Energy monitoring accurate
- ✅ Low energy warning triggers
- ✅ No unexpected resets

---

## Test 2: Muscle Contraction Test

**File:** `muscle_test.md`

### Objective
Verify SMA muscles contract/relax correctly with proper force and timing.

### Equipment Needed
- Ruler or caliper
- Infrared thermometer (optional)
- Current meter

### Procedure

#### 2.1 Individual Muscle Test
For each muscle (1-4):
1. Send command: `MUSCLE <n> 0.5`
2. Measure contraction distance
3. Expected: 3-5% of length (~9-15mm for 30cm wire)
4. Measure current draw
5. Expected: 0.5-1.5A depending on activation
6. Send command: `MUSCLE <n> 0`
7. Verify relaxation within 2-3 seconds

#### 2.2 Temperature Check
1. Activate muscle at 70% for 10 seconds
2. Measure temperature with IR thermometer
3. Expected: 50-70°C (safe operating range)
4. Maximum: <80°C

#### 2.3 Wave Pattern Test
1. Activate wave pattern mode
2. Observe sequential contraction
3. Expected: Smooth wave motion
4. Frequency: 1-2 Hz adjustable

#### 2.4 Endurance Test
1. Cycle all muscles 100 times (on/off)
2. Check for degradation in performance
3. Expected: Consistent contraction throughout

### Pass Criteria
- ✅ All muscles contract on command
- ✅ Contraction distance within spec
- ✅ Current draw within limits
- ✅ Temperature stays safe
- ✅ No wire breakage after cycling

---

## Test 3: Transport System Test

**File:** `transport_test.md`

### Objective
Verify fluid circulation system operates without leaks and delivers adequate flow.

### Equipment Needed
- Colored water
- Graduated cylinder
- Timer
- Paper towels (for spills)

### Procedure

#### 3.1 Leak Test
1. Fill reservoir with colored water
2. Run main pump at 50% for 5 minutes
3. Inspect all joints and connections
4. Expected: Zero leaks

#### 3.2 Flow Rate Measurement
1. Disconnect outlet tubing into graduated cylinder
2. Run pump at default speed (PWM 150) for 1 minute
3. Measure collected volume
4. Expected: 60-100 mL/min

#### 3.3 Variable Speed Test
1. Set pump speeds: 25%, 50%, 75%, 100%
2. Measure flow rate at each setting
3. Expected: Linear relationship

#### 3.4 Prime Test
1. Introduce air bubble into system
2. Activate prime mode
3. Expected: Air removed within 30 seconds

### Pass Criteria
- ✅ No leaks at any pressure
- ✅ Flow rate meets minimum spec
- ✅ Speed control responsive
- ✅ Priming effective

---

## Test 4: Repair System Test

**File:** `repair_test.md`

### Objective
Verify damage detection and repair material delivery functions correctly.

### Equipment Needed
- Colored water (repair simulant)
- Stopwatch
- Serial monitor

### Procedure

#### 4.1 Simulated Damage
1. Send command: `DAMAGE`
2. Observe OLED status change
3. Expected: "STATUS: REPAIRING" appears
4. Check serial log for damage report

#### 4.2 Repair Delivery
1. Mark target location on prototype
2. Trigger damage event
3. Time delivery from trigger to arrival
4. Expected: <30 seconds
5. Verify fluid reaches target

#### 4.3 Severity Response
Test three severity levels (1, 2, 3):
1. Send: `DAMAGE <severity>`
2. Measure pump speed
3. Measure delivery duration
4. Expected: Higher severity = faster flow, longer duration

#### 4.4 Recovery Verification
1. Wait for repair cycle to complete
2. Check status returns to normal
3. Expected: "STATUS: NORMAL" after completion

### Pass Criteria
- ✅ Damage detected and reported
- ✅ Repair protocol activates automatically
- ✅ Delivery time under 30 seconds
- ✅ System recovers after repair

---

## Test 5: Neural Control Test

**File:** `neural_test.md`

### Objective
Verify AI decision-making and sensor integration work correctly.

### Equipment Needed
- Serial monitor
- Accelerometer test fixture (optional)

### Procedure

#### 5.1 Sensor Readings
1. Send command: `SENSORS`
2. Review all sensor values
3. Expected: Valid readings from all sensors
4. Check for reasonable ranges

#### 5.2 Decision Cycle
1. Observe neural network decisions via serial
2. Expected: Decision every 100ms
3. Check outputs correlate with inputs

#### 5.3 Reflex Test
1. Quickly tilt organism (simulate fall)
2. Observe muscle response
3. Expected: Compensatory contraction within 200ms

#### 5.4 Learning Test
1. Run organism for 10 minutes
2. Compare early vs late decisions
3. Expected: Slight adaptation in behavior

### Pass Criteria
- ✅ All sensors readable
- ✅ Decision cycle runs consistently
- ✅ Reflexes activate appropriately
- ✅ Learning produces measurable adaptation

---

## Test 6: Integrated System Demo

**File:** `demo_test.md`

### Objective
Run complete demonstration sequence showing all systems working together.

### Demo Sequence

```
1. STARTUP
   - Power on
   - OLED shows boot sequence
   - All systems自检

2. ENERGY DEMO
   - Show current energy level
   - Simulate energy input
   - Display charging animation

3. MOVEMENT DEMO
   - Activate muscle wave pattern
   - Show coordinated motion
   - Vary speed and direction

4. DAMAGE EVENT
   - Trigger simulated damage
   - Show detection on OLED
   - Activate repair protocol

5. REPAIR DEMO
   - Pump delivers repair fluid
   - Monitor progress on display
   - Confirm repair complete

6. RECOVERY
   - Return to normal operation
   - Show all systems green
   - Enter idle mode
```

### Success Criteria
- ✅ Complete sequence runs without errors
- ✅ All transitions smooth
- ✅ OLED displays accurate information
- ✅ Total demo time: 2-3 minutes
- ✅ No manual intervention required

---

## Troubleshooting Quick Reference

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| OLED blank | No power to display | Check 3.3V connection |
| Muscles not moving | Insufficient current | Check MOSFET wiring |
| Pumps humming but not turning | Voltage too low | Check 12V supply |
| Leaks at joints | Poor seal | Re-apply silicone sealant |
| Random resets | Power sag | Add capacitor near ESP32 |
| I2C devices missing | Address conflict | Check pullup resistors |
| SMA overheating | Duty cycle too high | Reduce PWM or add cooling time |

---

## Test Report Template

```
Date: _______________
Tester: _____________
Prototype ID: ________

Energy System:      [ ] Pass  [ ] Fail
Muscle System:      [ ] Pass  [ ] Fail
Transport System:   [ ] Pass  [ ] Fail
Repair System:      [ ] Pass  [ ] Fail
Neural Control:     [ ] Pass  [ ] Fail
Integrated Demo:    [ ] Pass  [ ] Fail

Notes:
_______________________________________
_______________________________________
_______________________________________

Overall Result:     [ ] PASS  [ ] FAIL
```
