"""Section 5.2 smoke test: the elastic-mesh model core actually constructs,
forward/backward-passes with finite gradients, and its GPT.forward() output
shape matches the standard MLP variant it swaps in for. Not a training run
(that's exercised manually — see the session's comparison write-up); this
just guards the architecture itself against silently breaking.

Run with: python3 test_elastic_mesh.py
"""
import torch

from tinygpt.config import ModelConfig
from tinygpt.model import GPT


def check(cond: bool, msg: str) -> None:
    status = "ok  " if cond else "FAIL"
    print(f"{status} {msg}")
    if not cond:
        raise SystemExit(1)


def main():
    torch.manual_seed(0)

    base_cfg = ModelConfig(vocab_size=64, n_layer=2, n_head=2, n_embd=32, block_size=16)
    mesh_cfg = ModelConfig(
        vocab_size=64, n_layer=2, n_head=2, n_embd=32, block_size=16,
        use_elastic_mesh=True, mesh_num_experts=3, mesh_top_k=2,
        mesh_n_neurons=16, mesh_settle_steps=2, mesh_n_qubits=3,
    )

    idx = torch.randint(0, 64, (2, 8))
    targets = torch.randint(0, 64, (2, 8))

    base_model = GPT(base_cfg)
    base_logits, base_loss = base_model(idx, targets)
    check(base_logits.shape == (2, 8, 64), "baseline GPT forward produces the expected logits shape")
    check(torch.isfinite(base_loss), "baseline GPT loss is finite")

    mesh_model = GPT(mesh_cfg)
    mesh_logits, mesh_loss = mesh_model(idx, targets)
    check(mesh_logits.shape == (2, 8, 64), "elastic-mesh GPT forward produces the same logits shape as baseline")
    check(torch.isfinite(mesh_loss), "elastic-mesh GPT loss is finite")

    mesh_loss.backward()
    n_params = sum(1 for p in mesh_model.parameters() if p.requires_grad)
    n_with_grad = sum(1 for p in mesh_model.parameters() if p.requires_grad and p.grad is not None)
    check(n_with_grad == n_params, f"every elastic-mesh parameter receives a gradient ({n_with_grad}/{n_params})")
    all_finite = all(torch.isfinite(p.grad).all() for p in mesh_model.parameters() if p.grad is not None)
    check(all_finite, "all elastic-mesh gradients are finite (no NaN/Inf)")

    # Generation must run end to end (exercises the quantum layer at
    # inference/no_grad time too, not just training).
    generated = mesh_model.generate(idx[:, :4], max_new_tokens=3, temperature=1.0, top_k=10)
    check(generated.shape == (2, 7), f"elastic-mesh generate() extends the sequence correctly (got shape {tuple(generated.shape)})")

    print("\nAll elastic-mesh smoke checks passed.")


if __name__ == "__main__":
    main()
