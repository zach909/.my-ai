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


class TestEnergySystemDoesNotWasteExtractedEnergy(unittest.TestCase):
    def test_completed_material_is_not_mostly_wasted_as_heat(self):
        # update()'s processing-completion branch extracted a material's
        # full energy_content*mass*0.8 as a lump sum on a single tick, then
        # called battery.charge(energy_extracted, dt) exactly once --
        # EnergyStore.charge()'s charge_rate caps how much a *single call*
        # can accept (charge_rate * dt), so nearly the entire lump sum was
        # rejected and immediately written off as waste_heat, destroying
        # ~99.9% of a material's energy the instant conversion finished,
        # purely because the charging circuit couldn't accept it all in one
        # tick -- not because it was ever genuinely unrecoverable.
        energy = EnergySystem(storage_capacity=10000.0)
        material = Material(
            name="glucose_pack", material_type=MaterialType.ORGANIC,
            energy_content=400.0, mass=50.0, processing_time=10.0,
        )
        energy.consume_material(material)

        # Drive processing to completion (10s at dt=0.1 = 100 ticks), then a
        # couple more so pending_energy has a chance to start trickling in.
        for _ in range(102):
            energy.update(dt=0.1)

        expected_extracted = 400.0 * 50.0 * 0.8  # 16000 J
        self.assertAlmostEqual(energy.total_energy_processed, expected_extracted, places=3,
            msg="test setup should have actually extracted the material's energy")
        self.assertLess(energy.waste_heat, expected_extracted * 0.1,
            "completing a material must not immediately write off nearly all its "
            "extracted energy as waste_heat just because charge_rate is slower than "
            "a single tick -- undelivered energy must be retried on later ticks instead")
        self.assertGreater(energy.pending_energy + energy.battery.current, 0.0,
            "the extracted energy must still exist somewhere (stored or pending), not vanish")

    def test_pending_energy_eventually_reaches_the_battery(self):
        energy = EnergySystem(storage_capacity=20000.0)
        material = Material(
            name="glucose_pack", material_type=MaterialType.ORGANIC,
            energy_content=400.0, mass=50.0, processing_time=10.0,
        )
        energy.consume_material(material)

        for _ in range(100):
            energy.update(dt=0.1)
        self.assertEqual(energy.currently_processing, None,
            "test setup should have actually completed processing")

        # Keep an active consumer disabled so nothing drains what charges in.
        for consumer in energy.consumers.values():
            consumer.active = False

        # Run enough further ticks for charge_rate to deliver the full
        # extracted amount (charge_rate=100 J/s, efficiency=0.95 -> plenty
        # of ticks at dt=0.1 to move 16000 J).
        for _ in range(2000):
            energy.update(dt=0.1)

        self.assertAlmostEqual(energy.pending_energy, 0.0, places=3,
            msg="pending_energy must fully drain into the battery given enough ticks")
        self.assertGreater(energy.battery.current, 15000.0,
            "nearly all extracted energy must actually reach the battery, not be lost")


if __name__ == '__main__':
    unittest.main()
