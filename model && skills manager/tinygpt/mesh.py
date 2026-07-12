"""MeshLM — the all-to-all neuron mesh (Prometheus §1) as a trainable PyTorch
module, an experimental alternative to the transformer's attention+MLP block.

This is the substrate the design is really about: instead of attention over a
sequence, a mesh of N neurons — each holding a D-dimensional state vector — that
propagates all-to-all until it settles, then reads out the next-token logits. It
is deliberately built so the *existing* training infrastructure (tokenizer, data
loader, AdamW loop, checkpointing, sampling) trains it unchanged — the loop is
"pointed at the mesh instead of at attention layers".

Faithful to the design notes:
  - true all-to-all density (every neuron reads every other; self excluded);
  - each connection is a D×D weight block (any source dimension can influence
    any target dimension — cross-dimensional reasoning), not one scalar;
  - bias is added once per neuron after the full summed product, never per
    connection;
  - a reasoning step is several settle ticks of `state <- tanh(bias + W·state)`;
  - dimension 0 of every neuron is the reserved input-source flag (§6): 1.0 while
    externally driven, 0.0 otherwise. Input neurons are clamped each tick (§4:
    clamp -> settle -> read).

It is recurrent across positions (mesh state carries forward), so it is a real
language model trained by truncated backprop through the settle loop. It is not
claimed to beat the transformer — it is the unproven substrate to test.
"""
from __future__ import annotations

from typing import Optional

import torch
import torch.nn as nn
from torch.nn import functional as F

from .config import ModelConfig


