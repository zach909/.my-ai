"""Tests for the Action Log / Human Approval System (spec Part 9 sections 161-163)."""

import unittest

from asi_core.action_log import ActionLog, ApprovalStatus


class TestRequest(unittest.TestCase):
    def test_action_with_no_approval_rules_is_not_required(self):
        log = ActionLog()
        record = log.request("organize_notes", why="tidy up", system="memory")
        self.assertEqual(record.approval, ApprovalStatus.NOT_REQUIRED)

    def test_action_matching_approval_rule_is_pending(self):
        log = ActionLog()
        log.require_approval_for(lambda action: action == "delete_file")
        record = log.request("delete_file", why="cleanup", system="filesystem")
        self.assertEqual(record.approval, ApprovalStatus.PENDING)

    def test_multiple_rules_are_ored_together(self):
        log = ActionLog()
        log.require_approval_for(lambda a: a.startswith("delete_"))
        log.require_approval_for(lambda a: a == "install_extension")
        self.assertTrue(log.needs_approval("delete_file"))
        self.assertTrue(log.needs_approval("install_extension"))
        self.assertFalse(log.needs_approval("read_file"))

    def test_requests_accumulate_in_order(self):
        log = ActionLog()
        log.request("a", why="x", system="s")
        log.request("b", why="y", system="s")
        self.assertEqual([r.action for r in log.records], ["a", "b"])


class TestApprovalFlow(unittest.TestCase):
    def test_approve_pending_action(self):
        log = ActionLog()
        log.require_approval_for(lambda a: True)
        record = log.request("delete_file", why="cleanup", system="filesystem")
        log.approve(record)
        self.assertEqual(record.approval, ApprovalStatus.APPROVED)

    def test_deny_pending_action(self):
        log = ActionLog()
        log.require_approval_for(lambda a: True)
        record = log.request("delete_file", why="cleanup", system="filesystem")
        log.deny(record)
        self.assertEqual(record.approval, ApprovalStatus.DENIED)

    def test_approving_non_pending_action_raises(self):
        log = ActionLog()
        record = log.request("read_file", why="x", system="filesystem")
        with self.assertRaises(ValueError):
            log.approve(record)

    def test_denying_already_approved_action_raises(self):
        log = ActionLog()
        log.require_approval_for(lambda a: True)
        record = log.request("delete_file", why="x", system="filesystem")
        log.approve(record)
        with self.assertRaises(ValueError):
            log.deny(record)


class TestPerform(unittest.TestCase):
    def test_perform_runs_and_records_success(self):
        log = ActionLog()
        record = log.request("compute", why="x", system="reasoning")
        result = log.perform(record, lambda: 1 + 1)
        self.assertEqual(result, 2)
        self.assertEqual(record.result, "success")

    def test_perform_pending_action_raises_permission_error(self):
        log = ActionLog()
        log.require_approval_for(lambda a: True)
        record = log.request("delete_file", why="x", system="filesystem")
        with self.assertRaises(PermissionError):
            log.perform(record, lambda: None)

    def test_perform_denied_action_raises_permission_error(self):
        log = ActionLog()
        log.require_approval_for(lambda a: True)
        record = log.request("delete_file", why="x", system="filesystem")
        log.deny(record)
        with self.assertRaises(PermissionError):
            log.perform(record, lambda: None)

    def test_perform_after_approval_succeeds(self):
        log = ActionLog()
        log.require_approval_for(lambda a: True)
        record = log.request("delete_file", why="x", system="filesystem")
        log.approve(record)
        result = log.perform(record, lambda: "deleted")
        self.assertEqual(result, "deleted")
        self.assertEqual(record.result, "success")

    def test_perform_records_error_and_reraises(self):
        log = ActionLog()
        record = log.request("compute", why="x", system="reasoning")

        def boom():
            raise RuntimeError("bad input")

        with self.assertRaises(RuntimeError):
            log.perform(record, boom)
        self.assertEqual(record.result, "error: bad input")


class TestHistory(unittest.TestCase):
    def test_history_without_filter_returns_everything(self):
        log = ActionLog()
        log.request("a", why="x", system="memory")
        log.request("b", why="y", system="filesystem")
        self.assertEqual(len(log.history()), 2)

    def test_history_filters_by_system(self):
        log = ActionLog()
        log.request("a", why="x", system="memory")
        log.request("b", why="y", system="filesystem")
        memory_only = log.history(system="memory")
        self.assertEqual([r.action for r in memory_only], ["a"])


if __name__ == "__main__":
    unittest.main()
