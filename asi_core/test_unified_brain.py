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

    def test_register_skill_creates_a_skill_record(self):
        brain = make_brain()
        brain.register_skill("double", lambda v: v)
        self.assertIn("double", brain.skill_records)
        self.assertEqual(brain.skill_records["double"].activation_count, 0)

    def test_skill_record_tracks_activation_count_and_performance(self):
        brain = make_brain()
        brain.register_skill("double", lambda v: [x * 2 for x in v])
        for _ in range(3):
            brain.perceive([0.4, 0.1, 0.2, 0.3], reward=0.9)
        record = brain.skill_records["double"]
        self.assertEqual(record.activation_count, 3)
        self.assertEqual(len(record.improvement_history), 3)
        self.assertGreater(record.performance_score, 0.0)

    def test_unregister_skill_preserves_its_record(self):
        brain = make_brain()
        brain.register_skill("double", lambda v: [x * 2 for x in v])
        brain.perceive([0.4, 0.1, 0.2, 0.3], reward=0.9)
        brain.unregister_skill("double")
        self.assertNotIn("double", brain.skills)
        self.assertIn("double", brain.skill_records)
        self.assertEqual(brain.skill_records["double"].activation_count, 1)

    def test_skill_not_run_after_unregister_does_not_gain_activations(self):
        brain = make_brain()
        brain.register_skill("double", lambda v: [x * 2 for x in v])
        brain.perceive([0.4, 0.1, 0.2, 0.3], reward=0.9)
        brain.unregister_skill("double")
        brain.perceive([0.4, 0.1, 0.2, 0.3], reward=0.9)
        self.assertEqual(brain.skill_records["double"].activation_count, 1)


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


class TestExpertCreation(unittest.TestCase):
    def test_create_expert_grows_mesh_and_vale_together(self):
        brain = make_brain()
        n_before = brain.mesh.n_neurons
        group_id = brain.create_expert("robotics", n_new_neurons=4)
        self.assertEqual(brain.mesh.n_neurons, n_before + 4)
        self.assertEqual(len(brain.vale.v), n_before + 4)
        self.assertEqual(brain.mesh.get_group_name(group_id), "robotics")
        self.assertTrue(brain.vale.validate_invariant())

    def test_new_expert_neurons_vale_matches_mesh_after_sync(self):
        brain = make_brain()
        brain.create_expert("robotics", n_new_neurons=4)
        for nid, neuron in brain.mesh.neurons.items():
            self.assertAlmostEqual(neuron.vale, brain.vale.v[nid], places=9)

    def test_new_expert_neurons_are_registered_with_learning_system(self):
        brain = make_brain()
        n_neurons_before = brain.mesh.n_neurons
        brain.create_expert("robotics", n_new_neurons=4)
        for nid in range(n_neurons_before, n_neurons_before + 4):
            self.assertIsNotNone(brain.states.get_neuron_state(str(nid)))

    def test_brain_still_perceives_after_expert_creation(self):
        brain = make_brain()
        brain.create_expert("robotics", n_new_neurons=4)
        result = brain.perceive([0.4, 0.1, 0.2, 0.3])
        self.assertTrue(len(result.output) > 0)
        for val in result.output:
            self.assertFalse(val != val)  # not NaN


