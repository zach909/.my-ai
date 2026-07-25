/*
 * Energy System Module
 * Manages energy storage, distribution, and monitoring
 */

#ifndef ENERGY_SYSTEM_H
#define ENERGY_SYSTEM_H

#include <Arduino.h>
#include "config.h"

// Energy state variables
static float current_energy_mah = 0;
static float current_voltage = 3.7f;
static float total_current_draw = 0;
static unsigned long last_energy_update = 0;

/**
 * Initialize energy monitoring system
 */
void initEnergySystem() {
  current_energy_mah = ENERGY_CAPACITY_MAH * 0.8; // Start at 80%
  current_voltage = ENERGY_NOMINAL_VOLTAGE;
  total_current_draw = 0;
  
  Serial.println("[ENERGY] System initialized");
}

/**
 * Get current energy level in mAh
 */
float getEnergyLevel() {
  return current_energy_mah;
}

/**
 * Get energy percentage
 */
float getEnergyPercentage() {
  return (current_energy_mah / ENERGY_CAPACITY_MAH) * 100.0f;
}

/**
 * Update energy state based on consumption and input
 */
void updateEnergySystem() {
  unsigned long now = millis();
  float delta_time_h = (now - last_energy_update) / 3600000.0f; // Convert to hours
  
  if(delta_time_h > 0) {
    // Simulate energy consumption (replace with actual sensor readings)
    float consumption_rate_ma = total_current_draw * 1000; // Convert A to mA
    current_energy_mah -= consumption_rate_ma * delta_time_h;
    
    // Simulate energy input (from metabolic process or charging)
    float input_rate_ma = 100; // Example: 100mA input
    current_energy_mah += input_rate_ma * delta_time_h * CHARGE_EFFICIENCY;
    
    // Clamp to valid range
    current_energy_mah = constrain(current_energy_mah, 0, ENERGY_CAPACITY_MAH);
    
    // Estimate voltage based on energy level (simplified Li-ion curve)
    float pct = getEnergyPercentage() / 100.0f;
    current_voltage = ENERGY_MIN_VOLTAGE + (pct * (ENERGY_MAX_VOLTAGE - ENERGY_MIN_VOLTAGE));
  }
  
  last_energy_update = now;
}

/**
 * Set total current draw (called by motor/muscle controllers)
 */
void setCurrentDraw(float current_a) {
  total_current_draw = current_a;
}

/**
 * Add to total current draw
 */
void addCurrentDraw(float current_a) {
  total_current_draw += current_a;
}

/**
 * Check if energy is critically low
 */
bool isEnergyCritical() {
  return getEnergyPercentage() <= CRITICAL_ENERGY_PCT;
}

/**
 * Check if energy is low (warning level)
 */
bool isEnergyLow() {
  return getEnergyPercentage() <= LOW_ENERGY_WARNING_PCT;
}

/**
 * Calibrate energy sensors
 */
void calibrateEnergySensors() {
  Serial.println("[ENERGY] Calibrating sensors...");
  // Read baseline from INA219 sensors
  // Adjust for offset errors
  delay(100);
  Serial.println("[ENERGY] Calibration complete");
}

#endif // ENERGY_SYSTEM_H
