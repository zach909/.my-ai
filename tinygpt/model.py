"""GPT Transformer model implementation for TinyGPT."""

import math
from typing import Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

from config import ModelConfig


class RotaryPositionalEmbedding(nn.Module):
    """Rotary positional embeddings (RoPE)."""

    def __init__(self, dim: int, max_seq_length: int = 2048):
        super().__init__()
        self.dim = dim
        self.max_seq_length = max_seq_length

        # Precompute frequencies
        inv_freq = 1.0 / (10000 ** (torch.arange(0, dim, 2).float() / dim))
        self.register_buffer("inv_freq", inv_freq, persistent=False)

    def forward(self, seq_len: int, device: torch.device) -> Tuple[torch.Tensor, torch.Tensor]:
        """Compute rotation matrices for all positions.

        Args:
            seq_len: Sequence length.
            device: Device to place tensors on.

        Returns:
            Tuple of (cos, sin) matrices for rotation.
        """
        t = torch.arange(seq_len, device=device, dtype=self.inv_freq.dtype)
        freqs = torch.outer(t, self.inv_freq)
        emb = torch.cat([freqs, freqs], dim=-1)
        return emb.cos(), emb.sin()

    @staticmethod
    def apply_rotary_emb(
        x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor
    ) -> torch.Tensor:
        """Apply rotary embeddings to tensor.

        Args:
            x: Query or key tensor [batch, seq_len, num_heads, head_dim].
            cos: Cosine component.
            sin: Sine component.

        Returns:
            Rotated tensor.
        """
        # Split x into pairs
        x1, x2 = x[..., : x.shape[-1] // 2], x[..., x.shape[-1] // 2 :]
        # Rotate
        return torch.cat(
            [
                x1 * cos[None, :, None, :] - x2 * sin[None, :, None, :],
                x1 * sin[None, :, None, :] + x2 * cos[None, :, None, :],
            ],
            dim=-1,
        )


class MultiHeadAttention(nn.Module):
    """Multi-head self-attention with RoPE and causal masking."""

    def __init__(self, config: ModelConfig):
        super().__init__()
        self.hidden_dim = config.hidden_dim
        self.num_heads = config.num_heads
        self.head_dim = config.head_dim
        self.dropout = config.dropout

        # Linear projections
        self.qkv = nn.Linear(config.hidden_dim, 3 * config.hidden_dim)
        self.out = nn.Linear(config.hidden_dim, config.hidden_dim)
        self.dropout_layer = nn.Dropout(config.dropout)

        # Rotary embeddings
        self.rope = RotaryPositionalEmbedding(config.head_dim, config.max_position_embeddings)

    def forward(
        self,
        x: torch.Tensor,
        attention_mask: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """Forward pass.

        Args:
            x: Input tensor [batch_size, seq_len, hidden_dim].
            attention_mask: Causal mask or attention mask.

        Returns:
            Output tensor [batch_size, seq_len, hidden_dim].
        """
        batch_size, seq_len, _ = x.shape

        # Project to Q, K, V
        qkv = self.qkv(x)
        q, k, v = qkv.chunk(3, dim=-1)

        # Reshape for multi-head attention
        q = q.view(batch_size, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
        k = k.view(batch_size, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
        v = v.view(batch_size, seq_len, self.num_heads, self.head_dim).transpose(1, 2)

        # Apply rotary embeddings
        cos, sin = self.rope(seq_len, x.device)
        q = self.rope.apply_rotary_emb(q, cos, sin)
        k = self.rope.apply_rotary_emb(k, cos, sin)

        # Compute attention scores
        scores = torch.matmul(q, k.transpose(-2, -1)) / math.sqrt(self.head_dim)

        # Apply causal mask (lower triangular)
        if attention_mask is None:
            causal_mask = torch.triu(
                torch.ones(seq_len, seq_len, device=x.device, dtype=torch.bool),
                diagonal=1,
            )
            scores.masked_fill_(causal_mask.unsqueeze(0).unsqueeze(0), float("-inf"))
        else:
            scores = scores + attention_mask

        # Softmax and attention
        attn_weights = F.softmax(scores, dim=-1)
        attn_weights = self.dropout_layer(attn_weights)

        # Apply attention to values
        context = torch.matmul(attn_weights, v)

        # Reshape back
        context = context.transpose(1, 2).contiguous()
        context = context.view(batch_size, seq_len, self.hidden_dim)

        # Output projection
        output = self.out(context)
        output = self.dropout_layer(output)

        return output


class FeedForward(nn.Module):
    """Feed-forward network (MLP) block."""

    def __init__(self, config: ModelConfig):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(config.hidden_dim, config.mlp_dim),
            nn.GELU(),
            nn.Linear(config.mlp_dim, config.hidden_dim),
            nn.Dropout(config.dropout),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass.

        Args:
            x: Input tensor [batch_size, seq_len, hidden_dim].

        Returns:
            Output tensor [batch_size, seq_len, hidden_dim].
        """
        return self.net(x)


class TransformerBlock(nn.Module):
    """Single Transformer block with attention and feed-forward."""

    def __init__(self, config: ModelConfig):
        super().__init__()
        self.norm1 = nn.LayerNorm(config.hidden_dim, eps=config.layer_norm_eps)
        self.attention = MultiHeadAttention(config)
        self.norm2 = nn.LayerNorm(config.hidden_dim, eps=config.layer_norm_eps)
        self.mlp = FeedForward(config)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass with pre-normalization and residuals.

        Args:
            x: Input tensor [batch_size, seq_len, hidden_dim].

        Returns:
            Output tensor [batch_size, seq_len, hidden_dim].
        """
        # Self-attention with residual
        x = x + self.attention(self.norm1(x))
        # Feed-forward with residual
        x = x + self.mlp(self.norm2(x))
        return x


class GPT(nn.Module):
    """Decoder-only GPT model."""

    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config

        # Token embeddings
        self.token_embedding = nn.Embedding(config.vocab_size, config.hidden_dim)

        # Transformer blocks
        self.transformer_blocks = nn.ModuleList(
            [TransformerBlock(config) for _ in range(config.num_layers)]
        )

        # Final layer norm
        self.norm = nn.LayerNorm(config.hidden_dim, eps=config.layer_norm_eps)

        # Output layer (language modeling head)
        self.lm_head = nn.Linear(config.hidden_dim, config.vocab_size, bias=False)

        # Share embeddings between input and output
        self.lm_head.weight = self.token_embedding.weight

        # Initialize weights
        self.apply(self._init_weights)

    def _init_weights(self, module: nn.Module):
        """Initialize weights with normal distribution."""
        if isinstance(module, nn.Linear):
            torch.nn.init.normal_(
                module.weight, mean=0.0, std=self.config.initializer_range
            )
            if module.bias is not None:
                torch.nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            torch.nn.init.normal_(
                module.weight, mean=0.0, std=self.config.initializer_range
            )

    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """Forward pass.

        Args:
            input_ids: Token IDs [batch_size, seq_len].
            attention_mask: Optional attention mask.

        Returns:
            Logits [batch_size, seq_len, vocab_size].
        """
        # Get embeddings
        x = self.token_embedding(input_ids)

        # Apply transformer blocks
        for block in self.transformer_blocks:
            x = block(x)

        # Final norm
        x = self.norm(x)

        # Language modeling head
        logits = self.lm_head(x)

        return logits

    def generate(
        self,
        input_ids: torch.Tensor,
        max_length: int,
        temperature: float = 1.0,
        top_k: Optional[int] = None,
        top_p: Optional[float] = None,
        repetition_penalty: float = 1.0,
    ) -> torch.Tensor:
        """Generate tokens autoregressively.

        Args:
            input_ids: Initial token IDs [batch_size, seq_len].
            max_length: Maximum generation length.
            temperature: Sampling temperature.
            top_k: Keep top-k tokens.
            top_p: Keep tokens with cumulative probability <= top_p.
            repetition_penalty: Penalty for repeated tokens.

        Returns:
            Generated token IDs [batch_size, generated_length].
        """
        with torch.no_grad():
            current_ids = input_ids.clone()

            for _ in range(max_length):
                # Forward pass
                logits = self.forward(current_ids[:, -self.config.context_length :])
                next_token_logits = logits[:, -1, :]

                # Apply repetition penalty
                for batch_idx in range(current_ids.shape[0]):
                    for token_id in set(current_ids[batch_idx].tolist()):
                        next_token_logits[batch_idx, token_id] /= repetition_penalty

                # Apply temperature
                next_token_logits = next_token_logits / temperature

                # Apply top-k filtering
                if top_k is not None:
                    top_k_logits, top_k_indices = torch.topk(
                        next_token_logits, top_k, dim=-1
                    )
                    next_token_logits_filtered = torch.full_like(
                        next_token_logits, float("-inf")
                    )
                    next_token_logits_filtered.scatter_(1, top_k_indices, top_k_logits)
                    next_token_logits = next_token_logits_filtered

                # Apply top-p filtering
                if top_p is not None:
                    sorted_logits, sorted_indices = torch.sort(
                        next_token_logits, descending=True, dim=-1
                    )
                    cumsum_probs = torch.cumsum(
                        F.softmax(sorted_logits, dim=-1), dim=-1
                    )
                    sorted_indices_to_remove = cumsum_probs > top_p
                    sorted_indices_to_remove[..., 0] = False
                    indices_to_remove = sorted_indices[
                        torch.arange(sorted_indices.shape[0]).unsqueeze(-1),
                        sorted_indices_to_remove,
                    ]
                    next_token_logits[indices_to_remove] = float("-inf")

                # Sample or greedy select
                probs = F.softmax(next_token_logits, dim=-1)
                next_tokens = torch.multinomial(probs, num_samples=1)

                # Append to sequence
                current_ids = torch.cat([current_ids, next_tokens], dim=1)

            return current_ids
