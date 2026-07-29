"""Model factory.

The decoder-only transformer baseline has been retired; the all-to-all neuron
mesh (§1, tinygpt/mesh.py) is now the model. `build_model` keeps a single
construction point so the training and inference code stays
architecture-agnostic and checkpoints round-trip via the config.
"""
from __future__ import annotations

from .config import ModelConfig
from .mesh import MeshLM


def build_model(cfg: ModelConfig):
    """Build the model described by `cfg`. Currently always the mesh."""
    return MeshLM(cfg)
