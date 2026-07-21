# Subsystem Interface Standards

## 1. Communication Protocol: OrganismBus (OB-1)

### Physical Layer
- **Data Bus**: Differential signaling (LVDS) for noise immunity
- **Power Lines**: 48V DC primary, 5V DC secondary (logic)
- **Fluid Connectors**: Quick-disconnect with self-sealing valves
- **Bandwidth**: Minimum 1 Gbps per node

### Message Format
```
[Header][Source ID][Dest ID][Message Type][Payload][CRC]
 2B      1B        1B        2B           N B      2B
```

### Message Types
| Code | Type | Description |
|------|------|-------------|
| 0x01 | STATUS | Heartbeat + vitals |
| 0x02 | COMMAND | Action instruction |
| 0x03 | DATA | Sensor readings |
| 0x04 | CONFIG | Parameter update |
| 0x05 | ALERT | Error/failure notification |
| 0x06 | SYNC | Time synchronization |
| 0x07 | RESOURCE | Energy/material request |

### Node Addressing
- `0x00`: Broadcast
- `0x01-0x0F`: Core systems (Brain, Energy, Transport)
- `0x10-0x3F`: Limb controllers
- `0x40-0x7F`: Sensor arrays
- `0x80-0xBF`: Muscle groups
- `0xC0-0xFF`: Reserved/Expansion

---

## 2. Power Interface Standards

### Primary Power Rail
- **Voltage**: 48V DC ±5%
- **Current**: Up to 50A peak per major subsystem
- **Protection**: Over-current, over-voltage, reverse polarity

### Secondary Power Rail
- **Voltage**: 5V DC ±2%
- **Current**: Up to 5A per node
- **Purpose**: Logic, sensors, low-power electronics

### Energy Handshake Protocol
```
1. Requester sends RESOURCE message with power需求
2. Energy system validates availability
3. Energy system enables circuit + sends ACK
4. Requester confirms receipt
5. Continuous STATUS messages monitor draw
6. On completion, requester sends release command
```

---

## 3. Fluid Interface Standards

### Connector Types
| Type | Color | Purpose | Max Pressure |
|------|-------|---------|--------------|
| E-FLUID | Red | Energy transport fluid | 5 bar |
| R-MAT | Blue | Repair material | 3 bar |
| S-MAT | Green | Structural material | 8 bar |
| WASTE | Yellow | Waste removal | 2 bar |
| COOLANT | White | Thermal management | 4 bar |

### Connection Specification
- **Diameter**: 2mm, 4mm, 8mm standard sizes
- **Sealing**: Double O-ring with leak detection channel
- **Valve**: Spring-loaded self-closing on disconnect
- **Material**: Biocompatible polymer (PEEK or equivalent)

### Fluid Quality Monitoring
Each node must report:
- Flow rate (mL/min)
- Pressure (bar)
- Temperature (°C)
- Contamination level (optical sensor)
- Chemical composition (spectroscopic if applicable)

---

## 4. Data Model: Body State Representation

### Core State Vector (updated at 1kHz)
```python
class BodyState:
    # Energy
    total_energy_wh: float
    energy_reserve_wh: float
    power_draw_w: float
    
    # Position (per joint/muscle)
    joint_angles: dict[str, float]  # radians
    muscle_lengths: dict[str, float]  # mm
    muscle_forces: dict[str, float]  # Newtons
    
    # Damage
    damage_map: dict[str, DamageInfo]
    
    # Internal Environment
    core_temp_c: float
    fluid_levels: dict[str, float]  # percentage
    pressure_zones: dict[str, float]  # bar
    
    # Sensors
    external_sensors: dict[str, SensorData]
    internal_sensors: dict[str, SensorData]
```

### DamageInfo Structure
```python
class DamageInfo:
    location_id: str
    damage_type: str  # 'puncture', 'tear', 'fracture', 'electrical', 'sensor'
    severity: float  # 0.0 - 1.0
    detected_at: float  # timestamp
    repair_status: str  # 'pending', 'in_progress', 'completed', 'critical'
    repair_material_needed: str
    estimated_repair_time_s: float
```

---

## 5. Timing Requirements

| System | Update Rate | Latency Max | Jitter Max |
|--------|-------------|-------------|------------|
| Muscle Control | 1 kHz | 1 ms | 100 μs |
| Balance/Reflexes | 500 Hz | 2 ms | 200 μs |
| Damage Detection | 100 Hz | 10 ms | 1 ms |
| Energy Management | 50 Hz | 20 ms | 5 ms |
| High-level AI | 30 Hz | 33 ms | 10 ms |
| Internal Transport | 10 Hz | 100 ms | 10 ms |

### Clock Synchronization
- All nodes synchronize to Brain master clock
- Precision Time Protocol (PTP/IEEE 1588)
- Target sync accuracy: ±10 μs

---

## 6. Safety Interfaces

### Emergency Stop (E-Stop)
- Hardware line (dedicated wire)
- Software command (OB-1 message type 0x05 with code 0xFF)
- Response: All actuators release within 50ms
- Systems enter safe state, maintain minimal life support

### Isolation Protocol
On critical failure in subsystem:
1. Faulty node broadcasts ALERT
2. Adjacent nodes isolate fluid/power connections
3. Brain reroutes resources if possible
4. Repair system dispatched if damage is physical

### Graceful Degradation Levels
| Level | Description |
|-------|-------------|
| 0 | Full operation |
| 1 | Non-essential systems reduced |
| 2 | Mobility limited to essential movement |
| 3 | Stationary, life-support only |
| 4 | Minimal consciousness, hibernation mode |
| 5 | Critical shutdown (only on catastrophic failure) |

---

## 7. Manufacturing & Repair Interfaces

### Standard Component Slots
- **Muscle Module**: 50mm x 20mm x 10mm standardized form factor
- **Sensor Pod**: 15mm diameter spherical/cylindrical
- **Processor Node**: Eurocard-compatible (for high-level modules)
- **Pump/Valve**: Modular cartridge design

### Self-Repair Access Points
- External service ports every 10cm on body surface
- Internal access channels along main transport routes
- Robotic repair arm interface points at major junctions

### Material Deposition Specification
- Nozzle types: Micro-extrusion (50μm), Spray coating, Injection
- Materials pre-heated to operating temperature before deposition
- Curing methods: UV, thermal, chemical catalyst (material-dependent)

---

## 8. Versioning & Compatibility

### Hardware Version Format
`MAJOR.MINOR.PATCH`
- MAJOR: Breaking changes (incompatible)
- MINOR: New features (backward compatible)
- PATCH: Bug fixes (fully compatible)

### Firmware Update Protocol
1. Brain distributes update package with CRC
2. Node validates package integrity
3. Node enters bootloader mode
4. Flash new firmware
5. Run self-test
6. Report success/failure
7. If failure, rollback to previous version

### Backward Compatibility Rules
- New nodes must accept old message formats
- Old nodes may ignore new optional fields
- Power/fluid connectors remain compatible across generations
- Breaking changes require adapter modules
