/*
 * Pump Control Module
 * Controls peristaltic pumps for fluid transport
 */

#ifndef PUMP_CONTROL_H
#define PUMP_CONTROL_H

#include <Arduino.h>
#include "config.h"

// Pump state
static int pump_pwm[PUMP_COUNT] = {0, 0, 0, 0};
static bool pump_direction[PUMP_COUNT] = {true, true, true, true};
static unsigned long last_pump_update = 0;

/**
 * Initialize pump control system
 */
void initPumps() {
  // Set PWM pins for pumps
  ledcSetup(4, 5000, 8); // Channel 4, 5kHz, 8-bit
  ledcSetup(5, 5000, 8);
  ledcSetup(6, 5000, 8);
  ledcSetup(7, 5000, 8);
  
  // Attach channels to GPIO pins (using same pins as motor driver)
  ledcAttachPin(PUMP1_IN1, 4);
  ledcAttachPin(PUMP1_IN2, 5);
  ledcAttachPin(PUMP2_IN3, 6);
  ledcAttachPin(PUMP2_IN4, 7);
  
  // Initialize all pumps to off
  for(int i = 0; i < PUMP_COUNT; i++) {
    pump_pwm[i] = 0;
  }
  
  // Set direction pins
  pinMode(PUMP1_IN1, OUTPUT);
  pinMode(PUMP1_IN2, OUTPUT);
  pinMode(PUMP2_IN3, OUTPUT);
  pinMode(PUMP2_IN4, OUTPUT);
  
  Serial.println("[PUMPS] System initialized");
}

/**
 * Set pump speed (0-255 PWM)
 */
void setPumpSpeed(int pump_index, int pwm_value) {
  if(pump_index < 0 || pump_index >= PUMP_COUNT) return;
  
  pwm_value = constrain(pwm_value, 0, 255);
  
  // Minimum PWM to start rotation
  if(pwm_value > 0 && pwm_value < PUMP_MIN_PWM) {
    pwm_value = PUMP_MIN_PWM;
  }
  
  pump_pwm[pump_index] = pwm_value;
  
  // Apply PWM based on pump index
  if(pump_index == 0) {
    ledcWrite(4, pwm_value);
    digitalWrite(PUMP1_IN2, LOW); // Direction
  } else if(pump_index == 1) {
    ledcWrite(6, pwm_value);
    digitalWrite(PUMP2_IN4, LOW); // Direction
  }
  // Add more pumps as needed
}

/**
 * Set pump speed as percentage (0-100)
 */
void setPumpSpeedPercent(int pump_index, float percent) {
  int pwm_value = (int)(percent / 100.0f * 255);
  setPumpSpeed(pump_index, pwm_value);
}

/**
 * Set all pumps to same speed
 */
void setAllPumpsSpeed(int pwm_value) {
  for(int i = 0; i < PUMP_COUNT; i++) {
    setPumpSpeed(i, pwm_value);
  }
}

/**
 * Reverse pump direction
 */
void setPumpDirection(int pump_index, bool forward) {
  if(pump_index < 0 || pump_index >= PUMP_COUNT) return;
  
  pump_direction[pump_index] = forward;
  
  if(pump_index == 0) {
    digitalWrite(PUMP1_IN2, forward ? LOW : HIGH);
  } else if(pump_index == 1) {
    digitalWrite(PUMP2_IN4, forward ? LOW : HIGH);
  }
}

/**
 * Get current pump speed
 */
int getPumpSpeed(int pump_index) {
  if(pump_index < 0 || pump_index >= PUMP_COUNT) return 0;
  return pump_pwm[pump_index];
}

/**
 * Prime pump (run briefly in reverse to remove air)
 */
void primePump(int pump_index) {
  Serial.print("[PUMPS] Priming pump ");
  Serial.println(pump_index);
  
  // Run in reverse for 2 seconds
  setPumpDirection(pump_index, false);
  setPumpSpeed(pump_index, PUMP_DEFAULT_PWM);
  delay(2000);
  
  // Stop
  setPumpSpeed(pump_index, 0);
  setPumpDirection(pump_index, true);
}

/**
 * Activate repair protocol - deliver repair fluid to damage site
 */
void activateRepairProtocol(int severity) {
  Serial.print("[PUMPS] Activating repair protocol, severity: ");
  Serial.println(severity);
  
  // Main circulation pump continues at reduced speed
  setPumpSpeedPercent(0, 30);
  
  // Repair pump activates at high speed
  int repair_speed = 50 + (severity * 20); // Higher severity = faster delivery
  repair_speed = constrain(repair_speed, 50, 100);
  setPumpSpeedPercent(1, repair_speed);
  
  // Run for duration based on severity
  unsigned long repair_duration = 2000 + (severity * 1000); // ms
  delay(repair_duration);
  
  // Stop repair pump
  setPumpSpeed(1, 0);
  
  // Restore main pump
  setPumpSpeedPercent(0, 50);
  
  Serial.println("[PUMPS] Repair protocol complete");
}

/**
 * Calibrate pump sensors
 */
void calibratePumpSensors() {
  Serial.println("[PUMPS] Calibrating...");
  
  // Test each pump briefly
  for(int i = 0; i < PUMP_COUNT; i++) {
    Serial.print("  Testing pump ");
    Serial.println(i);
    setPumpSpeed(i, PUMP_MIN_PWM);
    delay(500);
    setPumpSpeed(i, 0);
  }
  
  Serial.println("[PUMPS] Calibration complete");
}

/**
 * Emergency stop - stop all pumps
 */
void emergencyStopPumps() {
  Serial.println("[PUMPS] EMERGENCY STOP");
  for(int i = 0; i < PUMP_COUNT; i++) {
    setPumpSpeed(i, 0);
  }
}

#endif // PUMP_CONTROL_H
