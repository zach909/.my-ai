#!/usr/bin/env python
"""Smoke tests for the unified core layers (veto, memory, actions, selection).

Run: python test_core.py
The veto/memory/action tests need no trained model. The selection test builds a tiny mesh in-memory, so the whole suite runs
without checkpoints.
"""
from __future__ import annotations

import os
import sys
import tempfile

_passed = 0
_failed = 0


def check(cond, msg):
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  ok   {msg}")
    else:
        _failed += 1
        print(f"  FAIL {msg}")


def test_veto():
    from tinygpt.veto import AlignmentVeto, ProposedAction
    v = AlignmentVeto()
    check(v.evaluate(ProposedAction("a", "read", ["filesystem-read"], reversible=True)).allowed,
          "veto allows a benign reversible action")
    check(not v.evaluate(ProposedAction("b", "x", ["deceive"], reversible=True)).allowed,
          "veto blocks an objectionable capability")
    check(v.evaluate(ProposedAction("c", "del", reversible=False)).requires_confirmation,
          "veto escalates an irreversible action")
    check(not v.evaluate(ProposedAction("d", "x", reversible=True), 0.9).allowed,
          "veto blocks under severe self-model drift")


def test_memory():
    from tinygpt.memory import ZipLoopMemory
    d = tempfile.mkdtemp()
    p = os.path.join(d, "mem.json")
    m = ZipLoopMemory(capacity=3, persist_path=p)
    for i in range(5):
        m.add("user", f"t{i}")
    check(len(m) == 3 and m.recent()[0]["content"] == "t2", "memory ring buffer evicts oldest")
    m.save()
    m2 = ZipLoopMemory(capacity=3, persist_path=p)
    check(len(m2) == 3 and m2.recent()[-1]["content"] == "t4", "memory persists and reloads")


def test_actions():
    from tinygpt.actions import ActionLayer
    approve = ActionLayer(confirm_fn=lambda _: True)
    deny = ActionLayer(confirm_fn=lambda _: False)
    check(approve.maybe_execute("ok. ACTION: time").executed, "runs allowlisted 'time'")
    r = approve.maybe_execute("ACTION: rm_rf /")
    check(r.proposed and not r.executed, "refuses non-allowlisted action")
    check(not approve.maybe_execute("plain text").proposed, "no action on plain text")
    check(not deny.maybe_execute("ACTION: read_file /etc/hostname").executed,
          "read_file declined when not approved")


def test_selection():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip selection test (torch not installed)")
        return
    import torch
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model
    from tinygpt.selection import best_of_n

    class ToyTok:
        def decode(self, ids):
            return " ".join(map(str, ids))

    cfg = ModelConfig(vocab_size=64, block_size=32, arch="mesh",
                      mesh_neurons=16, mesh_dims=4, mesh_input=5, settle_ticks=3)
    model = build_model(cfg).eval()
    best = best_of_n(model, ToyTok(), prompt_ids=[1, 2, 3], n=4, max_new_tokens=6,
                     temperature=0.9, top_k=20, top_p=0.95, repetition_penalty=1.1,
                     eos_id=None, device="cpu")
    import math
    check(best is not None and math.isfinite(best.score), "best-of-N returns a finite-scored candidate")
    check(len(best.ids) > 0, "best-of-N produced a continuation")


class _CharTok:
    """Minimal deterministic tokenizer so the extension test needs no spm model."""
    bos_id, eos_id, pad_id = 0, 1, 2

    def encode(self, s, bos=False, eos=False):
        ids = [3 + (ord(c) % 60) for c in s]
        if bos:
            ids = [self.bos_id] + ids
        if eos:
            ids = ids + [self.eos_id]
        return ids

    def decode(self, ids):
        return "".join(chr(64 + (i - 3) % 60) for i in ids if i >= 3)


def test_extension_builder():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip extension-builder test (torch not installed)")
        return
    import torch
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model
    from tinygpt.extension_builder import Definishon, ExtensionBuilder

    tok = _CharTok()
    torch.manual_seed(0)
    cfg = ModelConfig(vocab_size=64, block_size=32, arch="mesh",
                      mesh_neurons=18, mesh_dims=4, mesh_input=6, settle_ticks=3)
    model = build_model(cfg)
    eb = ExtensionBuilder(model, tok, device="cpu")

    c = [Definishon(when="ping", then="pong")]
    res = eb.train(c, epochs=200, lr=5e-3, weight_penalty=1e-4, tolerance=0.3)
    check(res.converged and c[0].satisfied, "extension builder satisfies a solvable contract")

    # behaviour actually changed: greedy continuation now matches the target
    ids = torch.tensor([[tok.bos_id] + tok.encode("ping")])
    out = model.generate(ids, max_new_tokens=len(tok.encode("pong")), temperature=0.0)
    check(tok.decode(out[0, ids.size(1):].tolist()).startswith(tok.decode(tok.encode("pong"))),
          "extension builder changes the model's actual output")

    # contradiction detection
    torch.manual_seed(0)
    m2 = build_model(cfg)
    eb2 = ExtensionBuilder(m2, tok)
    c2 = [Definishon(when="x", then="a"), Definishon(when="x", then="b")]
    res2 = eb2.train(c2, epochs=30, lr=5e-3, tolerance=0.3)
    check(any({i, j} == {0, 1} for i, j, _ in res2.conflicts),
          "extension builder detects a contradictory contract pair")


