"""Live guidance (Prometheus section 12) — correct mid-generation, don't stop.

Instead of halting when the model drifts, guide it back on track *while it is
generating*. At each step the model's own confidence (the probability it assigns
its chosen token) is the divergence signal: sustained low confidence means the
trajectory is wandering. When that happens the guide tightens sampling
(lower temperature, tighter nucleus) to pull generation toward high-probability,
coherent tokens; when confidence recovers it relaxes back to the defaults.

A tolerance band (require several consecutive low-confidence steps, not one)
keeps a single noisy token from over-correcting a trajectory that was fine.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, Optional


@dataclass
class GuideParams:
    temperature: float
    top_k: Optional[int]
    top_p: Optional[float]
    guiding: bool


class LiveGuide:
    def __init__(self, base_temperature: float, base_top_k: Optional[int],
                 base_top_p: Optional[float], low_confidence: float = 0.25,
                 patience: int = 3, tighten_temp: float = 0.5, tighten_top_p: float = 0.8):
        self.base_temperature = base_temperature
        self.base_top_k = base_top_k
        self.base_top_p = base_top_p
        self.low_confidence = low_confidence
        self.patience = patience
        self.tighten_temp = tighten_temp
        self.tighten_top_p = tighten_top_p
        self.recent: Deque[float] = deque(maxlen=patience)
        self.corrections = 0

    def adjust(self, confidence: float) -> GuideParams:
        """Given the confidence of the token about to be committed, return the
        (possibly tightened) sampling parameters for this step."""
        self.recent.append(confidence)
        # sustained low confidence = drifting -> guide back
        drifting = (len(self.recent) == self.patience
                    and all(c < self.low_confidence for c in self.recent))
        if drifting:
            self.corrections += 1
            top_p = min(self.base_top_p or 1.0, self.tighten_top_p)
            return GuideParams(
                temperature=max(0.1, self.base_temperature * self.tighten_temp),
                top_k=self.base_top_k,
                top_p=top_p,
                guiding=True,
            )
        return GuideParams(self.base_temperature, self.base_top_k, self.base_top_p, False)

    def reset(self) -> None:
        self.recent.clear()
