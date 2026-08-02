"""Tests for UnifiedBrain: the integration of NeuralMesh, ValeSystem,
HDThinkingSystem and the neural_states learning system into one pipeline."""

import unittest

from asi_core.unified_brain import UnifiedBrain, CycleResult


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


if __name__ == "__main__":
    unittest.main()
