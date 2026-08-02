"""
Test suite for the Hyper-Dimensional Thinking (HDT) system.

Organized to mirror docs/HYPERDIMENSIONAL_THINKING.md section by section:
1. HDVector construction/slicing
2. HDC algebra (bind/unbind/bundle/permute/similarity)
3. Neuron state transitions
4. Prediction & surprise
5. Memory consolidation & recall
6. Reasoning (analogy solving)
7. Full system integration & determinism
"""

import unittest

from asi_core.hyperdim_thinking import (
    HDVector,
    bind,
    unbind,
    bundle,
    permute,
    cosine_similarity,
    HDConfig,
    HDNeuron,
    HDThinkingSystem,
    MemoryStore,
    MemoryKind,
)


class TestHDVector(unittest.TestCase):
    def test_subspace_slicing_covers_all_dims(self):
        v = HDVector.zeros(100)
        total = len(v.sem) + len(v.ctx) + len(v.val) + len(v.tmp) + len(v.meta)
        self.assertEqual(total, v.dimensions)

    def test_random_is_deterministic_under_seed(self):
        a = HDVector.random(64, seed=7)
        b = HDVector.random(64, seed=7)
        self.assertEqual(a.data, b.data)

    def test_random_differs_across_seeds(self):
        a = HDVector.random(64, seed=1)
        b = HDVector.random(64, seed=2)
        self.assertNotEqual(a.data, b.data)

    def test_zeros_all_zero(self):
        v = HDVector.zeros(32)
        self.assertTrue(all(x == 0.0 for x in v.data))

    def test_subspace_setter_roundtrip(self):
        v = HDVector.zeros(50)
        v.sem = [1.0] * len(v.sem)
        self.assertTrue(all(x == 1.0 for x in v.sem))
        self.assertTrue(all(x == 0.0 for x in v.ctx))


class TestAlgebra(unittest.TestCase):
    def setUp(self):
        self.a = HDVector.random(128, seed=1)
        self.b = HDVector.random(128, seed=2)

    def test_bind_unbind_recovers_operand(self):
        bound = bind(self.a, self.b)
        recovered = unbind(bound, self.b)
        for x, y in zip(recovered.data, self.a.data):
            self.assertAlmostEqual(x, y, places=6)

    def test_bundle_is_similar_to_inputs(self):
        bundled = bundle(self.a, self.b)
        self.assertGreater(cosine_similarity(bundled, self.a), 0.0)
        self.assertGreater(cosine_similarity(bundled, self.b), 0.0)

    def test_permute_invertible(self):
        shifted = permute(self.a, 5)
        restored = permute(shifted, -5)
        self.assertEqual(restored.data, self.a.data)

    def test_permute_zero_is_identity(self):
        self.assertEqual(permute(self.a, 0).data, self.a.data)

    def test_self_similarity_is_one(self):
        self.assertAlmostEqual(cosine_similarity(self.a, self.a), 1.0, places=6)

    def test_dimension_mismatch_raises(self):
        other = HDVector.random(64, seed=3)
        with self.assertRaises(ValueError):
            bind(self.a, other)

    def test_bundle_requires_at_least_one_vector(self):
        with self.assertRaises(ValueError):
            bundle()


class TestNeuronTransitions(unittest.TestCase):
    def setUp(self):
        self.config = HDConfig(dimensions=64)
        self.neuron = HDNeuron(neuron_id=0, config=self.config, seed=0)

    def test_step_returns_nonnegative_surprise(self):
        inbound = HDVector.random(64, seed=10)
        surprise = self.neuron.step(inbound, reward=0.5)
        self.assertGreaterEqual(surprise, 0.0)

    def test_phase_returns_to_idle_after_step(self):
        inbound = HDVector.random(64, seed=10)
        self.neuron.step(inbound, reward=0.5)
        from asi_core.hyperdim_thinking import NeuronPhase
        self.assertEqual(self.neuron.phase, NeuronPhase.IDLE)

    def test_tmp_decays_toward_zero_with_zero_input(self):
        zero_input = HDVector.zeros(64)
        # Push tmp away from zero first with a non-zero exposure.
        self.neuron.step(HDVector.random(64, seed=5), reward=0.5)
        first_tmp_norm = sum(abs(x) for x in self.neuron.state.tmp)
        self.neuron.step(zero_input, reward=0.5)
        second_tmp_norm = sum(abs(x) for x in self.neuron.state.tmp)
        self.assertLessEqual(second_tmp_norm, first_tmp_norm + 1e-9)

    def test_value_tracks_constant_reward_monotonically(self):
        inbound = HDVector.zeros(64)
        prev_avg = sum(self.neuron.state.val) / len(self.neuron.state.val)
        for _ in range(5):
            self.neuron.step(inbound, reward=1.0)
            new_avg = sum(self.neuron.state.val) / len(self.neuron.state.val)
            self.assertGreaterEqual(new_avg, prev_avg - 1e-9)
            prev_avg = new_avg


