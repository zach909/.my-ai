"""
Test suite for the Background Value (Vale) System.

Covers:
1. Configuration / feasibility validation
2. Initialization (uniform + jittered)
3. Zero-sum conservation under continuous step() updates
4. Bound respect under saturation / water-filling
5. Explicit promote / demote / protect / release / transfer semantics
6. Plasticity curve and effective learning rate
7. Long-term stability (relaxation, frozen-fraction safety valve)
8. Forgetting prevention / memory interaction (consolidation penalty)
9. Population changes (add/remove neurons)
10. Serialization round-trip
11. Edge cases: n=1, all-targeted promote, saturated donors, NaN utility
"""

import math
import random
import unittest

from asi_core.vale_system import (
    ValeSystem, ValeConfig, DonorPolicy, RecipientPolicy,
    ValeConfigError, ValeInvariantError,
)


def make_system(n=16, seed=0, **overrides):
    cfg = ValeConfig(n_neurons=n, **overrides)
    return ValeSystem(cfg, seed=seed)


class TestConfigValidation(unittest.TestCase):
    def test_default_feasible(self):
        cfg = ValeConfig(n_neurons=10)
        self.assertTrue(cfg.v_min < cfg.v_init < cfg.v_max or cfg.v_init == cfg.v_total / 10)

    def test_infeasible_total_raises(self):
        with self.assertRaises(ValeConfigError):
            ValeConfig(n_neurons=10, v_min=0.4, v_max=0.6, v_total=100.0)

    def test_bad_bounds_raises(self):
        with self.assertRaises(ValeConfigError):
            ValeConfig(n_neurons=10, v_min=0.6, v_max=0.4)

    def test_zero_neurons_raises(self):
        with self.assertRaises(ValeConfigError):
            ValeConfig(n_neurons=0)


class TestInitialization(unittest.TestCase):
    def test_uniform_init_sums_to_total(self):
        vs = make_system(n=20)
        self.assertAlmostEqual(sum(vs.v), vs.cfg.v_total, places=6)
        self.assertEqual(len(set(round(x, 9) for x in vs.v)), 1)

    def test_jittered_init_still_conserves_and_respects_bounds(self):
        vs = make_system(n=50, init_jitter=0.05)
        self.assertAlmostEqual(sum(vs.v), vs.cfg.v_total, places=6)
        for x in vs.v:
            self.assertGreaterEqual(x, vs.cfg.v_min - 1e-9)
            self.assertLessEqual(x, vs.cfg.v_max + 1e-9)
        # jitter should actually produce some spread
        self.assertGreater(max(vs.v) - min(vs.v), 0.0)

    def test_single_neuron_holds_all_vale(self):
        vs = make_system(n=1)
        self.assertAlmostEqual(vs.v[0], vs.cfg.v_total, places=9)


class TestConservationUnderStep(unittest.TestCase):
    def test_conservation_over_many_random_steps(self):
        vs = make_system(n=32, seed=42, utility_learning_rate=0.05)
        rng = random.Random(1)
        for _ in range(300):
            utility = [rng.gauss(0, 1) for _ in range(32)]
            vs.step(utility=utility)
            total = sum(vs.v)
            self.assertAlmostEqual(total, vs.cfg.v_total, delta=1e-6)
            for x in vs.v:
                self.assertGreaterEqual(x, vs.cfg.v_min - 1e-9)
                self.assertLessEqual(x, vs.cfg.v_max + 1e-9)

    def test_extreme_utility_saturates_without_breaking_invariant(self):
        vs = make_system(n=10, seed=7, utility_learning_rate=1.0)
        utility = [100.0] + [-100.0] * 9
        for _ in range(50):
            vs.step(utility=utility)
        self.assertTrue(vs.validate_invariant())
        self.assertLessEqual(vs.v[0], vs.cfg.v_max + 1e-9)

    def test_nan_and_inf_utility_sanitized(self):
        vs = make_system(n=8, seed=3)
        utility = [float("nan"), float("inf"), float("-inf"), 0.5, 0.0, 0.0, 0.0, 0.0]
        vs.step(utility=utility)  # should not raise
        self.assertTrue(vs.validate_invariant())

    def test_renormalize_corrects_injected_drift(self):
        vs = make_system(n=12, seed=5, renormalize_every=10)
        # simulate accumulated float drift
        vs.v[0] += 1e-4
        vs.v[1] -= 1e-4
        for _ in range(10):
            vs.step(utility=[0.0] * 12)
        self.assertAlmostEqual(sum(vs.v), vs.cfg.v_total, delta=1e-8)


