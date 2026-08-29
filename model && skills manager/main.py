#!/usr/bin/env python
"""NeuroClaw — unified entry point.

This connects the pieces of the system. (It replaces an earlier stand-alone,
torch-less NeuroLang interpreter that duplicated neurolang.py — the real,
mesh-connected DSL and extension builder now live there.)

Usage:
    python main.py build <program.nl>   # build + train the mesh from a NeuroLang program
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


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 0
    cmd, rest = args[0], args[1:]
    if cmd == "build":
        return _build(rest)
    # chat / test / demo / learn-code went with the TinyGPT track: every one of
    # them ran a transformer script that no longer exists. Chatting with this
    # project now means the one network, served by the TypeScript backend --
    # `npm run server` -- not a checkpoint sampled here.
    if cmd == "code2net":
        return _code2net(rest)
    if cmd == "netsearch":
        return _netsearch(rest)
    print(f"unknown command: {cmd!r}\n")
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
