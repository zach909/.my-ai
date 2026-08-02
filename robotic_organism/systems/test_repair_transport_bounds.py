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
        #
        # Drives the prune through the real update_repairs() path (via its
        # own "already complete" fast path) rather than hand-simulating it,
        # since update_repairs() actually removes a completed id from
        # active_repairs and detected_damage together, in the same pass --
        # an earlier draft's comment claiming active_repairs is "left alone"
        # by the real prune was itself wrong (caught by review after this
        # test had already shipped; fixed here).
        repair = RepairSystem(nanobot_count=20)
        with patch('robotic_organism.systems.repair.time.time', return_value=1_000_000.0):
            first = repair.detect_damage((0.0, 0.0, 0.0), "tear", 0.2, affected_systems=["skin"])
            second = repair.detect_damage((0.0, 0.0, 0.0), "tear", 0.2, affected_systems=["skin"])
            self.assertEqual(len(repair.active_repairs), 2)
            self.assertEqual(len(repair.detected_damage), 2)

            first.repair_complete = True
            repair.update_repairs(dt=1.0)
            self.assertNotIn(first.id, repair.active_repairs,
                "test setup should actually prune the completed repair")
            self.assertEqual(len(repair.detected_damage), 1,
                "test setup should actually prune detected_damage back down to second's own creation-time length")

            # detected_damage has shrunk back to the length it had when
            # `second` was created -- under the old len(detected_damage) id
            # scheme, this new detection (same mocked millisecond) would
            # collide with `second`'s still-active id.
            third = repair.detect_damage((0.0, 0.0, 0.0), "tear", 0.2, affected_systems=["skin"])

        self.assertNotEqual(second.id, third.id,
            "damage_id must stay unique even when detected_damage has been pruned back to a length "
            "seen before, within the same millisecond")
        self.assertIn(second.id, repair.active_repairs,
            "the still-active repair must not be silently overwritten by a colliding id")
        self.assertIn(third.id, repair.active_repairs)
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


class TestTransportNetworkReachesLimbs(unittest.TestCase):
    def test_default_network_connects_every_node_to_the_spine(self):
        # _create_default_network() added limb_L1/limb_R1/limb_L2/limb_R2 to
        # self.nodes via add_node() but never called add_channel() to link
        # them to the spine, so their `connections` list stayed permanently
        # empty and _find_path_to_node()'s BFS (which only ever walks
        # `connections`, starting from "spine_0") could never reach them.
        transport = TransportSystem()
        for node_id in ("limb_L1", "limb_R1", "limb_L2", "limb_R2"):
            self.assertTrue(transport.nodes[node_id].connections,
                f"{node_id} must have at least one channel connecting it to the network")

    def test_route_repair_material_reaches_a_limb_location(self):
        # All existing coverage in this file reports damage at (0, 0, 0),
        # which resolves to nearest_node="spine_0" -- always routable even
        # with the limb nodes fully disconnected, so it never caught this.
        transport = TransportSystem()
        damage = transport.report_damage(
            x=0.05, y=0.1, z=0.0, damage_type="puncture", severity=0.9, timestamp=1000.0)
        self.assertEqual(damage.nearest_node, "limb_L1",
            "test setup should actually target a limb node, not the spine")

        result = transport.route_repair_material(damage)
        self.assertEqual(result.get('status'), 'routing_started',
            "repair material must be routable to a limb location, not just the spine axis")
        self.assertEqual(len(transport.repair_routes), 1)


if __name__ == '__main__':
    unittest.main()