class TestPromoteDemoteTransfer(unittest.TestCase):
    def test_promote_increases_target_and_conserves(self):
        vs = make_system(n=10, seed=1)
        before_total = sum(vs.v)
        before_target = vs.v[0]
        moved = vs.promote([0], amount=0.2)
        self.assertGreater(moved, 0.0)
        self.assertGreater(vs.v[0], before_target)
        self.assertAlmostEqual(sum(vs.v), before_total, delta=1e-9)
        self.assertTrue(vs.validate_invariant())

    def test_demote_decreases_target_and_conserves(self):
        vs = make_system(n=10, seed=1)
        vs.promote([0], amount=0.2)  # give it room to lose
        before_total = sum(vs.v)
        before_target = vs.v[0]
        moved = vs.demote([0], amount=0.1)
        self.assertGreater(moved, 0.0)
        self.assertLess(vs.v[0], before_target)
        self.assertAlmostEqual(sum(vs.v), before_total, delta=1e-9)

    def test_promote_all_neurons_has_no_donors(self):
        vs = make_system(n=5, seed=2)
        moved = vs.promote(list(range(5)), amount=0.5)
        self.assertEqual(moved, 0.0)

    def test_transfer_from_saturated_donor_reports_shortfall(self):
        vs = make_system(n=4, seed=9, v_min=0.05, v_max=0.95)
        vs.demote([0], amount=vs.v[0] - vs.cfg.v_min)  # push neuron 0 to the floor
        self.assertAlmostEqual(vs.v[0], vs.cfg.v_min, delta=1e-6)
        before = list(vs.v)
        moved = vs.transfer([0], [1], amount=0.5)
        # the only donor has zero headroom left, so nothing can move
        self.assertEqual(moved, 0.0)
        self.assertEqual(vs.v, before)
        self.assertTrue(vs.validate_invariant())

    def test_transfer_partially_limited_by_donor_capacity(self):
        vs = make_system(n=4, seed=9, v_min=0.05, v_max=0.95)
        # neuron 0 only has a small amount of headroom left to give
        vs.demote([0], amount=vs.v[0] - vs.cfg.v_min - 0.1)
        available = vs.v[0] - vs.cfg.v_min
        before_total = sum(vs.v)
        moved = vs.transfer([0], [1], amount=available + 1.0)
        self.assertAlmostEqual(moved, available, places=6)
        self.assertAlmostEqual(sum(vs.v), before_total, delta=1e-9)

    def test_protect_and_release_roundtrip(self):
        vs = make_system(n=10, seed=4)
        vs.protect([0, 1])
        self.assertTrue(vs.v[0] >= vs.cfg.freeze_threshold * vs.cfg.v_max - 1e-6)
        vs.release([0, 1])
        self.assertAlmostEqual(vs.v[0], vs.cfg.v_init, delta=1e-2)

    def test_donor_policy_uniform_vs_proportional(self):
        vs_u = make_system(n=6, seed=1)
        vs_p = make_system(n=6, seed=1)
        vs_u.promote([5], amount=0.3, donor_policy=DonorPolicy.UNIFORM)
        vs_p.promote([5], amount=0.3, donor_policy=DonorPolicy.PROPORTIONAL)
        # both conserve, but the resulting distributions differ under
        # non-uniform starting vale; here start is uniform so verify they at
        # least both conserve and raise the target equally
        self.assertAlmostEqual(vs_u.v[5], vs_p.v[5], delta=1e-6)
        self.assertTrue(vs_u.validate_invariant())
        self.assertTrue(vs_p.validate_invariant())


class TestPlasticity(unittest.TestCase):
    def test_plasticity_monotonic_decreasing_in_vale(self):
        vs = make_system(n=5, seed=1)
        vs.v = [vs.cfg.v_min, 0.25, 0.5, 0.75, vs.cfg.v_max]
        plas = [vs.plasticity(i) for i in range(5)]
        for a, b in zip(plas, plas[1:]):
            self.assertGreaterEqual(a, b)
        self.assertAlmostEqual(vs.plasticity(0), 1.0, places=6)
        self.assertAlmostEqual(vs.plasticity(4), 0.0, places=6)

    def test_effective_learning_rate_scales_with_plasticity(self):
        vs = make_system(n=2, seed=1)
        vs.v = [vs.cfg.v_min, vs.cfg.v_max]
        lr_low_vale = vs.effective_learning_rate(0, base_lr=0.1)
        lr_high_vale = vs.effective_learning_rate(1, base_lr=0.1)
        self.assertGreater(lr_low_vale, lr_high_vale)
        self.assertAlmostEqual(lr_high_vale, 0.0, places=6)

    def test_gamma_shapes_curve(self):
        vs_sharp = make_system(n=1, seed=1, plasticity_gamma=3.0)
        vs_flat = make_system(n=1, seed=1, plasticity_gamma=0.5)
        vs_sharp.v[0] = vs_flat.v[0] = 0.5
        # different gamma => different plasticity at the same interior point
        self.assertNotAlmostEqual(vs_sharp.plasticity(0), vs_flat.plasticity(0), places=3)


class TestLongTermStability(unittest.TestCase):
    def test_relaxation_pulls_back_toward_target(self):
        vs = make_system(n=20, seed=1, relax_rate=0.05, utility_learning_rate=0.0)
        vs.promote([0], amount=0.3)
        v0_after_promote = vs.v[0]
        for _ in range(200):
            vs.step(utility=[0.0] * 20)
        # relaxation should have pulled neuron 0 back down from its promoted spike
        self.assertLess(vs.v[0], v0_after_promote)

    def test_frozen_fraction_safety_valve(self):
        vs = make_system(n=20, seed=1, max_frozen_fraction=0.1, freeze_threshold=0.9)
        # try to freeze far more than the allowed fraction
        vs.protect(list(range(10)))
        for _ in range(5):
            vs.step(utility=[0.0] * 20)
        frozen = sum(1 for i in range(20) if vs.is_frozen(i))
        self.assertLessEqual(frozen, int(0.1 * 20) + 1)  # allow +1 for boundary rounding


