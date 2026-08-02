"""Tests for the Hive Mind / Multi-Agent Collaboration system (spec Part 12)."""

import unittest

from asi_core.hive_mind import HiveMind, TrustSystem
from asi_core.extension_system import ExtensionSystem


class TestTrustSystem(unittest.TestCase):
    def test_new_agent_gets_initial_trust(self):
        trust = TrustSystem(initial_trust=0.5)
        self.assertEqual(trust.get("agent_a"), 0.5)

    def test_reward_increases_trust(self):
        trust = TrustSystem(initial_trust=0.5)
        trust.reward("agent_a", amount=0.1)
        self.assertAlmostEqual(trust.get("agent_a"), 0.6)

    def test_penalize_decreases_trust(self):
        trust = TrustSystem(initial_trust=0.5)
        trust.penalize("agent_a", amount=0.2)
        self.assertAlmostEqual(trust.get("agent_a"), 0.3)

    def test_trust_is_clamped_to_bounds(self):
        trust = TrustSystem(initial_trust=0.5, min_trust=0.0, max_trust=1.0)
        for _ in range(20):
            trust.reward("agent_a", amount=0.5)
        self.assertEqual(trust.get("agent_a"), 1.0)
        for _ in range(20):
            trust.penalize("agent_a", amount=0.5)
        self.assertEqual(trust.get("agent_a"), 0.0)


class TestHiveMindSharing(unittest.TestCase):
    def _make_extension(self, source: ExtensionSystem, name="coding", skills=None):
        if skills is None:
            skills = ["a", "b"]
        return source.create(name, purpose="write code", skills=skills)

    def test_successful_share_installs_extension_in_receiving_registry(self):
        hive = HiveMind()
        source = ExtensionSystem()
        target = ExtensionSystem()
        ext = self._make_extension(source)

        record = hive.share(ext, from_agent="coding_agent", to_agent="research_agent", to_registry=target)

        self.assertTrue(record.accepted)
        self.assertIsNotNone(target.get("coding"))
        self.assertEqual(target.get("coding").stage.value, "quantized")

    def test_successful_share_rewards_sender_trust(self):
        hive = HiveMind()
        source = ExtensionSystem()
        target = ExtensionSystem()
        ext = self._make_extension(source)

        before = hive.trust.get("coding_agent")
        hive.share(ext, from_agent="coding_agent", to_agent="research_agent", to_registry=target)
        after = hive.trust.get("coding_agent")

        self.assertGreater(after, before)

    def test_share_with_empty_skills_fails_verification_and_penalizes_sender(self):
        hive = HiveMind()
        source = ExtensionSystem()
        target = ExtensionSystem()
        ext = self._make_extension(source, skills=[])

        before = hive.trust.get("coding_agent")
        record = hive.share(ext, from_agent="coding_agent", to_agent="research_agent", to_registry=target)
        after = hive.trust.get("coding_agent")

        self.assertFalse(record.accepted)
        self.assertLess(after, before)
        self.assertIsNone(target.get("coding"))

    def test_share_blocked_when_sender_trust_below_threshold(self):
        hive = HiveMind(min_trust_to_share=0.6)
        source = ExtensionSystem()
        target = ExtensionSystem()
        ext = self._make_extension(source)

        record = hive.share(ext, from_agent="coding_agent", to_agent="research_agent", to_registry=target)

        self.assertFalse(record.accepted)
        self.assertIn("trust", record.reason)
        self.assertIsNone(target.get("coding"))

    def test_share_blocked_when_name_already_exists_in_receiver(self):
        hive = HiveMind()
        source = ExtensionSystem()
        target = ExtensionSystem()
        ext = self._make_extension(source)
        target.create("coding", purpose="already here", skills=["x"])

        record = hive.share(ext, from_agent="coding_agent", to_agent="research_agent", to_registry=target)

        self.assertFalse(record.accepted)
        self.assertEqual(target.get("coding").purpose, "already here")

    def test_memory_trace_ids_are_not_carried_across_agents(self):
        hive = HiveMind()
        source = ExtensionSystem()
        target = ExtensionSystem()
        ext = source.create("coding", purpose="x", skills=["a"], memory_trace_ids=[123, 456])

        hive.share(ext, from_agent="coding_agent", to_agent="research_agent", to_registry=target)

        self.assertEqual(target.get("coding").memory_trace_ids, [])

    def test_history_for_agent_includes_both_sent_and_received(self):
        hive = HiveMind()
        source = ExtensionSystem()
        target = ExtensionSystem()
        ext = self._make_extension(source)
        hive.share(ext, from_agent="coding_agent", to_agent="research_agent", to_registry=target)

        sender_history = hive.history_for("coding_agent")
        receiver_history = hive.history_for("research_agent")
        self.assertEqual(len(sender_history), 1)
        self.assertEqual(len(receiver_history), 1)
        self.assertEqual(sender_history[0], receiver_history[0])


if __name__ == "__main__":
    unittest.main()
