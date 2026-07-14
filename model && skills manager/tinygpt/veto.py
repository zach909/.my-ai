"""Alignment veto (Prometheus section 3), Python port.

A deterministic gate on actions the model proposes — NOT a learned objective
the model optimises toward (the notes' "do not ship" Goodhart trap). Two safety
properties: drift fails safe, and irreversible / external-effect actions require
human confirmation. This is the safety layer of the unified core.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, List, Optional

_OBJECTIONABLE = {
    "deceive", "deception", "manipulate", "self-reward", "reward-hack",
    "fake-success", "simulate-happiness", "harm", "surveil-without-consent",
}


@dataclass
class ProposedAction:
    id: str
    name: str
    capabilities: List[str] = field(default_factory=list)
    reversible: bool = False          # unknown -> treat as irreversible (fail safe)
    external_effect: bool = False


@dataclass
class VetoDecision:
    allowed: bool
    requires_confirmation: bool
    score: float
    reasons: List[str]


def _default_scorer(action: ProposedAction, drift: float) -> float:
    score = 1.0
    for cap in action.capabilities:
        if cap in _OBJECTIONABLE:
            score -= 0.5
    if action.reversible is False:
        score -= 0.15
    if action.external_effect:
        score -= 0.1
    score -= min(0.3, max(0.0, drift))
    return max(0.0, min(1.0, score))


class AlignmentVeto:
    def __init__(self, objectionable: Optional[set] = None, drift_tolerance: float = 0.3,
                 severe_drift_tolerance: float = 0.6, confirm_irreversible: bool = True,
                 score_threshold: float = 0.5,
                 scorer: Optional[Callable[[ProposedAction, float], float]] = None):
        self.objectionable = objectionable or set(_OBJECTIONABLE)
        self.drift_tolerance = drift_tolerance
        self.severe_drift_tolerance = severe_drift_tolerance
        self.confirm_irreversible = confirm_irreversible
        self.score_threshold = score_threshold
        self.scorer = scorer or _default_scorer

    def evaluate(self, action: ProposedAction, self_model_surprise: float = 0.0) -> VetoDecision:
        reasons: List[str] = []
        allowed = True
        requires_confirmation = False

        score = self.scorer(action, self_model_surprise)
        objectionable = [c for c in action.capabilities if c in self.objectionable]
        if objectionable:
            allowed = False
            reasons.append(f"objectionable capability: {', '.join(objectionable)}")

        if self_model_surprise > self.severe_drift_tolerance:
            allowed = False
            reasons.append(f"severe self-model drift ({self_model_surprise:.3f})")
        elif self_model_surprise > self.drift_tolerance:
            requires_confirmation = True
            reasons.append(f"self-model drift ({self_model_surprise:.3f}) — confirm first")

        if self.confirm_irreversible and (action.reversible is False or action.external_effect):
            requires_confirmation = True
            reasons.append("irreversible or external-effect action — requires confirmation")

        if score < self.score_threshold:
            allowed = False
            reasons.append(f"benevolence score {score:.3f} below threshold {self.score_threshold}")

        if not reasons:
            reasons.append("no objection")
        return VetoDecision(allowed, requires_confirmation, score, reasons)
