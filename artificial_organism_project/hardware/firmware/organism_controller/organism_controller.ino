/*
 * Artificial Organism Controller - Stage 2 Prototype
 * 
 * This firmware controls a palm-sized artificial organism demonstrating:
 * - Energy management and storage
 * - Fluid transport (circulatory system)
 * - Shape Memory Alloy (SMA) artificial muscles
 * - Self-repair material delivery
 * - Sensor integration and neural control
 * 
 * Hardware: ESP32 DevKit
 * Author: Synthetic Organism Project
 * Version: 1.0.0
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
  bool damage_detected;
  int damage_severity;
  float muscle_activation[4];
  float pump_speed;
  unsigned long last_update;
} organism;

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
