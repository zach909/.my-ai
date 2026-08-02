import os
import stat
import tempfile
import unittest
import plugins.plugin_calendar
from plugins.plugin_calendar import CalendarPlugin

class TestCalendarSecurity(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory to host the calendar directory
        self.test_dir = tempfile.TemporaryDirectory()
        self.original_cal_file = plugins.plugin_calendar._CAL_FILE
        # Override the _CAL_FILE to point to a subfolder within our temp directory
        self.temp_cal_file = os.path.join(self.test_dir.name, "calendar", "events.json")
        plugins.plugin_calendar._CAL_FILE = self.temp_cal_file

    def tearDown(self):
        # Restore original _CAL_FILE path
        plugins.plugin_calendar._CAL_FILE = self.original_cal_file
        self.test_dir.cleanup()

    def test_directory_and_file_permissions(self):
        # Initialize plugin, which calls _setup() and creates the directory
        plugin = CalendarPlugin()
        temp_calendar_dir = os.path.dirname(self.temp_cal_file)

        # Verify the directory was created
        self.assertTrue(os.path.exists(temp_calendar_dir))

        # Check directory permissions (on Unix-like platforms)
        if os.name == 'posix':
            dir_stat = os.stat(temp_calendar_dir)
            dir_permissions = stat.S_IMODE(dir_stat.st_mode)
            # Expecting exactly 0o700 (owner read, write, execute only)
            self.assertEqual(dir_permissions, 0o700, f"Expected 0o700 permissions, got {oct(dir_permissions)}")

        # Call add on the plugin to save an event
        plugin.call(
            "add",
            title="Meeting",
            start=1620000000.0,
            end=1620003600.0,
            description="Discuss secure architecture",
            location="Room 101"
        )

        self.assertTrue(os.path.exists(self.temp_cal_file))

        # Check file permissions (on Unix-like platforms)
        if os.name == 'posix':
            file_stat = os.stat(self.temp_cal_file)
            file_permissions = stat.S_IMODE(file_stat.st_mode)
            # Expecting exactly 0o600 (owner read & write only)
            self.assertEqual(file_permissions, 0o600, f"Expected 0o600 permissions, got {oct(file_permissions)}")

if __name__ == "__main__":
    unittest.main()
