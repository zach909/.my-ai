"""
Regression test for NeuralController.process_sensory_input().

_create_basic_connections() wired each thalamus neuron's OUTPUT connections
(to cortex neurons) but never gave the thalamus neuron itself a weight for
the 'sensor_i' key it gets activated with in process_sensory_input(). Since
Neuron.activate() looks up each input's weight via
self.inputs.get(source_id, 0.0) and falls back to 0.0 when the key is
missing, every thalamus neuron's activation silently collapsed to a
constant sigmoid(0) = 0.5, no matter what the real sensor-derived value
was -- the "artificial brain" was structurally incapable of reacting to
its own body/environment, contradicting the module's own stated design
("The brain receives information about the entire body...").
"""

import unittest

from robotic_organism.systems.neural import NeuralController, BrainRegion


class TestNeuralControllerReactsToSensoryInput(unittest.TestCase):
    def test_thalamus_activation_varies_with_sensor_value(self):
        nc = NeuralController(neuron_count=200)
        thalamus = nc.regions[BrainRegion.THALAMUS]
        self.assertGreater(len(thalamus), 0, "test setup should have thalamus neurons to check")

        empty_channels = {'vision': {}, 'audio': {}, 'tactile': {}, 'proprioception': {}, 'internal': {}}
        nc.process_sensory_input(empty_channels)
        low_activation = nc.neurons[thalamus[0]].activation

        big_channel = {f'k{i}': i for i in range(10)}
        full_channels = {k: big_channel for k in ('vision', 'audio', 'tactile', 'proprioception', 'internal')}
        nc.process_sensory_input(full_channels)
        high_activation = nc.neurons[thalamus[0]].activation

        self.assertNotEqual(low_activation, high_activation,
            "a thalamus neuron's activation must actually change with the real sensor-derived "
            "value, not collapse to a constant sigmoid(0) = 0.5 regardless of sensory input")


if __name__ == '__main__':
    unittest.main()
