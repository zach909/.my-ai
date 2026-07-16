"""Smoke test for the model cores.

Guards two things against silently breaking:

1. The **all-to-all neuron mesh** (`tinygpt/mesh.py`) — the model that
   `build_model()` returns — constructs, forward/backward-passes with finite
   gradients, and generates, both in its base configuration and with skill
   routing (§3) and quantization-aware training (§8) enabled.
2. The **elastic-mesh expert core** (`tinygpt/elastic_mesh.py`, Section 5.2) —
   the MoE-routed, PennyLane-simulated quantum-interference block — still
   forward/backward-passes as a standalone drop-in module.

Not a training run (that's exercised manually — see the session's comparison
write-up); this just guards the architectures themselves.

Run with: python3 test_elastic_mesh.py
"""
import torch

from tinygpt.config import ModelConfig
from tinygpt.elastic_mesh import ElasticMeshFFN
from tinygpt.model import build_model


def check(cond: bool, msg: str) -> None:
    status = "ok  " if cond else "FAIL"
    print(f"{status} {msg}")
    if not cond:
        raise SystemExit(1)


def _grads_ok(model) -> tuple[int, int, bool]:
    n_params = sum(1 for p in model.parameters() if p.requires_grad)
    n_with_grad = sum(1 for p in model.parameters() if p.requires_grad and p.grad is not None)
    all_finite = all(torch.isfinite(p.grad).all()
                     for p in model.parameters() if p.grad is not None)
    return n_params, n_with_grad, all_finite


def main():
    torch.manual_seed(0)

    idx = torch.randint(0, 64, (2, 8))
    targets = torch.randint(0, 64, (2, 8))

    # 1) base mesh — the model build_model() actually returns
    base_cfg = ModelConfig(vocab_size=64, block_size=16, n_embd=32,
                           mesh_neurons=12, mesh_dims=3, settle_ticks=2)
    base_model = build_model(base_cfg)
    base_logits, base_loss = base_model(idx, targets)
    check(base_logits.shape == (2, 8, 64), "mesh forward produces the expected logits shape")
    check(torch.isfinite(base_loss), "mesh loss is finite")

    base_loss.backward()
    n_params, n_with_grad, all_finite = _grads_ok(base_model)
    check(n_with_grad == n_params, f"every mesh parameter receives a gradient ({n_with_grad}/{n_params})")
    check(all_finite, "all mesh gradients are finite (no NaN/Inf)")

    # 2) mesh with skill routing (§3) and quantization-aware training (§8)
    skill_cfg = ModelConfig(vocab_size=64, block_size=16, n_embd=32,
                            mesh_neurons=12, mesh_dims=3, settle_ticks=2,
                            skill_groups=3, skill_top_k=2,
                            quant_enabled=True, quant_bits=8)
    skill_model = build_model(skill_cfg)
    skill_logits, skill_loss = skill_model(idx, targets)
    check(skill_logits.shape == (2, 8, 64), "skill-routed QAT mesh forward keeps the logits shape")
    check(torch.isfinite(skill_loss), "skill-routed QAT mesh loss is finite")
    skill_loss.backward()
    _, _, all_finite = _grads_ok(skill_model)
    check(all_finite, "all skill-routed QAT mesh gradients are finite")

    # 3) generation must run end to end, including the caller early-stop hook
    generated = base_model.generate(idx[:, :4], max_new_tokens=3, temperature=1.0, top_k=10)
    check(generated.shape == (2, 7), f"mesh generate() extends the sequence correctly (got shape {tuple(generated.shape)})")
    stopped = base_model.generate(idx[:, :4], max_new_tokens=8, temperature=1.0, top_k=10,
                                  stop_fn=lambda cur: cur.size(1) >= 6)
    check(stopped.size(1) == 6, f"mesh generate() honours stop_fn early stopping (got length {stopped.size(1)})")

    # 4) the standalone elastic-mesh expert core (Section 5.2) still works as
    #    a drop-in block, exercising the PennyLane-simulated quantum layer
    mesh_cfg = ModelConfig(vocab_size=64, block_size=16, n_embd=32,
                           use_elastic_mesh=True, mesh_num_experts=3, mesh_top_k=2,
                           mesh_n_neurons=16, mesh_settle_steps=2, mesh_n_qubits=3)
    ffn = ElasticMeshFFN(mesh_cfg, num_experts=mesh_cfg.mesh_num_experts,
                         top_k=mesh_cfg.mesh_top_k, n_neurons=mesh_cfg.mesh_n_neurons,
                         settle_steps=mesh_cfg.mesh_settle_steps, n_qubits=mesh_cfg.mesh_n_qubits)
    x = torch.randn(2, 8, 32, requires_grad=True)
    y = ffn(x)
    check(y.shape == (2, 8, 32), "elastic-mesh expert core preserves the input shape")
    y.sum().backward()
    n_params, n_with_grad, all_finite = _grads_ok(ffn)
    check(n_with_grad == n_params, f"every elastic-mesh expert parameter receives a gradient ({n_with_grad}/{n_params})")
    check(all_finite, "all elastic-mesh expert gradients are finite (no NaN/Inf)")

    print("\nAll mesh smoke checks passed.")


if __name__ == "__main__":
    main()