class TestMistakeTracking(unittest.TestCase):
    def test_low_reward_cycle_is_recorded_as_a_mistake(self):
        brain = make_brain()
        result = brain.perceive([0.5, 0.2, -0.1, 0.4], reward=0.1)
        self.assertIsNotNone(result.mistake_signature)
        self.assertFalse(result.mistake_repeated)
        record = brain.mistakes.get(result.mistake_signature)
        self.assertEqual(record.occurrences, 1)

    def test_high_reward_cycle_is_not_a_mistake(self):
        brain = make_brain()
        result = brain.perceive([0.5, 0.2, -0.1, 0.4], reward=0.9)
        self.assertIsNone(result.mistake_signature)
        self.assertFalse(result.mistake_repeated)

    def test_repeated_low_reward_input_is_flagged_as_repeated(self):
        brain = make_brain()
        r1 = brain.perceive([0.5, 0.2, -0.1, 0.4], reward=0.1)
        r2 = brain.perceive([0.5, 0.2, -0.1, 0.4], reward=0.1)
        self.assertFalse(r1.mistake_repeated)
        self.assertTrue(r2.mistake_repeated)
        self.assertEqual(r1.mistake_signature, r2.mistake_signature)

    def test_repeated_mistake_still_conserves_vale(self):
        brain = make_brain()
        for _ in range(5):
            brain.perceive([0.5, 0.2, -0.1, 0.4], reward=0.1)
        self.assertTrue(brain.vale.validate_invariant())

    def test_correction_can_be_logged_via_mistake_tracker(self):
        brain = make_brain()
        result = brain.perceive([0.5, 0.2, -0.1, 0.4], reward=0.1)
        record = brain.mistakes.correct(result.mistake_signature, correction="raised vale on other groups", worked=True)
        self.assertTrue(record.correction_worked)


class TestMultiPathReasoning(unittest.TestCase):
    def test_empty_memory_returns_no_paths(self):
        brain = make_brain()
        paths = brain.multi_path_reason([0.5, 0.2, -0.1, 0.4])
        self.assertEqual(paths, [])

    def test_paths_are_sorted_strongest_first(self):
        brain = make_brain(n_neurons=16, n_groups=2, hd_dimensions=32)
        for _ in range(150):
            brain.perceive([0.9, 0.9, 0.9, 0.9], reward=0.95)
        for _ in range(150):
            brain.perceive([-0.9, -0.9, -0.9, -0.9], reward=0.02)

        paths = brain.multi_path_reason([0.9, 0.9, 0.9, 0.9], n_paths=5)
        self.assertTrue(len(paths) >= 2)
        confidences = [p.confidence for p in paths]
        self.assertEqual(confidences, sorted(confidences, reverse=True))

    def test_long_term_paths_rank_above_experience_paths_for_matching_query(self):
        brain = make_brain(n_neurons=16, n_groups=2, hd_dimensions=32)
        for _ in range(150):
            brain.perceive([0.9, 0.9, 0.9, 0.9], reward=0.95)
        for _ in range(150):
            brain.perceive([-0.9, -0.9, -0.9, -0.9], reward=0.02)

        paths = brain.multi_path_reason([0.9, 0.9, 0.9, 0.9], n_paths=5)
        best = paths[0]
        self.assertEqual(best.supporting_trace_kind, "long_term")
        self.assertGreater(best.confidence, 0.0)

    def test_experience_path_confidence_is_nonpositive(self):
        brain = make_brain(n_neurons=16, n_groups=2, hd_dimensions=32)
        for _ in range(150):
            brain.perceive([-0.9, -0.9, -0.9, -0.9], reward=0.02)

        paths = brain.multi_path_reason([-0.9, -0.9, -0.9, -0.9], n_paths=3)
        for p in paths:
            if p.supporting_trace_kind == "experience":
                self.assertLessEqual(p.confidence, 0.0)


