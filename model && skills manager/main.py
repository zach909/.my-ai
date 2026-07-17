#!/usr/bin/env python
"""Prometheus Elastic Core — unified entry point.

This connects the pieces of the system. (It replaces an earlier stand-alone,
torch-less NeuroLang interpreter that duplicated neurolang.py — the real,
mesh-connected DSL and extension builder now live there.)

Usage:
    python main.py build <program.nl>   # build + train the mesh from a NeuroLang program
    python main.py chat  [args...]      # talk to a trained mesh through the core
    python main.py test                 # run the unit/smoke test suite (test_core.py)
    python main.py demo                 # end-to-end integration demo (test_integration.py):
                                         #   one trained mesh carried through NeuroLang,
                                         #   elastic values + self-healing, extension
                                         #   save/install, live plugin/skill building,
                                         #   a real core.py chat session (empathy + RL
                                         #   ledger + quantum interference together), and
                                         #   a real HTTP round-trip through the browser
                                         #   backend — proof the pieces work as ONE system.
    python main.py learn-code [when] [then]  # flagship Extensions example, live:
                                         #   the AI learns to code, then autonomously
                                         #   creates + installs (quantized) a coding
                                         #   extension to permanently preserve it.
    python main.py code2net <name> <src.py>          # Code-to-Net: code -> neural net
    python main.py netsearch <query> <doc>...         # Net Search: semantic retrieval net

No external APIs.
"""
from __future__ import annotations

import os
import sys
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))


def _build(argv):
    """Build and train the mesh from a NeuroLang program (name=, @vale=,
    @connections=, @definishon=, ... then `train`)."""
    if not argv:
        print("usage: python main.py build <program.nl>")
        return 1
    import neurolang
    with open(argv[0], "r", encoding="utf-8") as f:
        source = f.read()
    rt = neurolang.interpret(source)
    print(f"Done. {len(rt.neurons)} neuron(s), {rt.tick} tick(s).")
    mesh = getattr(rt, "_mesh", None)
    if mesh is not None:
        print(f"Trained mesh: {mesh.num_params()} params, {mesh.N} neurons.")
    return 0


def _run(script, argv):
    return subprocess.call([sys.executable, os.path.join(HERE, script), *argv])


def _code2net(argv):
    """Code-to-Net: convert a Python source file into an equivalent neural
    network (function approximation when it defines a numeric function)."""
    if len(argv) < 2:
        print("usage: python main.py code2net <name> <source.py>")
        return 1
    import neurolang
    name, src_path = argv[0], argv[1]
    with open(src_path, "r", encoding="utf-8") as f:
        code = f.read()
    meta = neurolang.train_codenet(name, code, os.path.dirname(os.path.abspath(src_path)) or ".")
    print(f"Done. mode={meta['mode']} loss={meta['loss']:.6f} -> {name}.codenet")
    return 0


def _netsearch(argv):
    """Net Search: index a corpus of neural definitions/docs, train a retrieval
    net, and run a neural semantic search for the query."""
    if len(argv) < 2:
        print("usage: python main.py netsearch <query> <doc1> [doc2 ...]")
        return 1
    import neurolang
    query, docs = argv[0], argv[1:]
    mgr = neurolang.NetSearchManager("cli")
    for d in docs:
        mgr.add_corpus(d)
    mgr.train()
    mgr.neural_search(query)            # the deep-learning retrieval net (prints)
    hard = mgr.hard_search(query)       # deterministic TF-IDF ranking
    if hard:
        print(f"\nBest match: {hard[0][1]}")
    return 0


def _learn_code(argv):
    """The design notes' flagship Extensions example, live and narrated:
    "after learning to code it creates a coding extension" to "permanently
    preserve that knowledge." The AI learns a coding behaviour, and only
    because it actually learned it, autonomously registers a live coding
    skill and installs the extension (quantized) to disk."""
    import os
    import tempfile
    try:
        import torch
    except ImportError:
        print("learn-code needs torch (pip install -r requirements.txt)")
        return 1
    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model
    from tinygpt.extension_builder import Definishon, learn_and_extend
    from tinygpt.plugins import default_registry

    class _CharTok:
        bos_id, eos_id, pad_id = 0, 1, 2
        def encode(self, s, bos=False, eos=False):
            ids = [3 + (ord(c) % 60) for c in str(s)]
            if bos: ids = [self.bos_id] + ids
            if eos: ids = ids + [self.eos_id]
            return ids
        def decode(self, ids):
            return "".join(chr(64 + (i - 3) % 60) for i in ids if i >= 3)

    when = argv[0] if argv else "code"
    then = argv[1] if len(argv) > 1 else "a+b"
    workdir = tempfile.mkdtemp(prefix="myai_learncode_")
    ext_dir = os.path.join(workdir, "self_extensions")
    torch.manual_seed(2)
    tok = _CharTok()
    cfg = ModelConfig(vocab_size=128, block_size=64, arch="mesh",
                      mesh_neurons=18, mesh_dims=4, mesh_input=6, settle_ticks=3)
    model = build_model(cfg)
    reg = default_registry(data_dir=os.path.join(workdir, "data"))

    print(f'[learn-code] The AI does not know a coding skill yet '
          f'(registered coding-ext: {any(e.id == "coding-ext" for e in reg.skills())}).')
    print(f'[learn-code] Teaching it to code: when "{when}" -> "{then}" ...')
    result, installed = learn_and_extend(
        reg, model, tok, "coding-ext", [Definishon(when=when, then=then)],
        install_dir=ext_dir, name="Coding Extension", epochs=500, lr=5e-3, tolerance=0.3)
    print(f'[learn-code] learned (contract converged): {result.converged}')
    if not result.converged:
        print("[learn-code] the AI did not learn it this run (stochastic); "
              "no extension was created — try again.")
        return 0
    print(f'[learn-code] Having learned it, the AI autonomously created a coding extension:')
    print(f'             - registered as a live MoE skill: '
          f'{any(e.id == "coding-ext" for e in reg.skills())}')
    print(f'             - installed (quantized) to: {os.path.relpath(installed, workdir)}')
    blob = torch.load(installed, weights_only=False)
    print(f'             - quantized before install: {blob.get("quantized")} '
          f'({blob.get("bits")}-bit)')
    return 0


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 0
    cmd, rest = args[0], args[1:]
    if cmd == "build":
        return _build(rest)
    if cmd == "chat":
        return _run("core.py", rest)
    if cmd == "test":
        return _run("test_core.py", rest)
    if cmd == "demo":
        return _run("test_integration.py", rest)
    if cmd == "learn-code":
        return _learn_code(rest)
    if cmd == "code2net":
        return _code2net(rest)
    if cmd == "netsearch":
        return _netsearch(rest)
    print(f"unknown command: {cmd!r}\n")
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
