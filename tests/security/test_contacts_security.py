import os
import stat
import tempfile
import unittest
import plugins.plugin_contacts
from plugins.plugin_contacts import ContactsPlugin

class TestContactsSecurity(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory to host the contacts directory
        self.test_dir = tempfile.TemporaryDirectory()
        self.original_contacts_dir = plugins.plugin_contacts._CONTACTS_DIR
        # Override the _CONTACTS_DIR to point to a subfolder within our temp directory
        self.temp_contacts_dir = os.path.join(self.test_dir.name, "contacts")
        plugins.plugin_contacts._CONTACTS_DIR = self.temp_contacts_dir

    def tearDown(self):
        # Restore original _CONTACTS_DIR path
        plugins.plugin_contacts._CONTACTS_DIR = self.original_contacts_dir
        self.test_dir.cleanup()

    def test_directory_and_file_permissions(self):
        # Initialize plugin, which calls _setup() and creates the directory
        plugin = ContactsPlugin()

        # Verify the directory was created
        self.assertTrue(os.path.exists(self.temp_contacts_dir))

        # Check directory permissions (on Unix-like platforms)
        if os.name == 'posix':
            dir_stat = os.stat(self.temp_contacts_dir)
            dir_permissions = stat.S_IMODE(dir_stat.st_mode)
            # Expecting exactly 0o700 (owner read, write, execute only)
            self.assertEqual(dir_permissions, 0o700, f"Expected 0o700 permissions, got {oct(dir_permissions)}")

        # Call add on the plugin to save a contact
        plugin.call(
            "add",
            name="Alice",
            email="alice@example.com",
            phone="123-456-7890",
            notes="A secure contact"
        )

        contact_file_path = os.path.join(self.temp_contacts_dir, "Alice.json")
        self.assertTrue(os.path.exists(contact_file_path))

        # Check file permissions (on Unix-like platforms)
        if os.name == 'posix':
            file_stat = os.stat(contact_file_path)
            file_permissions = stat.S_IMODE(file_stat.st_mode)
            # Expecting exactly 0o600 (owner read & write only)
            self.assertEqual(file_permissions, 0o600, f"Expected 0o600 permissions, got {oct(file_permissions)}")

if __name__ == "__main__":
    unittest.main()
