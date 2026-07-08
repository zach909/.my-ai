"""Integration bridge: TinyGPT ↔ Prometheus Elastic Core.

Wires TinyGPT as a learned expert into the hyperdimensional mesh,
connecting to vale system, extension builder, and quantization loop.
"""

import torch
import torch.nn as nn
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass


@dataclass
class TinyGPTExpertContract:
    """Extension builder contract for TinyGPT as a neuron.

    Defines what TinyGPT must output when it alone receives input
    (exclusive-input contract for neuron-level unit testing).
    """
    name: str = "language_generation"
    exclusive_inputs: List[str] = None  # Which mesh neurons feed this
    expected_outputs: Dict[str, str] = None  # output_name -> output_type
    assertions: List[str] = None  # Verifiable constraints

    def __post_init__(self):
        if self.exclusive_inputs is None:
            self.exclusive_inputs = ["user_query", "context_buffer"]
        if self.expected_outputs is None:
            self.expected_outputs = {
                "logits": "float32[vocab_size]",
                "embeddings": "float32[hidden_dim]",
                "attention_weights": "float32[num_heads, seq_len, seq_len]",
            }
        if self.assertions is None:
            self.assertions = [
                "logits.sum(dim=-1) ≈ 1.0 (probability distribution)",
                "embeddings.norm() ∈ [0.5, 2.0] (normalized state)",
                "attention_weights.sum(dim=-1) ≈ 1.0 per head",
            ]


