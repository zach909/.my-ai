import os
import unittest
from plugins.plugin_browser import BrowserPlugin

class TestBrowserSecurity(unittest.TestCase):
    def setUp(self):
        self.plugin = BrowserPlugin()

    def test_valid_urls(self):
        # Valid URLs should not raise ValueError (though they might return "No browser found...")
        try:
            res1 = self.plugin.call("open", "https://example.com")
            res2 = self.plugin.call("open", "http://example.com/some/path?query=1")
            self.assertTrue(isinstance(res1, str))
            self.assertTrue(isinstance(res2, str))
        except ValueError as e:
            self.fail(f"Valid URL raised ValueError: {e}")

    def test_argument_injection(self):
        # URLs starting with '-' should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("open", "--gpu-launcher=xterm")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("argument injection", str(ctx.exception))

    def test_forbidden_scheme(self):
        # Schemes other than http/https/ftp/file should be blocked
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("open", "gopher://example.com")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("Forbidden protocol scheme", str(ctx.exception))

    def test_file_path_traversal(self):
        # file:// scheme pointing outside CWD should be blocked
        # E.g. absolute path to root
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("open", "file:///etc/passwd")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("Path traversal", str(ctx.exception))

        # E.g. relative path escaping CWD
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("open", "file://../some_sensitive_file")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("Path traversal", str(ctx.exception))

if __name__ == "__main__":
    unittest.main()
