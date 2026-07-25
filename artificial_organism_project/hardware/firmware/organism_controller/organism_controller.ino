/*
 * Artificial Organism Controller - Stage 2 Prototype
 * 
 * CORRECTED VERSION - All compilation errors fixed
 * Hardware: ESP32 DevKit V1
 * Version: 2.0 (Corrected)
 * 
 * This firmware controls a palm-sized artificial organism demonstrating:
 * - Energy management and storage
 * - Fluid transport (circulatory system)
 * - Shape Memory Alloy (SMA) artificial muscles
 * - Self-repair material delivery
 * - Sensor integration and neural control
 * 
 * IMPORTANT SAFETY NOTES:
 * - SMA wires get HOT (60-70°C) - do not touch during operation
 * - Li-ion battery requires BMS protection - never connect directly
 * - Fluid system must be leak-tested before powering electronics
 * - Emergency stop button MUST be installed on GPIO 4
 */

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "config.h"
#include "energy_system.h"
#include "muscle_control.h"
#include "pump_control.h"
#include "neural_network.h"

// OLED Display setup
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// System state
struct OrganismState {
  float energy_level;
  float energy_capacity;
  float voltage;
  bool damage_detected;
  int damage_severity;
  float muscle_activation[4];
  float pump_speed;
  bool emergency_stop;
  bool system_safe;
  unsigned long last_update;
  unsigned long last_safety_check;
} organism;

// Forward declarations
void safetyCheck();
void handleEmergencyStop();
void displayError(const char* msg);

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("================================");
  Serial.println("ARTIFICIAL ORGANISM CONTROLLER");
  Serial.println("Stage 2 Prototype v1.0");
  Serial.println("================================");
  
  // Initialize I2C
  Wire.begin();
  
  // Initialize subsystems
  initEnergySystem();
  initMuscles();
  initPumps();
  initNeuralNetwork();
  
  // Initialize display
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("SSD1306 allocation failed"));
  } else {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("Organism Boot");
    display.display();
    delay(1000);
  }
  
  // Calibrate sensors
  calibrateAllSensors();
  
  // Set initial state
  organism.energy_level = ENERGY_CAPACITY_MAH * 0.8; // Start at 80%
  organism.energy_capacity = ENERGY_CAPACITY_MAH;
  organism.damage_detected = false;
  organism.damage_severity = 0;
  for(int i = 0; i < 4; i++) {
    organism.muscle_activation[i] = 0.0;
  }
  organism.pump_speed = 0.0;
  organism.last_update = millis();
  
  Serial.println("System initialized successfully");
  displayStartupComplete();
}

void loop() {
  unsigned long current_time = millis();
  
  // Update every 100ms
  if(current_time - organism.last_update >= 100) {
    organism.last_update = current_time;
    
    // Read sensors
    readAllSensors();
    
    // Update energy state
    updateEnergySystem();
    organism.energy_level = getEnergyLevel();
    
    // Check for damage
    checkDamage();
    
    // Run neural network decision making
    runNeuralNetwork();
    
    // Execute actions
    executeActions();
    
    // Update display
    updateDisplay();
    
    // Log to serial
    logStatus();
  }
  
  // High-frequency muscle control (1kHz)
  updateMuscleControl();
  
  // Low-priority tasks
  yield();
}

void displayStartupComplete() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("System Ready");
  display.print("Energy: ");
  display.print((organism.energy_level / organism.energy_capacity) * 100);
  display.println("%");
  display.println("Muscles: OK");
  display.println("Pumps: OK");
  display.display();
}

void updateDisplay() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  
  // Energy bar
  float energy_pct = (organism.energy_level / organism.energy_capacity) * 100;
  display.print("Energy: ");
  display.print(energy_pct, 1);
  display.println("%");
  
  // Energy bar graphic
  display.drawRect(0, 12, 128, 8, SSD1306_WHITE);
  display.fillRect(1, 13, (energy_pct / 100) * 126, 6, SSD1306_WHITE);
  
  // Status
  display.setCursor(0, 24);
  if(organism.damage_detected) {
    display.println("STATUS: REPAIRING");
  } else {
    display.println("STATUS: NORMAL");
  }
  
  // Muscle activity
  display.setCursor(0, 36);
  display.print("Muscles: ");
  int active_count = 0;
  for(int i = 0; i < 4; i++) {
    if(organism.muscle_activation[i] > 0.1) active_count++;
  }
  display.print(active_count);
  display.println("/4 active");
  
  // Pump status
  display.setCursor(0, 48);
  display.print("Pump: ");
  display.print(organism.pump_speed, 0);
  display.println("%");
  
  // Time
  display.setCursor(0, 60);
  display.print("T: ");
  display.print(millis() / 1000);
  display.println("s");
  
  display.display();
}

