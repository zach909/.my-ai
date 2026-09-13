# Shell Robot

Shell MP: Spherical Pneumatic Combat RobotEngineering Overview, Mechanical Systems, and Tactical Analysis1. Concept Definition & ArchitectureThe Shell MP (Multi-Pneumatic Spherical Unit) is an omnidirectional combat robot designed for maximum structural resilience and chaotic kinetic impact. Built inside a continuous spherical shell, the machine eliminates traditional chassis weak points—such as corners, exposed treads, or vulnerable top plates—making it virtually immune to conventional flippers, spinners, and vertical wedge attacks.       [ Spiked Hemispherical Outer Shell ]
                       │
       [ Internal Drive Unit (IDU) / Pendulum ]
                       │
   ┌───────────────────┴───────────────────┐
   ▼                                       ▼
[ Dual-Axis Gyro Control ]    [ High-Pressure Pneumatics ]
   │                                       │
   ▼                                       ▼
[ Drive Wheels / Motors ]     [ Gas Tank & Solenoid Valves ]
2. Structural & Exterior DesignArmor & Hull MechanicsShell Composition: Dual-formed hardened steel alloy (e.g., Hardox 500 or Grade 5 Titanium alloy) engineered to dissipate localized impact forces evenly across the entire surface geometry.Hemispherical Seam: The prominent arc-groove splitting the shell allows the outer hull sections to articulate or rotate independently on a central axis, reducing friction during rotational maneuvers and allowing access for internal maintenance.Radially Mounted Spikes: Hardened tool-steel conical spikes are arrayed radially around the sphere's surface. These serve three distinct functions:Kinetic Engagement: Preventing opponent wedges from gaining flush contact beneath the robot.Traction Assistance: Digging into floor surfaces during rapid internal acceleration.Pneumatic Punchers: Dynamic spikes connected to internal pistons capable of rapid extension.Primary Puncturing Pin (Orange/Copper Element): A reinforced, heavy-duty focal spike constructed from beryllium copper or hardened tool steel with specialized coatings. It functions as a primary targeted strike point and electrical ground contact during arena operations.3. Drive & Propulsion MechanicsSpherical robots cannot use standard axle-driven wheel assemblies directly exposed to the environment. Shell MP utilizes an internal drive and pendulum actuation system.Internal Drive Unit (IDU)Internal Wheel Carriage: A heavy chassis sits inside the sphere, resting on omni-directional drive wheels pressed directly against the smooth inner wall of the shell.Pendulum Mass Shift: Steerable weights suspended below the central axis alter the robot's center of mass ($CoM$). By driving internal motors forward, the internal mass climbs the inner wall, creating an gravitational torque moment ($\tau$):$$\tau = m \cdot g \cdot r \cdot \sin(\theta)$$Where:$m$ = total internal offset mass$g$ = acceleration due to gravity ($9.81 \, \text{m/s}^2$)$r$ = internal radius of the shell$\theta$ = angular displacement of the internal pendulumFlywheel Stabilization: Dual counter-rotating gyroscopic flywheels provide rotational stability along the pitch and roll axes, preventing uncontrolled internal tumbling when striking obstacles.4. Pneumatic Weapon SystemThe defining offensive capability of Shell MP is its Multi-Point Pneumatic Spike Array.                +---------------------+
                | Compressed N2 Tank  |
                |   (3000 PSI Reg.)   |
                +----------+----------+
                           |
                           v
                +---------------------+
                | High-Flow Solenoid  |
                +----------+----------+
                           |
            +--------------+--------------+
            |                             |
            v                             v
+-----------------------+     +-----------------------+
|  Primary Spike (Pin)  |     | Radial Spike Actuators|
| (High Impact Puncture)|     | (Rapid Impulse/Hop)   |
+-----------------------+     +-----------------------+
High-Pressure System ArchitecturePressure Storage: A central carbon-fiber wrapped compressed nitrogen ($N_2$) tank regulated down from $3000 \, \text{PSI}$ to an operating pressure of $600\text{--}800 \, \text{PSI}$.Selective Actuation: Low-latency solenoid valves redirect high-pressure bursts to targeted pneumatic cylinders behind specific surface spikes.Kinetic Hop & Self-Righting: If flipped or pinned, firing the bottom-most spikes against the floor generates an explosive impulse ($J = \int F \, dt$), allowing the sphere to violently launch itself away from hazards or bounce back into an optimal orientation.5. Electronics, Telemetry, and Invariant ControlControlling a sphere whose outer shell rolls and spins independently of the driver's perspective requires an advanced telemetry pipeline.Field-Oriented Control (FOC): An integrated 9-axis Inertial Measurement Unit (IMU) tracks absolute orientation relative to the arena floor, not the outer shell.Directional Invariance: When the operator pushes "Forward" on the controller, the internal drive chassis calculates current spatial orientation and rolls the internal pendulum in that absolute vector regardless of how fast the outer shell is spinning or tumbling.Optical Hull Encoders: Internal sensors track the relative motion of the shell's inner wall to accurately calculate linear speed and slip ratios.6. Tactical Profile & Combat StrategyTactical AttributeSpecification / DynamicPrimary AdvantageAbsolute Deflection Geometry (no flat surfaces for impact transfer)Weakness CounterPneumatic hop dislodges opponents attempting to pin or pushAttack VectorRolling momentum transfer combined with pneumatic spike punchesMobility TypeSpherical Internal-Pendulum Omnidirectional Drive
