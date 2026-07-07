"""Configuration for TinyGPT model and training."""

from dataclasses import dataclass
from typing import Optional


@dataclass
class ModelConfig:
    """Model architecture configuration."""
    vocab_size: int = 8192  # SentencePiece vocabulary size
    context_length: int = 1024  # Maximum sequence length
    hidden_dim: int = 768  # Embedding and hidden dimension
    num_layers: int = 12  # Number of transformer blocks
    num_heads: int = 12  # Number of attention heads
    mlp_dim: int = 3072  # Feed-forward inner dimension (4x hidden_dim)
    dropout: float = 0.1  # Dropout rate
    layer_norm_eps: float = 1e-5
    initializer_range: float = 0.02
    max_position_embeddings: int = 1024

    @property
    def head_dim(self) -> int:
        """Dimension per attention head."""
        return self.hidden_dim // self.num_heads


@dataclass
class TokenizerConfig:
    """SentencePiece tokenizer configuration."""
    vocab_size: int = 8192
    model_type: str = "bpe"  # byte-pair encoding
    character_coverage: float = 0.9995
    num_threads: int = 4


@dataclass
class TrainingConfig:
    """Training hyperparameters."""
    batch_size: int = 32
    gradient_accumulation_steps: int = 4
    learning_rate: float = 1e-3
    weight_decay: float = 0.01
    warmup_steps: int = 1000
    total_steps: int = 100000
    save_every: int = 5000
    eval_every: int = 1000
    eval_samples: int = 100
    max_grad_norm: float = 1.0
    seed: int = 42
    use_amp: bool = True  # Automatic Mixed Precision
    device: str = "cuda"  # 'cuda' or 'cpu'


@dataclass
class InferenceConfig:
    """Inference configuration."""
    temperature: float = 0.7
    top_k: int = 50
    top_p: float = 0.9
    repetition_penalty: float = 1.0
    max_length: int = 256
    num_beams: int = 1  # 1 = greedy, >1 = beam search
