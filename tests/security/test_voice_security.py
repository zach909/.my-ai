import unittest
from plugins.plugin_voice import VoiceActivationPlugin

class TestVoiceSecurity(unittest.TestCase):
    def setUp(self):
        self.plugin = VoiceActivationPlugin()

    def test_allows_safe_wake_words(self):
        self.plugin.call("set_wake_word", "neuroclaw")
        self.assertEqual(self.plugin._wake_word, "neuroclaw")

        self.plugin.call("set_wake_word", "hello-world_123")
        self.assertEqual(self.plugin._wake_word, "hello-world_123")

    def test_rejects_empty_or_non_string_wake_words(self):
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("set_wake_word", "")
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("set_wake_word", None)
        self.assertIn("Security Error", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("set_wake_word", 123)
        self.assertIn("Security Error", str(ctx.exception))

    def test_rejects_overly_long_wake_words(self):
        long_word = "a" * 65
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("set_wake_word", long_word)
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("exceeds maximum length", str(ctx.exception).lower())

    def test_rejects_wake_words_starting_with_hyphen(self):
        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("set_wake_word", "-neuro")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("cannot start with a hyphen", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx:
            self.plugin.call("set_wake_word", "--wake")
        self.assertIn("Security Error", str(ctx.exception))
        self.assertIn("cannot start with a hyphen", str(ctx.exception).lower())

    def test_rejects_wake_words_with_invalid_characters(self):
        invalid_words = [
            "neuro claw",  # space
            "neuro;claw",  # semicolon
            "neuro&claw",  # ampersand
            "neuro$claw",  # dollar sign
            "neuro`claw",  # backtick
        ]
        for word in invalid_words:
            with self.assertRaises(ValueError) as ctx:
                self.plugin.call("set_wake_word", word)
            self.assertIn("Security Error", str(ctx.exception))

if __name__ == "__main__":
    unittest.main()
