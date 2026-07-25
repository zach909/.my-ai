/*
 * Configuration Header - Artificial Organism Controller
 * 
 * Adjust these parameters for your specific hardware setup
 */

#ifndef CONFIG_H
#define CONFIG_H

// =====================
// ENERGY SYSTEM CONFIG
// =====================
#define ENERGY_CAPACITY_MAH     2000      // Battery capacity in mAh
#define ENERGY_MAX_VOLTAGE      4.2f      // Li-ion max voltage
#define ENERGY_MIN_VOLTAGE      3.0f      // Li-ion min voltage (cutoff)
#define ENERGY_NOMINAL_VOLTAGE  3.7f      // Li-ion nominal voltage
#define SUPERCAPACITOR_FARADS   5.0f      // Supercapacitor capacitance
#define CHARGE_EFFICIENCY       0.85f     // Energy extraction efficiency

// =====================
// MUSCLE CONFIG
// =====================
#define MUSCLE_COUNT            4         // Number of SMA muscles
#define SMA_MAX_CURRENT_A       1.5f      // Max current per muscle (Amps)
#define SMA_ACTIVATION_TEMP_C   65        // Temperature for contraction (°C)
#define SMA_DEACTIVATION_TEMP_C 45        // Temperature for relaxation (°C)
#define SMA_CONTRACTION_PCT     4.0f      // Expected contraction percentage
#define SMA_PRESTRAIN_PCT       2.5f      // Pre-tension strain percentage
#define MUSCLE_CONTROL_FREQ_HZ  1000      // Control loop frequency

// =====================
// PUMP CONFIG
// =====================
#define PUMP_COUNT              4         // Number of peristaltic pumps
#define PUMP_MAX_PWM            255       // Maximum PWM value
#define PUMP_MIN_PWM            50        // Minimum PWM to start rotation
#define PUMP_DEFAULT_PWM        150       // Default operating speed
#define FLOW_RATE_ML_PER_MIN    80        // Expected flow rate at default speed

// =====================
// REPAIR SYSTEM CONFIG
// =====================
#define REPAIR_RESERVOIR_ML     50        // Repair fluid capacity
#define REPAIR_THRESHOLD        0.3f      // Damage level to trigger repair
#define REPAIR_FLOW_RATE_ML_S   2.0f      // Repair delivery rate
#define REPAIR_MATERIAL_VIScosity 150     // Approximate viscosity (cP)

// =====================
// SENSOR CONFIG
// =====================
#define INA219_ADDRESS_1        0x40      // Current sensor addresses
#define INA219_ADDRESS_2        0x41
#define INA219_ADDRESS_3        0x44
#define INA219_ADDRESS_4        0x45
#define MPU6050_ADDRESS         0x68      // IMU address
#define OLED_ADDRESS            0x3C      // Display address

// I2C pins (ESP32 default)
#define I2C_SDA_PIN             21
#define I2C_SCL_PIN             22

// =====================
// GPIO PIN ASSIGNMENTS
// =====================
// Motor driver (L298N) control pins
#define PUMP1_IN1               26
#define PUMP1_IN2               27
#define PUMP2_IN3               14
#define PUMP2_IN4               12

// MOSFET gate control for SMA muscles
#define MUSCLE1_GATE            25
#define MUSCLE2_GATE            33
#define MUSCLE3_GATE            32
#define MUSCLE4_GATE            23

// IMU interrupt (optional)
#define IMU_INT_PIN             4

// =====================
// NEURAL NETWORK CONFIG
// =====================
#define NN_INPUT_SIZE           12        // Sensor inputs
#define NN_HIDDEN_SIZE          24        // Hidden layer neurons
#define NN_OUTPUT_SIZE          8         // Control outputs
#define NN_LEARNING_RATE        0.01f     // Learning rate for adaptation
#define NN_DECISION_INTERVAL_MS 100       // Decision cycle time

// =====================
// SAFETY LIMITS
// =====================
#define MAX_TEMPERATURE_C       80        // Absolute max temperature
#define MAX_SYSTEM_CURRENT_A    8.0f      // Total system current limit
#define LOW_ENERGY_WARNING_PCT  20.0f     // Warning threshold
#define CRITICAL_ENERGY_PCT     10.0f     // Shutdown threshold

// =====================
// COMMUNICATION
// =====================
#define SERIAL_BAUD_RATE        115200    // Serial communication speed
#define ENABLE_WIFI             false     // Enable WiFi connectivity
#define ENABLE_BLUETOOTH        true      // Enable Bluetooth LE

// =====================
// DEBUGGING
// =====================
#define DEBUG_ENABLE            true      // Enable debug output
#define DEBUG_LEVEL             2         // 0=none, 1=errors, 2=info, 3=verbose
#define LOG_INTERVAL_MS         5000      // Status log interval

#endif // CONFIG_H