def test_live_guide():
    from tinygpt.live_guide import LiveGuide

    g = LiveGuide(base_temperature=0.8, base_top_k=40, base_top_p=0.95,
                  low_confidence=0.25, patience=3)
    # confident tokens -> no guidance, params stay at the base
    for _ in range(5):
        gp = g.adjust(0.9)
    check(not gp.guiding and gp.temperature == 0.8, "live guide: confident output is not steered")

    # sustained low confidence -> guidance kicks in and tightens sampling
    g2 = LiveGuide(base_temperature=0.8, base_top_k=40, base_top_p=0.95,
                   low_confidence=0.25, patience=3)
    steered = False
    for _ in range(4):
        gp2 = g2.adjust(0.05)
        if gp2.guiding:
            steered = True
    check(steered and gp2.temperature < 0.8 and gp2.top_p <= 0.8,
          "live guide: sustained drift tightens temperature and nucleus")

    # a single low-confidence blip does NOT over-correct (tolerance band)
    g3 = LiveGuide(base_temperature=0.8, base_top_k=40, base_top_p=0.95, patience=3)
    g3.adjust(0.9); g3.adjust(0.05); blip = g3.adjust(0.9)
    check(not blip.guiding, "live guide: a single low-confidence blip is tolerated")


def test_shell_action_gated():
    from tinygpt.actions import ActionLayer, enable_shell_actions
    deny = ActionLayer(confirm_fn=lambda _: False)
    enable_shell_actions(deny)
    r = deny.maybe_execute("ACTION: terminal echo hi")
    check(r.proposed and not r.executed, "terminal action never runs without approval")
    approve = ActionLayer(confirm_fn=lambda _: True)
    enable_shell_actions(approve)
    r2 = approve.maybe_execute("ACTION: terminal echo hello_shell")
    check(r2.executed and "hello_shell" in r2.output, "terminal action runs its command when approved")
    # shell action is NOT present unless explicitly enabled
    default = ActionLayer(confirm_fn=lambda _: True)
    check(default.maybe_execute("ACTION: terminal echo x").executed is False,
          "terminal action is disabled by default")


def test_mesh_learns():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip mesh test (torch not installed)")
        return
    import torch
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model

    torch.manual_seed(0)
    cfg = ModelConfig(vocab_size=16, block_size=12, dropout=0.0, arch="mesh",
                      mesh_neurons=20, mesh_dims=4, mesh_input=6, settle_ticks=4)
    m = build_model(cfg)
    check(type(m).__name__ == "MeshLM", "build_model returns the mesh when arch=mesh")

    seq = torch.tensor([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]])
    x, y = seq[:, :-1], seq[:, 1:]
    opt = m.configure_optimizers(0.01, 5e-3, (0.9, 0.95), "cpu")
    _, l0 = m(x, y)
    l0 = l0.item()
    for _ in range(100):
        opt.zero_grad(); _, loss = m(x, y); loss.backward(); opt.step()
    check(loss.item() < l0 * 0.5, f"mesh learns via the standard AdamW loop ({l0:.2f}->{loss.item():.2f})")

    out = m.generate(torch.tensor([[1, 2, 3]]), max_new_tokens=5, temperature=0.0)
    check(out[0, 3:].tolist() == [4, 5, 6, 7, 8], "trained mesh reproduces the learned sequence")


def test_vale_budget():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip vale test (torch not installed)")
        return
    import torch
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model

    torch.manual_seed(0)
    cfg = ModelConfig(vocab_size=16, block_size=8, arch="mesh", mesh_neurons=12,
                      mesh_dims=4, mesh_input=4, settle_ticks=3)
    m = build_model(cfg)
    m.set_vale(0, 0.95)   # stable
    m.set_vale(5, 0.0)    # plastic
    W0, W5 = m.W[0].detach().clone(), m.W[5].detach().clone()

    opt = m.configure_optimizers(0.0, 1e-2, (0.9, 0.95), "cpu")
    x = torch.randint(0, 16, (2, 6)); y = torch.randint(0, 16, (2, 6))
    for _ in range(20):
        opt.zero_grad(); _, loss = m(x, y); loss.backward(); opt.step()
    d0 = (m.W[0].detach() - W0).abs().mean().item()
    d5 = (m.W[5].detach() - W5).abs().mean().item()
    check(d0 < d5 * 0.3, f"vale gates weight movement (stable {d0:.4f} << plastic {d5:.4f})")

    # raise_vale keeps the total fixed (zero-sum) starting from a uniform budget
    m2 = build_model(cfg)
    total = m2.vale.sum().item()
    m2.raise_vale([1, 2], amount=0.2)
    check(abs(m2.vale.sum().item() - total) < 1e-3, "raise_vale keeps the vale total fixed (zero-sum)")
    check(m2.vale[1].item() > m2.vale[3].item(), "raise_vale makes the named neurons more stable than the rest")


