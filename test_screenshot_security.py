import os
import unittest
from plugins.plugin_screenshot import ScreenshotPlugin

class TestScreenshotSecurity(unittest.TestCase):
    def setUp(self):
        self.plugin = ScreenshotPlugin()

    def test_valid_paths(self):
        # Valid paths inside CWD or /tmp should not raise ValueError
        try:
            p1 = self.plugin._safe_path("test_screenshot.png")
            p2 = self.plugin._safe_path("/tmp/test_screenshot.png")
            p3 = self.plugin._safe_path("./test_dir/screenshot.png")
            self.assertTrue(isinstance(p1, str))
            self.assertTrue(isinstance(p2, str))
            self.assertTrue(isinstance(p3, str))
        except ValueError as e:
            self.fail(f"Valid path raised ValueError: {e}")

    def test_argument_injection(self):
        # Paths starting with '-' should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("capture", "--some-flag")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("capture_area", 0, 0, 100, 100, "-v")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("record", "-f")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

    def test_path_traversal(self):
        # Paths escaping CWD or /tmp should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("capture", "/etc/passwd")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("path traversal", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("capture", "../some_file.png")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("path traversal", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("capture_area", 0, 0, 100, 100, "/var/log/syslog")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("path traversal", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("record", "/usr/bin/some_binary")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("path traversal", str(ctx.exception).lower())

if __name__ == "__main__":
    unittest.main()
