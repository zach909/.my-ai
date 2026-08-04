import os
import unittest
from unittest.mock import patch
from plugins.plugin_gnome import GnomePlugin, _safe_workspace, _safe_window_id, _safe_workspace_name

class TestGnomeSecurity(unittest.TestCase):
    def setUp(self):
        self.plugin = GnomePlugin()

    def test_safe_workspace_validation(self):
        # Valid cases
        self.assertEqual(_safe_workspace(0), 0)
        self.assertEqual(_safe_workspace("5"), 5)
        self.assertEqual(_safe_workspace(100), 100)

        # Invalid cases should raise ValueError with "Security Error"
        with self.assertRaises(ValueError) as ctx:
            _safe_workspace(-1)
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            _safe_workspace(1001)
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            _safe_workspace("invalid")
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            _safe_workspace(True)  # Booleans should be rejected
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            _safe_workspace("1); alert(1); //")
        self.assertIn("Security Error", str(ctx.exception))

    def test_safe_window_id_validation(self):
        # Valid cases (hex format or integer string)
        self.assertEqual(_safe_window_id("0x3e00003"), "0x3e00003")
        self.assertEqual(_safe_window_id("12345"), "12345")
        self.assertEqual(_safe_window_id("abc"), "abc")

        # Invalid cases
        with self.assertRaises(ValueError) as ctx:
            _safe_window_id("")
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            _safe_window_id("-ir")  # Leading hyphen (potential argument injection)
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            _safe_window_id("0x123; rm -rf /")  # Command injection chars
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            _safe_window_id(123)  # Not a string
        self.assertIn("Security Error", str(ctx.exception))

    def test_safe_workspace_name_validation(self):
        # Valid cases
        self.assertEqual(_safe_workspace_name("My Desktop"), "My Desktop")
        self.assertEqual(_safe_workspace_name("work_space-1"), "work_space-1")

        # Invalid cases
        with self.assertRaises(ValueError) as ctx:
            _safe_workspace_name("-my-desktop")  # Leading hyphen
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            _safe_workspace_name("a" * 101)  # Too long
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            _safe_workspace_name("Desktop\n1")  # Control character
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            _safe_workspace_name(123)  # Not a string
        self.assertIn("Security Error", str(ctx.exception))

    def test_plugin_methods_enforce_validation(self):
        # 1. _switch_workspace
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("switch_workspace", "invalid_workspace")
        self.assertIn("Security Error", str(ctx.exception))

        # 2. _remove_workspace
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("remove_workspace", -5)
        self.assertIn("Security Error", str(ctx.exception))

        # 3. _move_window
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("move_window", "-inject_arg", 1)
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("move_window", "0x123", "invalid_workspace")
        self.assertIn("Security Error", str(ctx.exception))

        # 4. _add_workspace
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("add_workspace", name="-inject_arg")
        self.assertIn("Security Error", str(ctx.exception))

        # 5. _launch_on_desktop
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("launch_on_desktop", "firefox", workspace="invalid")
        self.assertIn("Security Error", str(ctx.exception))

if __name__ == "__main__":
    unittest.main()
