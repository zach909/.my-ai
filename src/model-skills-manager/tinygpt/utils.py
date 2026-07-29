"""Shared helpers: seeding, device selection, LR schedule, checkpoint I/O."""
from __future__ import annotations

import math
import os
import random
from dataclasses import asdict
from typing import Optional

import numpy as np
import torch

from .config import ModelConfig, TrainConfig


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def resolve_device(requested: str) -> str:
    """Honour the request but fall back gracefully if unavailable."""
    if requested == "cuda" and torch.cuda.is_available():
        return "cuda"
    if requested == "mps" and getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def resolve_dtype(name: str, device: str):
    if device != "cuda":
        return torch.float32  # AMP only makes sense on CUDA here
    if name == "bfloat16" and torch.cuda.is_bf16_supported():
        return torch.bfloat16
    if name == "float16":
        return torch.float16
    return torch.float32


def cosine_lr(step: int, cfg: TrainConfig) -> float:
    """Linear warmup then cosine decay to min_learning_rate."""
    if step < cfg.warmup_steps:
        return cfg.learning_rate * (step + 1) / max(1, cfg.warmup_steps)
    decay_steps = cfg.resolved_decay_steps()
    if step >= decay_steps:
        return cfg.min_learning_rate
    ratio = (step - cfg.warmup_steps) / max(1, decay_steps - cfg.warmup_steps)
    coeff = 0.5 * (1.0 + math.cos(math.pi * ratio))
    return cfg.min_learning_rate + coeff * (cfg.learning_rate - cfg.min_learning_rate)


def save_checkpoint(path: str, model, optimizer, model_cfg: ModelConfig,
                    step: int, best_val: float, extra: Optional[dict] = None) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    # Shallow field dict, dropping expert_moe: it's a live nn.Module attached at
    # build time (skills as mesh experts), not a serialisable hyperparameter, and
    # asdict() would try to deep-copy the module. Its weights are already in
    # model.state_dict(); re-attach the module via the registry when loading.
    import dataclasses
    cfg_dict = {f.name: getattr(model_cfg, f.name) for f in dataclasses.fields(model_cfg)}
    cfg_dict.pop("expert_moe", None)
    payload = {
        "model": model.state_dict(),
        "optimizer": optimizer.state_dict() if optimizer is not None else None,
        "model_config": cfg_dict,
        "step": step,
        "best_val": best_val,
    }
    if extra:
        payload.update(extra)
    torch.save(payload, path)


def load_checkpoint(path: str, map_location: str = "cpu", mmap: bool = False) -> dict:
    """Load a checkpoint's state dict + metadata.

    `mmap=True` memory-maps the checkpoint file instead of reading every tensor
    storage into RAM up front (PyTorch >=2.1's built-in `torch.load(mmap=...)`):
    pages are faulted in from disk by the OS as each weight is actually touched,
    and can be evicted under memory pressure, so a model whose weights exceed
    available RAM can still be loaded and run on a memory-constrained machine —
    the same technique llama.cpp-style CPU inference relies on. No new
    dependency: `mmap` has been a stdlib `torch.load` parameter since 2.1, and
    requirements.txt already pins `torch>=2.1`.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"Checkpoint not found: {path}")
    return torch.load(path, map_location=map_location, weights_only=False, mmap=mmap)


def human_count(n: int) -> str:
    for unit in ["", "K", "M", "B"]:
        if abs(n) < 1000:
            return f"{n:.1f}{unit}"
        n /= 1000
    return f"{n:.1f}T"
