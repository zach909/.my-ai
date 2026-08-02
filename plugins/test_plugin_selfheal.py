"""Regression tests for SelfHealPlugin's watch/check/restart cycle.

Run with: python3 -m unittest plugins.test_plugin_selfheal -v
(from the repo root, so the `plugins` package resolves).
"""
import unittest
from unittest.mock import patch

from plugins.plugin_selfheal import SelfHealPlugin


class TestAddWatch(unittest.TestCase):
    def test_add_watch_registers_under_given_name(self):
        plugin = SelfHealPlugin()
        plugin.tools["add_watch"]("svc", lambda: True, lambda: None)
        self.assertIn("svc", plugin._watches)

    def test_add_watch_defaults_to_no_prior_failures(self):
        plugin = SelfHealPlugin()
        plugin.tools["add_watch"]("svc", lambda: True, lambda: None)
        self.assertEqual(plugin._watches["svc"]["failures"], 0)

    def test_add_watch_honors_custom_interval(self):
        plugin = SelfHealPlugin()
        plugin.tools["add_watch"]("svc", lambda: True, lambda: None, interval=5)
        self.assertEqual(plugin._watches["svc"]["interval"], 5)


class TestCheckNowHealthyPath(unittest.TestCase):
    def test_healthy_check_does_not_call_restart(self):
        plugin = SelfHealPlugin()
        restarted = []
        plugin.tools["add_watch"]("svc", lambda: True, lambda: restarted.append(True))
        plugin._check_now()
        self.assertEqual(restarted, [])

    def test_healthy_check_reports_healthy_status(self):
        plugin = SelfHealPlugin()
        plugin.tools["add_watch"]("svc", lambda: True, lambda: None)
        results = plugin._check_now()
        self.assertEqual(results["svc"], "healthy")

    def test_healthy_check_resets_failure_count(self):
        plugin = SelfHealPlugin()
        plugin.tools["add_watch"]("svc", lambda: True, lambda: None)
        plugin._watches["svc"]["failures"] = 3
        plugin._watches["svc"]["last_check"] = 0
        plugin._check_now()
        self.assertEqual(plugin._watches["svc"]["failures"], 0)


class TestCheckNowFailurePath(unittest.TestCase):
    """The whole point of a self-heal plugin is that a failed check actually
    triggers the real restart callback -- not just logs the failure."""

    def test_failed_check_calls_the_real_restart_callback(self):
        plugin = SelfHealPlugin()
        restarted = []
        plugin.tools["add_watch"]("svc", lambda: False, lambda: restarted.append("svc"))
        plugin._check_now()
        self.assertEqual(restarted, ["svc"])

    def test_failed_check_increments_failure_count(self):
        plugin = SelfHealPlugin()
        plugin.tools["add_watch"]("svc", lambda: False, lambda: None)
        plugin._check_now()
        self.assertEqual(plugin._watches["svc"]["failures"], 1)

    def test_failed_check_reports_restarted_status(self):
        plugin = SelfHealPlugin()
        plugin.tools["add_watch"]("svc", lambda: False, lambda: None)
        results = plugin._check_now()
        self.assertEqual(results["svc"], "restarted")

    def test_repeated_failures_accumulate_the_count(self):
        plugin = SelfHealPlugin()
        plugin.tools["add_watch"]("svc", lambda: False, lambda: None, interval=0)
        plugin._check_now()
        plugin._watches["svc"]["last_check"] = 0
        plugin._check_now()
        self.assertEqual(plugin._watches["svc"]["failures"], 2)


class TestCheckNowErrorHandling(unittest.TestCase):
    """A watch whose check() itself raises must not crash the whole cycle or
    silently look healthy -- both would defeat monitoring's purpose."""

    def test_check_raising_is_reported_as_an_error_not_swallowed(self):
        plugin = SelfHealPlugin()

        def boom():
            raise RuntimeError("check failed")

        plugin.tools["add_watch"]("svc", boom, lambda: None)
        results = plugin._check_now()
        self.assertIn("error", results["svc"])

    def test_one_watch_erroring_does_not_block_another_watch_from_running(self):
        plugin = SelfHealPlugin()

        def boom():
            raise RuntimeError("check failed")

        plugin.tools["add_watch"]("bad", boom, lambda: None)
        plugin.tools["add_watch"]("good", lambda: True, lambda: None)
        results = plugin._check_now()
        self.assertEqual(results["good"], "healthy")


