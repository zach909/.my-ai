"""Tests for the Mistake Tracker (spec Part 7 sections 111-112)."""

import unittest

from asi_core.mistake_tracker import MistakeTracker


class TestRecording(unittest.TestCase):
    def test_first_record_starts_at_one_occurrence(self):
        tracker = MistakeTracker()
        record = tracker.record("sig1", what="bad output", why="low reward")
        self.assertEqual(record.occurrences, 1)

    def test_repeated_signature_increments_occurrences(self):
        tracker = MistakeTracker()
        tracker.record("sig1", what="bad output", why="low reward")
        record = tracker.record("sig1", what="bad output again", why="low reward again")
        self.assertEqual(record.occurrences, 2)
        self.assertEqual(record.what, "bad output again")

    def test_contributing_systems_accumulate_without_duplicates(self):
        tracker = MistakeTracker()
        tracker.record("sig1", what="x", why="y", contributing_systems=["coding"])
        record = tracker.record("sig1", what="x", why="y", contributing_systems=["coding", "language"])
        self.assertEqual(record.contributing_systems, ["coding", "language"])

    def test_different_signatures_are_independent(self):
        tracker = MistakeTracker()
        tracker.record("sig1", what="a", why="b")
        tracker.record("sig2", what="c", why="d")
        self.assertEqual(tracker.get("sig1").occurrences, 1)
        self.assertEqual(tracker.get("sig2").occurrences, 1)


class TestCorrection(unittest.TestCase):
    def test_correct_records_outcome(self):
        tracker = MistakeTracker()
        tracker.record("sig1", what="a", why="b")
        record = tracker.correct("sig1", correction="lowered vale", worked=True)
        self.assertEqual(record.correction, "lowered vale")
        self.assertTrue(record.correction_worked)

    def test_correct_unknown_signature_raises(self):
        tracker = MistakeTracker()
        with self.assertRaises(KeyError):
            tracker.correct("nope", correction="x", worked=True)


class TestRepetitionQueries(unittest.TestCase):
    def test_is_repeated_respects_threshold(self):
        tracker = MistakeTracker()
        tracker.record("sig1", what="a", why="b")
        self.assertFalse(tracker.is_repeated("sig1", threshold=2))
        tracker.record("sig1", what="a", why="b")
        self.assertTrue(tracker.is_repeated("sig1", threshold=2))

    def test_is_repeated_for_unknown_signature_is_false(self):
        tracker = MistakeTracker()
        self.assertFalse(tracker.is_repeated("nope"))

    def test_most_repeated_orders_by_occurrence_count(self):
        tracker = MistakeTracker()
        tracker.record("rare", what="a", why="b")
        for _ in range(3):
            tracker.record("common", what="a", why="b")
        top = tracker.most_repeated(top_k=2)
        self.assertEqual([r.occurrences for r in top], [3, 1])

    def test_get_missing_signature_returns_none(self):
        tracker = MistakeTracker()
        self.assertIsNone(tracker.get("nope"))


class TestSerialization(unittest.TestCase):
    def test_to_dict_from_dict_round_trip(self):
        tracker = MistakeTracker()
        tracker.record("sig1", what="a", why="b", contributing_systems=["coding"])
        tracker.record("sig1", what="a2", why="b2")
        tracker.correct("sig1", correction="fixed it", worked=True)

        restored = MistakeTracker.from_dict(tracker.to_dict())
        record = restored.get("sig1")

        self.assertEqual(record.what, "a2")
        self.assertEqual(record.occurrences, 2)
        self.assertEqual(record.correction, "fixed it")
        self.assertTrue(record.correction_worked)
        self.assertEqual(record.contributing_systems, ["coding"])


if __name__ == "__main__":
    unittest.main()
