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

if __name__ == "__main__":
    unittest.main()