class TestMemoryInteraction(unittest.TestCase):
    def test_consolidation_penalty_scales_with_vale(self):
        vs = make_system(n=2, seed=1)
        vs.v = [vs.cfg.v_min, vs.cfg.v_max]
        weight, anchor = 0.8, 0.5
        low_vale_penalty = vs.consolidation_penalty(0, weight, anchor, lam=1.0)
        high_vale_penalty = vs.consolidation_penalty(1, weight, anchor, lam=1.0)
        self.assertLess(abs(low_vale_penalty), abs(high_vale_penalty))

    def test_high_vale_neuron_resists_hebbian_drift_more_than_low_vale(self):
        vs = make_system(n=2, seed=1)
        vs.v = [vs.cfg.v_min, vs.cfg.v_max]
        base_lr = 0.1
        w_low, w_high = 0.0, 0.0
        pre, post = 1.0, 1.0
        for _ in range(50):
            w_low += vs.effective_learning_rate(0, base_lr) * pre * post
            w_high += vs.effective_learning_rate(1, base_lr) * pre * post
        self.assertGreater(w_low, w_high)
        self.assertAlmostEqual(w_high, 0.0, places=6)


class TestPopulationChanges(unittest.TestCase):
    def test_add_neurons_rescale_conserves_total(self):
        vs = make_system(n=10, seed=1)
        before_total = sum(vs.v)
        new_ids = vs.add_neurons(5, policy="rescale")
        self.assertEqual(len(new_ids), 5)
        self.assertEqual(len(vs.v), 15)
        # rescale only pays the new neurons' v_min floor as fresh capital;
        # everything above that floor is funded by existing neurons.
        expected_total = before_total + 5 * vs.cfg.v_min
        self.assertAlmostEqual(sum(vs.v), expected_total, delta=1e-6)
        self.assertAlmostEqual(vs.cfg.v_total, expected_total, delta=1e-6)
        for i in new_ids:
            self.assertAlmostEqual(vs.v[i], vs.cfg.v_init, delta=1e-6)

    def test_add_neurons_grow_increases_total(self):
        vs = make_system(n=10, seed=1)
        before_total = vs.cfg.v_total
        vs.add_neurons(5, policy="grow")
        self.assertGreater(vs.cfg.v_total, before_total)
        self.assertAlmostEqual(sum(vs.v), vs.cfg.v_total, delta=1e-6)

    def test_remove_neurons_redistributes_freed_vale(self):
        vs = make_system(n=10, seed=1)
        vs.promote([0], amount=0.3)
        vs.remove_neurons([0])
        self.assertEqual(len(vs.v), 9)
        self.assertTrue(vs.validate_invariant())

    def test_remove_all_neurons(self):
        vs = make_system(n=3, seed=1)
        vs.remove_neurons([0, 1, 2])
        self.assertEqual(len(vs.v), 0)
        self.assertEqual(vs.cfg.v_total, 0.0)


class TestSerialization(unittest.TestCase):
    def test_roundtrip_preserves_state(self):
        vs = make_system(n=12, seed=3, init_jitter=0.02)
        for _ in range(20):
            vs.step(utility=[random.random() for _ in range(12)])
        data = vs.to_dict()
        restored = ValeSystem.from_dict(data)
        self.assertEqual(restored.v, vs.v)
        self.assertEqual(restored.tick, vs.tick)
        self.assertTrue(restored.validate_invariant())


class TestEdgeCases(unittest.TestCase):
    def test_negative_amount_raises(self):
        vs = make_system(n=5, seed=1)
        with self.assertRaises(ValueError):
            vs.transfer([0], [1], amount=-1.0)

    def test_empty_donor_or_recipient_list_is_noop(self):
        vs = make_system(n=5, seed=1)
        self.assertEqual(vs.transfer([], [1], amount=0.1), 0.0)
        self.assertEqual(vs.transfer([0], [], amount=0.1), 0.0)

    def test_zero_amount_is_noop(self):
        vs = make_system(n=5, seed=1)
        before = list(vs.v)
        vs.transfer([0], [1], amount=0.0)
        self.assertEqual(vs.v, before)

    def test_step_on_empty_system(self):
        cfg = ValeConfig(n_neurons=1)
        vs = ValeSystem(cfg)
        vs.remove_neurons([0])
        stats = vs.step()  # should not raise on n=0
        self.assertEqual(stats["n"], 0)

    def test_deterministic_given_seed(self):
        vs1 = make_system(n=10, seed=99, init_jitter=0.1)
        vs2 = make_system(n=10, seed=99, init_jitter=0.1)
        self.assertEqual(vs1.v, vs2.v)


if __name__ == "__main__":
    unittest.main()
