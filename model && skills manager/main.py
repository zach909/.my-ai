#!/usr/bin/env python
"""Prometheus Elastic Core — unified entry point.

This connects the pieces of the system. (It replaces an earlier stand-alone,
torch-less NeuroLang interpreter that duplicated neurolang.py — the real,
mesh-connected DSL and extension builder now live there.)

Usage:
    python main.py build <program.nl>   # build + train the mesh from a NeuroLang program
    python main.py chat  [args...]      # talk to a trained mesh through the core
    python main.py test                 # run the test suite

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
    print(f"unknown command: {cmd!r}\n")
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
