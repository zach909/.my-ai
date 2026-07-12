"""Self-monitoring + self-halt (Prometheus sections 10 & 12) for TinyGPT.

Two things the notes ask for, made real for a transformer:

  - Meta-awareness (section 10): a small, approximate self-model predicts the
    model's own next hidden state ("neuron inputs"). The gap between prediction
    and reality — the *surprise* — is the self-monitoring signal. Exact
    self-prediction is impossible (infinite regress); an approximate one is not.

  - Self-halt (section 12, "drift fails safe"): when surprise stays high across
    several consecutive steps, the system stops itself rather than pressing on,
    and snapshots everything (the recorded hidden states / "neuron inputs",
    surprise history, and whatever context the caller passes) to disk. Halting
    is always safe; a false halt costs a save, not a bad action.

The self-model here is a lightweight online linear predictor over the mean
hidden state — cheap, and enough to produce a meaningful surprise signal.
"""
from __future__ import annotations

import json
import os
import time
from typing import List, Optional

import numpy as np


class SelfMonitor:
    def __init__(self, dim: int, halt_surprise: float = 0.6, patience: int = 3,
                 lr: float = 0.05, ema: float = 0.9):
        self.dim = dim
        self.halt_surprise = halt_surprise
        self.patience = patience
        self.lr = lr
        self.ema = ema
        # linear self-model: predict next mean-hidden from current mean-hidden
        self.W = np.zeros((dim, dim), dtype=np.float64)
        self.prev: Optional[np.ndarray] = None
        self.surprise_ema = 0.0
        self.has_ema = False
        self.consecutive_high = 0
        self.history: List[float] = []
        self.recorded_states: List[List[float]] = []

    def observe(self, hidden_mean: np.ndarray) -> float:
        """Record the current mean hidden state, return the surprise vs. the
        self-model's prediction, and train the self-model one step."""
        h = np.asarray(hidden_mean, dtype=np.float64).reshape(-1)[: self.dim]
        if h.shape[0] < self.dim:
            h = np.pad(h, (0, self.dim - h.shape[0]))
        self.recorded_states.append(h.tolist())

        surprise = 0.0
        if self.prev is not None:
            predicted = self.W @ self.prev
            error = h - predicted
            surprise = float(np.mean(np.abs(error)))
            # one online gradient step: W += lr * error ⊗ prev
            self.W += self.lr * np.outer(error, self.prev)

        self.surprise_ema = (self.ema * self.surprise_ema + (1 - self.ema) * surprise
                             if self.has_ema else surprise)
        self.has_ema = True
        self.history.append(surprise)
        self.prev = h

        if surprise > self.halt_surprise:
            self.consecutive_high += 1
        else:
            self.consecutive_high = 0
        return surprise

    def should_halt(self) -> bool:
        """True once surprise has stayed high for `patience` consecutive steps —
        sustained divergence, not a single noisy tick."""
        return self.consecutive_high >= self.patience

    def reset_halt(self) -> None:
        self.consecutive_high = 0

    def snapshot(self, path: str, extra: Optional[dict] = None) -> str:
        """Save all recorded neuron state + surprise history (+ caller context)."""
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        payload = {
            "timestamp": time.time(),
            "dim": self.dim,
            "surprise_history": self.history,
            "surprise_ema": self.surprise_ema,
            "consecutive_high": self.consecutive_high,
            "recorded_states": self.recorded_states,   # the "neuron inputs"
        }
        if extra:
            payload["context"] = extra
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        return path