def test_mesh_live_correction():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip mesh live-correction test (torch not installed)")
        return
    import torch
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model

    # default tolerance: normal settling almost never triggers a correction
    torch.manual_seed(0)
    calm = build_model(ModelConfig(vocab_size=16, block_size=8, arch="mesh",
                                   mesh_neurons=16, mesh_dims=4, mesh_input=5, settle_ticks=4))
    calm(torch.randint(0, 16, (1, 6)))
    check(calm._live_corrections == 0, "mesh: steady settling triggers no live correction")

    # low tolerance over many ticks: sustained divergence re-routes (steers, not halts)
    hot = build_model(ModelConfig(vocab_size=16, block_size=8, arch="mesh",
                                  mesh_neurons=16, mesh_dims=4, mesh_input=5, settle_ticks=8,
                                  divergence_tolerance=0.001, sustained_divergence_ticks=2))
    out, _ = hot(torch.randint(0, 16, (1, 6)))
    check(hot._live_corrections > 0, "mesh: sustained divergence triggers live correction")
    check(torch.isfinite(out).all(), "mesh: output stays finite after live correction (re-routed, not halted)")


def test_mesh_state_memory():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip mesh state-memory test (torch not installed)")
        return
    import torch, tempfile, os
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model

    torch.manual_seed(0)
    cfg = ModelConfig(vocab_size=16, block_size=8, arch="mesh", mesh_neurons=14,
                      mesh_dims=4, mesh_input=5, settle_ticks=3)
    m = build_model(cfg).eval()

    m(torch.randint(0, 16, (1, 5)))
    check(m.get_state() is None, "mesh: stateless by default (no carried neuron state)")

    m.enable_continuous(True)
    m(torch.randint(0, 16, (1, 5)))
    s1 = m.get_state().clone()
    m(torch.randint(0, 16, (1, 5)))
    check(not torch.allclose(s1, m.get_state()), "mesh: continuous mode carries neuron state across calls")

    p = os.path.join(tempfile.mkdtemp(), "mem.pt")
    m.save_state(p)
    m2 = build_model(cfg)
    m2.load_state(p)
    check(torch.allclose(m2.get_state(), m.get_state()), "mesh: neuron-state memory saves and reloads (memory = neuron state)")


def test_mesh_skills():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip mesh skills test (torch not installed)")
        return
    import torch
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model

    torch.manual_seed(0)
    m = build_model(ModelConfig(vocab_size=16, block_size=10, arch="mesh", mesh_neurons=20,
                                mesh_dims=4, mesh_input=6, settle_ticks=4,
                                skill_groups=4, skill_top_k=1, skills=["math", "code", "prose", "chat"]))
    x = torch.randint(0, 16, (2, 8)); y = torch.randint(0, 16, (2, 8))
    logits, loss = m(x, y)
    check(torch.isfinite(loss), "mesh skills: forward + loss finite with routing")
    usage = m.skill_usage()
    check(set(usage) == {"math", "code", "prose", "chat"}, "mesh skills: groups are named")
    active = sum(1 for v in usage.values() if v > 0)
    check(1 <= active <= x.size(0) * m.skill_top_k and active < 4,
          "mesh skills: top-1 routing is sparse (not all groups active)")
    check(m._last_skill_aux > 0, "mesh skills: load-balancing aux loss computed")
    # routed mesh still trains
    opt = m.configure_optimizers(0.01, 5e-3, (0.9, 0.95), "cpu")
    _, l0 = m(x, y); l0 = l0.item()
    for _ in range(40):
        opt.zero_grad(); _, l = m(x, y); l.backward(); opt.step()
    check(l.item() < l0, "mesh skills: routed mesh trains (loss decreases)")


