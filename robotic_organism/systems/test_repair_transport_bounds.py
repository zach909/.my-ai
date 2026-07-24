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


if __name__ == '__main__':
    unittest.main()
