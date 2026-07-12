#!/usr/bin/env python
"""Smoke tests for the unified core layers (veto, memory, actions, selection).

Run: python test_core.py
The veto/memory/action tests need no trained model. The selection test builds a
tiny random GPT in-memory, so the whole suite runs without checkpoints.
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
    from tinygpt.model import GPT
    from tinygpt.selection import best_of_n

    class ToyTok:
        def decode(self, ids):
            return " ".join(map(str, ids))

    cfg = ModelConfig(vocab_size=64, block_size=32, n_layer=2, n_head=2, n_embd=32)
    model = GPT(cfg).eval()
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
    from tinygpt.model import GPT
    from tinygpt.extension_builder import Definishon, ExtensionBuilder

    tok = _CharTok()
    torch.manual_seed(0)
    cfg = ModelConfig(vocab_size=64, block_size=32, n_layer=2, n_head=2, n_embd=64)
    model = GPT(cfg)
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
    m2 = GPT(cfg)
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


def test_moe():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip MoE test (torch not installed)")
        return
    import torch
    from tinygpt.config import ModelConfig
    from tinygpt.model import GPT

    cfg = ModelConfig(vocab_size=64, block_size=32, n_layer=2, n_head=2, n_embd=64,
                      use_moe=True, n_experts=4, moe_top_k=2, skills=["a", "b", "c", "d"])
    torch.manual_seed(0)
    m = GPT(cfg)
    x = torch.randint(0, 64, (2, 16))
    y = torch.randint(0, 64, (2, 16))
    logits, loss = m(x, y)
    check(torch.isfinite(loss) and logits.shape == (2, 16, 64), "MoE forward + loss finite")
    aux = sum(b.mlp.last_aux_loss.item() for b in m.transformer.h)
    check(aux > 0, "MoE load-balancing auxiliary loss is computed")
    usage = m.transformer.h[0].mlp.skill_usage()
    check(set(usage) == {"a", "b", "c", "d"} and abs(sum(usage.values()) - 1.0) < 1e-4,
          "MoE experts are named skills with traceable usage")
    dense = GPT(ModelConfig(vocab_size=64, block_size=32, n_layer=2, n_head=2, n_embd=64)).num_params()
    check(m.num_params() > dense, "MoE model has more capacity than the dense model")
    loss.backward()
    check(True, "MoE backward pass runs")


def main():
    for fn in (test_veto, test_memory, test_actions, test_selection,
               test_extension_builder, test_moe, test_live_guide,
               test_shell_action_gated):
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
