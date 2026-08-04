import os
import unittest
from plugins.plugin_gnome import GnomePlugin

class TestGnomeSecurity(unittest.TestCase):
    def setUp(self):
        self.plugin = GnomePlugin()

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