class TestPrediction(unittest.TestCase):
    def test_prediction_error_shrinks_on_repeated_pattern(self):
        config = HDConfig(dimensions=32, predictor_lr=0.1)
        neuron = HDNeuron(neuron_id=0, config=config, seed=0)
        pattern = HDVector.random(32, seed=99)

        errors = []
        for _ in range(30):
            errors.append(neuron.step(pattern, reward=0.5))

        early_avg = sum(errors[:5]) / 5
        late_avg = sum(errors[-5:]) / 5
        self.assertLess(late_avg, early_avg)

    def test_system_predict_horizon_returns_all_neurons(self):
        system = HDThinkingSystem(n_neurons=6, dimensions=32, n_input=2, seed=1)
        system.tick()
        preds = system.predict(horizon=3)
        self.assertEqual(set(preds.keys()), set(system.neurons.keys()))

    def test_surprise_reaches_default_consolidation_threshold_on_a_learned_pattern(self):
        """
        Regression test: surprise used to be an unshifted softplus of the
        prediction error norm, which floors at ln(2) ~= 0.693 even for a
        perfectly predicted (zero-error) input. Since HDConfig.theta_meta
        defaults to 0.3, should_consolidate()'s avg_meta < theta_meta check
        was permanently unreachable, so nothing could ever consolidate.
        """
        config = HDConfig(dimensions=32, predictor_lr=0.2)
        neuron = HDNeuron(neuron_id=0, config=config, seed=0)
        pattern = HDVector.random(32, seed=99)

        surprise = 1.0
        for _ in range(200):
            surprise = neuron.step(pattern, reward=1.0)

        self.assertLess(surprise, config.theta_meta)


class TestMemory(unittest.TestCase):
    def setUp(self):
        self.config = HDConfig(dimensions=64, theta_val=0.5, theta_meta=0.9)
        self.store = MemoryStore(self.config)

    def test_write_and_recall_nearest(self):
        key = HDVector.random(64, seed=1)
        value = HDVector.random(64, seed=2)
        self.store.write(key, value, tick=0)

        noisy_cue = bundle(key, HDVector.random(64, seed=3), weights=[0.9, 0.1])
        results = self.store.recall(noisy_cue, k=1)
        self.assertEqual(len(results), 1)
        self.assertGreater(cosine_similarity(results[0].key, key), 0.5)

    def test_similar_keys_merge_instead_of_growing(self):
        key1 = HDVector.random(64, seed=1)
        key2 = key1.copy()  # identical -> must merge
        self.store.write(key1, HDVector.random(64, seed=2), tick=0)
        self.store.write(key2, HDVector.random(64, seed=3), tick=1)
        self.assertEqual(len(self.store), 1)

    def test_decay_and_prune_bounds_growth(self):
        for i in range(5):
            self.store.write(HDVector.random(64, seed=100 + i), HDVector.random(64, seed=200 + i), tick=i)
        for _ in range(200000):
            self.store.decay_and_prune()
        self.assertEqual(len(self.store), 0)

    def test_kind_is_recorded_and_filters_recall(self):
        key = HDVector.random(64, seed=1)
        self.store.write(key, HDVector.random(64, seed=2), tick=0, kind=MemoryKind.EXPERIENCE.value)
        self.assertEqual(self.store.traces[0].kind, MemoryKind.EXPERIENCE.value)

        cue = key.copy()
        self.assertEqual(len(self.store.recall(cue, k=1, kind=MemoryKind.LONG_TERM.value)), 0)
        self.assertEqual(len(self.store.recall(cue, k=1, kind=MemoryKind.EXPERIENCE.value)), 1)

    def test_similar_keys_of_different_kinds_do_not_merge(self):
        key1 = HDVector.random(64, seed=1)
        key2 = key1.copy()
        self.store.write(key1, HDVector.random(64, seed=2), tick=0, kind=MemoryKind.LONG_TERM.value)
        self.store.write(key2, HDVector.random(64, seed=3), tick=1, kind=MemoryKind.EXPERIENCE.value)
        self.assertEqual(len(self.store), 2)


