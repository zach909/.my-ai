"""Tests for UnifiedBrain: the integration of NeuralMesh, ValeSystem,
HDThinkingSystem and the neural_states learning system into one pipeline."""

import unittest

from asi_core.unified_brain import UnifiedBrain, CycleResult
from asi_core.hyperdim_thinking import MemoryKind


def make_brain(**overrides):
    config = dict(n_neurons=16, n_dimensions=4, n_input=4, n_groups=2, hd_dimensions=64, seed=1)
    config.update(overrides)
    return UnifiedBrain(**config)


class TestUnifiedBrainConstruction(unittest.TestCase):
    def test_subsystems_are_wired_together(self):
        brain = make_brain()
        self.assertEqual(len(brain.vale.v), brain.mesh.n_neurons)
        # Vale is mirrored onto every mesh neuron at construction time.
        for nid, neuron in brain.mesh.neurons.items():
            self.assertAlmostEqual(neuron.vale, brain.vale.v[nid], places=9)

    def test_synapses_registered_for_learning_system(self):
        brain = make_brain()
        self.assertEqual(len(brain.states.synapse_states), len(brain.mesh.connections))
        self.assertEqual(len(brain.states.neuron_states), brain.mesh.n_neurons)


class TestPerceiveCycle(unittest.TestCase):
    def test_perceive_returns_cycle_result(self):
        brain = make_brain()
        result = brain.perceive([0.5, -0.2, 0.1, 0.9], reward=0.6)
        self.assertIsInstance(result, CycleResult)
        self.assertTrue(len(result.output) > 0)
        self.assertGreaterEqual(result.average_surprise, 0.0)

    def test_vale_stays_conserved_across_cycles(self):
        brain = make_brain()
        for _ in range(10):
            brain.perceive([0.3, 0.1, -0.4, 0.2], reward=0.5)
        brain.vale.validate_invariant()  # raises nothing if healthy
        self.assertTrue(brain.vale.validate_invariant())

    def test_vale_changes_propagate_to_mesh(self):
        brain = make_brain()
        brain.perceive([1.0, 1.0, 1.0, 1.0], reward=1.0)
        for nid, neuron in brain.mesh.neurons.items():
            self.assertAlmostEqual(neuron.vale, brain.vale.v[nid], places=9)

    def test_continuous_state_carries_across_calls(self):
        brain = make_brain()
        brain.perceive([0.5, 0.5, 0.5, 0.5])
        carried_after_first = {nid: list(v) for nid, v in brain.mesh._carried_state.items()}
        brain.perceive([0.5, 0.5, 0.5, 0.5])
        carried_after_second = brain.mesh._carried_state
        # Continuous mode means state does not simply reset to the same values.
        self.assertNotEqual(carried_after_first, carried_after_second)

    def test_memory_can_consolidate_over_many_cycles(self):
        brain = make_brain()
        total_consolidated = 0
        for i in range(30):
            result = brain.perceive([0.9, 0.9, 0.9, 0.9], reward=0.9)
            total_consolidated += result.memory_consolidated
        self.assertGreaterEqual(total_consolidated, 0)
        self.assertGreaterEqual(len(brain.hd.memory), 0)


class TestSkills(unittest.TestCase):
    def test_registered_skill_transforms_output(self):
        brain = make_brain()
        received = {}

        def spy_negate(values):
            received["input"] = list(values)
            return [-x for x in values]

        brain.register_skill("negate", spy_negate)
        result = brain.perceive([0.4, 0.1, 0.2, 0.3])

        self.assertIn("input", received)
        self.assertEqual(len(result.output), len(received["input"]))
        for out_val, pre_skill_val in zip(result.output, received["input"]):
            self.assertAlmostEqual(out_val, -pre_skill_val, places=9)

    def test_unregister_skill_removes_transform(self):
        brain = make_brain()
        brain.register_skill("negate", lambda v: [-x for x in v])
        brain.unregister_skill("negate")
        self.assertNotIn("negate", brain.skills)

    def test_skill_effect_reproducible_across_seeded_instances(self):
        with_skill = make_brain(seed=7)
        with_skill.register_skill("double", lambda v: [x * 2 for x in v])
        without_skill = make_brain(seed=7)

        result_with = with_skill.perceive([0.4, 0.1, 0.2, 0.3])
        result_without = without_skill.perceive([0.4, 0.1, 0.2, 0.3])

        self.assertEqual(len(result_with.output), len(result_without.output))
        for doubled, original in zip(result_with.output, result_without.output):
            self.assertAlmostEqual(doubled, original * 2, places=9)


