"""Regression test for GnomePlugin's xinput input-isolation/restore round-trip.

Run with: python3 -m unittest plugins.test_plugin_gnome -v
(from the repo root, so the `plugins` package resolves).

xinput isn't installed in this sandbox (no X server either), so these tests
drive the real parsing/isolate/restore logic against canned `xinput list
--long` transcripts matching the real, documented output format, with
subprocess.run/shutil.which patched to serve them instead of shelling out.
"""
import subprocess
import unittest
from unittest.mock import patch

from plugins.plugin_gnome import GnomePlugin, _get_xinput_devices

BEFORE_ISOLATION = """≡ Virtual core pointer                    \tid=2\t[master pointer  (3)]
│   ↳ Virtual core XTEST pointer              \tid=4\t[slave  pointer  (2)]
│   ↳ Logitech USB Mouse                       \tid=10\t[slave  pointer  (2)]
≡ Virtual core keyboard                   \tid=3\t[master keyboard (2)]
    ↳ Virtual core XTEST keyboard              \tid=5\t[slave  keyboard (3)]
    ↳ AT Translated Set 2 keyboard             \tid=11\t[slave  keyboard (3)]
"""

# Both real devices floated -- xinput lists them after all master/slave
# trees, tagged "floating slave", with no master of their own.
AFTER_BOTH_FLOATED = """≡ Virtual core pointer                    \tid=2\t[master pointer  (3)]
│   ↳ Virtual core XTEST pointer              \tid=4\t[slave  pointer  (2)]
≡ Virtual core keyboard                   \tid=3\t[master keyboard (2)]
    ↳ Virtual core XTEST keyboard              \tid=5\t[slave  keyboard (3)]
∼ Logitech USB Mouse                          \tid=10\t[floating slave]
∼ AT Translated Set 2 keyboard                 \tid=11\t[floating slave]
"""

ALREADY_FLOATING_MOUSE = """≡ Virtual core pointer                    \tid=2\t[master pointer  (3)]
│   ↳ Virtual core XTEST pointer              \tid=4\t[slave  pointer  (2)]
≡ Virtual core keyboard                   \tid=3\t[master keyboard (2)]
    ↳ Virtual core XTEST keyboard              \tid=5\t[slave  keyboard (3)]
∼ Logitech USB Mouse                          \tid=10\t[floating slave]
"""


def _fake_which(name):
    return "/usr/bin/xinput" if name == "xinput" else None


class TestXinputDeviceParsing(unittest.TestCase):
    """`_get_xinput_devices()` must not misattribute a floating (unmastered)
    device as a slave of whichever master was last seen -- "floating slave"
    contains the substring "slave", so a plain `"slave" in line` check used
    to nest it under the wrong master (in practice, always the keyboard
    master, since xinput lists it after the pointer master)."""

    @patch("plugins.plugin_gnome.shutil.which", side_effect=_fake_which)
    @patch("plugins.plugin_gnome.subprocess.run")
    def test_floating_device_is_not_nested_under_a_master(self, mock_run, mock_which):
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=ALREADY_FLOATING_MOUSE, stderr="")

        devices = _get_xinput_devices()

        by_type = {d["type"]: d for d in devices if d["type"] != "floating"}
        floating = [d for d in devices if d["type"] == "floating"]

        self.assertEqual(len(floating), 1)
        self.assertEqual(floating[0]["id"], 10)
        # The floating mouse must not appear as a slave of either master.
        all_slave_ids = {s["id"] for m in by_type.values() for s in m["slaves"]}
        self.assertNotIn(10, all_slave_ids)


class TestIsolateInputFloatsDefaultMasterDevices(unittest.TestCase):
    """`_isolate_input()`'s skip check previously tested `master["name"]`
    for "Virtual core" -- true for every default master -- instead of
    `slave["name"]`, so it silently floated nothing at all in the common
    case of no dedicated AI master having been created yet."""

    @patch("plugins.plugin_gnome.shutil.which", side_effect=_fake_which)
    @patch("plugins.plugin_gnome.subprocess.run")
    def test_isolate_floats_real_devices_under_the_default_masters(self, mock_run, mock_which):
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=BEFORE_ISOLATION, stderr="")

        plugin = GnomePlugin()
        result = plugin.call("isolate_input")

        self.assertTrue(result["isolated"])
        self.assertEqual(len(result.get("floated", [])), 2)
        float_calls = [c.args[0] for c in mock_run.call_args_list if c.args[0][:2] == ["xinput", "float"]]
        self.assertEqual({c[2] for c in float_calls}, {"10", "11"})


class TestRestoreInputReattachesCorrectType(unittest.TestCase):
    """The core regression: reattaching a floated device to a mismatched-
    type virtual core master. Verified end-to-end (isolate, then restore)
    and via a standalone restore call against an already-floating device."""

    def test_isolate_then_restore_reattaches_each_device_to_its_own_type(self):
        floated_ids = set()

        def fake_run(cmd, *a, **kw):
            if cmd[:2] == ["xinput", "list"]:
                stdout = AFTER_BOTH_FLOATED if floated_ids else BEFORE_ISOLATION
            else:
                stdout = ""
            if cmd[:2] == ["xinput", "float"]:
                floated_ids.add(cmd[2])
            return subprocess.CompletedProcess(args=cmd, returncode=0, stdout=stdout, stderr="")

        with patch("plugins.plugin_gnome.shutil.which", side_effect=_fake_which), \
             patch("plugins.plugin_gnome.subprocess.run", side_effect=fake_run) as mock_run:
            plugin = GnomePlugin()
            plugin.call("isolate_input")
            self.assertEqual(
                {(d["id"], d["type"]) for d in plugin._floated_devices},
                {(10, "pointer"), (11, "keyboard")},
            )

            mock_run.reset_mock()
            result = plugin.call("restore_input")

        reattach_calls = [c.args[0] for c in mock_run.call_args_list if c.args[0][:2] == ["xinput", "reattach"]]
        self.assertTrue(result["restored"])
        # The pointer device (id 10) must go back to the pointer master (id 2),
        # never the keyboard master (id 3) -- and vice versa for the keyboard.
        self.assertIn(["xinput", "reattach", "10", "2"], reattach_calls)
        self.assertIn(["xinput", "reattach", "11", "3"], reattach_calls)
        self.assertNotIn(["xinput", "reattach", "10", "3"], reattach_calls)
        self.assertNotIn(["xinput", "reattach", "11", "2"], reattach_calls)

    @patch("plugins.plugin_gnome.shutil.which", side_effect=_fake_which)
    @patch("plugins.plugin_gnome.subprocess.run")
    def test_restore_without_a_prior_isolate_does_not_guess(self, mock_run, mock_which):
        # A device is already floating (e.g. from some prior process), but
        # *this* instance never floated it -- it must not blindly attempt a
        # reattach based on re-derived (unreliable) type information.
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=ALREADY_FLOATING_MOUSE, stderr="")

        plugin = GnomePlugin()
        result = plugin.call("restore_input")

        self.assertFalse(result["restored"])
        reattach_calls = [c.args[0] for c in mock_run.call_args_list if c.args[0][:2] == ["xinput", "reattach"]]
        self.assertEqual(reattach_calls, [])


if __name__ == "__main__":
    unittest.main()