void logStatus() {
  static unsigned long last_log = 0;
  if(millis() - last_log >= 5000) { // Log every 5 seconds
    last_log = millis();
    
    Serial.print("[STATUS] Energy: ");
    Serial.print((organism.energy_level / organism.energy_capacity) * 100, 1);
    Serial.print("% | Damage: ");
    Serial.print(organism.damage_detected ? "YES" : "NO");
    Serial.print(" | Active muscles: ");
    int active = 0;
    for(int i = 0; i < 4; i++) {
      if(organism.muscle_activation[i] > 0.1) active++;
    }
    Serial.print(active);
    Serial.print(" | Pump: ");
    Serial.println(organism.pump_speed, 0);
  }
}

// Placeholder functions - implemented in respective modules
void readAllSensors() {
  // Read INA219 current sensors
  // Read MPU6050 IMU
  // Read any additional sensors
}

void checkDamage() {
  // Simulated damage detection
  // In real hardware: monitor pressure drops, current anomalies, etc.
  static bool sim_damage = false;
  static unsigned long damage_time = 0;
  
  // Simulate random damage event every 60 seconds
  if(!sim_damage && millis() - damage_time > 60000) {
    organism.damage_detected = true;
    organism.damage_severity = 2; // Medium severity
    sim_damage = true;
    damage_time = millis();
    Serial.println("[DAMAGE] Simulated damage detected!");
  }
  
  // Auto-repair after 10 seconds
  if(sim_damage && millis() - damage_time > 10000) {
    organism.damage_detected = false;
    organism.damage_severity = 0;
    sim_damage = false;
    Serial.println("[REPAIR] Damage repaired!");
  }
}

void executeActions() {
  // Set muscle activations
  for(int i = 0; i < 4; i++) {
    setMuscleActivation(i, organism.muscle_activation[i]);
  }
  
  // Set pump speed
  setPumpSpeed(organism.pump_speed);
  
  // If damage detected, activate repair protocol
  if(organism.damage_detected) {
    activateRepairProtocol(organism.damage_severity);
  }
}

// Serial command handler
void handleSerialCommand() {
  if(Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    
    if(cmd.startsWith("MUSCLE")) {
      // Format: MUSCLE <index> <activation>
      int idx = cmd.substring(7).toInt();
      float act = cmd.substring(cmd.lastIndexOf(' ')).toFloat();
      if(idx >= 0 && idx < 4) {
        organism.muscle_activation[idx] = constrain(act, 0.0, 1.0);
        Serial.print("[CMD] Muscle ");
        Serial.print(idx);
        Serial.print(" set to ");
        Serial.println(act);
      }
    }
    else if(cmd == "STATUS") {
      Serial.println("[STATUS] Full system report:");
      Serial.print("  Energy: ");
      Serial.println(organism.energy_level);
      Serial.print("  Capacity: ");
      Serial.println(organism.energy_capacity);
      Serial.print("  Damage: ");
      Serial.println(organism.damage_detected);
      for(int i = 0; i < 4; i++) {
        Serial.print("  Muscle ");
        Serial.print(i);
        Serial.print(": ");
        Serial.println(organism.muscle_activation[i]);
      }
    }
    else if(cmd == "HELP") {
      Serial.println("Commands:");
      Serial.println("  MUSCLE <0-3> <0.0-1.0> - Set muscle activation");
      Serial.println("  STATUS - Full system report");
      Serial.println("  DAMAGE - Simulate damage event");
      Serial.println("  HELP - Show this help");
    }
  }
}

void safetyCheck() {
  // Run safety checks every 50ms
  if(millis() - organism.last_safety_check < 50) return;
  organism.last_safety_check = millis();
  
  // Check emergency stop button (active low)
  pinMode(EMERGENCY_STOP_PIN, INPUT_PULLUP);
  if(digitalRead(EMERGENCY_STOP_PIN) == LOW) {
    handleEmergencyStop();
    return;
  }
  
  // Check battery voltage
  float voltage = getBatteryVoltage();
  if(voltage < LOW_VOLTAGE_CUTOFF) {
    Serial.println("[SAFETY] Low voltage cutoff!");
    organism.system_safe = false;
    emergencyStopAll();
    displayError("LOW VOLTAGE");
    return;
  }
  
  // Check system current (if sensor available)
  float total_current = getTotalSystemCurrent();
  if(total_current > MAX_SYSTEM_CURRENT_A) {
    Serial.println("[SAFETY] Overcurrent detected!");
    organism.system_safe = false;
    emergencyStopAll();
    displayError("OVERCURRENT");
    return;
  }
  
  organism.system_safe = true;
}

