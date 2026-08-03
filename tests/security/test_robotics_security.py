import os
import unittest
import math
from plugins.plugin_robotics import RoboticsPlugin

class TestRoboticsSecurity(unittest.TestCase):
    def setUp(self):
        self.plugin = RoboticsPlugin()

    def test_connect_simulation_security(self):
        # Simulation should connect normally without endpoint validation issues
        res = self.plugin.call("connect", "simulation")
        self.assertTrue(res["success"])

    def test_connect_serial_argument_injection(self):
        # Leading hyphen should be blocked to prevent argument injection
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("connect", "serial", "--config-file=/etc/shadow")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

    def test_connect_serial_path_traversal(self):
        # Paths escaping /dev/ must be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("connect", "serial", "/etc/ttyUSB0")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("path traversal", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("connect", "serial", "/dev/../etc/shadow")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("path traversal", str(ctx.exception).lower())

    def test_move_joint_invalid_numeric(self):
        self.plugin.call("connect", "simulation")

        # Test non-numeric inputs
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("move_joint", "joint_0", "not-a-number")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("must be a valid number", str(ctx.exception).lower())

        # Test NaN/Infinity inputs
        for bad_val in [float('nan'), float('inf'), float('-inf')]:
            with self.assertRaises(ValueError) as ctx:
                self.plugin.call("move_joint", "joint_0", bad_val)
            self.assertIn("Security Error", str(ctx.exception))
            self.assertIn("cannot be nan or infinity", str(ctx.exception).lower())

        # Test out of bounds position
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("move_joint", "joint_0", 5.0)
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("out of bounds", str(ctx.exception).lower())

        # Test out of bounds velocity
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("move_joint", "joint_0", 1.5, -0.5)
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("out of bounds", str(ctx.exception).lower())

    def test_move_cartesian_invalid_numeric(self):
        self.plugin.call("connect", "simulation")

        # Test out of bounds workspace and invalid types
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("move_cartesian", x="invalid")
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("move_cartesian", x=float('nan'))
        self.assertIn("Security Error", str(ctx.exception))

    def test_gripper_control_invalid_numeric(self):
        self.plugin.call("connect", "simulation")

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("gripper_control", "set_position", position=1.5)
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("gripper_control", "set_position", position=-0.1)
        self.assertIn("Security Error", str(ctx.exception))

    def test_execute_trajectory_invalid_numeric(self):
        self.plugin.call("connect", "simulation")

        waypoints = [{"x": 0.5, "y": 0.2, "z": float('nan')}]
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("execute_trajectory", waypoints)
        self.assertIn("Security Error", str(ctx.exception))

    def test_set_configuration_invalid_numeric(self):
        self.plugin.call("connect", "simulation")

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("set_configuration", max_velocity=-1.0)
        self.assertIn("Security Error", str(ctx.exception))

if __name__ == "__main__":
    unittest.main()
