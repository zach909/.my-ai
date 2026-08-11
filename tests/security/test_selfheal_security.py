import unittest
from plugins.plugin_selfheal import SelfHealPlugin

class TestSelfHealSecurity(unittest.TestCase):
    def setUp(self):
        self.plugin = SelfHealPlugin()

    def test_valid_ports(self):
        # Valid ports should register correctly and not raise ValueError
        try:
            self.plugin.watch_server(80, "true")
            self.plugin.watch_server(8080, "true")
            self.plugin.watch_server("8080", "true")  # numeric string
            self.plugin.watch_server(65535, "true")
        except ValueError as e:
            self.fail(f"Valid ports raised ValueError: {e}")

        self.assertIn("server:80", self.plugin._watches)
        self.assertIn("server:8080", self.plugin._watches)
        self.assertIn("server:65535", self.plugin._watches)

    def test_invalid_ports(self):
        # Non-integer strings
        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server("invalid", "true")
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server("8080/path", "true")
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server("8080\r\nHeader: value", "true")
        self.assertIn("Security Error", str(ctx.exception))

        # Boolean values should be blocked (since bool is a subclass of int in Python)
        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server(True, "true")
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server(False, "true")
        self.assertIn("Security Error", str(ctx.exception))

        # Out of bounds port numbers
        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server(0, "true")
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server(-80, "true")
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server(65536, "true")
        self.assertIn("Security Error", str(ctx.exception))

        # None or other types
        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server(None, "true")
        self.assertIn("Security Error", str(ctx.exception))

    def test_invalid_restart_cmd_types(self):
        # restart_cmd must be a string
        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server(8080, None)
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server(8080, 12345)
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server(8080, [])
        self.assertIn("Security Error", str(ctx.exception))

    def test_empty_restart_cmd(self):
        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server(8080, "")
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server(8080, "   ")
        self.assertIn("Security Error", str(ctx.exception))

    def test_argument_injection_restart_cmd(self):
        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server(8080, "--help")
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin.watch_server(8080, "-xyz")
        self.assertIn("Security Error", str(ctx.exception))

    def test_command_injection_restart_cmd(self):
        # Shell metacharacters should trigger a ValueError
        for char in [";", "&", "|", "$", "`", ">", "<", "\n", "\r", "(", ")", "{", "}", "[", "]", "*", "?"]:
            with self.subTest(char=char):
                with self.assertRaises(ValueError) as ctx:
                    self.plugin.watch_server(8080, f"reboot{char}")
                self.assertIn("Security Error", str(ctx.exception))

if __name__ == "__main__":
    unittest.main()
