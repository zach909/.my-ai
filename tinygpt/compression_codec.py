"""Compression codec for Prometheus Zip I/O Loop (ring buffer).

Enables continuous state cycling with long-term persistence snapshots.
Uses learned quantized representation (not generic ZIP) to preserve similarity structure.
"""

import torch
import torch.nn as nn
from pathlib import Path
from typing import Tuple, Dict, Optional
import struct


class LearnedCompressionCodec(nn.Module):
    """Learned compression codec for mesh states.

    Rather than generic-purpose ZIP compression (which breaks gradient structure),
    learns task-specific compression that preserves semantic similarity.
    """

    def __init__(
        self,
        input_dim: int,
        latent_dim: int,
        num_codebook_tokens: int = 256,
    ):
        """Initialize compression codec.

        Args:
            input_dim: Dimension of states to compress (num_neurons * hidden_dim).
            latent_dim: Compressed representation dimension.
            num_codebook_tokens: Number of discrete tokens in codebook.
        """
        super().__init__()
        self.input_dim = input_dim
        self.latent_dim = latent_dim
        self.num_codebook_tokens = num_codebook_tokens

        # Encoder: compress state → latent
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, 512),
            nn.ReLU(),
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Linear(256, latent_dim),
        )

        # Codebook: discrete tokens for quantization
        self.register_buffer(
            "codebook",
            torch.randn(num_codebook_tokens, latent_dim),
        )

        # Decoder: latent → state reconstruction
        self.decoder = nn.Sequential(
            nn.Linear(latent_dim, 256),
            nn.ReLU(),
            nn.Linear(256, 512),
            nn.ReLU(),
            nn.Linear(512, input_dim),
        )

    def encode(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Encode state to quantized latent and indices.

        Args:
            x: Input state [batch, input_dim].

        Returns:
            Tuple of (quantized_latent, indices, commit_loss) where:
            - quantized_latent: Codebook entries [batch, latent_dim]
            - indices: Codebook indices [batch]
            - commit_loss: Scalar loss encouraging commitment to codebook
        """
        # Encode to continuous latent
        z = self.encoder(x)  # [batch, latent_dim]

        # Find nearest codebook entries
        distances = torch.cdist(z, self.codebook)  # [batch, num_tokens]
        indices = torch.argmin(distances, dim=1)  # [batch]
        quantized_z = self.codebook[indices]  # [batch, latent_dim]

        # Straight-through estimator (STE) for gradient flow
        quantized_z = z + (quantized_z - z).detach()

        # Commitment loss: encourage z to stay close to codebook
        commit_loss = torch.mean((z.detach() - quantized_z) ** 2)

        return quantized_z, indices, commit_loss

    def decode(self, quantized_z: torch.Tensor) -> torch.Tensor:
        """Decode quantized latent back to state.

        Args:
            quantized_z: Quantized latent [batch, latent_dim].

        Returns:
            Reconstructed state [batch, input_dim].
        """
        return self.decoder(quantized_z)

    def forward(
        self,
        x: torch.Tensor,
    ) -> Dict:
        """Full encode-decode cycle.

        Args:
            x: Input state [batch, input_dim].

        Returns:
            Dict with reconstructed state, indices, and losses.
        """
        quantized_z, indices, commit_loss = self.encode(x)
        x_recon = self.decode(quantized_z)

        # Reconstruction loss
        recon_loss = torch.mean((x - x_recon) ** 2)

        return {
            "reconstructed": x_recon,
            "indices": indices,
            "commit_loss": commit_loss,
            "recon_loss": recon_loss,
            "total_loss": recon_loss + 0.25 * commit_loss,
        }


class RingBufferWithCheckpoint:
    """Ring buffer for Zip I/O Loop with periodic disk snapshots.

    Implements continuous state cycling (Section 2 of architecture notes):
    - Ring buffer of fixed size cycles input (1, 0, 1, 0...)
    - Periodic snapshots to disk for long-term persistence
    - On-demand restoration from checkpoint
    """

    def __init__(
        self,
        buffer_size: int = 50_000,
        state_dim: int = 256,
        checkpoint_interval: int = 5_000,
        checkpoint_dir: Path = Path("./ring_buffer_checkpoints"),
    ):
        """Initialize ring buffer.

        Args:
            buffer_size: Number of chunks in ring buffer.
            state_dim: Dimension of each state chunk.
            checkpoint_interval: Save checkpoint every N iterations.
            checkpoint_dir: Directory for checkpoint files.
        """
        self.buffer_size = buffer_size
        self.state_dim = state_dim
        self.checkpoint_interval = checkpoint_interval
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(exist_ok=True)

        # Ring buffer
        self.buffer = torch.zeros(buffer_size, state_dim)
        self.write_index = 0
        self.iteration_count = 0

    def write(self, state: torch.Tensor) -> None:
        """Write state to ring buffer (overwrite oldest if full).

        Args:
            state: State chunk [state_dim] or [batch, state_dim].
        """
        if state.dim() == 1:
            state = state.unsqueeze(0)

        batch_size = state.shape[0]

        for i in range(batch_size):
            self.buffer[self.write_index] = state[i].detach().cpu()
            self.write_index = (self.write_index + 1) % self.buffer_size
            self.iteration_count += 1

            # Periodic checkpoint
            if self.iteration_count % self.checkpoint_interval == 0:
                self.save_checkpoint()

    def read(self, num_chunks: int) -> torch.Tensor:
        """Read most recent chunks from buffer.

        Args:
            num_chunks: Number of chunks to read (from newest backward).

        Returns:
            Tensor [num_chunks, state_dim].
        """
        num_chunks = min(num_chunks, self.buffer_size)
        indices = [
            (self.write_index - 1 - i) % self.buffer_size for i in range(num_chunks)
        ]
        return self.buffer[indices]

    def save_checkpoint(self) -> Path:
        """Save checkpoint to disk.

        Returns:
            Path to saved checkpoint.
        """
        checkpoint_path = (
            self.checkpoint_dir / f"ring_buffer_iter_{self.iteration_count}.pt"
        )
        checkpoint = {
            "buffer": self.buffer,
            "write_index": self.write_index,
            "iteration_count": self.iteration_count,
        }
        torch.save(checkpoint, checkpoint_path)
        return checkpoint_path

    def load_checkpoint(self, checkpoint_path: Path) -> None:
        """Load checkpoint from disk.

        Args:
            checkpoint_path: Path to checkpoint file.
        """
        checkpoint = torch.load(checkpoint_path)
        self.buffer = checkpoint["buffer"]
        self.write_index = checkpoint["write_index"]
        self.iteration_count = checkpoint["iteration_count"]

    def get_context_window(self, context_size: int) -> torch.Tensor:
        """Get recent context for mesh input.

        Returns:
            Tensor [context_size, state_dim] of recent states.
        """
        return self.read(context_size)


class DualNumberDifferentiator(nn.Module):
    """Dual number arithmetic for value + derivative encoding (Section 13).

    Encodes f and f' (value and derivative) simultaneously for self-model
    and live correction. Used within mesh neurons when detecting divergence.

    Dual numbers: ε² = 0, so (a + bε)² = a² + 2abε.
    Value part (real): f
    Derivative part (dual): df/dx
    """

    def __init__(self, input_dim: int, hidden_dim: int):
        """Initialize dual number layer.

        Args:
            input_dim: Input dimension.
            hidden_dim: Hidden dimension (will be split 50-50 for value/dual).
        """
        super().__init__()
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.dual_dim = hidden_dim // 2

        # Separate weights for value and derivative parts
        self.value_weights = nn.Linear(input_dim, self.dual_dim)
        self.dual_weights = nn.Linear(input_dim, self.dual_dim)

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Compute both value and derivative in one pass.

        Args:
            x: Input [batch, input_dim].

        Returns:
            Tuple of (value, derivative) both [batch, dual_dim].
        """
        # Value part: standard forward
        value = torch.relu(self.value_weights(x))

        # Derivative part: using finite differences or autodiff
        # For simplicity, use autodiff if x requires grad
        if x.requires_grad:
            derivative = torch.autograd.grad(
                outputs=value.sum(),
                inputs=x,
                create_graph=True,
                retain_graph=True,
            )[0].norm(dim=1, keepdim=True).expand(-1, self.dual_dim)
        else:
            # Fallback: learned approximation of derivative
            derivative = torch.relu(self.dual_weights(x))

        return value, derivative
