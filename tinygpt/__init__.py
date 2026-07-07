"""TinyGPT - Production-grade GPT model from scratch, integrated into Prometheus."""

__version__ = "0.1.0"

from tinygpt.config import ModelConfig, TokenizerConfig, TrainingConfig, InferenceConfig
from tinygpt.model import GPT
from tinygpt.tokenizer import Tokenizer
from tinygpt.trainer import Trainer
from tinygpt.inference import Inferencer

# Integration layer
from tinygpt.prometheus_integration import (
    TinyGPTExpert,
    TinyGPTExpertContract,
    QuantizationAwareTraining,
    MeshContextEmbedding,
    ValeAwareLearning,
    LiveCorrectionMonitor,
)

from tinygpt.compression_codec import (
    LearnedCompressionCodec,
    RingBufferWithCheckpoint,
    DualNumberDifferentiator,
)

__all__ = [
    # Core model
    "GPT",
    "Tokenizer",
    "Trainer",
    "Inferencer",
    # Config
    "ModelConfig",
    "TokenizerConfig",
    "TrainingConfig",
    "InferenceConfig",
    # Integration
    "TinyGPTExpert",
    "TinyGPTExpertContract",
    "QuantizationAwareTraining",
    "MeshContextEmbedding",
    "ValeAwareLearning",
    "LiveCorrectionMonitor",
    # Compression
    "LearnedCompressionCodec",
    "RingBufferWithCheckpoint",
    "DualNumberDifferentiator",
]