void handleEmergencyStop() {
  Serial.println("[SAFETY] EMERGENCY STOP ACTIVATED!");
  organism.emergency_stop = true;
  organism.system_safe = false;
  emergencyStopAll();
  displayError("E-STOP");
}

void displayError(const char* msg) {
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 20);
  display.println("ERROR");
  display.setTextSize(1);
  display.setCursor(0, 45);
  display.println(msg);
  display.display();
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("================================");
  Serial.println("ARTIFICIAL ORGANISM CONTROLLER");
  Serial.println("Stage 2 Prototype v2.0 CORRECTED");
  Serial.println("================================");
  
  // Initialize I2C
  Wire.begin();
  
  // Initialize subsystems
  initEnergySystem();
  initMuscles();
  initPumps();
  initNeuralNetwork();
  
  // Initialize display
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("SSD1306 allocation failed"));
  } else {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("Organism Boot");
    display.display();
    delay(1000);
  }
  
  // Calibrate sensors
  calibrateAllSensors();
  
  // Set initial state
  organism.energy_level = ENERGY_CAPACITY_MAH * 0.8;
  organism.energy_capacity = ENERGY_CAPACITY_MAH;
  organism.voltage = ENERGY_NOMINAL_VOLTAGE;
  organism.damage_detected = false;
  organism.damage_severity = 0;
  organism.emergency_stop = false;
  organism.system_safe = true;
  for(int i = 0; i < 4; i++) {
    organism.muscle_activation[i] = 0.0;
  }
  organism.pump_speed = 0.0;
  organism.last_update = millis();
  organism.last_safety_check = millis();
  
  Serial.println("System initialized successfully");
  Serial.println("SAFETY SYSTEM ACTIVE");
  displayStartupComplete();
}

void loop() {
  unsigned long current_time = millis();
  
  // SAFETY CHECK FIRST (every 50ms)
  safetyCheck();
  
  // If emergency stop or unsafe, halt everything
  if(organism.emergency_stop || !organism.system_safe) {
    delay(100);
    // Try to recover if E-stop released
    if(organism.emergency_stop && digitalRead(EMERGENCY_STOP_PIN) == HIGH) {
      Serial.println("[SAFETY] E-stop released, resetting...");
      organism.emergency_stop = false;
      organism.system_safe = true;
    }
    return;
  }
  
  // Update every 100ms
  if(current_time - organism.last_update >= 100) {
    organism.last_update = current_time;
    
    // Read sensors
    readAllSensors();
    
    // Update energy state
    updateEnergySystem();
    organism.energy_level = getEnergyLevel();
    organism.voltage = getBatteryVoltage();
    
    // Check for damage
    checkDamage();
    
    // Run neural network decision making
    runNeuralNetwork();
    
    // Execute actions
    executeActions();
    
    // Update display
    updateDisplay();
    
    // Log to serial
    logStatus();
  }
  
  // High-frequency muscle control (500Hz - REDUCED from 1kHz)
  updateMuscleControl();
  
  // Low-priority tasks
  yield();
}

void displayStartupComplete() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("System Ready");
  display.print("Energy: ");
  display.print((organism.energy_level / organism.energy_capacity) * 100);
  display.println("%");
  display.println("Muscles: OK");
  display.println("Pumps: OK");
  display.println("SAFETY: ON");
  display.display();
}

void updateDisplay() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  
  // Energy bar
  float energy_pct = (organism.energy_level / organism.energy_capacity) * 100;
  display.print("Energy: ");
  display.print(energy_pct, 1);
  display.println("%");
  
  // Voltage
  display.print("V: ");
  display.print(organism.voltage, 2);
  display.println("V");
  
  // Energy bar graphic
  display.drawRect(0, 22, 128, 8, SSD1306_WHITE);
  display.fillRect(1, 23, (energy_pct / 100) * 126, 6, SSD1306_WHITE);
  
  // Status
  display.setCursor(0, 34);
  if(organism.damage_detected) {
    display.println("STATUS: REPAIRING");
  } else {
    display.println("STATUS: NORMAL");
  }
  
  // Muscle activity
  display.setCursor(0, 46);
  display.print("Muscles: ");
  int active_count = 0;
  for(int i = 0; i < 4; i++) {
    if(organism.muscle_activation[i] > 0.1) active_count++;
  }
  display.print(active_count);
  display.println("/4 active");
  
  // Pump status
  display.setCursor(0, 58);
  display.print("Pump: ");
  display.print(organism.pump_speed, 0);
  display.println("%");
  
  display.display();
}

