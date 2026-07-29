"""Answer selection by quantum interference (§5), with genuine complex numbers.

Given several candidate "thoughts" the mesh could settle on, don't pick the
loudest or a random one — let them interfere. Each candidate is a complex
number a·e^{iφ}: amplitude a (how strong) and phase φ (its stance). Complex
multiplication IS the maths of interference, not an analogy — candidates that
agree in phase reinforce, ones that disagree cancel.

Two tools live here and stay SEPARATE (the notes are explicit that fusing them
breaks both):
  - phase_consensus: cancels mutually contradictory candidates (a candidate
    pointing against the group resultant projects to ~0);
  - grover_amplify: boosts one marked candidate's amplitude — for rescuing a
    rare-but-correct signal buried among many wrong ones.

collapse() then samples proportionally to amplitude squared (the Born rule) —
not uniformly — so the interference actually decides the outcome.

This selects for internal COHERENCE, not truth: a confidently self-consistent
wrong answer collapses just as cleanly. That is why the mesh also has the
self-model / live-correction and the alignment veto to check itself.
"""
from __future__ import annotations

from typing import Optional, Tuple

import torch


def phase_consensus(amplitudes: torch.Tensor, phases: torch.Tensor) -> torch.Tensor:
    """Return each candidate's post-interference weight: its amplitude projected
    onto the group's resultant direction, clamped at 0. Candidates in phase with
    the consensus keep (or gain) weight; contradictory ones cancel toward 0."""
    z = amplitudes.to(torch.complex64) * torch.exp(1j * phases.to(torch.float32))
    resultant = z.sum()
    if resultant.abs() < 1e-9:
        # total destructive interference — fall back to raw amplitudes
        return amplitudes.clamp(min=0.0)
    direction = resultant / resultant.abs()
    projection = (z * direction.conj()).real        # contradictory -> negative
    return projection.clamp(min=0.0)


def grover_amplify(weights: torch.Tensor, target: int, boost: float = 2.0) -> torch.Tensor:
    """Amplitude amplification: boost one marked candidate (a rare-but-correct
    signal). Kept separate from phase_consensus on purpose."""
    w = weights.clone()
    if 0 <= target < w.numel():
        w[target] = w[target] * boost
    return w


def collapse(weights: torch.Tensor, generator: Optional[torch.Generator] = None
             ) -> Tuple[int, torch.Tensor]:
    """Sample a candidate proportionally to amplitude squared (Born rule).
    Returns (index, probability distribution)."""
    p = weights.clamp(min=0.0) ** 2
    total = p.sum()
    if total < 1e-12:
        p = torch.ones_like(weights) / weights.numel()
    else:
        p = p / total
    idx = int(torch.multinomial(p, 1, generator=generator).item())
    return idx, p


def interfere_select(amplitudes: torch.Tensor, phases: torch.Tensor,
                     amplify_target: Optional[int] = None, boost: float = 2.0,
                     generator: Optional[torch.Generator] = None
                     ) -> Tuple[int, torch.Tensor]:
    """Full §5 pipeline: phase-consensus -> optional Grover amplification ->
    Born-rule collapse. Returns (chosen index, probabilities)."""
    weights = phase_consensus(amplitudes, phases)
    if amplify_target is not None:
        weights = grover_amplify(weights, amplify_target, boost)
    return collapse(weights, generator)
