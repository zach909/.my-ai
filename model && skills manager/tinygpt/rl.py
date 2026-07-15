"""Reinforcement learning over candidate solutions (design note: the system
evaluates multiple possible solutions before selecting an action, and records
completed reasoning steps so they are not repeated unnecessarily).

Two pieces, both real:

  - `ReasoningLedger` — a persistent record of completed reasoning steps
    (prompt -> committed reply). Candidate scoring consults it so the core
    does not commit the same reasoning again for the same kind of prompt;
    repeats are penalised, not forbidden (sometimes repeating is right).

  - `reinforce_step` — one genuine REINFORCE policy-gradient update: sample N
    candidate continuations, score each with a reward (by default the ledger-
    penalised model confidence), subtract the batch-mean baseline, and push
    the model's log-probability of above-baseline candidates up and of
    below-baseline candidates down. This is the training-time counterpart of
    predict-before-commit (`selection.best_of_n`), which remains the
    inference-time evaluator.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from typing import Callable, List, Optional

import torch
from torch.nn import functional as F

from .selection import Candidate, best_of_n


def _normalise(text: str) -> str:
    """Case/whitespace/punctuation-insensitive form for repeat detection."""
    return re.sub(r"[^a-z0-9 ]+", "", text.lower()).strip()


def _digest(text: str) -> str:
    return hashlib.sha256(_normalise(text).encode("utf-8")).hexdigest()[:16]


class ReasoningLedger:
    """Records completed reasoning steps so they are not repeated unnecessarily."""

    def __init__(self, capacity: int = 4096, persist_path: Optional[str] = None):
        self.capacity = capacity
        self.persist_path = persist_path
        self._order: List[str] = []          # insertion order for eviction
        self._steps: dict[str, str] = {}     # digest -> normalised step text
        if persist_path and os.path.exists(persist_path):
            self.load()

    def __len__(self) -> int:
        return len(self._steps)

    def record(self, step: str) -> None:
        """Mark one reasoning step (typically a committed reply) as completed."""
        key = _digest(step)
        if key in self._steps:
            return
        self._steps[key] = _normalise(step)
        self._order.append(key)
        while len(self._order) > self.capacity:
            evicted = self._order.pop(0)
            self._steps.pop(evicted, None)
        if self.persist_path:
            self.save()

    def seen(self, step: str) -> bool:
        return _digest(step) in self._steps

    def repeat_penalty(self, candidate: str, weight: float = 1.0) -> float:
        """0 for novel candidates; `weight` for an exact (normalised) repeat;
        a partial penalty when the candidate contains a recorded step verbatim."""
        norm = _normalise(candidate)
        if not norm:
            return 0.0
        if _digest(candidate) in self._steps:
            return weight
        for recorded in self._steps.values():
            if len(recorded) >= 12 and recorded in norm:
                return 0.5 * weight
        return 0.0

    def save(self) -> None:
        if not self.persist_path:
            return
        os.makedirs(os.path.dirname(self.persist_path) or ".", exist_ok=True)
        with open(self.persist_path, "w", encoding="utf-8") as f:
            json.dump({"order": self._order, "steps": self._steps}, f)

    def load(self) -> None:
        try:
            with open(self.persist_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            self._steps = dict(payload.get("steps", {}))
            self._order = [k for k in payload.get("order", []) if k in self._steps]
        except (json.JSONDecodeError, TypeError, ValueError, OSError):
            self._order, self._steps = [], {}


def score_with_ledger(candidates: List[Candidate], ledger: ReasoningLedger,
                      penalty: float = 0.75) -> List[float]:
    """Confidence scores minus the ledger's repeat penalty, one per candidate."""
    return [c.score - ledger.repeat_penalty(c.text, weight=penalty)
            for c in candidates]


def _sequence_logprob(model, prompt_ids: List[int], cont_ids: List[int],
                      device: str) -> torch.Tensor:
    """Differentiable sum of log P(cont | prompt) under the model."""
    full = torch.tensor([prompt_ids + cont_ids], dtype=torch.long, device=device)
    # passing targets makes forward() return logits for every position (B, T, V);
    # without them the mesh returns only the final position's logits
    logits, _ = model(full[:, :-1], targets=full[:, 1:])
    logprobs = F.log_softmax(logits[0], dim=-1)
    n_prompt = len(prompt_ids)
    targets = full[0, 1:]
    # positions n_prompt-1 .. end predict the continuation tokens
    idx = torch.arange(n_prompt - 1, full.size(1) - 1, device=device)
    return logprobs[idx, targets[idx]].sum()


def reinforce_step(model, tokenizer, prompt_ids: List[int], *, n: int = 4,
                   max_new_tokens: int = 32, temperature: float = 1.0,
                   lr: float = 1e-4, device: str = "cpu",
                   ledger: Optional[ReasoningLedger] = None,
                   reward_fn: Optional[Callable[[Candidate], float]] = None):
    """One REINFORCE update from N sampled solutions.

    Returns (candidates, rewards, loss_value). The model is updated in place;
    callers decide when/whether to persist a checkpoint.
    """
    was_training = model.training
    model.eval()
    candidates = best_of_n(model, tokenizer, prompt_ids, n=n,
                           max_new_tokens=max_new_tokens, temperature=temperature,
                           top_k=None, top_p=None, repetition_penalty=1.0,
                           eos_id=tokenizer.eos_id, device=device,
                           return_all=True)
    if reward_fn is not None:
        rewards = [float(reward_fn(c)) for c in candidates]
    elif ledger is not None:
        rewards = score_with_ledger(candidates, ledger)
    else:
        rewards = [c.score for c in candidates]

    baseline = sum(rewards) / len(rewards)
    advantages = [r - baseline for r in rewards]

    model.train()
    optimizer = torch.optim.SGD(model.parameters(), lr=lr)
    optimizer.zero_grad(set_to_none=True)
    loss = torch.zeros((), device=device)
    for cand, adv in zip(candidates, advantages):
        if not cand.ids or abs(adv) < 1e-9:
            continue
        logprob = _sequence_logprob(model, prompt_ids, cand.ids, device)
        loss = loss - adv * logprob / max(1, len(cand.ids))
    if loss.requires_grad:
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
    model.train(was_training)
    return candidates, rewards, float(loss.detach())
