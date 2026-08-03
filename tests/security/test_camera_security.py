import os
import unittest
from plugins.plugin_camera import CameraPlugin

class TestCameraSecurity(unittest.TestCase):
    def setUp(self):
        self.plugin = CameraPlugin()

    def test_valid_paths(self):
        # Valid paths inside CWD or /tmp should not raise ValueError
        try:
            p1 = self.plugin._safe_path("test_image.jpg")
            p2 = self.plugin._safe_path("/tmp/test_image.jpg")
            p3 = self.plugin._safe_path("./test_dir/image.jpg")
            self.assertTrue(isinstance(p1, str))
            self.assertTrue(isinstance(p2, str))
            self.assertTrue(isinstance(p3, str))
        except ValueError as e:
            self.fail(f"Valid path raised ValueError: {e}")

    def test_argument_injection(self):
        # Paths starting with '-' should be blocked (e.g. fswebcam's --exec=<cmd>)
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("capture", "--exec=touch /tmp/pwned")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("capture", "-v")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

    def test_path_traversal(self):
        # Paths escaping CWD or /tmp should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("capture", "/etc/cron.d/evil")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("path traversal", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("capture", "../some_file.jpg")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("path traversal", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("capture", "/tmp/../../etc/passwd")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("path traversal", str(ctx.exception).lower())

    def test_device_argument_injection(self):
        # Devices starting with '-' should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("capture", path="test_image.jpg", device="--exec=touch /tmp/pwned")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("capture", path="test_image.jpg", device="-v")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

    def test_device_path_traversal(self):
        # Devices escaping /dev/ should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("capture", path="test_image.jpg", device="/etc/passwd")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("path traversal", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("capture", path="test_image.jpg", device="../etc/passwd")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("path traversal", str(ctx.exception).lower())

if __name__ == "__main__":
    unittest.main()
