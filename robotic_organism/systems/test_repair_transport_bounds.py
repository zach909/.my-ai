"""
Regression tests for RepairSystem/TransportSystem's damage-tracking lists.

detected_damage, repair_history (repair.py) and active_damage (transport.py)
were never pruned when a repair actually completed/delivered -- only removed
from the separate active_repairs/repair_routes dicts, not from these lists.
Since get_repair_priority() sorts detected_damage and deliver_repair_materials()
linear-scans active_damage on every single update() tick, this made both
files' hot path cost strictly grow with total ticks run, not with genuinely
outstanding work -- the same "unbounded growth on a hot path" bug class
already found and fixed many times elsewhere in this codebase, just never
previously found in robotic_organism/ because that package had never been
examined beyond "does it import."
"""

import unittest
import time
from unittest.mock import patch

from robotic_organism.systems.repair import RepairSystem
from robotic_organism.systems.transport import TransportSystem


class TestRepairSystemDoesNotLeak(unittest.TestCase):
    def test_detected_damage_drops_completed_reports(self):
        # Many nanobots + low (but above detection_sensitivity=0.1) severity
        # so repairs actually finish within the loop, rather than sitting
        # in-progress forever.
        repair = RepairSystem(nanobot_count=20)
        for _ in range(30):
            repair.detect_damage((0.0, 0.0, 0.0), "tear", 0.2, affected_systems=["skin"])
        for _ in range(200):
            repair.update(1.0)

        self.assertGreater(repair.successful_repairs, 0,
            "test setup should actually complete some repairs")
        self.assertLess(len(repair.detected_damage), 30,
            "completed repairs must be dropped from detected_damage, not kept forever")

    def test_repair_history_is_capped(self):
        repair = RepairSystem(nanobot_count=20)
        for _ in range(1500):
            repair.detect_damage((0.0, 0.0, 0.0), "tear", 0.2, affected_systems=["skin"])
            repair.update(1.0)

        self.assertGreater(repair.successful_repairs, 500,
            "test setup should complete more repairs than the cap, or this test proves nothing")
        self.assertLessEqual(len(repair.repair_history), 500,
            "repair_history must be capped instead of growing forever")

    def test_damage_ids_do_not_collide_after_pruning(self):
        # detect_damage() previously derived its id from
        # len(self.detected_damage), which the pruning fix above makes
        # non-monotonic: completing a repair can shrink it back down to a
        # value already used by an earlier detection. Force the exact
        # collision condition directly -- same millisecond (time.time()
        # mocked), detected_damage pruned back to the same length a prior
        # detection saw -- rather than relying on the real update() loop to
        # happen to land there.
        repair = RepairSystem(nanobot_count=20)
        with patch('robotic_organism.systems.repair.time.time', return_value=1_000_000.0):
            first = repair.detect_damage((0.0, 0.0, 0.0), "tear", 0.2, affected_systems=["skin"])
            self.assertEqual(len(repair.active_repairs), 1)

            # Simulate the same pruning update_repairs() performs when a
            # repair completes: drop it from detected_damage (but leave
            # active_repairs alone here, exactly as the real prune does --
            # active_repairs is only cleaned up separately, by id).
            repair.detected_damage = [d for d in repair.detected_damage if d.id != first.id]

            second = repair.detect_damage((0.0, 0.0, 0.0), "tear", 0.2, affected_systems=["skin"])

        self.assertNotEqual(first.id, second.id,
            "damage_id must stay unique even when detected_damage has been pruned back to a length "
            "seen before, within the same millisecond")
        self.assertIn(first.id, repair.active_repairs,
            "the first report must still be tracked, not silently overwritten by a colliding id")
        self.assertIn(second.id, repair.active_repairs)
        self.assertEqual(len(repair.active_repairs), 2)


class TestTransportSystemDoesNotLeak(unittest.TestCase):
    def test_active_damage_drops_delivered_reports(self):
        transport = TransportSystem()
        # Low severity keeps material consumption per repair small so
        # deliveries genuinely complete within this test's tick budget.
        for i in range(40):
            transport.report_damage(0.0, 0.0, 0.0, "tear", 0.05, time.time() + i)
        for _ in range(50):
            transport.update(1.0)

        self.assertGreater(transport.repairs_completed, 0,
            "test setup should actually complete some deliveries")
        self.assertEqual(
            len(transport.active_damage), 40 - transport.repairs_completed,
            "delivered damage must be dropped from active_damage, not kept forever"
        )

    def test_delivered_route_removed_same_tick(self):
        # deliver_repair_materials() only added a route index to `completed`
        # when it was ALREADY 'delivered' at the top of the loop -- a route
        # that transitions to 'delivered' inside this same call (progress
        # crossing 1.0) was never added, so it lingered in repair_routes for
        # one extra tick past its actual completion.
        transport = TransportSystem()
        transport.report_damage(0.0, 0.0, 0.0, "tear", 0.5, time.time())
        transport.update(1.0)  # auto-routes the new damage (status: 'routing')
        self.assertEqual(len(transport.repair_routes), 1,
            "test setup should create exactly one route")

        transport.update(1.0)  # progress 0.0 -> 0.5
        self.assertEqual(transport.repairs_completed, 0)
        self.assertEqual(len(transport.repair_routes), 1, "route should not be delivered yet")

        transport.update(1.0)  # progress 0.5 -> 1.0, delivered this tick
        self.assertEqual(transport.repairs_completed, 1)
        self.assertEqual(len(transport.repair_routes), 0,
            "a route that transitions to delivered this tick must be removed in the same call, not the next one")


if __name__ == '__main__':
    unittest.main()
