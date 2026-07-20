/**
 * Robotics API plugin - Interface with robotic systems and hardware.
 * 
 * Provides tools for controlling robotic actuators, reading sensors, and managing
 * robot state. Supports common robotics protocols and interfaces.
 */

import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";

export interface RobotState {
  joints: Record<string, number>;
  gripperPosition: number;
  sensors: Record<string, any>;
  status: 'idle' | 'ready' | 'moving' | 'executing_trajectory' | 'e-stopped' | 'disconnected';
  errors: string[];
}

export interface RobotConfiguration {
  maxVelocity: number;
  maxAcceleration: number;
  coordinateSystem: 'world' | 'tool';
  safetyMode: boolean;
}

export interface ConnectionInfo {
  type: 'simulation' | 'serial' | 'ros' | 'tcp';
  endpoint: string;
  robotModel: string;
}

export interface Waypoint {
  x?: number;
  y?: number;
  z?: number;
  roll?: number;
  pitch?: number;
  yaw?: number;
}

export class RoboticsPlugin extends BasePlugin {
  name = 'robotics';
  description = 'Control robotic systems, read sensors, and execute movements.';

  constructor(definition: PluginDefinition) {
    super(definition);
  }

  private connected = false;
  private robotState: RobotState = {
    joints: {
      joint_0: 0.0,
      joint_1: 0.0,
      joint_2: 0.0,
      joint_3: 0.0,
      joint_4: 0.0,
      joint_5: 0.0,
    },
    gripperPosition: 0.0,
    sensors: {},
    status: 'idle',
    errors: [],
  };
  
  private config: RobotConfiguration = {
    maxVelocity: 1.0,
    maxAcceleration: 0.5,
    coordinateSystem: 'world',
    safetyMode: true,
  };
  
  private connectionInfo: ConnectionInfo | null = null;

  async connect(
    connectionType: 'simulation' | 'serial' | 'ros' | 'tcp' = 'simulation',
    endpoint?: string,
    config?: Partial<RobotConfiguration>
  ): Promise<any> {
    if (this.connected) {
      return { success: false, error: 'Already connected to a robot' };
    }

    const validTypes = ['simulation', 'serial', 'ros', 'tcp'];
    if (!validTypes.includes(connectionType)) {
      return { success: false, error: `Invalid connection type. Must be one of: ${validTypes}` };
    }

    // In simulation mode, we don't need a real endpoint
    if (connectionType === 'simulation') {
      this.connected = true;
      this.connectionInfo = {
        type: 'simulation',
        endpoint: 'local',
        robotModel: 'simulated_6dof_arm',
      };
      this.robotState.status = 'ready';
      return {
        success: true,
        message: 'Connected to simulated robot',
        robotInfo: this.connectionInfo,
      };
    }

    // For real connections, validate endpoint
    if (!endpoint) {
      return { success: false, error: 'Endpoint required for non-simulation connections' };
    }

    try {
      if (connectionType === 'serial') {
        // Would use serialport in real implementation
        const fs = await import('fs');
        if (!fs.existsSync(endpoint)) {
          return { success: false, error: `Serial port ${endpoint} not found` };
        }
      } else if (connectionType === 'ros') {
        // Would use roslibjs in real implementation
      } else if (connectionType === 'tcp') {
        // Would use net module in real implementation
      }

      this.connected = true;
      this.connectionInfo = {
        type: connectionType,
        endpoint,
        robotModel: 'connected_robot',
      };
      this.robotState.status = 'ready';

      if (config) {
        this.config = { ...this.config, ...config };
      }

      return {
        success: true,
        message: `Connected to robot via ${connectionType}`,
        robotInfo: this.connectionInfo,
      };
    } catch (error) {
      return { success: false, error: `Connection failed: ${error}` };
    }
  }