class TestReasoning(unittest.TestCase):
    def test_analogy_solve_recovers_stored_concept(self):
        config = HDConfig(dimensions=128, theta_confident=0.0)
        system = HDThinkingSystem(n_neurons=4, dimensions=128, n_input=1, config=config, seed=3)

        king = HDVector.random(128, seed=10)
        man = HDVector.random(128, seed=11)
        queen = HDVector.random(128, seed=12)
        woman = HDVector.random(128, seed=13)

        # Teach the relation: king:man :: queen:woman by storing woman under
        # the cue derived from bind(queen, unbind(man, king)).
        relation = unbind(man, king)
        cue = bind(queen, relation)
        system.memory.write(cue, woman, tick=0)

        result = system.reason(king, man, queen)
        self.assertGreater(cosine_similarity(result, woman), 0.9)

    def test_sequence_bind_unbind_roundtrip(self):
        role = HDVector.random(64, seed=1)
        content = HDVector.random(64, seed=2)
        seq = bind(content, permute(role, 3))
        recovered = unbind(seq, permute(role, 3))
        for x, y in zip(recovered.data, content.data):
            self.assertAlmostEqual(x, y, places=6)


class TestSystemIntegration(unittest.TestCase):
    def test_end_to_end_ticks_produce_well_formed_statistics(self):
        system = HDThinkingSystem(n_neurons=10, dimensions=64, n_input=3, seed=42)
        for _ in range(5):
            system.tick()
        stats = system.get_statistics()
        self.assertEqual(stats["tick"], 5)
        self.assertEqual(stats["n_neurons"], 10)
        self.assertGreaterEqual(stats["memory_size"], 0)

    def test_consolidate_produces_both_long_term_and_experience_traces(self):
        config = HDConfig(dimensions=32, predictor_lr=0.2)
        system = HDThinkingSystem(n_neurons=2, dimensions=32, n_input=1, config=config, seed=7)
        good_pattern = HDVector.random(32, seed=1)
        bad_pattern = HDVector.random(32, seed=2)

        for _ in range(150):
            system.tick(inputs={0: good_pattern}, reward=1.0)
        for _ in range(150):
            system.tick(inputs={0: bad_pattern}, reward=0.0)

        kinds = {t.kind for t in system.memory.traces}
        self.assertIn(MemoryKind.LONG_TERM.value, kinds)
        self.assertIn(MemoryKind.EXPERIENCE.value, kinds)

    def test_save_load_state_reproduces_next_tick(self):
        system_a = HDThinkingSystem(n_neurons=8, dimensions=32, n_input=2, seed=5)
        system_b = HDThinkingSystem(n_neurons=8, dimensions=32, n_input=2, seed=5)

        for _ in range(3):
            system_a.tick()
            system_b.tick()

        saved = system_a.save_state()
        system_b.load_state(saved)

        result_a = system_a.tick(reward=0.7)
        result_b = system_b.tick(reward=0.7)

        for nid in system_a.neurons:
            a_state = result_a.activations[nid].data
            b_state = result_b.activations[nid].data
            for x, y in zip(a_state, b_state):
                self.assertAlmostEqual(x, y, places=6)

    def test_save_load_state_preserves_memory_trace_kind(self):
        """Regression test: save_state() used to omit MemoryTrace.kind
        entirely, so load_state() silently reset every restored trace back
        to LONG_TERM regardless of whether it was originally EXPERIENCE."""
        config = HDConfig(dimensions=32, predictor_lr=0.2)
        system_a = HDThinkingSystem(n_neurons=2, dimensions=32, n_input=1, config=config, seed=7)
        good_pattern = HDVector.random(32, seed=1)
        bad_pattern = HDVector.random(32, seed=2)

        for _ in range(150):
            system_a.tick(inputs={0: good_pattern}, reward=1.0)
        for _ in range(150):
            system_a.tick(inputs={0: bad_pattern}, reward=0.0)

        original_kinds = sorted(t.kind for t in system_a.memory.traces)
        self.assertIn(MemoryKind.EXPERIENCE.value, original_kinds)

        system_b = HDThinkingSystem(n_neurons=2, dimensions=32, n_input=1, config=config, seed=7)
        system_b.load_state(system_a.save_state())
        restored_kinds = sorted(t.kind for t in system_b.memory.traces)

        self.assertEqual(original_kinds, restored_kinds)


if __name__ == "__main__":
    unittest.main()
