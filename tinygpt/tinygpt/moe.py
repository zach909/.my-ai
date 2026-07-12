"""Sparse Mixture-of-Experts feed-forward layer with named experts ("skills").

Replaces a transformer block's single MLP with N expert MLPs and a router that
sends each token to its top-k experts. This is the real transformer version of
Prometheus §1.5 ("register plugins/skills as real MoE experts"): each expert is
a named skill, routing decisions are traceable to a skill, and a load-balancing
auxiliary loss keeps every expert in use.
"""
from __future__ import annotations

from typing import List, Optional

import torch
import torch.nn as nn
from torch.nn import functional as F


class Expert(nn.Module):
    """One expert = a standard GELU MLP (4x expansion)."""

    def __init__(self, n_embd: int, bias: bool):
        super().__init__()
        self.c_fc = nn.Linear(n_embd, 4 * n_embd, bias=bias)
        self.c_proj = nn.Linear(4 * n_embd, n_embd, bias=bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.c_proj(F.gelu(self.c_fc(x)))


class MoELayer(nn.Module):
    def __init__(self, n_embd: int, n_experts: int, top_k: int, bias: bool,
                 dropout: float = 0.0, skills: Optional[List[str]] = None):
        super().__init__()
        assert 1 <= top_k <= n_experts, "top_k must be in [1, n_experts]"
        self.n_experts = n_experts
        self.top_k = top_k
        self.router = nn.Linear(n_embd, n_experts, bias=False)
        self.experts = nn.ModuleList([Expert(n_embd, bias) for _ in range(n_experts)])
        self.dropout = nn.Dropout(dropout)
        self.skills = skills or [f"expert_{i}" for i in range(n_experts)]
        # diagnostics (not parameters)
        self.last_aux_loss: torch.Tensor = torch.zeros(())
        self.register_buffer("utilization", torch.zeros(n_experts), persistent=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, C = x.shape
        x_flat = x.reshape(-1, C)                          # (N, C)
        n_tokens = x_flat.size(0)

        router_logits = self.router(x_flat)                # (N, E)
        router_probs = F.softmax(router_logits, dim=-1)
        topk_vals, topk_idx = router_probs.topk(self.top_k, dim=-1)   # (N, k)
        # renormalise the kept weights so they sum to 1 per token
        topk_vals = topk_vals / (topk_vals.sum(dim=-1, keepdim=True) + 1e-9)

        out = torch.zeros_like(x_flat)
        for e in range(self.n_experts):
            where = (topk_idx == e)                         # (N, k)
            if not where.any():
                continue
            token_idx, slot = where.nonzero(as_tuple=True)
            weight = topk_vals[token_idx, slot].unsqueeze(-1)
            out[token_idx] += weight * self.experts[e](x_flat[token_idx])

        # load-balancing auxiliary loss (Switch Transformer): f_i · P_i summed,
        # scaled by E. f_i = fraction of tokens whose top-1 expert is i;
        # P_i = mean router probability for expert i.
        with torch.no_grad():
            top1 = topk_idx[:, 0]
            counts = torch.bincount(top1, minlength=self.n_experts).float()
            self.utilization = counts / max(1, n_tokens)
        f_i = torch.bincount(topk_idx[:, 0], minlength=self.n_experts).float() / max(1, n_tokens)
        p_i = router_probs.mean(dim=0)
        self.last_aux_loss = self.n_experts * torch.sum(f_i * p_i)

        return self.dropout(out).reshape(B, T, C)

    def skill_usage(self) -> dict:
        """Per-skill utilization from the last forward pass (fraction of tokens)."""
        return {self.skills[i]: float(self.utilization[i]) for i in range(self.n_experts)}
