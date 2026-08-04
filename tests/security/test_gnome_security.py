import unittest
import re
from plugins.plugin_gnome import GnomePlugin

class TestGnomeSecurity(unittest.TestCase):
    def setUp(self):
        self.plugin = GnomePlugin()

    def test_valid_parameters(self):
        # Valid window_id and workspace should not raise ValueErrors
        # We can bypass real wmctrl calls by testing the validation logic directly
        try:
            self.plugin._validate_window_id("0x12ab34")
            self.plugin._validate_window_id("12345")
            self.plugin._validate_workspace_index(0)
            self.plugin._validate_workspace_index(5)
        except ValueError as e:
            self.fail(f"Valid inputs raised ValueError: {e}")

    def test_invalid_window_ids(self):
        # Window IDs starting with a hyphen (argument injection)
        with self.assertRaises(ValueError) as ctx:
            self.plugin._validate_window_id("-ir")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin._validate_window_id("--help")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

        # Window IDs with dangerous shell metacharacters
        with self.assertRaises(ValueError) as ctx:
            self.plugin._validate_window_id("0x12;rm -rf")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("invalid characters", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin._validate_window_id("0x12&&touch")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("invalid characters", str(ctx.exception).lower())

    def test_invalid_workspace_indexes(self):
        # Non-integer workspace indexes
        with self.assertRaises(ValueError) as ctx:
            self.plugin._validate_workspace_index("invalid")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("must be an integer", str(ctx.exception).lower())

        # Negative workspace indexes
        with self.assertRaises(ValueError) as ctx:
            self.plugin._validate_workspace_index(-1)
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("must be a non-negative integer", str(ctx.exception).lower())

        # Out of bounds workspace indexes
        with self.assertRaises(ValueError) as ctx:
            self.plugin._validate_workspace_index(9999)
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("must be a non-negative integer", str(ctx.exception).lower())

    def test_switch_workspace_validation(self):
        with self.assertRaises(ValueError):
            self.plugin.call("switch_workspace", "invalid")
        with self.assertRaises(ValueError):
            self.plugin.call("switch_workspace", -1)

    def test_remove_workspace_validation(self):
        with self.assertRaises(ValueError):
            self.plugin.call("remove_workspace", "invalid")
        with self.assertRaises(ValueError):
            self.plugin.call("remove_workspace", -1)

    def test_move_window_validation(self):
        with self.assertRaises(ValueError):
            self.plugin.call("move_window", "-ir", 1)
        with self.assertRaises(ValueError):
            self.plugin.call("move_window", "0x12", -1)

    def test_launch_on_desktop_validation(self):
        # Invalid workspace index in launch_on_desktop
        with self.assertRaises(ValueError):
            self.plugin.call("launch_on_desktop", "ls", workspace="invalid")
        with self.assertRaises(ValueError):
            self.plugin.call("launch_on_desktop", "ls", workspace=-1)

if __name__ == "__main__":
    unittest.main()