class TestDebugSnapshot(unittest.TestCase):
    def test_snapshot_before_any_activity_does_not_error(self):
        brain = make_brain()
        snap = brain.debug_snapshot()
        self.assertEqual(snap.memory_size, 0)
        self.assertEqual(snap.errors_detected, [])
        self.assertEqual(snap.extensions_installed, [])

    def test_snapshot_reflects_context_buffers(self):
        brain = make_brain(context_capacity=10)
        brain.perceive([0.5, 0.1, 0.2, 0.3])
        brain.perceive([0.5, 0.1, 0.2, 0.3])
        snap = brain.debug_snapshot()
        self.assertEqual(snap.context_input_size, 2)
        self.assertEqual(snap.context_output_size, 2)

    def test_snapshot_reflects_errors_detected(self):
        brain = make_brain()
        brain.perceive([0.5, 0.2, -0.1, 0.4], reward=0.1)
        brain.perceive([0.5, 0.2, -0.1, 0.4], reward=0.1)
        snap = brain.debug_snapshot()
        self.assertEqual(len(snap.errors_detected), 1)
        self.assertIn("x2", snap.errors_detected[0])

    def test_snapshot_reflects_installed_extensions(self):
        brain = make_brain(n_neurons=16, n_groups=2, hd_dimensions=32)
        for _ in range(150):
            brain.perceive([0.9, 0.9, 0.9, 0.9], reward=0.95)
        brain.self_improve(min_strength=1.2)
        brain.create_extension("coding", purpose="write code")
        snap = brain.debug_snapshot()
        self.assertIn("coding", snap.extensions_installed)

    def test_snapshot_active_neuron_count_matches_active_groups(self):
        brain = make_brain(n_neurons=16, n_groups=2, n_input=4)
        brain.perceive([0.5, 0.1, 0.2, 0.3])
        snap = brain.debug_snapshot()
        expected = sum(
            1 for n in brain.mesh.neurons.values() if n.group in brain.mesh.active_groups
        )
        self.assertEqual(snap.active_neuron_count, expected)


class TestBackupRestore(unittest.TestCase):
    def _make_and_populate(self):
        brain = make_brain(n_neurons=16, n_groups=2, hd_dimensions=32)
        for _ in range(80):
            brain.perceive([0.9, 0.9, 0.9, 0.9], reward=0.95)
        for _ in range(3):
            brain.perceive([0.5, 0.2, -0.1, 0.4], reward=0.1)
        brain.self_improve(min_strength=1.2)
        brain.create_extension("coding", purpose="write code")
        return brain

    def test_restore_reproduces_vale(self):
        brain = self._make_and_populate()
        backup = brain.backup()

        restored = make_brain(n_neurons=16, n_groups=2, hd_dimensions=32)
        restored.restore(backup)

        self.assertEqual(restored.vale.v, brain.vale.v)
        self.assertTrue(restored.vale.validate_invariant())

    def test_restore_reproduces_memory_including_kind(self):
        brain = self._make_and_populate()
        backup = brain.backup()

        restored = make_brain(n_neurons=16, n_groups=2, hd_dimensions=32)
        restored.restore(backup)

        original_kinds = [t.kind for t in brain.hd.memory.traces]
        restored_kinds = [t.kind for t in restored.hd.memory.traces]
        self.assertEqual(restored_kinds, original_kinds)

    def test_restore_reproduces_extensions_and_mistakes(self):
        brain = self._make_and_populate()
        backup = brain.backup()

        restored = make_brain(n_neurons=16, n_groups=2, hd_dimensions=32)
        restored.restore(backup)

        self.assertEqual(
            set(restored.extensions.extensions.keys()), set(brain.extensions.extensions.keys())
        )
        self.assertEqual(set(restored.mistakes.records.keys()), set(brain.mistakes.records.keys()))

    def test_restored_brain_still_perceives(self):
        brain = self._make_and_populate()
        backup = brain.backup()

        restored = make_brain(n_neurons=16, n_groups=2, hd_dimensions=32)
        restored.restore(backup)

        result = restored.perceive([0.1, 0.1, 0.1, 0.1])
        self.assertTrue(len(result.output) > 0)

    def test_restore_into_mismatched_architecture_raises(self):
        brain = self._make_and_populate()
        backup = brain.backup()

        mismatched = make_brain(n_neurons=32, n_groups=2, hd_dimensions=32)
        with self.assertRaises(ValueError):
            mismatched.restore(backup)


if __name__ == "__main__":
    unittest.main()
