"""
Regression tests for MuscleFiber.update()'s length-vs-target-length branch.

Both `if current_length > target_length` / `elif current_length < target_length`
branches had no `else`, so once a fiber reached its target length (its normal
resting condition, since movement is stepped by min(remaining, rate*dt) and
lands exactly on target) neither branch ever fired again: `velocity` stayed
stuck at whatever nonzero value it last had, and `state` was left at whatever
CONTRACTING/RELAXING (or the untouched RELAXED default) it happened to be --
MuscleState.CONTRACTED was unreachable dead code. A second, related bug: even
with a naive equality-based `else`, current_length and target_length can be
computed via slightly different floating-point expressions and land a few
ulps apart while physically "at target" -- exact `==`/`<`/`>` comparisons on
floats are unreliable here.
"""

import unittest

from robotic_organism.systems.muscle import MuscleFiber, MuscleState


class TestMuscleFiberSettlesCorrectly(unittest.TestCase):
    def test_full_contraction_settles_to_contracted_with_zero_velocity(self):
        fiber = MuscleFiber(id="test")
        fiber.target_activation = 1.0
        for _ in range(2000):
            fiber.update(dt=0.01)

        self.assertEqual(fiber.state, MuscleState.CONTRACTED,
            "a fiber fully contracted and settled must report CONTRACTED, not stay stuck at "
            "CONTRACTING forever")
        self.assertEqual(fiber.velocity, 0.0,
            "velocity must reset to zero once the fiber stops moving, not stay stuck at its "
            "last nonzero value")

    def test_full_relax_settles_to_relaxed_with_zero_velocity(self):
        fiber = MuscleFiber(id="test")
        fiber.activation = 1.0
        fiber.current_length = fiber.rest_length * (1 - fiber.max_contraction)
        fiber.target_activation = 0.0
        for _ in range(2000):
            fiber.update(dt=0.01)

        self.assertEqual(fiber.state, MuscleState.RELAXED,
            "a fiber fully relaxed and settled must report RELAXED, not stay stuck at "
            "RELAXING forever")
        self.assertEqual(fiber.velocity, 0.0)

    def test_fiber_starting_already_at_target_reports_correct_state(self):
        # current_length is computed via a different floating-point
        # expression than the one update() uses internally for
        # target_length -- exercising the near-equal-but-not-bitwise-equal
        # case that a naive `==`/`<`/`>` comparison would mishandle.
        fiber = MuscleFiber(id="test")
        fiber.activation = 1.0
        fiber.target_activation = 1.0
        fiber.current_length = fiber.rest_length * (1 - fiber.max_contraction)

        fiber.update(dt=0.01)

        self.assertEqual(fiber.state, MuscleState.CONTRACTED,
            "a fiber that starts already at its fully-contracted target length must report "
            "CONTRACTED immediately, not the untouched RELAXED default")
        self.assertAlmostEqual(fiber.velocity, 0.0, places=9)


if __name__ == '__main__':
    unittest.main()
