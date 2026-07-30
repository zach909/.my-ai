import os
import unittest
from plugins.plugin_notifications import NotificationsPlugin

class TestNotificationsSecurity(unittest.TestCase):
    def setUp(self):
        self.plugin = NotificationsPlugin()

    def test_valid_notifications(self):
        # Valid notifications should not raise ValueError
        try:
            self.plugin.call("notify", "Hello", "World")
            self.plugin.call("urgent", "Urgent Alert", "Something happened")
            self.plugin.call("progress", "Download", 50)
        except ValueError as e:
            self.fail(f"Valid notifications raised ValueError: {e}")

    def test_argument_injection_title(self):
        # Title starting with '-' should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("notify", "--some-flag", "World")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("urgent", "-v", "World")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

    def test_argument_injection_body(self):
        # Body starting with '-' should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("notify", "Hello", "--some-flag")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

    def test_argument_injection_icon(self):
        # Icon starting with '-' should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("notify", "Hello", "World", icon="--help")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception).lower())

    def test_timeout_validation(self):
        # Invalid timeout should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("notify", "Hello", "World", timeout="invalid")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("timeout must be an integer", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("notify", "Hello", "World", timeout=-100)
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("timeout must be a positive integer", str(ctx.exception).lower())

    def test_progress_validation(self):
        # Invalid progress values should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("progress", "Download", "invalid")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("value must be an integer", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("progress", "Download", -5)
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("progress value must be between 0 and 100", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("progress", "Download", 101)
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("progress value must be between 0 and 100", str(ctx.exception).lower())

if __name__ == "__main__":
    unittest.main()
