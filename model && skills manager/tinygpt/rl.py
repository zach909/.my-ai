"""Reinforcement-learning reasoning ledger (design doc "Reinforcement
Learning" — "the AI records completed reasoning steps so they are not
repeated unnecessarily").

Generation already evaluates several candidate replies before committing to
one (predict-before-commit, `selection.best_of_n` / `selection.select_by_interference`).
This ledger is the piece that keeps that evaluation from picking the same
"solution" turn after turn: every committed step is recorded, and a step's
score is discounted the more times it has already been chosen, so a repeated
non-answer ("I'm not sure, could you clarify?" verbatim, forever) loses out to
a candidate that hasn't already failed to move the conversation forward.

Local JSON persistence only (mirrors ZipLoopMemory / EmpathyEngine's
persist_path convention) — no external APIs, no network calls.
"""
from __future__ import annotations

import json
import os
from collections import deque
from typing import Deque, Dict, List, Optional, Protocol


def _key(step: str) -> str:
    """Normalise a reasoning step/reply for repeat detection: case- and
    whitespace-insensitive, so trivial re-formatting still counts as a repeat."""
    return " ".join(step.strip().lower().split())


class _ScoredCandidate(Protocol):
    text: str
    score: float


class ReasoningLedger:
    def __init__(self, capacity: int = 1000, repeat_penalty: float = 0.35,
                 max_penalty: float = 0.9, persist_path: Optional[str] = None):
        self.capacity = capacity
        self.repeat_penalty = repeat_penalty
        self.max_penalty = max_penalty
        self.persist_path = persist_path
        self._counts: Dict[str, int] = {}
        self._order: Deque[str] = deque(maxlen=capacity)
        self.total_recorded = 0
        if persist_path and os.path.exists(persist_path):
            self.load()

    def times_seen(self, step: str) -> int:
        return self._counts.get(_key(step), 0)

    def penalty(self, step: str) -> float:
        """Score deduction for a step, growing with how often it recurs,
        capped so a candidate is discouraged rather than made unpickable."""
        n = self.times_seen(step)
        return min(self.max_penalty, self.repeat_penalty * n)

    def record(self, step: str) -> int:
        """Mark a reasoning step/reply as completed. Returns the new times-seen
        count. Bounded by `capacity` (oldest distinct step is forgotten first,
        LRU-by-insertion-order) so the ledger cannot grow without limit."""
        key = _key(step)
        if key not in self._counts:
            if len(self._order) >= self.capacity:
                oldest = self._order.popleft()
                self._counts.pop(oldest, None)
            self._order.append(key)
        self._counts[key] = self._counts.get(key, 0) + 1
        self.total_recorded += 1
        return self._counts[key]

    def rescore(self, candidates: List[_ScoredCandidate]) -> List[_ScoredCandidate]:
        """Apply the repeat penalty to `.score` on each candidate (duck-typed:
        anything with `.text` and `.score`, e.g. `selection.Candidate`) and
        return them re-sorted best-first. Does not mutate ledger state — call
        `record()` separately once a candidate is actually committed."""
        for c in candidates:
            c.score -= self.penalty(c.text)
        candidates.sort(key=lambda c: c.score, reverse=True)
        return candidates

    def save(self) -> None:
        if not self.persist_path:
            return
        os.makedirs(os.path.dirname(self.persist_path) or ".", exist_ok=True)
        with open(self.persist_path, "w", encoding="utf-8") as f:
            json.dump({
                "counts": self._counts,
                "order": list(self._order),
                "total_recorded": self.total_recorded,
            }, f)

    def load(self) -> None:
        if not self.persist_path or not os.path.exists(self.persist_path):
            return
        try:
            with open(self.persist_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return  # a corrupt checkpoint must never take down the core
        self._counts = data.get("counts", {})
        self._order = deque(data.get("order", []), maxlen=self.capacity)
        self.total_recorded = data.get("total_recorded", 0)

    def __len__(self) -> int:
        return self.total_recorded
