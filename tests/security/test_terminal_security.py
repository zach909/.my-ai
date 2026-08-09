import os
import unittest
from plugins.plugin_terminal import TerminalPlugin

class TestTerminalSecurity(unittest.TestCase):
    def setUp(self):
        self.plugin = TerminalPlugin()
        # Set some mock environment variables for testing
        os.environ["SAFE_VAR"] = "safe_value"
        os.environ["SUPER_SECRET_KEY"] = "secret_value"
        os.environ["MY_DB_PASSWORD"] = "password_value"
        os.environ["MY_JWT_TOKEN"] = "token_value"

    def tearDown(self):
        # Clean up mock environment variables
        os.environ.pop("SAFE_VAR", None)
        os.environ.pop("SUPER_SECRET_KEY", None)
        os.environ.pop("MY_DB_PASSWORD", None)
        os.environ.pop("MY_JWT_TOKEN", None)

    def test_safe_env_variable(self):
        # Accessing safe variables should be allowed
        res = self.plugin.call("env", var="SAFE_VAR")
        self.assertEqual(res, {"SAFE_VAR": "safe_value"})

    def test_sensitive_env_variable_blocks(self):
        # Accessing sensitive keys individually should raise a ValueError
        sensitive_keys = ["SUPER_SECRET_KEY", "MY_DB_PASSWORD", "MY_JWT_TOKEN"]
        for key in sensitive_keys:
            with self.assertRaises(ValueError) as ctx:
                self.plugin.call("env", var=key)
            self.assertIn("Security Error", str(ctx.exception))
            self.assertIn("blocked", str(ctx.exception).lower())

    def test_list_all_env_variables_filters_sensitive(self):
        # Listing all environment variables should filter out any sensitive ones
        res = self.plugin.call("env")
        self.assertIn("SAFE_VAR", res)
        self.assertEqual(res["SAFE_VAR"], "safe_value")

        # Verify sensitive ones are not present
        self.assertNotIn("SUPER_SECRET_KEY", res)
        self.assertNotIn("MY_DB_PASSWORD", res)
        self.assertNotIn("MY_JWT_TOKEN", res)

if __name__ == "__main__":
    unittest.main()
