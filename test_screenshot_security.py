import os
import unittest
from plugins.plugin_screenshot import ScreenshotPlugin

class TestScreenshotSecurity(unittest.TestCase):
    def setUp(self):
        self.plugin = ScreenshotPlugin()

    def test_valid_paths(self):
        # Valid paths should not raise ValueError (though tool command run might fail/warn due to missing environment/tools)
        # 1. In CWD
        cwd_path = os.path.join(os.getcwd(), "test_valid_screenshot.png")
        try:
            res = self.plugin._safe_path(cwd_path, "default.png")
            self.assertEqual(res, os.path.realpath(cwd_path))
        except ValueError as e:
            self.fail(f"Valid CWD path raised ValueError: {e}")

        # 2. In /tmp
        tmp_path = "/tmp/test_valid_screenshot.png"
        try:
            res = self.plugin._safe_path(tmp_path, "default.png")
            self.assertEqual(res, os.path.realpath(tmp_path))
        except ValueError as e:
            self.fail(f"Valid /tmp path raised ValueError: {e}")

    def test_argument_injection(self):
        # Paths starting with '-' should be blocked
        bad_paths = ["--help", " -f some_file", "-out.png"]
        for bad in bad_paths:
            with self.assertRaises(ValueError) as ctx:
                self.plugin._safe_path(bad, "default.png")
            self.assertIn("Security Error", str(ctx.exception))
            self.assertIn("argument injection", str(ctx.exception))

            with self.assertRaises(ValueError):
                self.plugin.call("capture", bad)

            with self.assertRaises(ValueError):
                self.plugin.call("capture_area", 0, 0, 100, 100, bad)

            with self.assertRaises(ValueError):
                self.plugin.call("record", bad)

    def test_path_traversal(self):
        # Paths escaping CWD and /tmp should be blocked
        # E.g. /etc/passwd, ../escaping_cwd.png, /tmp/../etc/passwd
        bad_paths = ["/etc/passwd", "../escaping_cwd.png", "/tmp/../etc/passwd"]
        for bad in bad_paths:
            with self.assertRaises(ValueError) as ctx:
                self.plugin._safe_path(bad, "default.png")
            self.assertIn("Security Error", str(ctx.exception))
            self.assertIn("Path traversal", str(ctx.exception))

            with self.assertRaises(ValueError):
                self.plugin.call("capture", bad)

            with self.assertRaises(ValueError):
                self.plugin.call("capture_area", 0, 0, 100, 100, bad)

            with self.assertRaises(ValueError):
                self.plugin.call("record", bad)

if __name__ == "__main__":
    unittest.main()
import pytest
from plugins.plugin_screenshot import ScreenshotPlugin

def test_screenshot_argument_injection():
    plugin = ScreenshotPlugin()
    with pytest.raises(ValueError, match="Potential argument injection"):
        plugin._capture("-v")

    with pytest.raises(ValueError, match="Potential argument injection"):
        plugin._capture_area(0, 0, 100, 100, " -o output.png")

    with pytest.raises(ValueError, match="Potential argument injection"):
        plugin._record("--help")

def test_screenshot_path_traversal():
    plugin = ScreenshotPlugin()
    with pytest.raises(ValueError, match="Path traversal or unauthorized path"):
        plugin._capture("/etc/passwd")

    with pytest.raises(ValueError, match="Path traversal or unauthorized path"):
        plugin._capture("/tmp/../../etc/passwd")

    with pytest.raises(ValueError, match="Path traversal or unauthorized path"):
        plugin._record("~/../../etc/passwd")

def test_screenshot_valid_paths():
    plugin = ScreenshotPlugin()
    # /tmp is an authorized directory, so it should resolve safely without throwing ValueError
    # Even if the tool itself is not installed, _safe_path should not raise ValueError for safe paths
    try:
        plugin._capture("/tmp/valid_screenshot.png")
    except ValueError:
        pytest.fail("Valid path inside /tmp raised a ValueError unexpectedly.")
    except Exception:
        # We don't care if it returns "No screenshot tool available" or other errors, as long as it bypasses the security check.
        pass

    try:
        plugin._capture("valid_local_screenshot.png")
    except ValueError:
        pytest.fail("Valid local path raised a ValueError unexpectedly.")
    except Exception:
        pass
