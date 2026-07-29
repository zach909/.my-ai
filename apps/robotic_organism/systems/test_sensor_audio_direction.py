"""
Regression test for SensorArray.update_audio()'s binaural direction estimate.

The line
    direction = (left_sample.direction or 0 + right_sample.direction or 0) / 2
parses, by Python's operator precedence (`+` binds tighter than `or`), as
    direction = (left_sample.direction or (0 + right_sample.direction) or 0) / 2
so whenever left_sample.direction is truthy (essentially always, since it's
math.sin(timestamp * 0.3) * math.pi / 4 -- zero only at exact multiples of
timestamp that hit a sine zero-crossing), the `or` short-circuits on the
first operand and right_sample.direction is never even added. Both ears
compute direction from the same timestamp with no per-ear offset in this
simplified simulation, so left and right are always numerically equal --
which makes the bug's effect exact and deterministic: the buggy expression
always returns exactly half of the correct average, not just "wrong" in a
data-dependent way.
"""

import math
import unittest

from robotic_organism.systems.sensors import SensorArray


class TestSensorAudioDirectionIsNotHalved(unittest.TestCase):
    def test_estimated_direction_matches_true_average(self):
        sensors = SensorArray()
        timestamp = 12.5  # arbitrary, non-zero-crossing instant

        result = sensors.update_audio(timestamp=timestamp)

        expected_per_ear = math.sin(timestamp * 0.3) * math.pi / 4
        expected_direction = (expected_per_ear + expected_per_ear) / 2  # == expected_per_ear

        self.assertAlmostEqual(result['estimated_direction'], expected_direction, places=9,
            msg="estimated_direction must be the true average of both ears' readings, "
                "not silently halved by an operator-precedence bug in the or-chain")


if __name__ == '__main__':
    unittest.main()