  async disconnect(): Promise<any> {
    if (!this.connected) {
      return { success: false, error: 'Not connected to any robot' };
    }

    // Ensure robot is in safe state before disconnecting
    if (this.robotState.status !== 'idle') {
      await this.emergencyStop();
    }

    this.connected = false;
    this.connectionInfo = null;
    this.robotState.status = 'disconnected';

    return { success: true, message: 'Disconnected from robot' };
  }

  async getStatus(): Promise<any> {
    return {
      connected: this.connected,
      connectionInfo: this.connectionInfo,
      robotState: { ...this.robotState },
      configuration: { ...this.config },
    };
  }

  async moveJoint(
    jointId: string,
    position: number,
    velocity?: number,
    wait: boolean = true
  ): Promise<any> {
    if (!this.connected) {
      return { success: false, error: 'Not connected to a robot' };
    }

    if (!(jointId in this.robotState.joints)) {
      return { success: false, error: `Unknown joint: ${jointId}` };
    }

    // Validate position limits (typical industrial robot limits)
    if (position < -Math.PI || position > Math.PI) {
      return { success: false, error: 'Position out of range (-π to π)' };
    }

    const vel = velocity ?? this.config.maxVelocity;
    const oldPosition = this.robotState.joints[jointId];
    this.robotState.joints[jointId] = position;
    this.robotState.status = wait ? 'ready' : 'moving';

    return {
      success: true,
      message: `Moved ${jointId} from ${oldPosition.toFixed(3)} to ${position.toFixed(3)} rad`,
      joint: jointId,
      oldPosition,
      newPosition: position,
      velocity: vel,
    };
  }

  async moveCartesian(params: {
    x?: number;
    y?: number;
    z?: number;
    roll?: number;
    pitch?: number;
    yaw?: number;
    velocity?: number;
  }): Promise<any> {
    if (!this.connected) {
      return { success: false, error: 'Not connected to a robot' };
    }

    const { x, y, z, roll, pitch, yaw, velocity } = params;
    
    // Build target pose
    const target: Record<string, number> = {};
    if (x !== undefined) target.x = x;
    if (y !== undefined) target.y = y;
    if (z !== undefined) target.z = z;
    if (roll !== undefined) target.roll = roll;
    if (pitch !== undefined) target.pitch = pitch;
    if (yaw !== undefined) target.yaw = yaw;

    if (Object.keys(target).length === 0) {
      return { success: false, error: 'No target position specified' };
    }

    // Validate workspace limits (typical small arm workspace)
    if ('x' in target || 'y' in target || 'z' in target) {
      const xVal = target.x ?? 0;
      const yVal = target.y ?? 0;
      const zVal = target.z ?? 0;
      const distance = Math.sqrt(xVal ** 2 + yVal ** 2 + zVal ** 2);
      if (distance > 1.0) {
        return { success: false, error: 'Target position outside workspace' };
      }
    }

    const vel = velocity ?? this.config.maxVelocity;
    this.robotState.status = 'moving';

    return {
      success: true,
      message: `Moving to Cartesian position: ${JSON.stringify(target)}`,
      target,
      velocity: vel,
    };
  }

  async gripperControl(action: string, position?: number, force?: number): Promise<any> {
    if (!this.connected) {
      return { success: false, error: 'Not connected to a robot' };
    }

    if (action === 'open') {
      this.robotState.gripperPosition = 1.0;
      return { success: true, message: 'Gripper opened', position: 1.0 };
    } else if (action === 'close') {
      this.robotState.gripperPosition = 0.0;
      return { success: true, message: 'Gripper closed', position: 0.0 };
    } else if (action === 'set_position') {
      if (position === undefined) {
        return { success: false, error: 'Position required for set_position' };
      }
      if (position < 0.0 || position > 1.0) {
        return { success: false, error: 'Position must be between 0.0 and 1.0' };
      }
      this.robotState.gripperPosition = position;
      return {
        success: true,
        message: `Gripper position set to ${position}`,
        position,
      };
    } else {
      return { success: false, error: `Unknown gripper action: ${action}` };
    }
  }