class MeshLM(nn.Module):
    def __init__(self, cfg: ModelConfig, n_neurons: Optional[int] = None,
                 n_dims: Optional[int] = None, n_input: Optional[int] = None,
                 settle_ticks: Optional[int] = None):
        super().__init__()
        # mesh hyperparameters come from the config (so checkpoints round-trip);
        # explicit args override for quick experiments.
        n_neurons = n_neurons if n_neurons is not None else cfg.mesh_neurons
        n_dims = n_dims if n_dims is not None else cfg.mesh_dims
        n_input = n_input if n_input is not None else cfg.mesh_input
        settle_ticks = settle_ticks if settle_ticks is not None else cfg.settle_ticks
        assert n_dims >= 2, "need dim 0 for the input flag plus >=1 content dim"
        assert 1 <= n_input < n_neurons
        self.cfg = cfg
        self.N = n_neurons
        self.D = n_dims
        self.n_input = n_input
        self.settle_ticks = settle_ticks
        self.content = n_dims - 1  # content dims per neuron (dim 0 is the flag)

        self.wte = nn.Embedding(cfg.vocab_size, n_input * self.content)
        # all-to-all connection tensor: W[i, j] is the D×D block from neuron j
        # into neuron i. Scaled small for a stable settle.
        scale = 1.0 / (n_neurons * n_dims) ** 0.5
        self.W = nn.Parameter(torch.randn(n_neurons, n_neurons, n_dims, n_dims) * scale)
        self.bias = nn.Parameter(torch.zeros(n_neurons, n_dims))
        self.readout = nn.Linear(n_neurons * n_dims, cfg.vocab_size, bias=True)
        # mask out self-connections (a neuron reads every *other* neuron)
        self.register_buffer("self_mask",
                             (1.0 - torch.eye(n_neurons)).view(n_neurons, n_neurons, 1, 1))
        self.dropout = nn.Dropout(cfg.dropout)

        # §2 vale / value budget: per-neuron plasticity. vale in [0,1]; high-vale
        # neurons resist change, low-vale neurons learn readily. It gates the
        # weight update — a neuron i's incoming connection + bias gradients are
        # scaled by (1 - vale[i]) — so it IS the rule for how much each neuron
        # moves, not a separate freeze. vale is zero-sum (total fixed); raising
        # one neuron's vale lowers the rest. Buffer, not a learned parameter.
        self.register_buffer("vale", torch.full((n_neurons,), cfg.vale_init))
        self._vale_total = float(cfg.vale_init) * n_neurons
        # gradient hooks apply the vale gate during backward — no trainer change.
        self.W.register_hook(lambda g: g * (1.0 - self.vale).view(self.N, 1, 1, 1))
        self.bias.register_hook(lambda g: g * (1.0 - self.vale).view(self.N, 1))

        # §7 live-correction thresholds + diagnostics
        self.divergence_tolerance = cfg.divergence_tolerance
        self.sustained_divergence_ticks = cfg.sustained_divergence_ticks
        self._live_corrections = 0
        self._last_surprise = 0.0

        # §9 continuous operation: when on, the neuron state carries across
        # forward calls instead of resetting to zeros — the mesh keeps thinking
        # from where it was. `_carried` IS the memory (the saved neuron state).
        self._continuous = False
        self._carried = None

    def _settle(self, state: torch.Tensor, emb: torch.Tensor) -> torch.Tensor:
        """Run the settle loop for one position; `emb` (B, n_input, content) is
        clamped onto the input neurons each tick.

        §6 self-model + §7 live correction: each tick's change from the previous
        tick is the mesh's own prediction error. If that stays large across
        several *consecutive* ticks (sustained divergence, not one noisy tick),
        the update is damped — blended back toward the previous state — steering
        a run-away settle back toward convergence rather than letting it drift.
        This runs during settling, not just at the end.
        """
        B = state.size(0)
        W = self.W * self.self_mask
        ones = torch.ones(B, self.n_input, 1, device=state.device, dtype=state.dtype)
        zeros = torch.zeros(B, self.N - self.n_input, 1, device=state.device, dtype=state.dtype)
        consecutive_high = 0
        for _ in range(self.settle_ticks):
            prev = state
            # context[b,i,d] = bias[i,d] + sum_{j,e} state[b,j,e] * W[i,j,e,d]
            context = torch.einsum("bje,ijed->bid", state, W) + self.bias
            settled = torch.tanh(context)
            # clamp: input neurons hold (flag=1, emb); others keep settled content
            # with flag=0. Built functionally (no in-place) so autograd is happy.
            input_block = torch.cat([ones, emb], dim=2)                  # (B, n_input, D)
            rest = torch.cat([zeros, settled[:, self.n_input:, 1:]], dim=2)
            state = torch.cat([input_block, rest], dim=1)

            # tick-to-tick divergence (self-model surprise). Detached: it only
            # drives the control-flow decision, not the gradient.
            divergence = float((state[:, self.n_input:, 1:]
                                - prev[:, self.n_input:, 1:]).abs().mean().detach())
            if divergence > self.divergence_tolerance:
                consecutive_high += 1
            else:
                consecutive_high = 0
            if consecutive_high >= self.sustained_divergence_ticks:
                # live correction: damp toward the previous state to re-route
                state = 0.5 * state + 0.5 * prev
                self._live_corrections += 1
                consecutive_high = 0
            self._last_surprise = divergence
        return state

    def forward(self, idx: torch.Tensor, targets: Optional[torch.Tensor] = None):
        B, T = idx.shape
        self._live_corrections = 0  # §7: count re-routes applied this pass
        # §9: continue from carried neuron state if running continuously, else
        # start fresh. Carried state is detached (truncated BPTT across calls).
        if self._continuous and self._carried is not None and self._carried.size(0) == B:
            state = self._carried.to(idx.device)
        else:
            state = torch.zeros(B, self.N, self.D, device=idx.device)
        logits_steps = []
        for t in range(T):
            emb = self.wte(idx[:, t]).view(B, self.n_input, self.content)
            state = self._settle(state, emb)
            logits_steps.append(self.readout(self.dropout(state.reshape(B, -1))))
        logits = torch.stack(logits_steps, dim=1)  # (B, T, vocab)
        if self._continuous:
            self._carried = state.detach()

        if targets is not None:
            loss = F.cross_entropy(logits.reshape(-1, logits.size(-1)),
                                   targets.reshape(-1), ignore_index=-1)
            return logits, loss
        return logits[:, [-1], :], None

    # ---- §2 vale / value budget --------------------------------------------
    @torch.no_grad()
    def raise_vale(self, neuron_ids, amount: float = 0.3) -> None:
        """Raise the vale (stability) of the given neurons and lower everyone
        else's proportionally, keeping the total fixed (zero-sum). Used to lock
        in a neuron once its meaning is verified (extension builder, §4)."""
        ids = torch.as_tensor(list(neuron_ids), dtype=torch.long, device=self.vale.device)
        if ids.numel() == 0:
            return
        raise_amt = float(amount) * ids.numel()
        others = torch.ones(self.N, dtype=torch.bool, device=self.vale.device)
        others[ids] = False
        self.vale[ids] = torch.clamp(self.vale[ids] + amount, 0.0, 1.0)
        # remove the same total from the other neurons, proportional to their vale
        if others.any():
            pool = self.vale[others]
            share = pool / (pool.sum() + 1e-9)
            self.vale[others] = torch.clamp(pool - share * raise_amt, 0.0, 1.0)
        # renormalise to the fixed total
        self.vale.mul_(self._vale_total / (self.vale.sum() + 1e-9))
        self.vale.clamp_(0.0, 1.0)

    @torch.no_grad()
    def set_vale(self, neuron_id: int, value: float) -> None:
        self.vale[neuron_id] = max(0.0, min(1.0, value))

    def get_vale(self):
        return self.vale.detach().cpu().tolist()

    # ---- §9 continuous operation + neuron-state memory ---------------------
    def enable_continuous(self, on: bool = True) -> None:
        """Turn on continuous mode: the neuron state carries across calls."""
        self._continuous = on
        if not on:
            self._carried = None

    def reset_state(self) -> None:
        self._carried = None

    def get_state(self):
        """The current carried neuron state (the mesh's 'thoughts'), or None."""
        return None if self._carried is None else self._carried.detach().cpu()

    def save_state(self, path: str) -> Optional[str]:
        """Memory = save the neuron state (the neuron inputs) to disk."""
        if self._carried is None:
            return None
        import os
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        torch.save({"state": self._carried.detach().cpu(), "N": self.N, "D": self.D}, path)
        return path

    def load_state(self, path: str) -> None:
        """Reload a previously saved neuron state, resuming that train of thought."""
        data = torch.load(path, map_location="cpu")
        if data.get("N") == self.N and data.get("D") == self.D:
            self._carried = data["state"]
            self._continuous = True

    def num_params(self, non_embedding: bool = True) -> int:
        n = sum(p.numel() for p in self.parameters())
        if non_embedding:
            n -= self.wte.weight.numel()
        return n

    def configure_optimizers(self, weight_decay: float, learning_rate: float,
                             betas, device_type: str):
        decay = [p for p in self.parameters() if p.dim() >= 2]
        no_decay = [p for p in self.parameters() if p.dim() < 2]
        groups = [{"params": decay, "weight_decay": weight_decay},
                  {"params": no_decay, "weight_decay": 0.0}]
        return torch.optim.AdamW(groups, lr=learning_rate, betas=betas)

    @torch.no_grad()
    def generate(self, idx: torch.Tensor, max_new_tokens: int, temperature: float = 1.0,
                 top_k: Optional[int] = None, top_p: Optional[float] = None,
                 repetition_penalty: float = 1.0, eos_id: Optional[int] = None, guide=None):
        from .sampling import sample_next_token
        for _ in range(max_new_tokens):
            idx_cond = idx if idx.size(1) <= self.cfg.block_size else idx[:, -self.cfg.block_size:]
            logits, _ = self(idx_cond)
            logits = logits[:, -1, :]
            t, tk, tp = temperature, top_k, top_p
            if guide is not None:
                conf = float(F.softmax(logits, dim=-1).max(dim=-1).values.mean().item())
                gp = guide.adjust(conf)
                t, tk, tp = gp.temperature, gp.top_k, gp.top_p
            next_id = sample_next_token(logits, idx, temperature=t, top_k=tk, top_p=tp,
                                        repetition_penalty=repetition_penalty)
            idx = torch.cat((idx, next_id), dim=1)
            if eos_id is not None and (next_id == eos_id).all():
                break
        return idx
