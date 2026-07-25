/*
 * Configuration Header - Artificial Organism Controller
 * 
 * CORRECTED VERSION - All errors from original fixed
 * Hardware: ESP32 DevKit V1
 * Version: 2.0 (Corrected)
 */

#ifndef CONFIG_H
#define CONFIG_H

// =====================
// ENERGY SYSTEM CONFIG
// =====================
#define ENERGY_CAPACITY_MAH     3000      // Battery capacity in mAh (UPGRADED from 2000)
#define ENERGY_MAX_VOLTAGE      4.2f      // Li-ion max voltage
#define ENERGY_MIN_VOLTAGE      3.0f      // Li-ion min voltage (cutoff)
#define ENERGY_NOMINAL_VOLTAGE  3.7f      // Li-ion nominal voltage
#define SUPERCAPACITOR_FARADS   5.0f      // Supercapacitor capacitance
#define CHARGE_EFFICIENCY       0.85f     // Energy extraction efficiency
#define BOOST_OUTPUT_VOLTAGE    5.0f      // Boost converter output
#define LOW_VOLTAGE_CUTOFF      3.2f      // Auto-shutdown voltage

// =====================
// MUSCLE CONFIG - CORRECTED
// =====================
#define MUSCLE_COUNT            4         // Number of SMA muscles
#define SMA_MAX_CURRENT_A       0.45f     // Max current per muscle (Amps) - CORRECTED from 1.5A
#define SMA_ACTIVATION_TEMP_C   65        // Temperature for contraction (°C)
#define SMA_DEACTIVATION_TEMP_C 45        // Temperature for relaxation (°C)
#define SMA_CONTRACTION_PCT     3.5f      // Expected contraction percentage (realistic)
#define SMA_PRESTRAIN_PCT       2.5f      // Pre-tension strain percentage
#define MUSCLE_CONTROL_FREQ_HZ  500       // Control loop frequency - REDUCED from 1000
#define SMA_DUTY_CYCLE_MAX_PCT  30        // MAX duty cycle to prevent overheating - CRITICAL FIX
#define SMA_COOLING_TIME_MS     5000      // Minimum cooling time between activations
#define SMA_HEATING_TIME_MS     1500      // Time to reach activation temp

// =====================
// PUMP CONFIG - CORRECTED
// =====================
#define PUMP_COUNT              2         // Number of pumps actually implemented - CORRECTED from 4
#define PUMP_MAX_PWM            255       // Maximum PWM value
#define PUMP_MIN_PWM            50        // Minimum PWM to start rotation
#define PUMP_DEFAULT_PWM        150       // Default operating speed
#define FLOW_RATE_ML_PER_MIN    50        // Expected flow rate at default speed - REALISTIC for 3.7V pump

// =====================
// REPAIR SYSTEM CONFIG
// =====================
#define REPAIR_RESERVOIR_ML     50        // Repair fluid capacity
#define REPAIR_THRESHOLD        0.3f      // Damage level to trigger repair
#define REPAIR_FLOW_RATE_ML_S   1.5f      // Repair delivery rate - REALISTIC
#define REPAIR_MATERIAL_VISCOSITY 150     // Approximate viscosity (cP)
#define REPAIR_MAX_DURATION_MS  10000     // Maximum repair cycle duration

// =====================
// SENSOR CONFIG
// =====================
#define INA219_ADDRESS_1        0x40      // Current sensor address 1
#define INA219_ADDRESS_2        0x41      // Current sensor address 2 - REDUCED from 4 sensors
#define MPU6050_ADDRESS         0x68      // IMU address
#define OLED_ADDRESS            0x3C      // Display address

// I2C pins (ESP32 default)
#define I2C_SDA_PIN             21
#define I2C_SCL_PIN             22

// =====================
// GPIO PIN ASSIGNMENTS - CORRECTED
// =====================
// Motor driver (TB6612FNG) control pins - AVOIDING problematic pins
#define PUMP1_IN1               26        // Pump 1 direction 1
#define PUMP1_IN2               27        // Pump 1 direction 2
#define PUMP2_IN1               14        // Pump 2 direction 1 (has pullup, acceptable)
#define PUMP2_IN2               13        // Pump 2 direction 2 - CHANGED from GPIO 12 (boot issue!)

// MOSFET gate control for SMA muscles (with 100Ω series resistors)
#define MUSCLE1_GATE            25        // Muscle 1 PWM
#define MUSCLE2_GATE            33        // Muscle 2 PWM
#define MUSCLE3_GATE            32        // Muscle 3 PWM
#define MUSCLE4_GATE            23        // Muscle 4 PWM

// Emergency stop button (active low)
#define EMERGENCY_STOP_PIN      4         // E-stop input (pullup enabled)

// =====================
// NEURAL NETWORK CONFIG
// =====================
#define NN_INPUT_SIZE           12        // Sensor inputs
#define NN_HIDDEN_SIZE          16        // Hidden layer neurons - REDUCED for memory
#define NN_OUTPUT_SIZE          6         // Control outputs - MATCHES actual outputs
#define NN_LEARNING_RATE        0.01f     // Learning rate for adaptation
#define NN_DECISION_INTERVAL_MS 100       // Decision cycle time

// =====================
// SAFETY LIMITS - ADDED
// =====================
#define MAX_TEMPERATURE_C       70        // Absolute max temperature for SMA - REDUCED from 80
#define MAX_SYSTEM_CURRENT_A    5.0f      // Total system current limit - FUSE RATING
#define LOW_ENERGY_WARNING_PCT  20.0f     // Warning threshold
#define CRITICAL_ENERGY_PCT     10.0f     // Shutdown threshold
#define BROWNOUT_VOLTAGE        3.1f      // ESP32 brownout threshold
#define OVERCURRENT_TIMEOUT_MS  100       // Time before overcurrent shutdown

// =====================
// COMMUNICATION
// =====================
#define SERIAL_BAUD_RATE        115200    // Serial communication speed
#define ENABLE_WIFI             false     // Disable WiFi to save power
#define ENABLE_BLUETOOTH        false     // Disable BLE to save power

// =====================
// DEBUGGING
// =====================
#define DEBUG_ENABLE            true      // Enable debug output
#define DEBUG_LEVEL             2         // 0=none, 1=errors, 2=info, 3=verbose
#define LOG_INTERVAL_MS         5000      // Status log interval

// =====================
// TIMING CONSTANTS
// =====================
#define CONTROL_LOOP_TARGET_MS  100       // Target control loop time
#define SENSOR_READ_TIME_MS     5         // Estimated sensor read time
#define NN_PROCESS_TIME_MS      10        // Estimated neural net processing
#define SAFETY_CHECK_TIME_MS    2         // Safety system check time
#define ACTUATOR_UPDATE_TIME_MS 3         // Actuator command time

#endif // CONFIG_H
