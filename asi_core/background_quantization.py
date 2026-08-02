"""
Background Quantization System
------------------------------
Purpose: Runs the model after "billing" (consolidation).
Why: Faster inference and significant power savings.
Mechanism: Converts float32 weights to int4 (4-bit) while preserving range via scale/zero-point.
Example: When an extension is finished learning, it is quantized before being saved to disk.
"""

import numpy as np
import json
from typing import Dict, Any, Tuple, Optional

class Quantizer:
    """
    Handles background quantization for extensions and neural states.
    Supports 4-bit (int4) quantization for maximum efficiency.
    """
    
    def __init__(self, bits: int = 4):
        self.bits = bits
        self.qmin = -(2 ** (bits - 1))
        self.qmax = (2 ** (bits - 1)) - 1
        
    def quantize_weights(self, weights: np.ndarray) -> Tuple[np.ndarray, float, float]:
        """
        Converts float32 weights to int4.
        Returns: (quantized_weights, scale, zero_point)
        
        Math: 
          scale = (max - min) / (qmax - qmin)
          q_weight = round((weight / scale) + zero_point)
        """
        if weights.size == 0:
            return weights.astype(np.int8), 1.0, 0
            
        w_min = weights.min()
        w_max = weights.max()
        
        # Avoid division by zero if all weights are same
        if w_max == w_min:
            return np.zeros_like(weights, dtype=np.int8), 1.0, 0
            
        scale = (w_max - w_min) / (self.qmax - self.qmin)
        zero_point = self.qmin - (w_min / scale)
        
        # Quantize
        q_weights = np.round((weights / scale) + zero_point)
        q_weights = np.clip(q_weights, self.qmin, self.qmax)
        
        return q_weights.astype(np.int8), scale, zero_point

    def dequantize_weights(self, q_weights: np.ndarray, scale: float, zero_point: float) -> np.ndarray:
        """
        Reconstructs float32 approximations from int4.
        Math: weight = scale * (q_weight - zero_point)
        """
        return scale * (q_weights.astype(np.float32) - zero_point)

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
            {"weights": "<base64_or_list>", "scale": float, "zero_point": float}
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
                if isinstance(weights, list):
                    weights = np.array(weights)
                
                q_weights, scale, zp = self.quantize_weights(weights)
                
                # Calculate sizes
                orig_bytes = weights.nbytes
                # 4 bits per element = 0.5 bytes per element
                quant_bytes = int(q_weights.nbytes * (self.bits / 8)) 
                
                total_orig += orig_bytes
                total_quant += quant_bytes
                
                quantized_bundle["layers"].append({
                    "layer_name": layer_name,
                    "shape": list(q_weights.shape),
                    "data": q_weights.flatten().tolist(), # Stored as small ints
                    "scale": float(scale),
                    "zero_point": float(zp)
                })
        
        quantized_bundle["original_size_bytes"] = total_orig
        quantized_bundle["quantized_size_bytes"] = total_quant
        quantized_bundle["compression_ratio"] = total_orig / max(total_quant, 1)
        
        return quantized_bundle

    def load_quantized_extension(self, bundle: Dict[str, Any]) -> Dict[str, np.ndarray]:
        """
        Loads a quantized bundle back into memory as float32 for execution.
        """
        restored_weights = {}
        
        for layer in bundle.get("layers", []):
            shape = tuple(layer["shape"])
            data = np.array(layer["data"], dtype=np.int8).reshape(shape)
            
            weights = self.dequantize_weights(data, layer["scale"], layer["zero_point"])
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
        
    def bill_extension(self, name: str, raw_weights: Dict[str, np.ndarray], metadata: Optional[Dict] = None) -> Dict:
        """
        Process:
        1. Take raw learned weights (float32).
        2. Quantize to 4-bit.
        3. Report power/memory savings.
        4. Return the package ready for disk.
        """
        print(f"\n[BILLING] Processing extension: {name}")
        
        extension_package = {
            "name": name,
            "weights": raw_weights,
            "metadata": metadata or {}
        }
        
        # Perform Quantization
        quantized_bundle = self.quantizer.quantize_extension(extension_package)
        
        # Log Savings
        ratio = quantized_bundle["compression_ratio"]
        orig_kb = quantized_bundle["original_size_bytes"] / 1024
        quant_kb = quantized_bundle["quantized_size_bytes"] / 1024
        
        print(f"  > Original Size: {orig_kb:.2f} KB")
        print(f"  > Quantized Size: {quant_kb:.2f} KB")
        print(f"  > Compression Ratio: {ratio:.2f}x")
        print(f"  > Power Saving Estimate: ~{((1 - 1/ratio) * 100):.1f}% less memory bandwidth")
        
        self.billed_extensions.append(quantized_bundle)
        
        return quantized_bundle


# --- Demonstration of Background Quantization ---
if __name__ == "__main__":
    billing = BillingSystem()
    
    # Simulate an extension that just learned "Image Generation"
    # These are float32 weights taking up significant space
    mock_weights = {
        "conv_layer_1": np.random.randn(64, 3, 3, 3).astype(np.float32), # 1.7KB
        "dense_layer_1": np.random.randn(128, 64).astype(np.float32),    # 32KB
        "output_head": np.random.randn(10, 128).astype(np.float32)       # 5KB
    }
    
    # Execute Billing (Quantization)
    final_package = billing.bill_extension(
        name="image_generator_v1", 
        raw_weights=mock_weights,
        metadata={"task": "image_generation", "created_by": "ASI"}
    )
    
    # Verify we can restore it
    restored = billing.quantizer.load_quantized_extension(final_package)
    
    print("\n[VERIFICATION]")
    print(f"Restored {len(restored)} layers successfully.")
    print(f"Max error in restoration: {np.max(np.abs(restored['dense_layer_1'] - mock_weights['dense_layer_1'])):.6f}")
    print("Background Quantization Complete. Extension ready for low-power execution.")