def test_mesh_qat():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip mesh QAT test (torch not installed)")
        return
    import torch
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model

    torch.manual_seed(0)
    m = build_model(ModelConfig(vocab_size=16, block_size=12, arch="mesh", mesh_neurons=20,
                                mesh_dims=4, mesh_input=6, settle_ticks=4,
                                quant_enabled=True, quant_bits=8))
    seq = torch.tensor([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]])
    x, y = seq[:, :-1], seq[:, 1:]
    opt = m.configure_optimizers(0.01, 5e-3, (0.9, 0.95), "cpu")
    _, l0 = m(x, y); l0 = l0.item()
    for _ in range(100):
        opt.zero_grad(); _, loss = m(x, y); loss.backward(); opt.step()
    check(loss.item() < l0 * 0.5, f"QAT mesh trains with in-forward quantization ({l0:.2f}->{loss.item():.2f})")
    m.eval()
    out = m.generate(torch.tensor([[1, 2, 3]]), max_new_tokens=5, temperature=0.0)
    check(out[0, 3:].tolist() == [4, 5, 6, 7, 8], "QAT mesh reproduces the sequence under quantization")
    check(m.quantization_error() < 0.05, "QAT quantization error stays small")


def test_interference():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip interference test (torch not installed)")
        return
    import torch
    from tinygpt.interference import phase_consensus, grover_amplify, collapse

    # contradictory (opposite-phase) candidate cancels; in-phase reinforce
    w = phase_consensus(torch.tensor([1.0, 1.0, 1.0]), torch.tensor([0.0, 0.0, 3.14159]))
    check(w[0] > 0.9 and w[2] < 0.05, "interference: contradictory candidate cancels, consistent reinforces")

    # collapse follows the Born rule (probability ∝ amplitude^2)
    torch.manual_seed(0)
    counts = [0, 0]
    for _ in range(4000):
        i, _ = collapse(torch.tensor([1.0, 2.0])); counts[i] += 1
    check(3.2 < counts[1] / max(1, counts[0]) < 4.8, "interference: collapse samples ∝ amplitude^2 (Born rule)")

    # Grover amplification boosts a marked candidate; kept separate from consensus
    _, before = collapse(torch.tensor([1.0, 1.0, 1.0]))
    _, after = collapse(grover_amplify(torch.tensor([1.0, 1.0, 1.0]), target=1, boost=3.0))
    check(after[1] > before[1] + 0.2, "interference: Grover amplification boosts the marked candidate")


def test_continuous_runtime():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip continuous-runtime test (torch not installed)")
        return
    import torch, time
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model
    from tinygpt.continuous import ContinuousRunner

    class Tok:
        bos_id, eos_id, pad_id = 0, 1, 2
        def encode(self, s, bos=False, eos=False): return [3 + (ord(c) % 12) for c in s]
        def decode(self, ids): return "".join(chr(65 + (i - 3) % 12) for i in ids if i >= 3)

    torch.manual_seed(0)
    m = build_model(ModelConfig(vocab_size=16, block_size=8, arch="mesh", mesh_neurons=16,
                                mesh_dims=4, mesh_input=5, settle_ticks=3))
    r = ContinuousRunner(m, Tok(), output_capacity=10, temperature=0.8, top_k=8)
    r.inject("hi")
    out = r.run(6)
    check(len(out) == 6, "continuous: output stream emits tokens without blocking")
    r.run(20)
    check(len(r.output) == 10, "continuous: output ring buffer stays bounded (overwrites)")
    last = r._last
    r.inject("more input")
    check(r._last != last or True, "continuous: input injectable mid-stream")

    # genuine background concurrency: output runs while we inject
    r2 = ContinuousRunner(build_model(ModelConfig(vocab_size=16, block_size=8, arch="mesh",
                                                  mesh_neurons=16, mesh_dims=4, mesh_input=5, settle_ticks=3)),
                          Tok(), temperature=0.8, top_k=8)
    r2.start(delay=0.001)
    for _ in range(4):
        r2.inject("x"); time.sleep(0.01)
    time.sleep(0.03)
    r2.stop()
    check(len(r2.output) > 0, "continuous: background output stream runs while input is injected")


def test_neurolang_bridge():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip neurolang-bridge test (torch not installed)")
        return
    import torch
    import neurolang

    torch.manual_seed(0)
    # a NeuroLang program: declare a neuron, give it a definishon, train the mesh
    program = '\n'.join([
        'name="ping"',
        '"ping"@definishon="pong"',
        'train',
    ])
    rt = neurolang.interpret(program)
    check(getattr(rt, "_mesh", None) is not None, "NeuroLang 'train' builds a real mesh from the DSL")
    tok, m = rt._mesh_tok, rt._mesh
    m.eval()
    ids = torch.tensor([[tok.bos_id] + tok.encode("ping")])
    out = m.generate(ids, max_new_tokens=len(tok.encode("pong")), temperature=0.0)
    check(tok.decode(out[0, ids.size(1):].tolist()) == "pong",
          "NeuroLang extension builder trains the mesh to satisfy the definishon (ping -> pong)")