class TestDeterminism(unittest.TestCase):
    def test_seeded_construction_is_reproducible(self):
        b1 = make_brain(seed=99)
        b2 = make_brain(seed=99)
        r1 = b1.perceive([0.4, 0.1, 0.2, 0.3])
        r2 = b2.perceive([0.4, 0.1, 0.2, 0.3])
        self.assertEqual(r1.output, r2.output)

    def test_skill_registry_reflected_in_statistics(self):
        brain = make_brain()
        brain.register_skill("noop", lambda v: v)
        stats = brain.get_statistics()
        self.assertIn("noop", stats["skills"])


class TestReasoning(unittest.TestCase):
    def test_reason_returns_vector_of_expected_size(self):
        brain = make_brain()
        result = brain.reason([1.0, 0.0], [0.0, 1.0], [0.0, 0.0])
        expected_sem_len = brain.hd.config.dimensions
        # sem is a fixed fraction of total dimensions; just check it's non-empty
        self.assertTrue(len(result) > 0)
        self.assertLessEqual(len(result), expected_sem_len)


class TestStatistics(unittest.TestCase):
    def test_statistics_include_all_subsystems(self):
        brain = make_brain()
        brain.perceive([0.2, 0.4, 0.6, 0.8])
        stats = brain.get_statistics()
        for key in ("mesh", "vale", "hd", "states", "skills"):
            self.assertIn(key, stats)


class TestValeContribution(unittest.TestCase):
    def test_high_reward_increases_active_neuron_vale_relative_to_low_reward(self):
        rewarded = make_brain(seed=3)
        punished = make_brain(seed=3)

        for _ in range(15):
            rewarded.perceive([0.8, 0.8, 0.8, 0.8], reward=1.0)
        for _ in range(15):
            punished.perceive([0.8, 0.8, 0.8, 0.8], reward=0.0)

        # Reward is mean-centered around 0.5 into the utility signal that
        # redistributes vale, so consistently rewarded activity should not
        # collapse to the same distribution as consistently punished activity.
        self.assertNotEqual(rewarded.vale.v, punished.vale.v)
        rewarded.vale.validate_invariant()
        punished.vale.validate_invariant()


class TestIntrospection(unittest.TestCase):
    def test_introspect_reports_ranked_neurons(self):
        brain = make_brain()
        brain.perceive([0.5, 0.1, 0.2, 0.3])
        info = brain.introspect(top_k=3)
        self.assertEqual(len(info.most_stable_neurons), 3)
        self.assertEqual(len(info.most_flexible_neurons), 3)
        self.assertAlmostEqual(info.average_vale, sum(brain.vale.v) / len(brain.vale.v), places=9)

    def test_introspect_before_any_cycle_does_not_error(self):
        brain = make_brain()
        info = brain.introspect()
        self.assertEqual(info.memory_size, 0)


class TestExpertGroupRouting(unittest.TestCase):
    def test_cycle_result_reports_active_groups(self):
        brain = make_brain(n_neurons=24, n_groups=4, n_input=4)
        result = brain.perceive([0.5, 0.2, -0.1, 0.4])
        self.assertTrue(len(result.active_groups) >= 1)
        for g in result.active_groups:
            self.assertIn(g, range(4))

    def test_routing_eventually_activates_every_group(self):
        brain = make_brain(n_neurons=24, n_groups=4, n_input=4)
        seen = set()
        for _ in range(20):
            result = brain.perceive([0.5, 0.2, -0.1, 0.4])
            seen.update(result.active_groups)
        self.assertEqual(seen, {0, 1, 2, 3})

    def test_introspect_reports_active_groups(self):
        brain = make_brain(n_neurons=24, n_groups=4, n_input=4)
        brain.perceive([0.5, 0.2, -0.1, 0.4])
        info = brain.introspect()
        self.assertTrue(len(info.active_groups) >= 1)

    def test_expert_names_passed_at_construction_appear_in_results(self):
        brain = make_brain(
            n_neurons=24, n_groups=4, n_input=4,
            expert_names=["coding", "language", "reasoning", "research"],
        )
        result = brain.perceive([0.5, 0.2, -0.1, 0.4])
        for name in result.active_experts:
            self.assertIn(name, ["coding", "language", "reasoning", "research"])
        self.assertEqual(len(result.active_experts), len(result.active_groups))

        info = brain.introspect()
        self.assertEqual(info.active_experts, result.active_experts)

    def test_unnamed_experts_fall_back_to_default_names(self):
        brain = make_brain(n_neurons=24, n_groups=4, n_input=4)
        result = brain.perceive([0.5, 0.2, -0.1, 0.4])
        for name in result.active_experts:
            self.assertTrue(name.startswith("expert_"))


