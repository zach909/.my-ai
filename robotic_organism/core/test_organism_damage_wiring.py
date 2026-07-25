"""
Regression test for ArtificialOrganism.detect_damage()'s reporting fan-out.

detect_damage() reported to repair_system, transport_system, and the neural
controller's safety drive, but never to sensor_array -- the only method that
appends to SensorArray.damage_sensors. Since sensor_array.update()/
get_status() surface damage counts as len(self.damage_sensors[...]), every
tick's reported damage_reports/recent_damage silently stayed at 0 forever,
no matter how much real damage the organism took, contradicting sensors.py's
own "the brain receives information about the entire body" docstring.

Also covers a follow-on bug an automated review caught in this same fix:
wiring detect_damage() through to sensor_array made SensorArray.damage_sensors
reachable and growing for the first time, but it was never capped -- the
same "unbounded growth on a hot path" bug class already fixed elsewhere in
this codebase (RepairSystem.repair_history, EnergySystem.material_buffer),
just newly introduced here since this list was previously unreachable dead
code.
"""

import unittest

from robotic_organism.core.organism import ArtificialOrganism


class TestOrganismDamageReachesSensorArray(unittest.TestCase):
    def test_detect_damage_updates_sensor_damage_count(self):
        organism = ArtificialOrganism()
        self.assertEqual(
            organism.sensor_array.get_status()['internal']['recent_damage'], 0,
            "test setup should start with no damage reported")

        organism.detect_damage((1.0, 2.0, 3.0), "tear", 0.4)

        self.assertEqual(
            organism.sensor_array.get_status()['internal']['recent_damage'], 1,
            "the organism's own damage report must reach the sensor array's "
            "damage-sensor bookkeeping, not just the repair/transport systems")

    def test_multiple_damage_events_accumulate_in_sensor_array(self):
        organism = ArtificialOrganism()
        for _ in range(3):
            organism.detect_damage((0.0, 0.0, 0.0), "tear", 0.2)

        self.assertEqual(
            organism.sensor_array.get_status()['internal']['recent_damage'], 3,
            "each real damage event must be individually counted by the "
            "sensor array, not silently dropped")
        self.assertEqual(len(organism.sensor_array.damage_sensors), 3,
            "the underlying damage_sensors list itself must actually grow")

    def test_damage_sensors_list_stays_bounded_across_many_events(self):
        organism = ArtificialOrganism()
        for _ in range(500):
            organism.detect_damage((0.0, 0.0, 0.0), "tear", 0.1)

        self.assertLessEqual(len(organism.sensor_array.damage_sensors), 200,
            "damage_sensors must be capped instead of growing forever now "
            "that detect_damage() actually reaches it on every real event")
        self.assertEqual(
            organism.sensor_array.get_status()['internal']['recent_damage'], 5,
            "the reported recent_damage count (a fixed [-5:] slice) is "
            "unaffected by capping the underlying list to a larger bound")


if __name__ == '__main__':
    unittest.main()