class TestIntervalGating(unittest.TestCase):
    """A watch should only actually run once its interval has elapsed --
    otherwise a short monitor loop would hammer every check on every tick."""

    def test_watch_within_its_interval_is_skipped(self):
        plugin = SelfHealPlugin()
        calls = []
        plugin.tools["add_watch"]("svc", lambda: calls.append(1) or True, lambda: None, interval=999)
        plugin._check_now()  # first call always runs (last_check starts at 0)
        plugin._check_now()  # second call should be skipped -- interval not elapsed
        self.assertEqual(len(calls), 1)


class TestStatus(unittest.TestCase):
    def test_status_reports_not_running_before_start(self):
        plugin = SelfHealPlugin()
        self.assertFalse(plugin.tools["status"]()["running"])

    def test_status_lists_registered_watch_names(self):
        plugin = SelfHealPlugin()
        plugin.tools["add_watch"]("svc", lambda: True, lambda: None)
        self.assertIn("svc", plugin.tools["status"]()["watches"])

    def test_status_surfaces_the_real_log_not_a_placeholder(self):
        plugin = SelfHealPlugin()
        plugin.tools["add_watch"]("svc", lambda: False, lambda: None)
        plugin._check_now()
        log = plugin.tools["status"]()["recent_log"]
        events = [entry["event"] for entry in log]
        self.assertIn("failure", events)
        self.assertIn("restarted", events)


class TestStartStopMonitor(unittest.TestCase):
    def test_start_monitor_reports_running(self):
        plugin = SelfHealPlugin()
        plugin.tools["start"]()
        try:
            self.assertTrue(plugin._running)
        finally:
            plugin.tools["stop"]()

    def test_starting_an_already_running_monitor_is_a_noop_message(self):
        plugin = SelfHealPlugin()
        plugin.tools["start"]()
        try:
            self.assertEqual(plugin.tools["start"](), "Monitor already running")
        finally:
            plugin.tools["stop"]()

    def test_stop_monitor_reports_not_running(self):
        plugin = SelfHealPlugin()
        plugin.tools["start"]()
        plugin.tools["stop"]()
        self.assertFalse(plugin._running)


class TestWatchServerConvenience(unittest.TestCase):
    def test_watch_server_registers_a_watch_named_for_its_port(self):
        plugin = SelfHealPlugin()
        plugin.watch_server(8080, "true")
        self.assertIn("server:8080", plugin._watches)

    def test_watch_server_check_fails_closed_when_nothing_is_listening(self):
        plugin = SelfHealPlugin()
        plugin.watch_server(8080, "true")
        results = plugin._check_now()
        # Nothing is actually serving :8080/health in the test environment,
        # so the real urllib check must observe that and report a restart --
        # not optimistically assume the service is up.
        self.assertEqual(results["server:8080"], "restarted")

    @patch("plugins.plugin_selfheal.subprocess.Popen")
    def test_watch_server_restart_blocks_a_destructive_restart_cmd(self, mock_popen):
        # restart() shells out via subprocess.Popen(restart_cmd, shell=True) --
        # the same execution surface plugin_terminal guards with _is_blocked().
        plugin = SelfHealPlugin()
        plugin.watch_server(8080, "rm -rf /")
        plugin._check_now()
        mock_popen.assert_not_called()

    @patch("plugins.plugin_selfheal.subprocess.Popen")
    def test_watch_server_restart_still_runs_an_ordinary_cmd(self, mock_popen):
        plugin = SelfHealPlugin()
        plugin.watch_server(8080, "systemctl restart myservice")
        plugin._check_now()
        mock_popen.assert_called_once()


if __name__ == "__main__":
    unittest.main()
