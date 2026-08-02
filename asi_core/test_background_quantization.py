"""Tests for the Background Quantization / Billing System.

Pure-Python reimplementation (no numpy -- see background_quantization.py's
module docstring for why the previous numpy-based version broke `import
asi_core` in any environment without numpy pre-installed).
"""

import unittest

from asi_core.background_quantization import Quantizer, BillingSystem


class TestQuantizeWeights(unittest.TestCase):
    def test_round_trip_reconstructs_within_quantization_error(self):
        q = Quantizer(bits=4)
        weights = [0.0, 0.25, -0.5, 1.0, -1.0, 0.7]
        q_weights, scale, zero_point = q.quantize_weights(weights)
        restored = q.dequantize_weights(q_weights, scale, zero_point)

        # 4-bit range is only 16 levels across the [-1, 1] span here, so
        # allow a generous but bounded reconstruction error.
        max_error = (max(weights) - min(weights)) / (2 ** 4)
        for original, back in zip(weights, restored):
            self.assertLessEqual(abs(original - back), max_error * 1.5 + 1e-9)

    def test_quantized_values_are_within_bit_range(self):
        q = Quantizer(bits=4)
        q_weights, _, _ = q.quantize_weights([-5.0, 0.0, 5.0, 2.5, -2.5])
        for v in q_weights:
            self.assertGreaterEqual(v, q.qmin)
            self.assertLessEqual(v, q.qmax)
            self.assertIsInstance(v, int)

    def test_constant_weights_do_not_divide_by_zero(self):
        q = Quantizer(bits=4)
        q_weights, scale, zero_point = q.quantize_weights([0.5, 0.5, 0.5])
        self.assertEqual(q_weights, [0, 0, 0])
        self.assertEqual(scale, 1.0)

    def test_empty_weights_handled(self):
        q = Quantizer(bits=4)
        q_weights, scale, zero_point = q.quantize_weights([])
        self.assertEqual(q_weights, [])

    def test_nested_shape_is_preserved_through_round_trip(self):
        q = Quantizer(bits=4)
        weights = [[0.1, 0.2], [0.3, 0.4], [-0.5, -0.6]]
        q_weights, scale, zero_point = q.quantize_weights(weights)
        self.assertEqual(len(q_weights), 3)
        self.assertEqual(len(q_weights[0]), 2)
        restored = q.dequantize_weights(q_weights, scale, zero_point)
        self.assertEqual(len(restored), 3)
        self.assertEqual(len(restored[0]), 2)


class TestQuantizeExtension(unittest.TestCase):
    def test_quantize_extension_produces_layer_bundle(self):
        q = Quantizer(bits=4)
        extension_data = {
            "name": "vision_expert",
            "weights": {
                "layer_a": [0.1, 0.2, 0.3, 0.4],
                "layer_b": [[1.0, -1.0], [0.5, -0.5]],
            },
            "metadata": {"task": "vision"},
        }
        bundle = q.quantize_extension(extension_data)

        self.assertEqual(bundle["name"], "vision_expert")
        self.assertEqual(bundle["bits"], 4)
        self.assertEqual({l["layer_name"] for l in bundle["layers"]}, {"layer_a", "layer_b"})
        self.assertGreater(bundle["original_size_bytes"], 0)
        self.assertGreater(bundle["quantized_size_bytes"], 0)
        # 4-bit packing should always compress relative to float32.
        self.assertGreater(bundle["compression_ratio"], 1.0)

    def test_load_quantized_extension_restores_all_layers(self):
        q = Quantizer(bits=4)
        extension_data = {
            "name": "coder",
            "weights": {"w": [0.1, 0.9, -0.9, 0.0]},
        }
        bundle = q.quantize_extension(extension_data)
        restored = q.load_quantized_extension(bundle)
        self.assertIn("w", restored)
        self.assertEqual(len(restored["w"]), 4)


class TestBillingSystem(unittest.TestCase):
    def test_bill_extension_returns_quantized_bundle(self):
        billing = BillingSystem()
        bundle = billing.bill_extension(
            name="image_generator_v1",
            raw_weights={"dense": [0.1, 0.5, -0.2, 0.8]},
            metadata={"task": "image_generation"},
        )
        self.assertEqual(bundle["name"], "image_generator_v1")
        self.assertIn(bundle, billing.billed_extensions)
        self.assertEqual(len(billing.billed_extensions), 1)


if __name__ == "__main__":
    unittest.main()