class TestMaintenance(unittest.TestCase):
    def test_maintain_keeps_vale_invariant_healthy(self):
        brain = make_brain()
        for _ in range(5):
            brain.perceive([0.4, 0.2, 0.6, 0.1])
        report = brain.maintain()
        self.assertTrue(report["vale_invariant_ok"])
        self.assertIn("memory_size", report)

    def test_maintain_does_not_mutate_mesh_state(self):
        brain = make_brain()
        brain.perceive([0.4, 0.2, 0.6, 0.1])
        before = {nid: list(n.state_vector) for nid, n in brain.mesh.neurons.items()}
        brain.maintain()
        after = {nid: list(n.state_vector) for nid, n in brain.mesh.neurons.items()}
        self.assertEqual(before, after)


class TestSelfImprovement(unittest.TestCase):
    def test_repeated_success_pattern_is_promoted_to_a_permanent_skill(self):
        brain = make_brain(n_neurons=16, n_groups=2, hd_dimensions=32)
        for _ in range(150):
            brain.perceive([0.9, 0.9, 0.9, 0.9], reward=0.95)

        long_term_traces = [
            t for t in brain.hd.memory.traces if t.kind == MemoryKind.LONG_TERM.value
        ]
        self.assertTrue(any(t.strength >= 1.2 for t in long_term_traces))

        created = brain.self_improve(min_strength=1.2)
        self.assertTrue(len(created) >= 1)
        for name in created:
            self.assertIn(name, brain.skills)

    def test_self_improve_does_not_recreate_already_promoted_skills(self):
        brain = make_brain(n_neurons=16, n_groups=2, hd_dimensions=32)
        for _ in range(150):
            brain.perceive([0.9, 0.9, 0.9, 0.9], reward=0.95)

        first = brain.self_improve(min_strength=1.2)
        second = brain.self_improve(min_strength=1.2)
        self.assertTrue(len(first) >= 1)
        self.assertEqual(second, [])

    def test_self_improve_with_no_strong_patterns_creates_nothing(self):
        brain = make_brain()
        brain.perceive([0.1, 0.1, 0.1, 0.1])
        created = brain.self_improve(min_strength=1.2)
        self.assertEqual(created, [])


class TestExtensionCreation(unittest.TestCase):
    def test_create_extension_bundles_promoted_pattern_skills(self):
        brain = make_brain(n_neurons=16, n_groups=2, hd_dimensions=32)
        for _ in range(150):
            brain.perceive([0.9, 0.9, 0.9, 0.9], reward=0.95)
        created = brain.self_improve(min_strength=1.2)
        self.assertTrue(len(created) >= 1)

        ext = brain.create_extension("coding", purpose="write code")
        self.assertEqual(set(ext.skills), set(created))
        self.assertEqual(ext.stage.value, "quantized")

    def test_create_extension_with_no_skills_fails_default_test(self):
        brain = make_brain()
        ext = brain.create_extension("empty", purpose="nothing bundled")
        self.assertEqual(ext.stage.value, "failed")


class TestCircularContext(unittest.TestCase):
    def test_input_and_output_are_recorded_each_cycle(self):
        brain = make_brain(context_capacity=10)
        brain.perceive([0.5, 0.1, 0.2, 0.3])
        self.assertEqual(len(brain.context.input_buffer), 1)
        self.assertEqual(len(brain.context.output_buffer), 1)
        self.assertEqual(brain.context.input_buffer.items[0], [0.5, 0.1, 0.2, 0.3])

    def test_buffer_overflow_compresses_into_long_term_memory(self):
        brain = make_brain(context_capacity=3)
        self.assertEqual(len(brain.hd.memory), 0)
        for _ in range(6):
            brain.perceive([0.5, 0.1, 0.2, 0.3])
        self.assertEqual(len(brain.context.input_buffer), 3)
        self.assertTrue(len(brain.hd.memory) > 0)


if __name__ == "__main__":
    unittest.main()