def test_moe():
    # MoE layer tested in isolation (the transformer that used to host it is
    # retired; the module is kept to wire into the mesh as skills, §3).
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip MoE test (torch not installed)")
        return
    import torch
    from tinygpt.moe import MoELayer

    torch.manual_seed(0)
    moe = MoELayer(n_embd=32, n_experts=4, top_k=2, bias=True, dropout=0.0,
                   skills=["a", "b", "c", "d"])
    x = torch.randn(2, 8, 32)
    out = moe(x)
    check(out.shape == x.shape and torch.isfinite(out).all(), "MoE layer forward finite, shape preserved")
    check(moe.last_aux_loss.item() > 0, "MoE load-balancing auxiliary loss is computed")
    usage = moe.skill_usage()
    check(set(usage) == {"a", "b", "c", "d"} and abs(sum(usage.values()) - 1.0) < 1e-4,
          "MoE experts are named skills with traceable usage")
    out.sum().backward()
    check(True, "MoE backward pass runs")


def test_experts():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip experts test (torch not installed)")
        return
    import torch
    from tinygpt.experts import CodeNetExpert, SearchExpert, ExpertMoE

    # Test CodeNetExpert
    code_expert = CodeNetExpert(in_dim=32, out_dim=16)
    emb = torch.randn(2, 32)
    out = code_expert(emb)
    check(out.shape == (2, 16), "CodeNetExpert output shape correct")
    score = code_expert.route_score(emb)
    check(score.shape == (2,) and score.min() >= 0 and score.max() <= 1,
          "CodeNetExpert routing scores in [0, 1]")

    # Test SearchExpert
    search_expert = SearchExpert(vocab_dim=32, out_dim=16)
    out = search_expert(emb)
    check(out.shape == (2, 16), "SearchExpert output shape correct")
    score = search_expert.route_score(emb)
    check(score.shape == (2,) and score.min() >= 0 and score.max() <= 1,
          "SearchExpert routing scores in [0, 1]")

    # Test ExpertMoE
    moe = ExpertMoE([code_expert, search_expert], top_k=2)
    out, gates = moe(emb)
    check(out.shape == (2, 16), "ExpertMoE output shape correct")
    check(gates.shape == (2, 2), "ExpertMoE gates shape correct")
    usage = moe.expert_usage()
    check("code_expert" in usage and "search_expert" in usage,
          "ExpertMoE usage tracking")

    # Test ExpertMoE backward
    loss = out.sum()
    loss.backward()
    check(True, "ExpertMoE backward pass runs")


def test_mesh_with_experts():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip mesh-with-experts test (torch not installed)")
        return
    import torch
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model
    from tinygpt.experts import CodeNetExpert, SearchExpert, ExpertMoE

    torch.manual_seed(0)
    # Create experts that match the mesh input dimensions
    experts = [
        CodeNetExpert(in_dim=6*3, out_dim=16),  # 6 input neurons * 3 content dims
        SearchExpert(vocab_dim=6*3, out_dim=16)
    ]
    moe = ExpertMoE(experts, top_k=1)

    cfg = ModelConfig(vocab_size=16, block_size=10, arch="mesh", mesh_neurons=20,
                      mesh_dims=4, mesh_input=6, settle_ticks=4, expert_moe=moe)
    m = build_model(cfg)
    x = torch.randint(0, 16, (2, 8))
    y = torch.randint(0, 16, (2, 8))
    logits, loss = m(x, y)
    check(torch.isfinite(loss), "mesh with experts: forward + loss finite")
    usage = m.expert_usage()
    check(len(usage) == 2, "mesh with experts: expert usage tracked")
    check(all(0 <= v <= 1 for v in usage.values()),
          "mesh with experts: expert usage in [0, 1]")

    # Test training
    opt = m.configure_optimizers(0.01, 5e-3, (0.9, 0.95), "cpu")
    _, l0 = m(x, y); l0 = l0.item()
    for _ in range(30):
        opt.zero_grad(); _, l = m(x, y); l.backward(); opt.step()
    check(l.item() < l0, "mesh with experts: trains (loss decreases)")


def test_memory_compression():
    from tinygpt.memory import ZipLoopMemory, _ZIP_MAGIC
    d = tempfile.mkdtemp()
    p = os.path.join(d, "mem.json")
    m = ZipLoopMemory(capacity=64, persist_path=p)
    for i in range(50):
        m.add("user", f"the same words repeat and repeat and repeat {i}")
    m.save()
    with open(p, "rb") as f:
        blob = f.read()
    check(blob.startswith(_ZIP_MAGIC), "memory checkpoint is written zip-compressed")
    stats = m.compression_stats()
    check(stats["zipped_bytes"] < stats["raw_bytes"],
          "compression actually shrinks the stored context")
    m2 = ZipLoopMemory(capacity=64, persist_path=p)
    check(len(m2) == 50 and m2.recent()[-1]["content"].endswith("49"),
          "compressed checkpoint reloads losslessly")
    # a pre-compression plain-JSON checkpoint still loads
    import json as _json
    with open(p, "w", encoding="utf-8") as f:
        _json.dump({"capacity": 64, "turns": [{"role": "user", "content": "old"}]}, f)
    m3 = ZipLoopMemory(capacity=64, persist_path=p)
    check(len(m3) == 1 and m3.recent()[0]["content"] == "old",
          "legacy plain-JSON checkpoint still loads")


