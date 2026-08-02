"""
Background Quantization System
------------------------------
Purpose: Runs the model after "billing" (consolidation).
Why: Faster inference and significant power savings.
Mechanism: Converts float32 weights to int4 (4-bit) while preserving range via scale/zero-point.
Example: When an extension is finished learning, it is quantized before being saved to disk.

Pure Python (no numpy): asi_core has no declared external numeric
dependency anywhere else (hyperdim_thinking.py, neural_mesh.py, etc. are
all plain Python), and this module previously hard-imported numpy
unconditionally at module scope with no requirements.txt anywhere
declaring it -- meaning `import asi_core` raised ModuleNotFoundError in
any environment without numpy pre-installed (including this one), taking
the entire package down with it. Reimplemented here with plain
lists/math so the module (and therefore the package) actually imports.
"""

import math
from typing import Any, Dict, List, Tuple, Optional, Union

Nested = Union[float, List[Any]]


def _flatten(nested: Nested) -> List[float]:
    """Flatten an arbitrarily-nested list of numbers into a flat list."""
    if isinstance(nested, (list, tuple)):
        out: List[float] = []
        for item in nested:
            out.extend(_flatten(item))
        return out
    return [float(nested)]


def _shape(nested: Nested) -> Tuple[int, ...]:
    """Infer the shape of a (rectangular) nested list, numpy-`array.shape`-style."""
    if isinstance(nested, (list, tuple)):
        if len(nested) == 0:
            return (0,)
        return (len(nested),) + _shape(nested[0])
    return ()


def _reshape(flat: List[float], shape: Tuple[int, ...]) -> Nested:
    """Inverse of `_flatten` given the original shape."""
    if len(shape) == 0:
        return flat[0]
    if len(shape) == 1:
        return list(flat[: shape[0]])
    size = 1
    for d in shape[1:]:
        size *= d
    out = []
    for i in range(shape[0]):
        out.append(_reshape(flat[i * size:(i + 1) * size], shape[1:]))
    return out


class Quantizer:
    """
    Handles background quantization for extensions and neural states.
    Supports 4-bit (int4) quantization for maximum efficiency.
    """

    def __init__(self, bits: int = 4):
        self.bits = bits
        self.qmin = -(2 ** (bits - 1))
        self.qmax = (2 ** (bits - 1)) - 1

    def quantize_weights(self, weights: Nested) -> Tuple[Nested, float, float]:
        """
        Converts float weights (any nested-list shape) to int4-range
        integers stored as plain ints.
        Returns: (quantized_weights, scale, zero_point)

        Math:
          scale = (max - min) / (qmax - qmin)
          q_weight = round((weight / scale) + zero_point)
        """
        shape = _shape(weights)
        flat = _flatten(weights) if shape != (0,) else []

        if not flat:
            return _reshape([], shape) if shape != (0,) else [], 1.0, 0

        w_min = min(flat)
        w_max = max(flat)

        # Avoid division by zero if all weights are same
        if w_max == w_min:
            zeros = [0 for _ in flat]
            return _reshape(zeros, shape), 1.0, 0

        scale = (w_max - w_min) / (self.qmax - self.qmin)
        zero_point = self.qmin - (w_min / scale)

        q_flat = []
        for w in flat:
            q = round((w / scale) + zero_point)
            q = max(self.qmin, min(self.qmax, q))
            q_flat.append(int(q))

        return _reshape(q_flat, shape), scale, zero_point

    def dequantize_weights(self, q_weights: Nested, scale: float, zero_point: float) -> Nested:
        """
        Reconstructs float approximations from int4.
        Math: weight = scale * (q_weight - zero_point)
        """
        shape = _shape(q_weights)
        flat = _flatten(q_weights)
        restored = [scale * (q - zero_point) for q in flat]
        return _reshape(restored, shape)

    def quantize_extension(self, extension_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Takes a full extension dictionary (with float weights) and converts it
        to a quantized bundle ready for disk storage.

        Structure:
        {
          "name": "...",
          "type": "quantized_extension",
          "bits": 4,
          "layers": [
            {"weights": "<list>", "scale": float, "zero_point": float}
          ],
          "metadata": {...}
        }
        """
        quantized_bundle = {
            "name": extension_data.get("name", "unknown"),
            "type": "quantized_extension",
            "bits": self.bits,
            "original_size_bytes": 0,
            "quantized_size_bytes": 0,
            "layers": [],
            "metadata": extension_data.get("metadata", {})
        }

        total_orig = 0
        total_quant = 0

        # Process weights in the extension
        if "weights" in extension_data:
            for layer_name, weights in extension_data["weights"].items():
                flat = _flatten(weights)
                shape = _shape(weights)

                q_weights, scale, zp = self.quantize_weights(weights)

                # Calculate sizes: float32 (4 bytes/elem) vs `bits`-bit packed
                orig_bytes = len(flat) * 4
                quant_bytes = int(len(flat) * (self.bits / 8))

                total_orig += orig_bytes
                total_quant += quant_bytes

                quantized_bundle["layers"].append({
                    "layer_name": layer_name,
                    "shape": list(shape),
                    "data": _flatten(q_weights),
                    "scale": float(scale),
                    "zero_point": float(zp)
                })

        quantized_bundle["original_size_bytes"] = total_orig
        quantized_bundle["quantized_size_bytes"] = total_quant
        quantized_bundle["compression_ratio"] = total_orig / max(total_quant, 1)

        return quantized_bundle

    def load_quantized_extension(self, bundle: Dict[str, Any]) -> Dict[str, Nested]:
        """
        Loads a quantized bundle back into memory as floats for execution.
        """
        restored_weights = {}

        for layer in bundle.get("layers", []):
            shape = tuple(layer["shape"])
            data = layer["data"]

            weights = self.dequantize_weights(_reshape(data, shape), layer["scale"], layer["zero_point"])
            restored_weights[layer["layer_name"]] = weights

        return restored_weights


class BillingSystem:
    """
    The 'Billing' process.
    When the AI finishes learning a task (an Extension), it sends it here
    to be quantized before permanent storage.
    """

    def __init__(self):
        self.quantizer = Quantizer(bits=4)
        self.billed_extensions = []

    def bill_extension(self, name: str, raw_weights: Dict[str, Nested], metadata: Optional[Dict] = None) -> Dict:
        """
        Process:
        1. Take raw learned weights (float).
        2. Quantize to 4-bit.
        3. Report power/memory savings.
        4. Return the package ready for disk.
        """
        extension_package = {
            "name": name,
            "weights": raw_weights,
            "metadata": metadata or {}
        }

        # Perform Quantization
        quantized_bundle = self.quantizer.quantize_extension(extension_package)
        self.billed_extensions.append(quantized_bundle)

        return quantized_bundle
