"""Robotics API plugin — interface with robotic systems and hardware.

Provides tools for controlling robotic actuators, reading sensors, and managing
robot state. Supports common robotics protocols and interfaces.
"""

from __future__ import annotations
import os
import json
import time
from typing import Optional, Dict, Any, List
from .plugin_base import Plugin


class RoboticsPlugin(Plugin):
    """Robotics API plugin for controlling robotic systems.
    
    This plugin provides an interface for:
    - Controlling robotic actuators (motors, servos, grippers)
    - Reading sensor data (encoders, IMU, distance sensors)
    - Managing robot state and configuration
    - Executing movement commands and trajectories
    
    The plugin uses a mock/simulation mode by default and can be configured
    to connect to real hardware via ROS, serial ports, or network APIs.
    """
    
    name = "robotics"
    description = "Control robotic systems, read sensors, and execute movements."
    
    def _validate_num(self, val: Any, name: str, min_val: Optional[float] = None, max_val: Optional[float] = None, allow_none: bool = False) -> Optional[float]:
        if val is None:
            if allow_none:
                return None
            raise ValueError(f"Security Error: {name} cannot be None.")

        try:
            f_val = float(val)
        except (ValueError, TypeError):
            raise ValueError(f"Security Error: {name} must be a valid number.")

        import math
        if math.isnan(f_val) or math.isinf(f_val):
            raise ValueError(f"Security Error: {name} cannot be NaN or infinity.")

        if min_val is not None and f_val < min_val:
            raise ValueError(f"Security Error: {name} is out of bounds (minimum {min_val}).")

        if max_val is not None and f_val > max_val:
            raise ValueError(f"Security Error: {name} is out of bounds (maximum {max_val}).")

        return f_val

    def _setup(self) -> None:
        self.tools = {
            "connect": self._connect,
            "disconnect": self._disconnect,
            "get_status": self._get_status,
            "move_joint": self._move_joint,
            "move_cartesian": self._move_cartesian,
            "gripper_control": self._gripper_control,
            "read_sensor": self._read_sensor,
            "read_all_sensors": self._read_all_sensors,
            "execute_trajectory": self._execute_trajectory,
            "emergency_stop": self._emergency_stop,
            "get_configuration": self._get_configuration,
            "set_configuration": self._set_configuration,
        }
        self._connected = False
        self._robot_state = {
            "joints": {f"joint_{i}": 0.0 for i in range(6)},
            "gripper_position": 0.0,
            "sensors": {},
            "status": "idle",
            "errors": [],
        }
        self._config = {
            "max_velocity": 1.0,
            "max_acceleration": 0.5,
            "coordinate_system": "world",
            "safety_mode": True,
        }
        self._connection_info = None
    
    def _connect(self, connection_type: str = "simulation", 
                 endpoint: str = None, 
                 config: Dict = None) -> Dict[str, Any]:
        """Connect to a robotic system.
        
        Args:
            connection_type: Type of connection ('simulation', 'serial', 'ros', 'tcp')
            endpoint: Connection endpoint (e.g., '/dev/ttyUSB0', 'localhost:11311')
            config: Additional configuration parameters
            
        Returns:
            Connection status and robot information
        """
        if self._connected:
            return {"success": False, "error": "Already connected to a robot"}
        
        # Validate connection type
        valid_types = ["simulation", "serial", "ros", "tcp"]
        if connection_type not in valid_types:
            return {"success": False, "error": f"Invalid connection type. Must be one of: {valid_types}"}
        
        # Validate connection config if provided
        if config:
            for key, val in config.items():
                if key in ["max_velocity", "max_acceleration"]:
                    self._validate_num(val, key, min_val=0.001)

        # In simulation mode, we don't need a real endpoint
        if connection_type == "simulation":
            self._connected = True
            self._connection_info = {
                "type": "simulation",
                "endpoint": "local",
                "robot_model": "simulated_6dof_arm",
            }
            self._robot_state["status"] = "ready"
            return {
                "success": True,
                "message": "Connected to simulated robot",
                "robot_info": self._connection_info,
            }
        
        # For real connections, validate endpoint
        if not endpoint:
            return {"success": False, "error": "Endpoint required for non-simulation connections"}
        
        if endpoint.strip().startswith("-"):
            raise ValueError("Security Error: Potential argument injection detected in endpoint.")

        if connection_type == "serial":
            # Check for path traversal / local file disclosure
            if os.name == "posix" or endpoint.startswith("/"):
                target = os.path.realpath(os.path.abspath(os.path.expanduser(endpoint)))
                dev_dir = os.path.realpath("/dev")
                try:
                    common = os.path.commonpath([dev_dir, target])
                except ValueError:
                    raise ValueError("Security Error: Invalid serial path.")

                if common != dev_dir or target == dev_dir:
                    raise ValueError("Security Error: Path traversal or unauthorized serial path detected.")
        elif connection_type == "tcp":
            parts = endpoint.split(":")
            if len(parts) != 2:
                raise ValueError("Security Error: Invalid TCP endpoint format. Expected host:port.")
            try:
                port = int(parts[1])
                if not (1 <= port <= 65535):
                    raise ValueError("Security Error: Invalid TCP port number.")
            except (ValueError, TypeError):
                raise ValueError("Security Error: Invalid TCP port number.")
        elif connection_type == "ros":
            from urllib.parse import urlparse
            try:
                parsed = urlparse(endpoint)
            except Exception:
                raise ValueError("Security Error: Invalid ROS master URI or endpoint scheme.")
            if parsed.scheme not in ["http", "https", "rosrpc"]:
                raise ValueError("Security Error: Invalid ROS master URI or endpoint scheme.")
            if parsed.port is not None:
                if not (1 <= parsed.port <= 65535):
                    raise ValueError("Security Error: Invalid ROS endpoint port.")

        # Attempt connection based on type
        try:
            if connection_type == "serial":
                # Would use pyserial in real implementation
                if not os.path.exists(endpoint):
                    return {"success": False, "error": f"Serial port {endpoint} not found"}
                    
            elif connection_type == "ros":
                # Would use rospy/ROS2 in real implementation
                pass
                
            elif connection_type == "tcp":
                # Would use socket connection in real implementation
                pass
            
            self._connected = True
            self._connection_info = {
                "type": connection_type,
                "endpoint": endpoint,
                "robot_model": "connected_robot",
            }
            self._robot_state["status"] = "ready"
            
            if config:
                self._config.update(config)
            
            return {
                "success": True,
                "message": f"Connected to robot via {connection_type}",
                "robot_info": self._connection_info,
            }
            
        except Exception as e:
            return {"success": False, "error": f"Connection failed: {str(e)}"}
    
    def _disconnect(self) -> Dict[str, Any]:
        """Disconnect from the robotic system.
        
        Returns:
            Disconnection status
        """
        if not self._connected:
            return {"success": False, "error": "Not connected to any robot"}
        
        # Ensure robot is in safe state before disconnecting
        if self._robot_state["status"] != "idle":
            self._emergency_stop()
        
        self._connected = False
        self._connection_info = None
        self._robot_state["status"] = "disconnected"
        
        return {"success": True, "message": "Disconnected from robot"}
    
    def _get_status(self) -> Dict[str, Any]:
        """Get current robot status.
        
        Returns:
            Current robot state including joints, gripper, and errors
        """
        return {
            "connected": self._connected,
            "connection_info": self._connection_info,
            "robot_state": self._robot_state.copy(),
            "configuration": self._config.copy(),
        }
    
    def _move_joint(self, joint_id: str, position: float, 
                    velocity: float = None, wait: bool = True) -> Dict[str, Any]:
        """Move a specific joint to a target position.
        
        Args:
            joint_id: Joint identifier (e.g., 'joint_0', 'joint_1')
            position: Target position in radians
            velocity: Movement velocity (rad/s), uses default if None
            wait: Whether to wait for movement completion
            
        Returns:
            Movement execution status
        """
        if not self._connected:
            return {"success": False, "error": "Not connected to a robot"}
        
        if joint_id not in self._robot_state["joints"]:
            return {"success": False, "error": f"Unknown joint: {joint_id}"}
        
        # Validate position limits (typical industrial robot limits)
        position = self._validate_num(position, "position", -3.14, 3.14)

        if velocity is not None:
            velocity = self._validate_num(velocity, "velocity", min_val=0.001, max_val=self._config["max_velocity"])
        
        vel = velocity or self._config["max_velocity"]
        
        # Simulate movement
        old_position = self._robot_state["joints"][joint_id]
        self._robot_state["joints"][joint_id] = position
        self._robot_state["status"] = "moving" if not wait else "ready"
        
        return {
            "success": True,
            "message": f"Moved {joint_id} from {old_position:.3f} to {position:.3f} rad",
            "joint": joint_id,
            "old_position": old_position,
            "new_position": position,
            "velocity": vel,
        }
    
    def _move_cartesian(self, x: float = None, y: float = None, z: float = None,
                        roll: float = None, pitch: float = None, yaw: float = None,
                        velocity: float = None) -> Dict[str, Any]:
        """Move robot end-effector in Cartesian space.
        
        Args:
            x, y, z: Target position in meters
            roll, pitch, yaw: Target orientation in radians
            velocity: Movement velocity (m/s)
            
        Returns:
            Movement execution status
        """
        if not self._connected:
            return {"success": False, "error": "Not connected to a robot"}
        
        # Build target pose with validation
        target = {}
        if x is not None:
            x = self._validate_num(x, "x")
            target["x"] = x
        if y is not None:
            y = self._validate_num(y, "y")
            target["y"] = y
        if z is not None:
            z = self._validate_num(z, "z")
            target["z"] = z
        if roll is not None:
            roll = self._validate_num(roll, "roll")
            target["roll"] = roll
        if pitch is not None:
            pitch = self._validate_num(pitch, "pitch")
            target["pitch"] = pitch
        if yaw is not None:
            yaw = self._validate_num(yaw, "yaw")
            target["yaw"] = yaw
        
        if velocity is not None:
            velocity = self._validate_num(velocity, "velocity", min_val=0.001, max_val=self._config["max_velocity"])

        if not target:
            return {"success": False, "error": "No target position specified"}
        
        # Validate workspace limits (typical small arm workspace)
        if any(k in target for k in ["x", "y", "z"]):
            x_val = target.get("x", 0)
            y_val = target.get("y", 0)
            z_val = target.get("z", 0)
            distance = (x_val**2 + y_val**2 + z_val**2)**0.5
            if distance > 1.0:  # 1 meter reach limit
                return {"success": False, "error": "Target position outside workspace"}
        
        vel = velocity or self._config["max_velocity"]
        self._robot_state["status"] = "moving"
        
        return {
            "success": True,
            "message": f"Moving to Cartesian position: {target}",
            "target": target,
            "velocity": vel,
        }
    
    def _gripper_control(self, action: str, position: float = None,
                         force: float = None) -> Dict[str, Any]:
        """Control the robot gripper.
        
        Args:
            action: Action to perform ('open', 'close', 'set_position')
            position: Gripper position (0.0 = closed, 1.0 = open)
            force: Gripping force (0.0 to 1.0)
            
        Returns:
            Gripper control status
        """
        if not self._connected:
            return {"success": False, "error": "Not connected to a robot"}
        
        if position is not None:
            position = self._validate_num(position, "position", 0.0, 1.0)
        if force is not None:
            force = self._validate_num(force, "force", 0.0, 1.0)

        if action == "open":
            self._robot_state["gripper_position"] = 1.0
            return {"success": True, "message": "Gripper opened", "position": 1.0}
        
        elif action == "close":
            self._robot_state["gripper_position"] = 0.0
            return {"success": True, "message": "Gripper closed", "position": 0.0}
        
        elif action == "set_position":
            if position is None:
                return {"success": False, "error": "Position required for set_position"}
            if not (0.0 <= position <= 1.0):
                return {"success": False, "error": "Position must be between 0.0 and 1.0"}
            
            self._robot_state["gripper_position"] = position
            return {
                "success": True,
                "message": f"Gripper position set to {position}",
                "position": position,
            }
        
        else:
            return {"success": False, "error": f"Unknown gripper action: {action}"}
    
    def _read_sensor(self, sensor_id: str) -> Dict[str, Any]:
        """Read data from a specific sensor.
        
        Args:
            sensor_id: Sensor identifier (e.g., 'imu', 'encoder_0', 'distance_front')
            
        Returns:
            Sensor reading data
        """
        if not self._connected:
            return {"success": False, "error": "Not connected to a robot"}
        
        # Simulate various sensor types
        sensor_types = {
            "imu": lambda: {"accel": [0.0, 0.0, 9.81], "gyro": [0.0, 0.0, 0.0]},
            "encoder_0": lambda: {"position": self._robot_state["joints"]["joint_0"]},
            "encoder_1": lambda: {"position": self._robot_state["joints"]["joint_1"]},
            "distance_front": lambda: {"distance": 0.5},  # meters
            "force_torque": lambda: {"force": [0.0, 0.0, 0.0], "torque": [0.0, 0.0, 0.0]},
            "current_0": lambda: {"current": 0.5},  # amps
            "temperature": lambda: {"temp": 35.0},  # celsius
        }
        
        if sensor_id in sensor_types:
            reading = sensor_types[sensor_id]()
            self._robot_state["sensors"][sensor_id] = reading
            return {"success": True, "sensor_id": sensor_id, "reading": reading}
        
        # Return cached value if exists
        if sensor_id in self._robot_state["sensors"]:
            return {
                "success": True,
                "sensor_id": sensor_id,
                "reading": self._robot_state["sensors"][sensor_id],
            }
        
        return {"success": False, "error": f"Unknown sensor: {sensor_id}"}
    
    def _read_all_sensors(self) -> Dict[str, Any]:
        """Read all available sensors.
        
        Returns:
            All sensor readings
        """
        if not self._connected:
            return {"success": False, "error": "Not connected to a robot"}
        
        readings = {}
        for sensor_id in ["imu", "encoder_0", "encoder_1", "distance_front", 
                          "force_torque", "current_0", "temperature"]:
            result = self._read_sensor(sensor_id)
            if result["success"]:
                readings[sensor_id] = result["reading"]
        
        return {"success": True, "readings": readings}
    
    def _execute_trajectory(self, waypoints: List[Dict], 
                           velocity: float = None,
                           blend_radius: float = 0.01) -> Dict[str, Any]:
        """Execute a trajectory through multiple waypoints.
        
        Args:
            waypoints: List of waypoint dictionaries with position/orientation
            velocity: Trajectory velocity
            blend_radius: Blending radius at waypoints for smooth motion
            
        Returns:
            Trajectory execution status
        """
        if not self._connected:
            return {"success": False, "error": "Not connected to a robot"}
        
        if not waypoints or len(waypoints) == 0:
            return {"success": False, "error": "No waypoints provided"}
        
        if velocity is not None:
            velocity = self._validate_num(velocity, "velocity", min_val=0.001, max_val=self._config["max_velocity"])
        blend_radius = self._validate_num(blend_radius, "blend_radius", min_val=0.0)

        # Validate waypoints
        for i, wp in enumerate(waypoints):
            if not isinstance(wp, dict):
                return {"success": False, "error": f"Waypoint {i} must be a dictionary"}
            for key in ["x", "y", "z", "roll", "pitch", "yaw"]:
                if key in wp:
                    wp[key] = self._validate_num(wp[key], f"waypoints[{i}][{key}]")
        
        vel = velocity or self._config["max_velocity"]
        self._robot_state["status"] = "executing_trajectory"
        
        return {
            "success": True,
            "message": f"Executing trajectory with {len(waypoints)} waypoints",
            "waypoints_count": len(waypoints),
            "velocity": vel,
            "blend_radius": blend_radius,
        }
    
    def _emergency_stop(self) -> Dict[str, Any]:
        """Immediately stop all robot motion.
        
        Returns:
            Emergency stop status
        """
        self._robot_state["status"] = "e-stopped"
        self._robot_state["errors"].append("Emergency stop activated")
        
        return {
            "success": True,
            "message": "Emergency stop activated - all motion halted",
            "status": "e-stopped",
        }
    
    def _get_configuration(self) -> Dict[str, Any]:
        """Get robot configuration parameters.
        
        Returns:
            Current configuration
        """
        if not self._connected:
            return {"success": False, "error": "Not connected to a robot"}
        
        return {
            "success": True,
            "configuration": self._config.copy(),
        }
    
    def _set_configuration(self, **kwargs) -> Dict[str, Any]:
        """Set robot configuration parameters.
        
        Args:
            max_velocity: Maximum joint/cartesian velocity
            max_acceleration: Maximum acceleration
            coordinate_system: 'world' or 'tool'
            safety_mode: Enable/disable safety checks
            
        Returns:
            Updated configuration
        """
        if not self._connected:
            return {"success": False, "error": "Not connected to a robot"}
        
        for key, value in kwargs.items():
            if key in ["max_velocity", "max_acceleration"]:
                self._validate_num(value, key, min_val=0.001)

        allowed_keys = ["max_velocity", "max_acceleration", "coordinate_system", "safety_mode"]
        for key, value in kwargs.items():
            if key in allowed_keys:
                self._config[key] = value
        
        return {
            "success": True,
            "message": "Configuration updated",
            "configuration": self._config.copy(),
        }