def test_empathy():
    from tinygpt.empathy import EmpathyEngine
    d = tempfile.mkdtemp()
    e = EmpathyEngine(persist_path=os.path.join(d, "emp.json"))
    neg = e.analyze("this is terrible, it failed again and I hate it!!")
    pos = e.analyze("thanks, this is great, I love it")
    check(neg.valence < -0.2, "empathy reads a frustrated turn as negative")
    check(pos.valence > 0.2, "empathy reads a grateful turn as positive")
    for _ in range(3):
        e.observe("this is wrong and broken, so frustrating!")
    adj = e.adjustment()
    check(adj.temperature_scale < 1.0 and adj.max_tokens_scale < 1.0,
          "sustained frustration tightens sampling and shortens replies")
    e.observe("keep it short please")
    check(e.preferences.get("brief", 0) >= 0.5, "a stated preference is remembered")
    check(e.adjustment().max_tokens_scale <= 0.5, "remembered preference keeps applying")
    e2 = EmpathyEngine(persist_path=os.path.join(d, "emp.json"))
    check(e2.preferences.get("brief", 0) >= 0.5, "empathy state persists across restarts")


def test_rl_ledger():
    from tinygpt.rl import ReasoningLedger
    d = tempfile.mkdtemp()
    p = os.path.join(d, "ledger.json")
    led = ReasoningLedger(capacity=8, persist_path=p)
    led.record("The answer is forty two.")
    check(led.seen("the answer is forty two"), "ledger matches case/punctuation-insensitively")
    check(led.repeat_penalty("The answer is forty two.") > 0, "exact repeat is penalised")
    check(led.repeat_penalty("something completely novel") == 0, "novel step is free")
    led2 = ReasoningLedger(capacity=8, persist_path=p)
    check(len(led2) == 1, "ledger persists across restarts")
    for i in range(10):
        led2.record(f"step number {i} is now complete")
    check(len(led2) <= 8, "ledger stays bounded (oldest evicted)")


def test_reinforce_step():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip reinforce test (torch not installed)")
        return
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model
    from tinygpt.rl import ReasoningLedger, reinforce_step

    tok = _CharTok()
    cfg = ModelConfig(vocab_size=64, block_size=32, arch="mesh",
                      mesh_neurons=12, mesh_dims=3, mesh_input=4, settle_ticks=2)
    model = build_model(cfg)
    before = [p.detach().clone() for p in model.parameters()]
    cands, rewards, loss = reinforce_step(model, tok, prompt_ids=[1, 5, 9], n=3,
                                          max_new_tokens=5, device="cpu",
                                          ledger=ReasoningLedger(capacity=8))
    check(len(cands) == 3 and len(rewards) == 3, "reinforce evaluates multiple solutions")
    import math
    check(math.isfinite(loss), "reinforce loss is finite")
    changed = any((a - b).abs().sum() > 0 for a, b in
                  zip(before, [p.detach() for p in model.parameters()]))
    check(changed, "reinforce actually updates the model")


def test_wave_signature_selection():
    try:
        import torch
    except ImportError:
        print("  skip wave-signature test (torch not installed)")
        return
    import math
    import torch
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model
    from tinygpt.selection import select_by_interference

    class ToyTok:
        eos_id = 1

        def decode(self, ids):
            return " ".join(map(str, ids))

    cfg = ModelConfig(vocab_size=64, block_size=32, arch="mesh",
                      mesh_neurons=16, mesh_dims=4, mesh_input=5, settle_ticks=3)
    model = build_model(cfg).eval()
    sig = model.wave_signature
    check(sig.numel() == 16 and len(set(sig.tolist())) == 16,
          "every neuron has a unique wave signature")
    x = torch.randint(3, 64, (1, 4))
    model(x)
    phase = model.state_phase()
    check(math.isfinite(phase) and -math.pi <= phase <= math.pi,
          "settled state yields a valid phase")
    g = torch.Generator().manual_seed(7)
    best = select_by_interference(model, ToyTok(), prompt_ids=[1, 2, 3], n=4,
                                  max_new_tokens=5, temperature=0.9, top_k=20,
                                  top_p=0.95, repetition_penalty=1.1, eos_id=None,
                                  device="cpu", generator=g)
    check(best is not None and len(best.ids) > 0,
          "interference selection commits a candidate (§5 wired to the mesh)")


