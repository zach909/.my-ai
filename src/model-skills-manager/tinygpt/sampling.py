"""Token sampling utilities: temperature, top-k, top-p (nucleus), repetition penalty.

Kept separate from the model so both `GPT.generate` and the chat CLI share one
correct implementation.
"""
from __future__ import annotations

from typing import Optional

import torch
from torch.nn import functional as F


def apply_repetition_penalty(logits: torch.Tensor, generated: torch.Tensor,
                             penalty: float) -> torch.Tensor:
    """CTRL-style repetition penalty (Keskar et al. 2019).

    For every token already present in `generated`, divide its logit by
    `penalty` if positive, multiply if negative — pushing probability away from
    tokens the model has already emitted.
    """
    if penalty == 1.0:
        return logits
    for b in range(logits.size(0)):
        unique = torch.unique(generated[b])
        selected = logits[b, unique]
        selected = torch.where(selected > 0, selected / penalty, selected * penalty)
        logits[b, unique] = selected
    return logits


def top_k_filter(logits: torch.Tensor, k: int) -> torch.Tensor:
    if k is None or k <= 0:
        return logits
    k = min(k, logits.size(-1))
    kth = torch.topk(logits, k, dim=-1).values[..., -1, None]
    return logits.masked_fill(logits < kth, float("-inf"))


def top_p_filter(logits: torch.Tensor, p: float) -> torch.Tensor:
    """Nucleus filtering: keep the smallest set of tokens whose cumulative
    probability exceeds p."""
    if p is None or p >= 1.0:
        return logits
    sorted_logits, sorted_idx = torch.sort(logits, descending=True, dim=-1)
    cumulative = torch.cumsum(F.softmax(sorted_logits, dim=-1), dim=-1)
    # remove tokens once cumulative prob passes p, but always keep the top-1
    remove = cumulative > p
    remove[..., 1:] = remove[..., :-1].clone()
    remove[..., 0] = False
    sorted_logits = sorted_logits.masked_fill(remove, float("-inf"))
    return sorted_logits.scatter(-1, sorted_idx, sorted_logits)


def sample_next_token(logits: torch.Tensor, generated: torch.Tensor,
                      temperature: float = 1.0, top_k: Optional[int] = None,
                      top_p: Optional[float] = None,
                      repetition_penalty: float = 1.0) -> torch.Tensor:
    """Return the next token id (shape (B, 1)) given final-position logits."""
    logits = logits.clone()
    logits = apply_repetition_penalty(logits, generated, repetition_penalty)

    if temperature <= 0:
        # greedy decoding
        return torch.argmax(logits, dim=-1, keepdim=True)

    logits = logits / temperature
    logits = top_k_filter(logits, top_k) if top_k else logits
    logits = top_p_filter(logits, top_p) if top_p else logits
    probs = F.softmax(logits, dim=-1)
    return torch.multinomial(probs, num_samples=1)
