/*
 * Muscle Control Module
 * Controls Shape Memory Alloy (SMA) artificial muscles
 */

#ifndef MUSCLE_CONTROL_H
#define MUSCLE_CONTROL_H

#include <Arduino.h>
#include "config.h"

// Muscle state
static float muscle_activation[MUSCLE_COUNT] = {0, 0, 0, 0};
static float muscle_current[MUSCLE_COUNT] = {0, 0, 0, 0};
static unsigned long last_muscle_update = 0;
static int muscle_pwm[MUSCLE_COUNT] = {0, 0, 0, 0};

/**
 * Initialize muscle control system
 */
void initMuscles() {
  // Set PWM pins
  ledcSetup(0, 1000, 8); // Channel 0, 1kHz, 8-bit
  ledcSetup(1, 1000, 8);
  ledcSetup(2, 1000, 8);
  ledcSetup(3, 1000, 8);
  
  // Attach channels to GPIO pins
  ledcAttachPin(MUSCLE1_GATE, 0);
  ledcAttachPin(MUSCLE2_GATE, 1);
  ledcAttachPin(MUSCLE3_GATE, 2);
  ledcAttachPin(MUSCLE4_GATE, 3);
  
  // Initialize activation array
  for(int i = 0; i < MUSCLE_COUNT; i++) {
    muscle_activation[i] = 0.0f;
    muscle_pwm[i] = 0;
  }
  
  Serial.println("[MUSCLES] System initialized");
}

/**
 * Set muscle activation level (0.0 to 1.0)
 */
void setMuscleActivation(int index, float activation) {
  if(index < 0 || index >= MUSCLE_COUNT) return;
  
  activation = constrain(activation, 0.0f, 1.0f);
  muscle_activation[index] = activation;
  
  // Convert to PWM (0-255)
  int pwm_value = (int)(activation * 255);
  muscle_pwm[index] = pwm_value;
  
  // Apply PWM
  ledcWrite(index, pwm_value);
  
  // Track current draw (estimated)
  muscle_current[index] = activation * SMA_MAX_CURRENT_A;
}

/**
 * Get muscle activation level
 */
float getMuscleActivation(int index) {
  if(index < 0 || index >= MUSCLE_COUNT) return 0;
  return muscle_activation[index];
}

/**
 * Get muscle current draw
 */
float getMuscleCurrent(int index) {
  if(index < 0 || index >= MUSCLE_COUNT) return 0;
  return muscle_current[index];
}

/**
 * High-frequency muscle control loop (call at 1kHz)
 */
void updateMuscleControl() {
  static unsigned long last_update = 0;
  unsigned long now = micros();
  
  // Run at 1kHz (every 1000 microseconds)
  if(now - last_update >= 1000) {
    last_update = now;
    
    // Update each muscle
    for(int i = 0; i < MUSCLE_COUNT; i++) {
      // Safety check: limit duty cycle to prevent overheating
      // SMA needs time to cool between contractions
      static int duty_cycle_counter[MUSCLE_COUNT] = {0, 0, 0, 0};
      
      duty_cycle_counter[i]++;
      if(duty_cycle_counter[i] > 10) {
        duty_cycle_counter[i] = 0;
      }
      
      // Reduce effective duty cycle to 70% max for cooling
      if(muscle_pwm[i] > 0 && duty_cycle_counter[i] <= 7) {
        ledcWrite(i, muscle_pwm[i]);
      } else if(muscle_pwm[i] > 0) {
        ledcWrite(i, 0); // Off for cooling
      }
    }
  }
}

/**
 * Activate all muscles in a wave pattern (for demonstration)
 */
void activateWavePattern(float speed_ms) {
  static int wave_index = 0;
  static unsigned long last_wave = 0;
  
  if(millis() - last_wave >= speed_ms) {
    last_wave = millis();
    
    // Reset all
    for(int i = 0; i < MUSCLE_COUNT; i++) {
      setMuscleActivation(i, 0);
    }
    
    // Activate current muscle in wave
    setMuscleActivation(wave_index, 0.7f);
    
    wave_index = (wave_index + 1) % MUSCLE_COUNT;
  }
}

/**
 * Calibrate muscle sensors
 */
void calibrateMuscleSensors() {
  Serial.println("[MUSCLES] Calibrating current sensors...");
  
  // Zero all sensors
  for(int i = 0; i < MUSCLE_COUNT; i++) {
    muscle_current[i] = 0;
  }
  
  delay(100);
  Serial.println("[MUSCLES] Calibration complete");
}

/**
 * Emergency stop - deactivate all muscles
 */
void emergencyStopMuscles() {
  Serial.println("[MUSCLES] EMERGENCY STOP");
  for(int i = 0; i < MUSCLE_COUNT; i++) {
    setMuscleActivation(i, 0);
  }
}

#endif // MUSCLE_CONTROL_H