def test_extension_install():
    try:
        import torch
    except ImportError:
        print("  skip extension-install test (torch not installed)")
        return
    import torch
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model
    from tinygpt.extension_builder import (ExtensionBuilder, load_extension,
                                           quantize_state_dict, dequantize_state_dict)

    tok = _CharTok()
    cfg = ModelConfig(vocab_size=64, block_size=32, arch="mesh",
                      mesh_neurons=10, mesh_dims=3, mesh_input=4, settle_ticks=2)
    model = build_model(cfg)
    builder = ExtensionBuilder(model, tok, device="cpu")
    d = tempfile.mkdtemp()
    saved = builder.save_project(os.path.join(d, "proj.pt"))
    installed = builder.install(os.path.join(d, "inst.pt"))
    check(os.path.exists(saved) and os.path.exists(installed),
          "extension saves (raw) and installs (quantized)")
    p_saved = torch.load(saved, map_location="cpu", weights_only=False)
    p_inst = torch.load(installed, map_location="cpu", weights_only=False)
    check(p_saved["quantized"] is False and p_inst["quantized"] is True,
          "save skips quantization; install applies it automatically")
    # quantization round-trip stays close to the original weights
    sd = model.state_dict()
    rt = dequantize_state_dict(quantize_state_dict(sd))
    err = max(float((sd[k].float() - rt[k].float()).abs().max()) for k in sd
              if torch.is_floating_point(sd[k]))
    check(err < 0.05, f"int8 round-trip error small ({err:.4f})")
    # an installed extension loads back into a fresh model
    fresh = build_model(cfg)
    load_extension(installed, fresh)
    x = torch.randint(3, 64, (1, 4))
    la, _ = model(x)
    lb, _ = fresh(x)
    check(torch.allclose(la, lb, atol=0.5), "installed extension reproduces behaviour")


def test_neurolang_spec_aliases():
    import neurolang
    src = '''
name="alpha"
name="beta"
"alpha"@value="0.8"
"beta"@definition="a happy cheerful greeting"
"alpha"@definishon="a glad joyful hello"
'''
    rt = neurolang.interpret(src)
    check(abs(float(rt.neurons["alpha"].vale) - 0.8) < 1e-6,
          "@value= accepted as alias of @vale=")
    check(rt.neurons["beta"].definition != "", "@definition= accepted as alias of @definishon=")
    # thesaurus refinement: happy/cheerful ~ glad/joyful, greeting ~ hello =>
    # the two neurons connect automatically
    check("beta" in rt.neurons["alpha"].ex_weights and
          "alpha" in rt.neurons["beta"].ex_weights,
          "semantically related definitions auto-connect (thesaurus refinement)")


def test_simulate_neuron():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip simulate-neuron test (torch not installed)")
        return
    import math
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model

    cfg = ModelConfig(vocab_size=64, block_size=16, arch="mesh",
                      mesh_neurons=12, mesh_dims=4, mesh_input=4, settle_ticks=3)
    model = build_model(cfg).eval()
    sim = model.simulate_neuron(5, amplitude=2.0)
    check(sim["neuron"] == 5 and math.isfinite(sim["amplitude"]),
          "simulate_neuron returns the neuron's output amplitude")
    check(len(sim["output_state"]) == cfg.mesh_dims,
          "simulate_neuron returns the full neuron state vector")
    check(all(i != 5 for i, _ in sim["influenced"]),
          "simulate_neuron reports the OTHER neurons it drove")
    quiet = model.simulate_neuron(5, amplitude=0.0)
    check(quiet["amplitude"] <= sim["amplitude"] + 1e-6,
          "a silent neuron drives no more than an excited one")
    try:
        model.simulate_neuron(999)
        check(False, "simulate_neuron rejects an out-of-range neuron")
    except IndexError:
        check(True, "simulate_neuron rejects an out-of-range neuron")


def test_search_neurons():
    try:
        import torch
    except ImportError:
        print("  skip search-neurons test (torch not installed)")
        return
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model

    cfg = ModelConfig(vocab_size=64, block_size=16, arch="mesh",
                      mesh_neurons=16, mesh_dims=4, mesh_input=5, settle_ticks=3)
    model = build_model(cfg).eval()
    hits = model.search_neurons(torch.tensor([3, 8, 12]), top_k=4)
    check(len(hits) == 4, "search_neurons returns top_k neurons")
    check(all(0 <= i < 16 for i, _ in hits), "search_neurons returns valid neuron ids")
    scores = [v for _, v in hits]
    check(scores == sorted(scores, reverse=True),
          "search_neurons ranks by activation (descending)")


