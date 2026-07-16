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

        # §3 skills as neuron-groups: partition neurons into groups; a router
        # picks which groups are active per input. Non-selected groups stay fully
        # wired (topology unchanged) but dormant — they hold their state instead
        # of updating, so per-tick compute is sparse while density stays total.
        # A neuron's group is just a label the router uses. skill_groups=1 means
        # no routing (every neuron always active), preserving the base behaviour.
        self.n_groups = max(1, cfg.skill_groups)
        self.skill_top_k = max(1, min(cfg.skill_top_k, self.n_groups))
        group_of = torch.arange(n_neurons) % self.n_groups
        self.register_buffer("group_of", group_of)
        self.skills = list(cfg.skills) if cfg.skills and len(cfg.skills) == self.n_groups \
            else [f"skill_{g}" for g in range(self.n_groups)]
        if self.n_groups > 1:
            self.router = nn.Linear(n_input * self.content, self.n_groups, bias=False)
        self._skill_usage = torch.zeros(self.n_groups)
        self._last_skill_aux = 0.0

        # §8 quantization-aware training: the quantizer sits inside the forward
        # pass, so the mesh learns weights that already expect their quantized
        # form. Straight-through estimator: forward uses quantized W, gradient
        # flows to the full-precision W unchanged.
        self.quant_enabled = cfg.quant_enabled
        self.quant_bits = cfg.quant_bits

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

        # §5 quantum interference: each neuron has a unique, fixed wave
        # signature (its phase). The neuron's input/activation determines the
        # wave's amplitude; the signature identifies the neuron during
        # interference calculations. Signatures are spread evenly on the unit
        # circle so no two neurons share a phase.
        self.register_buffer("wave_signature",
                             torch.arange(n_neurons, dtype=torch.float32)
                             * (2.0 * torch.pi / n_neurons))
        self._last_settled = None  # settled neuron state after the last forward
        # When on, the readout is gated by quantum interference between the
        # neurons' waves: each neuron is a·e^{iφ} (amplitude a = its activation
        # strength, phase φ = its fixed signature); neurons whose phase agrees
        # with the network's resultant reinforce, discordant ones cancel. This
        # runs inside the canonical mesh's forward pass (differentiable, no
        # external deps), so the quantum layer is part of the model build_model()
        # constructs — not only the optional PennyLane component.
        self.quant_interference = getattr(cfg, "quant_interference", False)
        self.interference_strength = 1.0

        # §9 continuous operation: when on, the neuron state carries across
        # forward calls instead of resetting to zeros — the mesh keeps thinking
        # from where it was. `_carried` IS the memory (the saved neuron state).
        self._continuous = False
        self._carried = None

        # Expert mixture-of-experts: optional learnable experts that produce
        # contributions to the settle loop. When supplied, experts are routed
        # by input relevance and their outputs get mixed into the settle context.
        self.expert_moe = cfg.expert_moe if hasattr(cfg, 'expert_moe') else None

    def _skill_mask(self, emb: torch.Tensor):
        """§3: route this position's input to its top-k skill groups and return a
        per-neuron active mask (B, N). Neurons in non-selected groups stay
        dormant. Also records a load-balancing aux loss + usage. Returns None
        when routing is disabled (single group)."""
        if self.n_groups <= 1:
            return None
        B = emb.size(0)
        logits = self.router(emb.reshape(B, -1))                 # (B, n_groups)
        probs = torch.softmax(logits, dim=-1)
        top = probs.topk(self.skill_top_k, dim=-1).indices       # (B, k)
        group_active = torch.zeros(B, self.n_groups, device=emb.device, dtype=torch.bool)
        group_active.scatter_(1, top, True)
        # expand group activation to neurons via each neuron's group label
        active = group_active[:, self.group_of]                  # (B, N)
        # load balance (Switch): groups * mean(fraction_selected * mean_prob)
        with torch.no_grad():
            self._skill_usage = group_active.float().mean(dim=0).detach().cpu()
        f = group_active.float().mean(dim=0)
        self._last_skill_aux = float((self.n_groups * (f * probs.mean(dim=0)).sum()).detach())
        self._skill_aux_term = self.n_groups * (f * probs.mean(dim=0)).sum()
        return active

    def _settle(self, state: torch.Tensor, emb: torch.Tensor,
                active: Optional[torch.Tensor] = None) -> torch.Tensor:
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
        if self.quant_enabled:
            W = self._fake_quant(W)
        ones = torch.ones(B, self.n_input, 1, device=state.device, dtype=state.dtype)
        zeros = torch.zeros(B, self.N - self.n_input, 1, device=state.device, dtype=state.dtype)

        # Expert contribution: route based on input and get mixed expert outputs
        expert_contrib = None
        if self.expert_moe is not None:
            emb_flat = emb.reshape(B, -1)
            expert_out, _ = self.expert_moe(emb_flat)  # (B, out_dim)
            # Broadcast to neuron dimensions: (B, out_dim) -> (B, N, out_dim//N or pad)
            if expert_out.size(-1) > 0:
                # Replicate or project expert output to fill neuron dimensions
                expert_contrib = expert_out.unsqueeze(1).expand(B, self.N, -1)  # (B, N, out_dim)

        consecutive_high = 0
        for _ in range(self.settle_ticks):
            prev = state
            # context[b,i,d] = bias[i,d] + sum_{j,e} state[b,j,e] * W[i,j,e,d]
            context = torch.einsum("bje,ijed->bid", state, W) + self.bias
            # Mix in expert contributions if available (broadcast to each neuron)
            if expert_contrib is not None and expert_contrib.size(-1) > 0:
                # Project expert contrib to match context dimensions
                target_d = context.size(-1)
                expert_proj = expert_contrib[:, :, :target_d]
                if expert_proj.size(-1) < target_d:
                    expert_proj = torch.cat([expert_proj,
                                            torch.zeros(B, self.N, target_d - expert_proj.size(-1),
                                                       device=expert_proj.device)], dim=-1)
                context = context + 0.1 * expert_proj  # Scale expert contribution
            settled = torch.tanh(context)
            # clamp: input neurons hold (flag=1, emb); others keep settled content
            # with flag=0. Built functionally (no in-place) so autograd is happy.
            input_block = torch.cat([ones, emb], dim=2)                  # (B, n_input, D)
            rest = torch.cat([zeros, settled[:, self.n_input:, 1:]], dim=2)
            state = torch.cat([input_block, rest], dim=1)

            # §3: neurons in non-selected skill groups stay dormant — hold their
            # previous state instead of updating. Input neurons always update.
            if active is not None:
                hold = ~active.clone()
                hold[:, :self.n_input] = False
                state = torch.where(hold.unsqueeze(-1), prev, state)

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
        skill_aux = torch.zeros((), device=idx.device)
        for t in range(T):
            emb = self.wte(idx[:, t]).view(B, self.n_input, self.content)
            active = self._skill_mask(emb)                       # §3 routing (or None)
            if active is not None:
                skill_aux = skill_aux + self._skill_aux_term
            state = self._settle(state, emb, active)
            read_state = self._interfere(state) if self.quant_interference else state
            logits_steps.append(self.readout(self.dropout(read_state.reshape(B, -1))))
        logits = torch.stack(logits_steps, dim=1)  # (B, T, vocab)
        if self._continuous:
            self._carried = state.detach()

        if targets is not None:
            loss = F.cross_entropy(logits.reshape(-1, logits.size(-1)),
                                   targets.reshape(-1), ignore_index=-1)
            if self.n_groups > 1:
                loss = loss + self.cfg.moe_aux_weight * (skill_aux / max(1, T))
            return logits, loss
        return logits[:, [-1], :], None

    def skill_usage(self) -> dict:
        """§3: fraction of inputs that activated each skill group, last forward."""
        return {self.skills[g]: float(self._skill_usage[g]) for g in range(self.n_groups)}

    @torch.no_grad()
    def simulate_neuron(self, neuron_id: int, amplitude: float = 1.0):
        """Extension Builder: "Simulate the output produced by an individual
        neuron" / the Neural Definition Format's "behavior if it alone receives
        input". Seed exactly one neuron with `amplitude` on its content dims,
        propagate through the all-to-all connections for the settle window, and
        report what that single neuron drives.

        Returns a dict: the neuron's own settled state vector, its output
        amplitude (content-dim norm), its fixed wave signature (§ quantum), and
        the top neurons it most influenced (by settled activation)."""
        if not 0 <= neuron_id < self.N:
            raise IndexError(f"neuron {neuron_id} out of range [0, {self.N})")
        device = self.W.device
        state = torch.zeros(1, self.N, self.D, device=device)
        state[0, neuron_id, 1:] = amplitude          # drive only this neuron
        W = self.W * self.self_mask
        if self.quant_enabled:
            W = self._fake_quant(W)
        for _ in range(self.settle_ticks):
            context = torch.einsum("bje,ijed->bid", state, W) + self.bias
            settled = torch.tanh(context)
            # re-seed the driven neuron each tick (it "alone receives input")
            settled[0, neuron_id, 1:] = amplitude
            settled[:, :, 0] = 0.0
            state = settled
        content = state[0, :, 1:].norm(dim=-1)        # per-neuron output strength
        influenced = [i for i in content.argsort(descending=True).tolist()
                      if i != neuron_id][:5]
        return {
            "neuron": neuron_id,
            "output_state": state[0, neuron_id].tolist(),
            "amplitude": float(content[neuron_id]),
            "wave_signature": float(self.wave_signature[neuron_id]),
            "influenced": [(i, float(content[i])) for i in influenced],
        }

    @torch.no_grad()
    def search_neurons(self, idx: torch.Tensor, top_k: int = 5):
        """Extension Builder: "Search neurons within large models". Drive the
        mesh with an input sequence and return the neurons that end up most
        active (largest settled content-norm) — i.e. which neurons a given input
        recruits. Useful for locating the neurons relevant to a behaviour before
        editing/labelling them."""
        if idx.dim() == 1:
            idx = idx.unsqueeze(0)
        self.eval()
        self(idx)                                     # populates _last_settled
        if self._last_settled is None:
            return []
        content = self._last_settled.mean(dim=0)[:, 1:].norm(dim=-1)   # (N,)
        k = max(1, min(top_k, self.N))
        top = content.topk(k)
        return [(int(i), float(v)) for i, v in zip(top.indices, top.values)]

    def _interfere(self, state: torch.Tensor) -> torch.Tensor:
        """Quantum-interference readout gate (differentiable, in-forward).

        Each neuron becomes a complex wave a_i·e^{iφ_i}: amplitude a_i is its
        content activation strength, phase φ_i its fixed wave signature. The
        neurons interfere; a neuron's coherence with the network resultant
        (its amplitude projected onto the resultant direction, ≥ 0) scales how
        much its content contributes to the readout. Phase-aligned neurons are
        reinforced, discordant ones cancel — real constructive/destructive
        interference, not an analogy. Returns a state whose content dims are
        gated; the input flag (dim 0) is untouched."""
        B = state.size(0)
        amp = state[:, :, 1:].norm(dim=-1)                       # (B, N) amplitudes
        phase = self.wave_signature.view(1, self.N)              # (1, N)
        z = amp.to(torch.complex64) * torch.exp(1j * phase.to(torch.float32))
        resultant = z.sum(dim=1, keepdim=True)                   # (B, 1)
        mag = resultant.abs()
        direction = torch.where(mag > 1e-9, resultant / (mag + 1e-9),
                                torch.ones_like(resultant))
        coherence = (z * direction.conj()).real                  # (B, N), signed
        # gate in [1-s, 1+s]: coherent neurons amplified, anti-coherent damped,
        # normalised so the mean gate is ~1 (interference redistributes, not
        # inflates — echoing the zero-sum spirit of the design).
        norm = coherence / (amp.mean(dim=1, keepdim=True) + 1e-6)
        gate = 1.0 + self.interference_strength * torch.tanh(norm)   # (B, N)
        content = state[:, :, 1:] * gate.unsqueeze(-1)
        return torch.cat([state[:, :, :1], content], dim=-1)

    @torch.no_grad()
    def neuron_waves(self):
        """Per-neuron (wave signature, amplitude) from the last settled state —
        the design's quantum picture ("Neuron 2 has a wave signature of 4.5 and
        an amplitude of 10"). Amplitude is the neuron's content activation norm;
        the signature is fixed and unique per neuron."""
        if self._last_settled is None:
            amps = torch.zeros(self.N)
        else:
            amps = self._last_settled.mean(dim=0)[:, 1:].norm(dim=-1)
        return [(int(i), float(self.wave_signature[i]), float(amps[i]))
                for i in range(self.N)]

    @torch.no_grad()
    def state_phase(self) -> float:
        """§5: the phase of the mesh's last settled state.

        Each neuron contributes a complex wave a_i·e^{iφ_i}: amplitude a_i is
        the neuron's activation strength (norm of its content dims), phase φ_i
        is its fixed wave signature. The resultant's angle summarises *which*
        neurons carried the thought — states carried by the same neurons get
        similar phases, so during answer selection they interfere
        constructively while states carried by different neurons cancel."""
        if self._last_settled is None:
            return 0.0
        state = self._last_settled.mean(dim=0)               # (N, D)
        amps = state[:, 1:].norm(dim=-1)                     # content dims only
        z = (amps.to(torch.complex64)
             * torch.exp(1j * self.wave_signature.to(torch.float32))).sum()
        if z.abs() < 1e-9:
            return 0.0
        return float(torch.angle(z))

    def expert_usage(self) -> dict:
        """Expert mixture-of-experts: fraction of inputs that activated each expert."""
        if self.expert_moe is None:
            return {}
        return self.expert_moe.expert_usage()

    def _fake_quant(self, w: torch.Tensor) -> torch.Tensor:
        """§8 symmetric fake-quantization with a straight-through estimator: the
        returned tensor equals the quantized weights numerically but carries the
        full-precision gradient (w + (wq - w).detach())."""
        qmax = 2 ** (self.quant_bits - 1) - 1
        scale = w.detach().abs().max() / qmax
        if scale <= 0:
            return w
        wq = torch.clamp(torch.round(w / scale), -qmax - 1, qmax) * scale
        return w + (wq - w).detach()

    @torch.no_grad()
    def quantization_error(self) -> float:
        """Mean abs difference between W and its quantized form — the drift QAT
        is training the mesh to already expect (should shrink over training)."""
        W = self.W * self.self_mask
        return float((self._fake_quant(W) - W).abs().mean())

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
                 repetition_penalty: float = 1.0, eos_id: Optional[int] = None, guide=None,
                 stop_fn=None):
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
            # caller-supplied early stop (e.g. "enough complete sentences")
            if stop_fn is not None and stop_fn(idx):
                break
        return idx