  async readSensor(sensorId: string): Promise<any> {
    if (!this.connected) {
      return { success: false, error: 'Not connected to a robot' };
    }

    // Simulate various sensor types
    const sensorTypes: Record<string, () => any> = {
      imu: () => ({ accel: [0.0, 0.0, 9.81], gyro: [0.0, 0.0, 0.0] }),
      encoder_0: () => ({ position: this.robotState.joints.joint_0 }),
      encoder_1: () => ({ position: this.robotState.joints.joint_1 }),
      distance_front: () => ({ distance: 0.5 }),
      force_torque: () => ({ force: [0.0, 0.0, 0.0], torque: [0.0, 0.0, 0.0] }),
      current_0: () => ({ current: 0.5 }),
      temperature: () => ({ temp: 35.0 }),
    };

    if (sensorId in sensorTypes) {
      const reading = sensorTypes[sensorId]();
      this.robotState.sensors[sensorId] = reading;
      return { success: true, sensorId, reading };
    }

    // Return cached value if exists
    if (sensorId in this.robotState.sensors) {
      return {
        success: true,
        sensorId,
        reading: this.robotState.sensors[sensorId],
      };
    }

    return { success: false, error: `Unknown sensor: ${sensorId}` };
  }

  async readAllSensors(): Promise<any> {
    if (!this.connected) {
      return { success: false, error: 'Not connected to a robot' };
    }

    const readings: Record<string, any> = {};
    const sensorIds = ['imu', 'encoder_0', 'encoder_1', 'distance_front', 
                       'force_torque', 'current_0', 'temperature'];
    
    for (const sensorId of sensorIds) {
      const result = await this.readSensor(sensorId);
      if (result.success) {
        readings[sensorId] = result.reading;
      }
    }

    return { success: true, readings };
  }

  async executeTrajectory(
    waypoints: Waypoint[],
    velocity?: number,
    blendRadius: number = 0.01
  ): Promise<any> {
    if (!this.connected) {
      return { success: false, error: 'Not connected to a robot' };
    }

    if (!waypoints || waypoints.length === 0) {
      return { success: false, error: 'No waypoints provided' };
    }

    // Validate waypoints
    for (let i = 0; i < waypoints.length; i++) {
      if (typeof waypoints[i] !== 'object' || waypoints[i] === null) {
        return { success: false, error: `Waypoint ${i} must be a dictionary` };
      }
    }

    const vel = velocity ?? this.config.maxVelocity;
    this.robotState.status = 'executing_trajectory';

    return {
      success: true,
      message: `Executing trajectory with ${waypoints.length} waypoints`,
      waypointsCount: waypoints.length,
      velocity: vel,
      blendRadius,
    };
  }

  async emergencyStop(): Promise<any> {
    this.robotState.status = 'e-stopped';
    this.robotState.errors.push('Emergency stop activated');

    return {
      success: true,
      message: 'Emergency stop activated - all motion halted',
      status: 'e-stopped',
    };
  }

  async getConfiguration(): Promise<any> {
    if (!this.connected) {
      return { success: false, error: 'Not connected to a robot' };
    }

    return {
      success: true,
      configuration: { ...this.config },
    };
  }

  async setConfiguration(config: Partial<RobotConfiguration>): Promise<any> {
    if (!this.connected) {
      return { success: false, error: 'Not connected to a robot' };
    }

    const allowedKeys = ['maxVelocity', 'maxAcceleration', 'coordinateSystem', 'safetyMode'];
    for (const key of Object.keys(config) as Array<keyof RobotConfiguration>) {
      if (allowedKeys.includes(key)) {
        (this.config as any)[key] = (config as any)[key];
      }
    }

    return {
      success: true,
      message: 'Configuration updated',
      configuration: { ...this.config },
    };
  }
}
