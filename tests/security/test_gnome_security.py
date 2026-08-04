import os
import unittest
from unittest.mock import patch
from plugins.plugin_gnome import GnomePlugin, _safe_workspace, _safe_window_id, _safe_workspace_name
from plugins.plugin_gnome import GnomePlugin

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
    def test_switch_workspace_invalid_index(self):
        # Negative index should raise ValueError
        with self.assertRaises(ValueError) as ctx:
            self.plugin._switch_workspace(-1)
        self.assertIn("Security Error", str(ctx.exception))

        # Excessive index should raise ValueError
        with self.assertRaises(ValueError) as ctx:
            self.plugin._switch_workspace(999999)
        self.assertIn("Security Error", str(ctx.exception))

        # String that cannot be coerced to int should raise ValueError
        with self.assertRaises(ValueError) as ctx:
            self.plugin._switch_workspace("not-an-int")
        self.assertIn("Security Error", str(ctx.exception))

    def test_remove_workspace_invalid_index(self):
        with self.assertRaises(ValueError) as ctx:
            self.plugin._remove_workspace(-1)
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin._remove_workspace("malicious-index")
        self.assertIn("Security Error", str(ctx.exception))

    def test_move_window_invalid_params(self):
        # Invalid window_id pattern (e.g. malicious characters or leading hyphen)
        with self.assertRaises(ValueError) as ctx:
            self.plugin._move_window("; rm -rf /; ", 0)
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin._move_window("-v", 0)
        self.assertIn("Security Error", str(ctx.exception))

        # Invalid workspace index
        with self.assertRaises(ValueError) as ctx:
            self.plugin._move_window("0x123a", -5)
        self.assertIn("Security Error", str(ctx.exception))

    def test_launch_on_desktop_invalid_workspace(self):
        with self.assertRaises(ValueError) as ctx:
            self.plugin._launch_on_desktop("firefox", -1)
        self.assertIn("Security Error", str(ctx.exception))

    def test_valid_params_do_not_raise_security_error(self):
        # Valid parameters should be processed normally without raising ValueError
        # (Though they might fail due to system-level commands like wmctrl missing,
        # they shouldn't trigger the security block's ValueError).
        try:
            self.plugin._switch_workspace(1)
        except ValueError as e:
            self.fail(f"Valid workspace index raised ValueError: {e}")
        except Exception:
            pass

        try:
            self.plugin._move_window("0x02800003", 2)
        except ValueError as e:
            self.fail(f"Valid window ID format and workspace index raised ValueError: {e}")
        except Exception:
            pass
    def test_window_id_validity(self):
        # Valid window IDs
        res = self.plugin.call("move_window", "0x03400003", 2)
        # Should not raise any validation error on window id format (will return "wmctrl required" if not available, which is fine)
        self.assertNotIn("Invalid window ID format", res)

        res2 = self.plugin.call("move_window", "window-123_abc", 0)
        self.assertNotIn("Invalid window ID format", res2)

        # Invalid window IDs (argument injection, characters like ';')
        res3 = self.plugin.call("move_window", "-v", 2)
        self.assertIn("Invalid window ID format", res3)

        res4 = self.plugin.call("move_window", "0x1234; rm -rf /", 2)
        self.assertIn("Invalid window ID format", res4)

    def test_workspace_index_validity(self):
        # Invalid workspaces (out-of-bounds, invalid string, or injection-like format)
        res1 = self.plugin.call("switch_workspace", -1)
        self.assertIn("Invalid workspace index", res1)

        res2 = self.plugin.call("switch_workspace", 1001)
        self.assertIn("Invalid workspace index", res2)

        res3 = self.plugin.call("switch_workspace", "invalid_idx")
        self.assertIn("Invalid workspace index", res3)

        res4 = self.plugin.call("remove_workspace", -5)
        self.assertIn("Invalid workspace index", res4)

        res5 = self.plugin.call("remove_workspace", "5; console.log(1)")
        self.assertIn("Invalid workspace index", res5)

    def test_launch_on_desktop_blocked_and_invalid_workspace(self):
        # Destructive command
        res = self.plugin.call("launch_on_desktop", "rm -rf /", workspace=0)
        self.assertIn("Blocked", res)

        # Invalid workspace index during launch
        res2 = self.plugin.call("launch_on_desktop", "firefox", workspace="invalid")
        self.assertIn("Invalid workspace index", res2)

if __name__ == "__main__":
    unittest.main()
