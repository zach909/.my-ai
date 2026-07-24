"""
Regression tests for EnergySystem.material_buffer.

consume_material() only ever appended to material_buffer -- nothing anywhere
drained or capped it, so it grew forever, one entry per feeding, for the
entire lifetime of any long-running simulation. The only other reference to
it was a len() count in get_status(), so the leak was purely dead weight:
the actual energy-extraction logic (update()) only ever reads from the
separate processing_queue, which ArtificialOrganism.consume_material() also
populated directly via a redundant start_processing() call on the same
Material object -- the same "unbounded growth on a hot path" bug class
already found and fixed in this package's repair.py/transport.py, just never
previously found in energy.py because that file had the same "never examined
beyond does it import" history.
"""

import unittest

from robotic_organism.systems.energy import EnergySystem, Material, MaterialType
from robotic_organism.core.organism import ArtificialOrganism


class TestEnergySystemDoesNotLeak(unittest.TestCase):
    def test_material_buffer_drains_into_processing_queue(self):
        energy = EnergySystem()
        for i in range(20):
            energy.consume_material(Material(
                name=f"food_{i}", material_type=MaterialType.ORGANIC,
                energy_content=100.0, mass=10.0, processing_time=10.0,
            ))

        self.assertEqual(len(energy.material_buffer), 20,
            "test setup should actually have buffered material before any update() drains it")

        energy.update(dt=0.1)

        self.assertEqual(len(energy.material_buffer), 0,
            "material_buffer must be drained by update(), not kept forever")
        # One material is popped straight into currently_processing by the
        # same update() call, so the queue holds the rest.
        self.assertEqual(len(energy.processing_queue), 19)
        self.assertIsNotNone(energy.currently_processing)
        self.assertEqual(energy.currently_processing.name, "food_0")

    def test_material_buffer_stays_bounded_across_many_ticks(self):
        energy = EnergySystem()
        for i in range(50):
            energy.consume_material(Material(
                name=f"food_{i}", material_type=MaterialType.ORGANIC,
                energy_content=100.0, mass=10.0, processing_time=10.0,
            ))
            energy.update(dt=0.1)

        self.assertEqual(len(energy.material_buffer), 0,
            "material_buffer must not accumulate across repeated feed/update cycles")


class TestArtificialOrganismDoesNotDoubleQueueMaterial(unittest.TestCase):
    def test_consume_material_does_not_double_insert(self):
        # ArtificialOrganism.consume_material() used to call both
        # energy_system.consume_material() (buffer) AND
        # energy_system.start_processing() (queue) on the same Material,
        # so every feeding was queued for processing twice over.
        o = ArtificialOrganism("Test")
        for i in range(10):
            o.consume_material(f"food_{i}", "organic", mass=10.0, energy_content=100.0)
            o.update(dt=0.1)

        total_tracked = (
            len(o.energy_system.material_buffer)
            + len(o.energy_system.processing_queue)
            + (1 if o.energy_system.currently_processing else 0)
        )
        # 10 feedings, 1 update() each: one material is being processed, the
        # rest sit in the queue. Never more than 10 Material objects total.
        self.assertLessEqual(total_tracked, 10,
            "each feeding must be tracked once, not queued for processing twice over")


if __name__ == '__main__':
    unittest.main()
