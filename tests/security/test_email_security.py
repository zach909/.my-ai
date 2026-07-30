import os
import stat
import tempfile
import unittest
import plugins.plugin_email
from plugins.plugin_email import EmailPlugin

class TestEmailSecurity(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory to host the credentials file
        self.test_dir = tempfile.TemporaryDirectory()
        self.original_creds_file = plugins.plugin_email._CREDS_FILE
        # Override the _CREDS_FILE to point to our temp directory path
        self.temp_creds_path = os.path.join(self.test_dir.name, "email_creds.json")
        plugins.plugin_email._CREDS_FILE = self.temp_creds_path
        self.plugin = EmailPlugin()

    def tearDown(self):
        # Restore original _CREDS_FILE path
        plugins.plugin_email._CREDS_FILE = self.original_creds_file
        self.test_dir.cleanup()

    def test_configure_file_permissions(self):
        # Call configure on the plugin
        self.plugin.call(
            "configure",
            email_addr="test@example.com",
            password="super_secure_password_123",
            imap_host="imap.example.com",
            smtp_host="smtp.example.com"
        )

        # Verify the file was created
        self.assertTrue(os.path.exists(self.temp_creds_path))

        # Check file permissions (on Unix-like platforms)
        if os.name == 'posix':
            file_stat = os.stat(self.temp_creds_path)
            permissions = stat.S_IMODE(file_stat.st_mode)
            # Expecting exactly 0o600 (owner read & write only)
            self.assertEqual(permissions, 0o600, f"Expected 0o600 permissions, got {oct(permissions)}")

if __name__ == "__main__":
    unittest.main()
