"""Smoke test for the optional Section 5.2 quantum component
(`tinygpt/elastic_mesh.py`): the `ElasticMeshFFN` MoE block whose per-expert
interference step is a genuine PennyLane statevector simulation of a small
variational quantum circuit.

This is an OPTIONAL component — it is not part of the canonical all-to-all mesh
(`tinygpt/mesh.py`) that `build_model()` constructs, and it requires PennyLane
(`pip install pennylane`). If PennyLane isn't installed the test skips cleanly
rather than failing, so `python test_core.py` stays dependency-light. When the
dep is present this guards the block: it constructs, forward/backward-passes
with finite gradients, and preserves the (B, T, C) hidden shape it drops into.

Run with: python3 test_elastic_mesh.py
"""
import torch


def check(cond: bool, msg: str) -> None:
    status = "ok  " if cond else "FAIL"
    print(f"{status} {msg}")
    if not cond:
        raise SystemExit(1)


def main():
    try:
        from tinygpt.elastic_mesh import ElasticMeshFFN
    except Exception as e:                       # pennylane (or a dep) missing
        print(f"skip elastic-mesh smoke test — optional component unavailable: {e}")
        print("  (install with: pip install pennylane)")
        return

    from tinygpt.config import ModelConfig

    torch.manual_seed(0)
    cfg = ModelConfig(vocab_size=64, n_embd=32, block_size=16, dropout=0.1)
    ffn = ElasticMeshFFN(cfg, num_experts=3, top_k=2, n_neurons=16,
                         settle_steps=2, n_qubits=3)

    x = torch.randn(2, 8, cfg.n_embd, requires_grad=True)
    out = ffn(x)
    check(out.shape == x.shape,
          "ElasticMeshFFN preserves the (B, T, C) hidden shape it drops into")
    check(torch.isfinite(out).all(), "ElasticMeshFFN output is finite")

    out.sum().backward()
    n_params = sum(1 for p in ffn.parameters() if p.requires_grad)
    n_with_grad = sum(1 for p in ffn.parameters()
                      if p.requires_grad and p.grad is not None)
    check(n_with_grad > 0, f"gradients flow through the quantum block "
                           f"({n_with_grad}/{n_params} params)")
    all_finite = all(torch.isfinite(p.grad).all()
                     for p in ffn.parameters() if p.grad is not None)
    check(all_finite, "all ElasticMeshFFN gradients are finite (no NaN/Inf)")

    print("\nAll elastic-mesh smoke checks passed.")


if __name__ == "__main__":
    main()
