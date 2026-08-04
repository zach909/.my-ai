import os
import stat
import tempfile
import unittest
import plugins.plugin_self_replicate
import json
from plugins.plugin_self_replicate import SelfReplicatePlugin

class TestSelfReplicateSecurity(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory to host the clones directory
        self.test_dir = tempfile.TemporaryDirectory()
        self.original_clone_dir = plugins.plugin_self_replicate._ROOT
        # Point the plugin's clones dir path to a custom temp folder
        self.temp_root_dir = self.test_dir.name
        plugins.plugin_self_replicate._ROOT = self.temp_root_dir
        self.temp_clone_dir = os.path.join(self.temp_root_dir, "clones")

    def tearDown(self):
        # Restore original path
        plugins.plugin_self_replicate._ROOT = self.original_clone_dir
        self.test_dir.cleanup()

    def test_directory_and_file_permissions(self):
        # Initialize plugin
        plugin = SelfReplicatePlugin()

        # Override the clone directory to point to our temp folder
        plugin._clone_dir = self.temp_clone_dir

        # Call clone to trigger creation of directory and save state
        res = plugin.call("clone", prompt="Secure AI test clone")
        self.assertTrue(res["success"])
        clone_id = res["clone_id"]

        # Verify the clones directory was created
        self.assertTrue(os.path.exists(self.temp_clone_dir))

        # Check directory permissions (on POSIX systems)
        if os.name == 'posix':
            dir_stat = os.stat(self.temp_clone_dir)
            dir_permissions = stat.S_IMODE(dir_stat.st_mode)
            # Expecting exactly 0o700 (owner read, write, execute only)
            self.assertEqual(dir_permissions, 0o700, f"Expected 0o700 permissions, got {oct(dir_permissions)}")

        # Verify the state file is created and has correct permissions
        state_file_path = os.path.join(self.temp_clone_dir, f"{clone_id}.state.json")
        self.assertTrue(os.path.exists(state_file_path))

        if os.name == 'posix':
            file_stat = os.stat(state_file_path)
            file_permissions = stat.S_IMODE(file_stat.st_mode)
            # Expecting exactly 0o600 (owner read & write only)
            self.assertEqual(file_permissions, 0o600, f"Expected 0o600 permissions, got {oct(file_permissions)}")

        # Terminate clone to trigger log file creation
        terminate_result = plugin.call("terminate_clone", clone_id=clone_id, save_log=True)
        self.assertTrue(terminate_result["success"])

        log_file_path = os.path.join(self.temp_clone_dir, f"{clone_id}.log.json")
        self.assertTrue(os.path.exists(log_file_path))

        # Check log file permissions (on POSIX systems)
        if os.name == 'posix':
            log_stat = os.stat(log_file_path)
            log_permissions = stat.S_IMODE(log_stat.st_mode)
            # Expecting exactly 0o600 (owner read & write only)
            self.assertEqual(log_permissions, 0o600, f"Expected 0o600 permissions, got {oct(log_permissions)}")

if __name__ == "__main__":
    unittest.main()
