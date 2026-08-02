"""Elastic mesh block — Section 5.2: swap the model core, keep the training loop.

A from-scratch PyTorch replacement for the position-wise MLP sublayer,
replicating the TypeScript elastic mesh's core mechanisms as a genuine
architectural difference (not a relabeled MLP):

  - All-to-all (density 1.0) connectivity among N internal "neurons" per
    token: a single dense NxN weight matrix — which is exactly what
    all-to-all wiring collapses to once there is no sparsity mask.
  - Vale-gated state transitions (Section 1.2):
        new_state = vale * old_state + (1 - vale) * computed_state
    iterated for a few settle steps (mirroring hyperdimensional.ts's
    settle()), with vale a learnable per-neuron gate in (0, 1).
  - MoE routing (Section 2.1): several parallel mesh experts plus a router
    that scores them per-token and top-K gates which experts' settled
    output is combined — computation gated, not wiring. (Unlike the TS
    mesh, where every skill's neurons share one physical mesh, an MoE
    *layer*'s experts are conventionally separate parameter sets; each
    expert here is its own settle block for that reason.)
  - Quantum interference (QIL, Sections 1.4/3.5): real hardware isn't
    viable, so this is a *perfect classical simulation* of a small
    variational quantum circuit — genuine amplitude/phase interference via
    PennyLane's statevector simulator (`default.qubit`), not a hand-rolled
    complex-number stand-in. The settled state is angle-encoded into qubit
    rotations, entangled through a small trainable circuit, and read back
    out via Pauli-Z expectation values; PennyLane's TorchLayer makes the
    whole circuit an ordinary differentiable nn.Module, trained by the same
    backprop as everything else in the model.

Written against the decoder-only transformer baseline (model.py's
CausalSelfAttention), which this block's docstring originally described as
"kept unchanged": the TypeScript elastic mesh is a settle-to-convergence
network over a single state vector with no notion of sequence order or
causality, so it had no substitute for the transformer's token-mixing
mechanism, and this block only replaced the *position-wise* MLP sublayer.
That comparison point no longer applies -- model.py has since retired the
transformer baseline entirely in favor of the all-to-all neuron mesh
(MeshLM, tinygpt/mesh.py) as the model. ElasticMeshFFN itself is unaffected
and still tested standalone (test_elastic_mesh.py); build_model() just
never constructs a model that would use it (see pretrain.py's
--use-elastic-mesh warning).
"""
from __future__ import annotations

import math

import pennylane as qml
import torch
import torch.nn as nn

from .config import ModelConfig


def _make_quantum_interference_layer(n_qubits: int, n_layers: int = 2) -> qml.qnn.TorchLayer:
    """A small variational quantum circuit, simulated exactly (statevector,
    no shot noise) on PennyLane's `default.qubit` device: AngleEmbedding
    puts each qubit into a superposition parameterized by the mesh's
    settled state, BasicEntanglerLayers entangles them through trainable
    rotations, and PauliZ expectation values are read back out. Constructive
    / destructive interference between qubits' amplitudes is genuine
    circuit behavior here, not an approximation of it — the "perfect
    simulation" real quantum hardware would be needed for at production
    scale, but at n_qubits this small the classical simulation is exact.
    """
    dev = qml.device("default.qubit", wires=n_qubits)

    @qml.qnode(dev, interface="torch", diff_method="backprop")
    def circuit(inputs, weights):
        qml.AngleEmbedding(inputs, wires=range(n_qubits))
        qml.BasicEntanglerLayers(weights, wires=range(n_qubits))
        return [qml.expval(qml.PauliZ(w)) for w in range(n_qubits)]

    weight_shapes = {"weights": (n_layers, n_qubits)}
    return qml.qnn.TorchLayer(circuit, weight_shapes)


class _MeshExpert(nn.Module):
    """One all-to-all, vale-gated settle block over `n_neurons` internal
    units, finished with simulated-quantum interference before projecting
    back out."""

    def __init__(self, n_embd: int, n_neurons: int, settle_steps: int, n_qubits: int):
        super().__init__()
        self.settle_steps = settle_steps
        self.n_qubits = n_qubits
        self.in_proj = nn.Linear(n_embd, n_neurons)
        # All-to-all (density 1.0) connectivity: one dense NxN matrix. There
        # is no sparsity/masking to apply — full density *is* an ordinary
        # dense linear layer.
        self.W = nn.Linear(n_neurons, n_neurons, bias=True)
        # Per-neuron vale (elasticity/resistance to change), learnable,
        # squashed to (0, 1) — Section 1.2's exact gating formula.
        self.vale_logit = nn.Parameter(torch.zeros(n_neurons))
        # Settled state -> rotation angles for AngleEmbedding, bounded to
        # [-pi, pi] so the encoding is a genuine, well-defined qubit rotation.
        self.to_angles = nn.Linear(n_neurons, n_qubits)
        self.quantum = _make_quantum_interference_layer(n_qubits)
        self.out_proj = nn.Linear(n_qubits, n_embd)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        state = torch.tanh(self.in_proj(x))
        vale = torch.sigmoid(self.vale_logit)
        for _ in range(self.settle_steps):
            computed = torch.tanh(self.W(state))
            state = vale * state + (1 - vale) * computed
        angles = torch.tanh(self.to_angles(state)) * math.pi
        interfered = self.quantum(angles)
        return self.out_proj(interfered)


class ElasticMeshFFN(nn.Module):
    """MoE-routed drop-in replacement for model.py's MLP sublayer. Scores
    `num_experts` mesh experts per token, top-K gates them (Section 2.1:
    the router gates *computation*, unselected experts simply aren't
    evaluated for that token — there is no shared mesh to keep "wired" once
    experts are separate parameter sets, so gating computation is the whole
    story here), and combines the selected experts' outputs by softmax
    router weight."""

    def __init__(self, cfg: ModelConfig, num_experts: int = 4, top_k: int = 2,
                 n_neurons: int = 64, settle_steps: int = 3, n_qubits: int = 4):
        super().__init__()
        self.top_k = min(top_k, num_experts)
        self.router = nn.Linear(cfg.n_embd, num_experts, bias=False)
        self.experts = nn.ModuleList([
            _MeshExpert(cfg.n_embd, n_neurons, settle_steps, n_qubits) for _ in range(num_experts)
        ])
        self.dropout = nn.Dropout(cfg.dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, C = x.shape
        flat = x.reshape(-1, C)  # (B*T, C)

        scores = self.router(flat)  # (B*T, num_experts)
        topk_scores, topk_idx = scores.topk(self.top_k, dim=-1)
        topk_weights = torch.softmax(topk_scores, dim=-1)  # (B*T, top_k)

        out = torch.zeros_like(flat)
        for slot in range(self.top_k):
            expert_idx = topk_idx[:, slot]         # (B*T,) which expert this slot picked
            weight = topk_weights[:, slot:slot + 1]  # (B*T, 1)
            for e, expert in enumerate(self.experts):
                mask = expert_idx == e
                if not mask.any():
                    continue
                out[mask] += weight[mask] * expert(flat[mask])

        return self.dropout(out.view(B, T, C))
