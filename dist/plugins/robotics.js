/**
 * Robotics API plugin - Interface with robotic systems and hardware.
 *
 * Provides tools for controlling robotic actuators, reading sensors, and managing
 * robot state. Supports common robotics protocols and interfaces.
 */
import { BasePlugin } from "../plugin_manager/sdk.js";
import * as path from 'node:path';
export class RoboticsPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.name = 'robotics';
        this.description = 'Control robotic systems, read sensors, and execute movements.';
        this.connected = false;
        this.robotState = {
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
        this.config = {
            maxVelocity: 1.0,
            maxAcceleration: 0.5,
            coordinateSystem: 'world',
            safetyMode: true,
        };
        this.connectionInfo = null;
    }
    validateNum(val, name, minVal, maxVal, allowUndefined = false) {
        if (val === undefined || val === null) {
            if (allowUndefined)
                return 0; // return default/safe
            throw new Error(`Security Error: ${name} cannot be undefined or null.`);
        }
        const num = Number(val);
        if (isNaN(num) || !isFinite(num)) {
            throw new Error(`Security Error: ${name} must be a valid, finite number.`);
        }
        if (minVal !== undefined && num < minVal) {
            throw new Error(`Security Error: ${name} is out of bounds (minimum ${minVal}).`);
        }
        if (maxVal !== undefined && num > maxVal) {
            throw new Error(`Security Error: ${name} is out of bounds (maximum ${maxVal}).`);
        }
        return num;
    }
    async connect(connectionType = 'simulation', endpoint, config) {
        if (this.connected) {
            return { success: false, error: 'Already connected to a robot' };
        }
        const validTypes = ['simulation', 'serial', 'ros', 'tcp'];
        if (!validTypes.includes(connectionType)) {
            return { success: false, error: `Invalid connection type. Must be one of: ${validTypes}` };
        }
        if (config) {
            if (config.maxVelocity !== undefined)
                this.validateNum(config.maxVelocity, 'maxVelocity', 0.001);
            if (config.maxAcceleration !== undefined)
                this.validateNum(config.maxAcceleration, 'maxAcceleration', 0.001);
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
        if (endpoint.trim().startsWith('-')) {
            throw new Error('Security Error: Potential argument injection detected in endpoint.');
        }
        if (connectionType === 'serial') {
            // Path traversal validation
            if (process.platform !== 'win32' || endpoint.startsWith('/')) {
                const target = path.resolve(endpoint);
                const devDir = path.resolve('/dev');
                if (!target.startsWith(devDir) || target === devDir) {
                    throw new Error('Security Error: Path traversal or unauthorized serial path detected.');
                }
            }
        }
        try {
            if (connectionType === 'serial') {
                // Would use serialport in real implementation
                const fs = await import('fs');
                if (!fs.existsSync(endpoint)) {
                    return { success: false, error: `Serial port ${endpoint} not found` };
                }
            }
            else if (connectionType === 'ros') {
                // Would use roslibjs in real implementation
            }
            else if (connectionType === 'tcp') {
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
        }
        catch (error) {
            return { success: false, error: `Connection failed: ${error}` };
        }
    }
    async disconnect() {
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
    async getStatus() {
        return {
            connected: this.connected,
            connectionInfo: this.connectionInfo,
            robotState: { ...this.robotState },
            configuration: { ...this.config },
        };
    }
    async moveJoint(jointId, position, velocity, wait = true) {
        if (!this.connected) {
            return { success: false, error: 'Not connected to a robot' };
        }
        if (!Object.prototype.hasOwnProperty.call(this.robotState.joints, jointId)) {
            return { success: false, error: `Unknown joint: ${jointId}` };
        }
        // Validate position limits (typical industrial robot limits)
        position = this.validateNum(position, 'position', -Math.PI, Math.PI);
        if (velocity !== undefined) {
            this.validateNum(velocity, 'velocity', 0.001, this.config.maxVelocity);
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
    async moveCartesian(params) {
        if (!this.connected) {
            return { success: false, error: 'Not connected to a robot' };
        }
        const { x, y, z, roll, pitch, yaw, velocity } = params;
        // Build target pose
        const target = {};
        if (x !== undefined)
            target.x = this.validateNum(x, 'x');
        if (y !== undefined)
            target.y = this.validateNum(y, 'y');
        if (z !== undefined)
            target.z = this.validateNum(z, 'z');
        if (roll !== undefined)
            target.roll = this.validateNum(roll, 'roll');
        if (pitch !== undefined)
            target.pitch = this.validateNum(pitch, 'pitch');
        if (yaw !== undefined)
            target.yaw = this.validateNum(yaw, 'yaw');
        if (velocity !== undefined) {
            this.validateNum(velocity, 'velocity', 0.001, this.config.maxVelocity);
        }
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
    async gripperControl(action, position, force) {
        if (!this.connected) {
            return { success: false, error: 'Not connected to a robot' };
        }
        if (position !== undefined)
            this.validateNum(position, 'position', 0.0, 1.0);
        if (force !== undefined)
            this.validateNum(force, 'force', 0.0, 1.0);
        if (action === 'open') {
            this.robotState.gripperPosition = 1.0;
            return { success: true, message: 'Gripper opened', position: 1.0 };
        }
        else if (action === 'close') {
            this.robotState.gripperPosition = 0.0;
            return { success: true, message: 'Gripper closed', position: 0.0 };
        }
        else if (action === 'set_position') {
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
        }
        else {
            return { success: false, error: `Unknown gripper action: ${action}` };
        }
    }
    async readSensor(sensorId) {
        if (!this.connected) {
            return { success: false, error: 'Not connected to a robot' };
        }
        // Simulate various sensor types
        const sensorTypes = {
            imu: () => ({ accel: [0.0, 0.0, 9.81], gyro: [0.0, 0.0, 0.0] }),
            encoder_0: () => ({ position: this.robotState.joints.joint_0 }),
            encoder_1: () => ({ position: this.robotState.joints.joint_1 }),
            distance_front: () => ({ distance: 0.5 }),
            force_torque: () => ({ force: [0.0, 0.0, 0.0], torque: [0.0, 0.0, 0.0] }),
            current_0: () => ({ current: 0.5 }),
            temperature: () => ({ temp: 35.0 }),
        };
        if (Object.prototype.hasOwnProperty.call(sensorTypes, sensorId)) {
            const reading = sensorTypes[sensorId]();
            this.robotState.sensors[sensorId] = reading;
            return { success: true, sensorId, reading };
        }
        // Return cached value if exists
        if (Object.prototype.hasOwnProperty.call(this.robotState.sensors, sensorId)) {
            return {
                success: true,
                sensorId,
                reading: this.robotState.sensors[sensorId],
            };
        }
        return { success: false, error: `Unknown sensor: ${sensorId}` };
    }
    async readAllSensors() {
        if (!this.connected) {
            return { success: false, error: 'Not connected to a robot' };
        }
        const readings = {};
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
    async executeTrajectory(waypoints, velocity, blendRadius = 0.01) {
        if (!this.connected) {
            return { success: false, error: 'Not connected to a robot' };
        }
        if (!waypoints || waypoints.length === 0) {
            return { success: false, error: 'No waypoints provided' };
        }
        if (velocity !== undefined) {
            this.validateNum(velocity, 'velocity', 0.001, this.config.maxVelocity);
        }
        this.validateNum(blendRadius, 'blendRadius', 0.0);
        // Validate waypoints
        for (let i = 0; i < waypoints.length; i++) {
            if (typeof waypoints[i] !== 'object' || waypoints[i] === null) {
                return { success: false, error: `Waypoint ${i} must be a dictionary` };
            }
            const wp = waypoints[i];
            if (wp.x !== undefined)
                this.validateNum(wp.x, `waypoints[${i}].x`);
            if (wp.y !== undefined)
                this.validateNum(wp.y, `waypoints[${i}].y`);
            if (wp.z !== undefined)
                this.validateNum(wp.z, `waypoints[${i}].z`);
            if (wp.roll !== undefined)
                this.validateNum(wp.roll, `waypoints[${i}].roll`);
            if (wp.pitch !== undefined)
                this.validateNum(wp.pitch, `waypoints[${i}].pitch`);
            if (wp.yaw !== undefined)
                this.validateNum(wp.yaw, `waypoints[${i}].yaw`);
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
    async emergencyStop() {
        this.robotState.status = 'e-stopped';
        this.robotState.errors.push('Emergency stop activated');
        return {
            success: true,
            message: 'Emergency stop activated - all motion halted',
            status: 'e-stopped',
        };
    }
    async getConfiguration() {
        if (!this.connected) {
            return { success: false, error: 'Not connected to a robot' };
        }
        return {
            success: true,
            configuration: { ...this.config },
        };
    }
    async setConfiguration(config) {
        if (!this.connected) {
            return { success: false, error: 'Not connected to a robot' };
        }
        if (config.maxVelocity !== undefined)
            this.validateNum(config.maxVelocity, 'maxVelocity', 0.001);
        if (config.maxAcceleration !== undefined)
            this.validateNum(config.maxAcceleration, 'maxAcceleration', 0.001);
        const allowedKeys = ['maxVelocity', 'maxAcceleration', 'coordinateSystem', 'safetyMode'];
        for (const key of Object.keys(config)) {
            if (allowedKeys.includes(key)) {
                this.config[key] = config[key];
            }
        }
        return {
            success: true,
            message: 'Configuration updated',
            configuration: { ...this.config },
        };
    }
}
