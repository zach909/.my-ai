import os
import unittest
import pytest
from plugins.plugin_microphone import MicrophonePlugin

class TestMicrophoneSecurity(unittest.TestCase):
    def setUp(self):
        self.plugin = MicrophonePlugin()

    def test_valid_paths(self):
        # Valid paths inside CWD or /tmp should not raise ValueError
        try:
            p1 = self.plugin._safe_path("test_audio.wav")
            p2 = self.plugin._safe_path("/tmp/test_audio.wav")
            p3 = self.plugin._safe_path("./test_dir/audio.wav")
            self.assertTrue(isinstance(p1, str))
            self.assertTrue(isinstance(p2, str))
            self.assertTrue(isinstance(p3, str))
        except ValueError as e:
            self.fail(f"Valid path raised ValueError: {e}")

    def test_argument_injection(self):
        # Paths starting with '-' should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("record", "--some-flag")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("record", "-v")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

    def test_path_traversal(self):
        # Paths escaping CWD or /tmp should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("record", "/etc/passwd")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("path traversal", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("record", "../some_file.wav")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("path traversal", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("record", "/tmp/../../etc/passwd")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("path traversal", str(ctx.exception).lower())

    def test_param_validation(self):
        # Invalid rate/duration params should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("record", "valid.wav", rate="invalid")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("must be integers", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("record", "valid.wav", duration="invalid")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("must be integers", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("record", "valid.wav", rate=-44100)
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("must be positive numbers", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("record", "valid.wav", duration=-5)
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("must be positive numbers", str(ctx.exception).lower())

if __name__ == "__main__":
    unittest.main()
