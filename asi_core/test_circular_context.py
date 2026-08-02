"""Tests for the Circular Context System (spec Part 5 sections 66-69)."""

import unittest

from asi_core.circular_context import CircularBuffer, CircularContextSystem


class TestCircularBuffer(unittest.TestCase):
    def test_push_within_capacity_keeps_all_items(self):
        buf = CircularBuffer(capacity=3)
        buf.push(1)
        buf.push(2)
        self.assertEqual(buf.items, [1, 2])
        self.assertEqual(len(buf), 2)

    def test_push_past_capacity_evicts_oldest(self):
        buf = CircularBuffer(capacity=2)
        buf.push(1)
        buf.push(2)
        buf.push(3)
        self.assertEqual(buf.items, [2, 3])
        self.assertEqual(len(buf), 2)

    def test_on_evict_receives_the_oldest_item_before_it_is_dropped(self):
        evicted = []
        buf = CircularBuffer(capacity=1, on_evict=evicted.append)
        buf.push("a")
        buf.push("b")
        buf.push("c")
        self.assertEqual(evicted, ["a", "b"])
        self.assertEqual(buf.items, ["c"])

    def test_is_full(self):
        buf = CircularBuffer(capacity=2)
        self.assertFalse(buf.is_full())
        buf.push(1)
        buf.push(2)
        self.assertTrue(buf.is_full())

    def test_invalid_capacity_raises(self):
        with self.assertRaises(ValueError):
            CircularBuffer(capacity=0)

    def test_iteration(self):
        buf = CircularBuffer(capacity=3)
        buf.push(1)
        buf.push(2)
        self.assertEqual(list(buf), [1, 2])

    def test_load_items_replaces_contents_without_evicting(self):
        evicted = []
        buf = CircularBuffer(capacity=3, on_evict=evicted.append)
        buf.load_items([1, 2, 3])
        self.assertEqual(buf.items, [1, 2, 3])
        self.assertEqual(evicted, [])

    def test_load_items_truncates_to_capacity_keeping_most_recent(self):
        buf = CircularBuffer(capacity=2)
        buf.load_items([1, 2, 3, 4])
        self.assertEqual(buf.items, [3, 4])


class TestCircularContextSystem(unittest.TestCase):
    def test_input_and_output_buffers_are_independent(self):
        ctx = CircularContextSystem(capacity=2)
        ctx.record_input("in1")
        ctx.record_output("out1")
        self.assertEqual(ctx.input_buffer.items, ["in1"])
        self.assertEqual(ctx.output_buffer.items, ["out1"])

    def test_eviction_callbacks_fire_independently(self):
        evicted_in, evicted_out = [], []
        ctx = CircularContextSystem(
            capacity=1, on_input_evict=evicted_in.append, on_output_evict=evicted_out.append
        )
        ctx.record_input("a")
        ctx.record_input("b")
        ctx.record_output("x")

        self.assertEqual(evicted_in, ["a"])
        self.assertEqual(evicted_out, [])


if __name__ == "__main__":
    unittest.main()
