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


def main():
    for fn in (test_veto, test_memory, test_actions, test_selection):
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
