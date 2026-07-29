"""Regression test for TerminalPlugin's destructive-command blocklist.

Run with: python3 -m unittest plugins.test_plugin_terminal -v
(from the repo root, so the `plugins` package resolves).
"""
import unittest

from plugins.plugin_terminal import _is_blocked


class TestBlocklistCatchesRmRfRootVariants(unittest.TestCase):
    """`rm -rf /` was previously matched literally, so anything after the
    slash, reordered/separated/long-form flags all slipped through while
    being just as destructive as the one exact string that was blocked."""

    def test_blocks_exact_original_pattern(self):
        self.assertTrue(_is_blocked("rm -rf /"))

    def test_blocks_trailing_wildcard(self):
        self.assertTrue(_is_blocked("rm -rf /*"))

    def test_blocks_doubled_slash(self):
        self.assertTrue(_is_blocked("rm -rf //"))

    def test_blocks_trailing_dot(self):
        self.assertTrue(_is_blocked("rm -rf /."))

    def test_blocks_reordered_short_flags(self):
        self.assertTrue(_is_blocked("rm -fr /"))

    def test_blocks_separated_short_flags(self):
        self.assertTrue(_is_blocked("rm -r -f /"))
        self.assertTrue(_is_blocked("rm -f -r /"))

    def test_blocks_long_form_flags(self):
        self.assertTrue(_is_blocked("rm --recursive --force /"))
        self.assertTrue(_is_blocked("rm --force --recursive /"))


class TestBlocklistDoesNotOverblockLegitimateDeletes(unittest.TestCase):
    """The plugin's own docstring frames it as a full-system-access tool;
    blocking every rm -rf on any absolute path would defeat that purpose --
    only root-like targets should trip the guard."""

    def test_allows_deep_absolute_path(self):
        self.assertFalse(_is_blocked("rm -rf /home/user/tmp"))

    def test_allows_deep_absolute_path_with_wildcard(self):
        self.assertFalse(_is_blocked("rm -rf /tmp/foo/*"))

    def test_allows_relative_path(self):
        self.assertFalse(_is_blocked("rm -rf ./build"))

    def test_allows_non_recursive_non_force_command(self):
        self.assertFalse(_is_blocked("rm file.txt"))

    def test_allows_unrelated_command_touching_root(self):
        self.assertFalse(_is_blocked("ls -la /"))


class TestBlocklistOtherDestructivePatternsUnaffected(unittest.TestCase):
    """Confirms the rm-specific rework didn't regress the other patterns."""

    def test_blocks_fork_bomb(self):
        self.assertTrue(_is_blocked(":(){ :|:& };:"))

    def test_blocks_mkfs(self):
        self.assertTrue(_is_blocked("mkfs.ext4 /dev/sda1"))

    def test_blocks_shutdown(self):
        self.assertTrue(_is_blocked("shutdown -h now"))

    def test_blocks_dd_to_raw_disk(self):
        self.assertTrue(_is_blocked("dd if=/dev/zero of=/dev/sda"))

    def test_allows_ordinary_command(self):
        self.assertFalse(_is_blocked("echo hello"))


if __name__ == "__main__":
    unittest.main()
