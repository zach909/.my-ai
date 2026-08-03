import os
import stat
import tempfile
import unittest
import plugins.plugin_self_replicate
from plugins.plugin_self_replicate import SelfReplicatePlugin

class TestSelfReplicateSecurity(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory to host the clones directory
        self.test_dir = tempfile.TemporaryDirectory()
        self.original_clone_dir = plugins.plugin_self_replicate._ROOT
        # Point the plugin's clones dir path to a custom temp folder
        self.temp_root_dir = self.test_dir.name
        plugins.plugin_self_replicate._ROOT = self.temp_root_dir

    def tearDown(self):
        # Restore original path
        plugins.plugin_self_replicate._ROOT = self.original_clone_dir
        self.test_dir.cleanup()

    def test_directory_and_file_permissions(self):
        # Initialize plugin, which calls _setup() and creates the clones directory
        plugin = SelfReplicatePlugin()
        # Verify the directory clones is created within our temp root
        temp_clone_dir = os.path.join(self.temp_root_dir, "clones")
        self.assertTrue(os.path.exists(temp_clone_dir))

        # Check directory permissions (on Unix-like platforms)
        if os.name == 'posix':
            dir_stat = os.stat(temp_clone_dir)
            dir_permissions = stat.S_IMODE(dir_stat.st_mode)
            # Expecting exactly 0o700 (owner read, write, execute only)
            self.assertEqual(dir_permissions, 0o700, f"Expected 0o700 permissions, got {oct(dir_permissions)}")

        # Call clone on the plugin to create a clone
        result = plugin.call(
            "clone",
            prompt="Test secure cloning prompt",
            role="assistant",
            specialization="security"
        )
        self.assertTrue(result["success"])
        clone_id = result["clone_id"]

        state_file_path = os.path.join(temp_clone_dir, f"{clone_id}.state.json")
        self.assertTrue(os.path.exists(state_file_path))

        # Check state file permissions (on Unix-like platforms)
        if os.name == 'posix':
            file_stat = os.stat(state_file_path)
            file_permissions = stat.S_IMODE(file_stat.st_mode)
            # Expecting exactly 0o600 (owner read & write only)
            self.assertEqual(file_permissions, 0o600, f"Expected 0o600 permissions, got {oct(file_permissions)}")

        # Terminate clone to trigger log file creation
        terminate_result = plugin.call("terminate_clone", clone_id, save_log=True)
        self.assertTrue(terminate_result["success"])

        log_file_path = os.path.join(temp_clone_dir, f"{clone_id}.log.json")
        self.assertTrue(os.path.exists(log_file_path))

        # Check log file permissions (on Unix-like platforms)
        if os.name == 'posix':
            file_stat = os.stat(log_file_path)
            file_permissions = stat.S_IMODE(file_stat.st_mode)
            # Expecting exactly 0o600 (owner read & write only)
            self.assertEqual(file_permissions, 0o600, f"Expected 0o600 permissions, got {oct(file_permissions)}")

if __name__ == "__main__":
    unittest.main()