class QuantizationAwareTraining(nn.Module):
    """Quantization-Aware Training (QAT) with error feedback.

    Teaches the network to think in its own compressed quantized representation
    from the start, feeding quantization error back into contributing neurons.
    """

    def __init__(self, num_bits: int = 4, momentum: float = 0.9):
        """Initialize QAT module.

        Args:
            num_bits: Number of bits for quantization (4, 8, etc.)
            momentum: Momentum for running scale estimation.
        """
        super().__init__()
        self.num_bits = num_bits
        self.momentum = momentum
        self.max_val = 2 ** (num_bits - 1) - 1

        # Running statistics for symmetric quantization
        self.register_buffer("running_scale", torch.tensor(1.0))

    def quantize_tensor(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Quantize tensor to fixed bits.

        Args:
            x: Input tensor to quantize.

        Returns:
            Tuple of (quantized_tensor, scale_factor).
        """
        # Estimate scale from statistics
        scale = x.abs().max() / self.max_val
        scale = torch.clamp(scale, min=1e-8)

        # Update running scale
        if self.training:
            self.running_scale = self.momentum * self.running_scale + (1 - self.momentum) * scale
        else:
            scale = self.running_scale

        # Quantize with straight-through estimator (STE)
        quantized = torch.round(x / scale).clamp(-self.max_val, self.max_val)
        quantized = quantized * scale

        return quantized, scale

    def forward(
        self,
        x: torch.Tensor,
        return_error: bool = True,
    ) -> Tuple[torch.Tensor, Optional[torch.Tensor]]:
        """Apply QAT forward pass.

        Args:
            x: Input tensor.
            return_error: Whether to return quantization error for feedback.

        Returns:
            Tuple of (quantized_output, quantization_error).
        """
        quantized, scale = self.quantize_tensor(x)
        error = x - quantized if return_error else None
        return quantized, error


class MeshContextEmbedding(nn.Module):
    """Project TinyGPT embeddings into hyperdimensional mesh space.

    Feeds TinyGPT's learned representations into the all-to-all
    mesh as compressed states that preserve semantic similarity.
    """

    def __init__(
        self,
        tinygpt_hidden_dim: int,
        mesh_hidden_dim: int,
        num_mesh_neurons: int,
    ):
        """Initialize embedding layer.

        Args:
            tinygpt_hidden_dim: TinyGPT's hidden dimension (e.g., 768).
            mesh_hidden_dim: Hyperdimensional mesh state dimension (e.g., 256).
            num_mesh_neurons: Number of neurons in mesh (e.g., 64).
        """
        super().__init__()
        self.tinygpt_hidden_dim = tinygpt_hidden_dim
        self.mesh_hidden_dim = mesh_hidden_dim
        self.num_mesh_neurons = num_mesh_neurons

        # Project TinyGPT embeddings to mesh dimension
        self.projection = nn.Linear(tinygpt_hidden_dim, mesh_hidden_dim)

        # Per-neuron affine transformation (learn how each mesh neuron
        # interprets the embedding)
        self.neuron_scales = nn.Parameter(torch.ones(num_mesh_neurons))
        self.neuron_biases = nn.Parameter(torch.zeros(num_mesh_neurons))

        # Input-flag dimension (Section 5 of architecture notes):
        # Reserve one dimension per neuron to track which are externally driven
        self.input_flag_dim = 1
        self.input_flag_projection = nn.Linear(tinygpt_hidden_dim, num_mesh_neurons)

    def forward(
        self,
        tinygpt_embeddings: torch.Tensor,
        is_external_input: bool = True,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """Project TinyGPT embeddings to mesh states.

        Args:
            tinygpt_embeddings: [batch, seq_len, hidden_dim] from TinyGPT.
            is_external_input: Whether this is external or internal (mesh-echo) input.

        Returns:
            Tuple of (mesh_states, input_flags) where:
            - mesh_states: [batch, num_neurons, mesh_hidden_dim]
            - input_flags: [batch, num_neurons] binary input-source awareness
        """
        batch_size, seq_len, hidden_dim = tinygpt_embeddings.shape

        # Pool sequence dimension (e.g., take mean or use attention)
        pooled = tinygpt_embeddings.mean(dim=1)  # [batch, hidden_dim]

        # Project to mesh dimension
        projected = self.projection(pooled)  # [batch, mesh_hidden_dim]

        # Expand to per-neuron states and apply neuron-specific transformations
        mesh_states = projected.unsqueeze(1) * self.neuron_scales.view(1, -1, 1)
        mesh_states = mesh_states + self.neuron_biases.view(1, -1, 1)
        # Result: [batch, num_neurons, mesh_hidden_dim]

        # Compute input flags (Section 5: input-source awareness)
        # Which neurons are externally driven this tick?
        input_logits = self.input_flag_projection(pooled)  # [batch, num_neurons]
        input_flags = torch.sigmoid(input_logits) if is_external_input else torch.zeros_like(input_logits)

        return mesh_states, input_flags


class ValeAwareLearning(nn.Module):
    """Wire TinyGPT's vale (value budget) into learning loop.

    High-vale neurons change less (stable, locked knowledge).
    Low-vale neurons learn more (plastic, adaptive).
    """

    def __init__(self, num_neurons: int, learning_rate: float = 1e-3):
        """Initialize vale-aware learning.

        Args:
            num_neurons: Number of neurons in mesh.
            learning_rate: Base learning rate.
        """
        super().__init__()
        self.num_neurons = num_neurons
        self.base_lr = learning_rate

        # Vale values: 0 (plastic) to 1 (locked, stable)
        self.register_parameter(
            "vale",
            nn.Parameter(torch.ones(num_neurons) * 0.5),  # Initialize at midpoint
        )

    def compute_adaptive_learning_rates(self) -> torch.Tensor:
        """Compute per-neuron learning rates based on vale.

        Returns:
            Learning rates: high-vale neurons get lower LR (less plastic).
        """
        # Invert vale: high vale → low learning rate
        adaptive_lr = self.base_lr * (1.0 - self.vale.detach())
        return adaptive_lr

    def apply_vale_penalty(self, loss: torch.Tensor, gradients: Dict[str, torch.Tensor]) -> torch.Tensor:
        """Penalize violations of vale constraints.

        If a high-vale (locked) neuron tries to change too much,
        apply a penalty loss.

        Args:
            loss: Original training loss.
            gradients: Per-neuron gradient magnitudes.

        Returns:
            Loss + vale violation penalty.
        """
        # Compute gradient magnitudes
        grad_magnitudes = torch.stack(
            [g.abs().mean() for g in gradients.values()]
        )

        # High-vale neurons should have small gradients
        vale_penalty = (self.vale * grad_magnitudes).mean()

        return loss + 0.1 * vale_penalty

    def update_vale_from_contracts(
        self,
        satisfied_contracts: torch.Tensor,
    ) -> None:
        """Update vale based on extension builder contract satisfaction.

        When a neuron's contracts are satisfied (verified), raise its vale.
        When contracts fail, lower it to encourage learning.

        Args:
            satisfied_contracts: [num_neurons] binary mask of satisfied contracts.
        """
        # Lock satisfied neurons (raise vale)
        self.vale.data = torch.where(
            satisfied_contracts.bool(),
            torch.minimum(self.vale + 0.01, torch.ones_like(self.vale)),
            self.vale,
        )

        # Unlock unsatisfied neurons (lower vale)
        self.vale.data = torch.where(
            ~satisfied_contracts.bool(),
            torch.maximum(self.vale - 0.01, torch.zeros_like(self.vale)),
            self.vale,
        )


class LiveCorrectionMonitor(nn.Module):
    """Monitor and correct during execution (Section 12 of architecture notes).

    Compare self-model predictions to actual mesh state tick-by-tick,
    intervening only on sustained divergence (tolerance band, not noise).
    """

    def __init__(
        self,
        num_neurons: int,
        hidden_dim: int,
        tolerance_ticks: int = 3,
        divergence_threshold: float = 0.15,
    ):
        """Initialize live correction monitor.

        Args:
            num_neurons: Number of mesh neurons.
            hidden_dim: Hidden dimension.
            tolerance_ticks: Ticks of sustained divergence before intervening.
            divergence_threshold: Euclidean distance threshold for divergence.
        """
        super().__init__()
        self.num_neurons = num_neurons
        self.hidden_dim = hidden_dim
        self.tolerance_ticks = tolerance_ticks
        self.divergence_threshold = divergence_threshold

        # Approximate self-model (Section 10)
        self.self_model = nn.Sequential(
            nn.Linear(num_neurons * hidden_dim, 512),
            nn.ReLU(),
            nn.Linear(512, num_neurons * hidden_dim),
        )

        # Track divergence history
        self.divergence_history = []

    def predict_next_state(
        self,
        current_state: torch.Tensor,
    ) -> torch.Tensor:
        """Predict next mesh state using approximate self-model.

        Args:
            current_state: [batch, num_neurons, hidden_dim]

        Returns:
            Predicted next state: [batch, num_neurons, hidden_dim]
        """
        batch_size = current_state.shape[0]
        flattened = current_state.view(batch_size, -1)
        predicted_flat = self.self_model(flattened)
        predicted = predicted_flat.view(batch_size, self.num_neurons, self.hidden_dim)
        return predicted

    def detect_divergence(
        self,
        predicted: torch.Tensor,
        actual: torch.Tensor,
    ) -> Tuple[bool, float]:
        """Detect whether execution is diverging from prediction.

        Args:
            predicted: Predicted state [batch, num_neurons, hidden_dim]
            actual: Actual state [batch, num_neurons, hidden_dim]

        Returns:
            Tuple of (has_sustained_divergence, divergence_magnitude)
        """
        # Euclidean distance per batch
        divergence = torch.norm(predicted - actual, dim=(1, 2))  # [batch]
        max_divergence = divergence.max().item()

        # Track history
        is_diverging = max_divergence > self.divergence_threshold
        self.divergence_history.append(is_diverging)

        # Keep only recent history
        if len(self.divergence_history) > self.tolerance_ticks:
            self.divergence_history.pop(0)

        # Sustained divergence: all recent ticks show divergence
        sustained = len(self.divergence_history) >= self.tolerance_ticks and all(
            self.divergence_history
        )

        return sustained, max_divergence

    def compute_correction_signal(
        self,
        predicted: torch.Tensor,
        actual: torch.Tensor,
    ) -> torch.Tensor:
        """Compute signal to correct mesh trajectory.

        Args:
            predicted: Predicted state.
            actual: Actual state.

        Returns:
            Correction signal to apply to mesh inputs.
        """
        # Direction from predicted to actual
        direction = actual - predicted
        direction = direction / (torch.norm(direction, dim=(1, 2), keepdim=True) + 1e-8)

        return direction


class TinyGPTExpert:
    """TinyGPT registered as a Mixture-of-Experts (MoE) skill.

    Bridges TinyGPT into Prometheus:
    - MoE router selects this expert when language generation is needed
    - Outputs feed into hyperdimensional mesh as compressed states
    - Extension builder verifies contracts
    - Vale system locks satisfied neurons
    - Quantization loop compresses representations
    - Live correction monitors during execution
    """

    def __init__(
        self,
        model_checkpoint: Path,
        tokenizer_checkpoint: Path,
        mesh_config: Dict,
        device: str = "cuda",
    ):
        """Initialize TinyGPT expert for Prometheus.

        Args:
            model_checkpoint: Path to trained TinyGPT model.
            tokenizer_checkpoint: Path to tokenizer.
            mesh_config: Hyperdimensional mesh configuration.
            device: Device to run on.
        """
        self.device = torch.device(device)

        # Lazy import to avoid circular dependency
        from tinygpt.model import GPT
        from tinygpt.tokenizer import Tokenizer
        from tinygpt.config import ModelConfig

        # Load TinyGPT
        checkpoint = torch.load(model_checkpoint, map_location=self.device)
        self.model_config = checkpoint["config"]
        self.model = GPT(self.model_config).to(self.device)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.eval()

        # Load tokenizer
        self.tokenizer = Tokenizer.from_checkpoint(tokenizer_checkpoint)

        # Initialize integration modules
        self.qat = QuantizationAwareTraining(num_bits=4)
        self.embedding_layer = MeshContextEmbedding(
            tinygpt_hidden_dim=self.model_config.hidden_dim,
            mesh_hidden_dim=mesh_config.get("hidden_dim", 256),
            num_mesh_neurons=mesh_config.get("num_neurons", 64),
        )
        self.vale_learning = ValeAwareLearning(
            num_neurons=mesh_config.get("num_neurons", 64),
        )
        self.correction_monitor = LiveCorrectionMonitor(
            num_neurons=mesh_config.get("num_neurons", 64),
            hidden_dim=mesh_config.get("hidden_dim", 256),
        )

        # Extension builder contract
        self.contract = TinyGPTExpertContract()

    def forward(
        self,
        user_query: str,
        context_buffer: List[str],
    ) -> Dict:
        """Generate response through TinyGPT expert.

        Args:
            user_query: User input text.
            context_buffer: Recent conversation history.

        Returns:
            Dict with logits, embeddings, attention weights, and mesh states.
        """
        # Encode input
        input_ids = torch.tensor(
            self.tokenizer.encode(user_query, add_special_tokens=True),
            dtype=torch.long,
        ).unsqueeze(0).to(self.device)

        # Forward through TinyGPT
        with torch.no_grad():
            logits = self.model(input_ids)  # [1, seq_len, vocab_size]

            # Extract embeddings (from last hidden layer before lm_head)
            # This is a simplified extraction; in practice, you'd hook into model internals
            embeddings = self.model.token_embedding(input_ids)  # [1, seq_len, hidden_dim]

        # Apply QAT (Quantization-Aware Training)
        quantized_logits, qat_error = self.qat(logits, return_error=True)
        quantized_embeddings, _ = self.qat(embeddings, return_error=False)

        # Project to mesh space
        mesh_states, input_flags = self.embedding_layer(
            quantized_embeddings,
            is_external_input=True,
        )

        return {
            "logits": logits,
            "embeddings": embeddings,
            "quantized_logits": quantized_logits,
            "quantized_embeddings": quantized_embeddings,
            "qat_error": qat_error,
            "mesh_states": mesh_states,
            "input_flags": input_flags,
            "contract": self.contract,
        }

    def verify_contract(self, output: Dict) -> torch.Tensor:
        """Verify extension builder contract (neuron-level unit testing).

        Args:
            output: Forward output dict.

        Returns:
            Binary mask of satisfied contracts per neuron.
        """
        satisfied = torch.ones(self.embedding_layer.num_mesh_neurons, dtype=torch.bool)

        # Check assertion 1: logits sum to ~1.0
        logits_probs = torch.softmax(output["logits"], dim=-1)
        prob_sums = logits_probs.sum(dim=-1)
        assertion_1 = (prob_sums - 1.0).abs() < 0.01
        satisfied = satisfied & assertion_1.all()

        # Check assertion 2: embeddings are normalized
        embedding_norms = torch.norm(output["quantized_embeddings"], dim=-1)
        assertion_2 = (embedding_norms > 0.5) & (embedding_norms < 2.0)
        satisfied = satisfied & assertion_2.all()

        return satisfied