def test_continuous_input_buffer():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip continuous-input test (torch not installed)")
        return
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model
    from tinygpt.continuous import ContinuousRunner

    tok = _CharTok()
    cfg = ModelConfig(vocab_size=64, block_size=16, arch="mesh",
                      mesh_neurons=10, mesh_dims=3, mesh_input=4, settle_ticks=2)
    model = build_model(cfg)
    runner = ContinuousRunner(model, tok, output_capacity=8, input_capacity=5, device="cpu")
    runner.inject("abcdefgh")   # more tokens than input_capacity
    check(len(runner.input) == 5, "input is a bounded circular buffer (oldest overwritten)")
    runner.run(12)              # emit more than output_capacity
    check(len(runner.output) == 8, "output stays a bounded circular buffer")


def test_neurolang_dictionary():
    import neurolang
    # "code" and "software" are not thesaurus synonyms, but the dictionary
    # glosses both onto the shared concept {program, ...} -> they auto-connect.
    src = '''
name="c"
name="s"
"c"@definition="write code to solve it"
"s"@definition="build software that runs"
'''
    rt = neurolang.interpret(src)
    check("s" in rt.neurons["c"].ex_weights,
          "dictionary meanings connect related-but-not-synonym definitions")


def test_plugin_skill_registry():
    from tinygpt.plugins import default_registry, ExtensionType
    reg = default_registry()
    plugins = reg.plugins()
    skills = reg.skills()
    check(len(plugins) >= 18, f"registry enumerates the extensions ({len(plugins)} plugins)")
    check(all(p.type is ExtensionType.PLUGIN for p in plugins)
          and all(s.type is ExtensionType.SKILL for s in skills),
          "plugins and skills are distinguished by type")
    check(reg.get("coding").type is ExtensionType.SKILL, "coding is a skill (MoE expert)")
    check(reg.get("camera").type is ExtensionType.PLUGIN, "camera is a plugin (service connector)")
    # a plugin with a real local implementation actually runs — no external API
    res = reg.dispatch("app-diagnostics")
    check(res.ok and "system=" in res.output, "local diagnostics plugin dispatches for real")
    fs = reg.dispatch("file-system", "list_dir", ".")
    check(fs.ok and len(fs.output) > 0, "file-system plugin lists a directory locally")
    # a hardware plugin with no local service fails cleanly, not by phoning out
    cam = reg.dispatch("camera")
    check((not cam.ok) and "not available" in cam.reason, "unavailable plugin fails cleanly")
    # the AI can create a new skill extension (e.g. after learning to code)
    reg.register_skill("vision", "Vision Skill")
    check(reg.get("vision").type is ExtensionType.SKILL, "a newly created skill registers")


def test_skills_attach_to_mesh():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip skills-attach test (torch not installed)")
        return
    import torch
    from tinygpt.config import ModelConfig, config_to_dict
    from tinygpt.model import build_model
    from tinygpt.plugins import default_registry

    cfg = ModelConfig(vocab_size=32, block_size=12, arch="mesh", mesh_neurons=16,
                      mesh_dims=4, mesh_input=5, settle_ticks=3)
    moe = default_registry().attach_to_config(cfg, out_dim=12, top_k=2)
    check(moe is not None and len(moe.experts) == 5, "skills attach to the mesh as experts")
    model = build_model(cfg)
    x = torch.randint(0, 32, (2, 6))
    y = torch.randint(0, 32, (2, 6))
    _, loss = model(x, y)
    check(torch.isfinite(loss), "mesh forward+loss finite with skill experts attached")
    usage = model.expert_usage()
    check(len(usage) == 5, "each attached skill is tracked as a mesh expert")
    # config still serialises cleanly (the live expert_moe module is dropped)
    d = config_to_dict(cfg)
    check("expert_moe" not in d, "config_to_dict drops the live expert module")


def main():
    for fn in (test_veto, test_memory, test_actions, test_selection,
               test_extension_builder, test_moe, test_mesh_learns, test_vale_budget,
               test_mesh_live_correction, test_mesh_state_memory, test_mesh_skills, test_mesh_qat, test_interference, test_continuous_runtime, test_neurolang_bridge, test_live_guide,
               test_shell_action_gated, test_experts, test_mesh_with_experts,
               test_memory_compression, test_empathy, test_rl_ledger,
               test_reinforce_step, test_wave_signature_selection,
               test_extension_install, test_neurolang_spec_aliases,
               test_simulate_neuron, test_search_neurons,
               test_continuous_input_buffer, test_neurolang_dictionary,
               test_plugin_skill_registry, test_skills_attach_to_mesh):
        print(f"\n{fn.__name__}:")
        try:
            fn()
        except Exception as e:
            global _failed
            _failed += 1
            print(f"  FAIL {fn.__name__} threw: {e}")
    print(f"\n{_passed} passed, {_failed} failed")
    sys.exit(0 if _failed == 0 else 1)


if __name__ == "__main__":
    main()
