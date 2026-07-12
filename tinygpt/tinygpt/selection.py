"""Predict-before-commit (Prometheus section 11), Python port for TinyGPT.

Generation is cheap and repeatable; committing to a reply is not. So generate N
candidate continuations, score each by how confident the model is in it (mean
token log-probability of the generated tokens), and commit only the best one.
This is the candidate-selection layer of the unified core — a real quality win
over single-sample decoding, using the actual model.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

import torch
from torch.nn import functional as F


@dataclass
class Candidate:
    ids: List[int]          # generated token ids (continuation only)
    text: str
    score: float            # mean log-prob per token (higher = more confident)


@torch.no_grad()
def _score_continuation(model, prompt_ids: torch.Tensor, cont_ids: torch.Tensor) -> float:
    """Mean log-probability the model assigns to `cont_ids` following `prompt_ids`."""
    if cont_ids.numel() == 0:
        return float("-inf")
    seq = torch.cat([prompt_ids, cont_ids], dim=1)
    seq = seq[:, -model.cfg.block_size:]
    # Passing targets makes forward() return logits for *every* position
    # (B, T, V); without targets it returns only the final position, which
    # can't score a whole continuation. The returned loss is ignored here.
    logits, _ = model(seq, targets=seq)
    n_cont = min(cont_ids.size(1), seq.size(1) - 1)
    if n_cont <= 0:
        return float("-inf")
    # logits[:, t] predicts token t+1; positions -n_cont-1..-2 predict the
    # final n_cont tokens (the continuation).
    pred = logits[0, -n_cont - 1: -1, :]
    logprobs = F.log_softmax(pred, dim=-1)
    targets = seq[0, -n_cont:]
    chosen = logprobs[torch.arange(n_cont), targets]
    return float(chosen.mean().item())


@torch.no_grad()
def best_of_n(model, tokenizer, prompt_ids: List[int], n: int, max_new_tokens: int,
              temperature: float, top_k: Optional[int], top_p: Optional[float],
              repetition_penalty: float, eos_id: Optional[int],
              device: str) -> Candidate:
    """Generate `n` candidates and return the highest-scoring one."""
    base = torch.tensor([prompt_ids], dtype=torch.long, device=device)
    candidates: List[Candidate] = []
    for _ in range(max(1, n)):
        out = model.generate(
            base, max_new_tokens=max_new_tokens, temperature=temperature,
            top_k=top_k, top_p=top_p, repetition_penalty=repetition_penalty, eos_id=eos_id,
        )
        cont = out[:, base.size(1):]
        score = _score_continuation(model, base, cont)
        ids = cont[0].tolist()
        candidates.append(Candidate(ids=ids, text=tokenizer.decode(ids), score=score))
    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates[0]