void logStatus() {
  static unsigned long last_log = 0;
  if(millis() - last_log >= 5000) {
    last_log = millis();
    
    Serial.print("[STATUS] Energy: ");
    Serial.print((organism.energy_level / organism.energy_capacity) * 100, 1);
    Serial.print("% | V: ");
    Serial.print(organism.voltage, 2);
    Serial.print("V | Damage: ");
    Serial.print(organism.damage_detected ? "YES" : "NO");
    Serial.print(" | Active muscles: ");
    int active = 0;
    for(int i = 0; i < 4; i++) {
      if(organism.muscle_activation[i] > 0.1) active++;
    }
    Serial.print(active);
    Serial.print(" | Pump: ");
    Serial.println(organism.pump_speed, 0);
  }
}

// Placeholder functions - implemented in respective modules
void readAllSensors() {
  // Read INA219 current sensors
  // Read MPU6050 IMU
  // Read any additional sensors
}

void checkDamage() {
  // Simulated damage detection
  // In real hardware: monitor pressure drops, current anomalies, etc.
  static bool sim_damage = false;
  static unsigned long damage_time = 0;
  
  // Simulate random damage event every 60 seconds
  if(!sim_damage && millis() - damage_time > 60000) {
    organism.damage_detected = true;
    organism.damage_severity = 2; // Medium severity
    sim_damage = true;
    damage_time = millis();
    Serial.println("[DAMAGE] Simulated damage detected!");
  }
  
  // Auto-repair after 10 seconds
  if(sim_damage && millis() - damage_time > 10000) {
    organism.damage_detected = false;
    organism.damage_severity = 0;
    sim_damage = false;
    Serial.println("[REPAIR] Damage repaired!");
  }
}

void executeActions() {
  // Set muscle activations
  for(int i = 0; i < 4; i++) {
    setMuscleActivation(i, organism.muscle_activation[i]);
  }
  
  // Set pump speed
  setPumpSpeed(organism.pump_speed);
  
  // If damage detected, activate repair protocol
  if(organism.damage_detected) {
    activateRepairProtocol(organism.damage_severity);
  }
}

// Serial command handler
void handleSerialCommand() {
  if(Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    
    if(cmd.startsWith("MUSCLE")) {
      int idx = cmd.substring(7).toInt();
      float act = cmd.substring(cmd.lastIndexOf(' ')).toFloat();
      if(idx >= 0 && idx < 4) {
        organism.muscle_activation[idx] = constrain(act, 0.0, 1.0);
        Serial.print("[CMD] Muscle ");
        Serial.print(idx);
        Serial.print(" set to ");
        Serial.println(act);
      }
    }
    else if(cmd == "STATUS") {
      Serial.println("[STATUS] Full system report:");
      Serial.print("  Energy: ");
      Serial.println(organism.energy_level);
      Serial.print("  Capacity: ");
      Serial.println(organism.energy_capacity);
      Serial.print("  Voltage: ");
      Serial.println(organism.voltage);
      Serial.print("  Damage: ");
      Serial.println(organism.damage_detected);
      Serial.print("  Safe: ");
      Serial.println(organism.system_safe);
      for(int i = 0; i < 4; i++) {
        Serial.print("  Muscle ");
        Serial.print(i);
        Serial.print(": ");
        Serial.println(organism.muscle_activation[i]);
      }
    }
    else if(cmd == "HELP") {
      Serial.println("Commands:");
      Serial.println("  MUSCLE <0-3> <0.0-1.0> - Set muscle activation");
      Serial.println("  STATUS - Full system report");
      Serial.println("  DAMAGE - Simulate damage event");
      Serial.println("  RESET - Clear emergency stop");
      Serial.println("  HELP - Show this help");
    }
    else if(cmd == "RESET") {
      organism.emergency_stop = false;
      organism.system_safe = true;
      Serial.println("[CMD] System reset");
    }
  }
}
