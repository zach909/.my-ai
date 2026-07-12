"""Extension builder (Prometheus section 4) for TinyGPT — declarative training.

A "definishon" is a behavioural contract on the model:

    when "<prompt>"  then the model must continue with  "<required text>"

Training satisfies every contract by a constraint loss (cross-entropy of the
required continuation given the prompt) plus a *don't-forget* weight penalty —
the L2 distance from the model's weights before teaching, so satisfying new
contracts doesn't wipe out what pretraining learned (the notes' "learn but don't
forget"). Contradictory contracts (same/similar prompt, different required
output, or losses that trade off against each other) are detected and reported
so training doesn't loop forever chasing an impossible set.

This is the faithful transformer analog of the mesh's clamp->settle->check
neuron contracts: here the "settled read" is the model's greedy continuation.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import torch
from torch.nn import functional as F


@dataclass
class Definishon:
    when: str
    then: str
    satisfied: bool = False
    final_loss: float = float("inf")


@dataclass
class TrainResult:
    converged: bool
    epochs: int
    satisfied: List[int]
    conflicts: List[Tuple[int, int, float]]   # (i, j, correlation)
    losses: List[float]                       # total loss per epoch


class ExtensionBuilder:
    def __init__(self, model, tokenizer, device: str = "cpu"):
        self.model = model
        self.tok = tokenizer
        self.device = device

    # ---- encoding ---------------------------------------------------------
    def _encode_contract(self, defn: Definishon) -> Tuple[torch.Tensor, torch.Tensor]:
        """Return (input_ids, targets) where targets are -1 on the prompt and the
        real token ids on the required continuation (loss only on the answer)."""
        when_ids = [self.tok.bos_id] + self.tok.encode(defn.when)
        then_ids = self.tok.encode(defn.then) + [self.tok.eos_id]
        ids = when_ids + then_ids
        ids = ids[: self.model.cfg.block_size + 1]
        x = torch.tensor(ids[:-1], dtype=torch.long, device=self.device)
        y = torch.full((len(ids) - 1,), -1, dtype=torch.long, device=self.device)
        # targets align to next-token: positions predicting the `then` tokens
        start = len(when_ids) - 1
        for i in range(start, len(ids) - 1):
            y[i] = ids[i + 1]
        return x.unsqueeze(0), y.unsqueeze(0)

    def _contract_loss(self, defn: Definishon) -> torch.Tensor:
        x, y = self._encode_contract(defn)
        _, loss = self.model(x, y)
        return loss

    @torch.no_grad()
    def is_satisfied(self, defn: Definishon, tolerance: float = 0.5) -> bool:
        """Satisfied iff the constraint loss is below tolerance (the model
        confidently produces the required continuation)."""
        was_training = self.model.training
        self.model.eval()
        loss = self._contract_loss(defn).item()
        if was_training:
            self.model.train()
        defn.final_loss = loss
        return loss < tolerance

    # ---- training ---------------------------------------------------------
    def train(self, contracts: List[Definishon], epochs: int = 200, lr: float = 1e-4,
              weight_penalty: float = 1e-3, tolerance: float = 0.5,
              freeze_when_satisfied: bool = True, verbose: bool = False) -> TrainResult:
        if not contracts:
            return TrainResult(True, 0, [], [], [])

        # structural conflict: identical prompt, different required output
        structural: List[Tuple[int, int, float]] = []
        for i in range(len(contracts)):
            for j in range(i + 1, len(contracts)):
                if contracts[i].when.strip() == contracts[j].when.strip() \
                        and contracts[i].then.strip() != contracts[j].then.strip():
                    structural.append((i, j, -1.0))

        # snapshot of pretrained weights for the don't-forget penalty
        anchor = {n: p.detach().clone() for n, p in self.model.named_parameters()}
        optimizer = torch.optim.AdamW(self.model.parameters(), lr=lr)

        self.model.train()
        loss_history: List[List[float]] = [[] for _ in contracts]
        total_history: List[float] = []
        ran = 0

        for epoch in range(epochs):
            ran = epoch + 1
            optimizer.zero_grad(set_to_none=True)

            per_contract = []
            active_losses = []
            for k, defn in enumerate(contracts):
                loss_k = self._contract_loss(defn)
                per_contract.append(loss_k.item())
                # once satisfied, optionally stop pushing it (freeze/lock, low weight)
                if not (freeze_when_satisfied and defn.satisfied):
                    active_losses.append(loss_k)

            constraint_loss = (torch.stack(active_losses).mean()
                               if active_losses else torch.zeros((), device=self.device))

            # don't-forget penalty: L2 distance from the pretrained weights
            penalty = torch.zeros((), device=self.device)
            for n, p in self.model.named_parameters():
                penalty = penalty + ((p - anchor[n]) ** 2).sum()
            total = constraint_loss + weight_penalty * penalty

            if active_losses:
                total.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                optimizer.step()

            for k in range(len(contracts)):
                loss_history[k].append(per_contract[k])
            total_history.append(float(total.item()))

            # update satisfaction flags
            for defn in contracts:
                defn.satisfied = self.is_satisfied(defn, tolerance)
                self.model.train()

            if verbose and epoch % max(1, epochs // 10) == 0:
                n_sat = sum(d.satisfied for d in contracts)
                print(f"  epoch {epoch:4d} | total {total.item():.4f} | satisfied {n_sat}/{len(contracts)}")

            if all(d.satisfied for d in contracts):
                break

        satisfied = [i for i, d in enumerate(contracts) if d.satisfied]

        # behavioural conflict: unsatisfied pairs whose loss trajectories are
        # strongly anti-correlated (pushing one down pushed the other up).
        conflicts = list(structural)
        for i in range(len(contracts)):
            for j in range(i + 1, len(contracts)):
                if contracts[i].satisfied and contracts[j].satisfied:
                    continue
                corr = _correlation(_deltas(loss_history[i]), _deltas(loss_history[j]))
                if corr < -0.5 and (i, j, -1.0) not in structural:
                    conflicts.append((i, j, corr))

        converged = len(satisfied) == len(contracts)
        return TrainResult(converged, ran, satisfied, conflicts, total_history)


def _deltas(xs: List[float]) -> List[float]:
    return [xs[i + 1] - xs[i] for i in range(len(xs) - 1)]


def _correlation(a: List[float], b: List[float]) -> float:
    n = min(len(a), len(b))
    if n < 2:
        return 0.0
    a, b = a[:n], b[:n]
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((x - mb) ** 2 for x in b)
    if va == 0 or vb == 0:
        return 0.0
    cov = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    return cov / (va ** 0.5 * vb ** 0.5)
