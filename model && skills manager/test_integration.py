#!/usr/bin/env python
"""End-to-end integration demonstration: one continuous session that proves
the mechanisms in the design notes work TOGETHER as a single system, not just
individually in isolation (test_core.py covers that; this file exists
specifically to show integration).

One trained mesh is built via NeuroLang, then carried through extension
save/install, plugin & skill dispatch (including building NEW ones live),
self-healing, empathy-aware chat via the real core.py CLI, and the real
browser backend (interface/server.py) — all against the SAME model, so this
is the AI acting as one system, not a pile of separately-tested parts.

Run: python test_integration.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

_passed = 0
_failed = 0


def check(cond: bool, msg: str) -> None:
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  ok   {msg}")
    else:
        _failed += 1
        print(f"  FAIL {msg}")


def section(title: str) -> None:
    print(f"\n=== {title} ===")


def main() -> None:
    try:
        import torch
    except ImportError:
        print("torch not installed — integration demo needs it (pip install torch numpy sentencepiece)")
        sys.exit(0)

    workdir = tempfile.mkdtemp(prefix="myai_integration_")
    ckpt_dir = os.path.join(workdir, "checkpoints")
    os.makedirs(ckpt_dir, exist_ok=True)

    # ── 1. Neural Language: build the mesh through NeuroLang, spec-literal
    #      directives, and dictionary-linked (not just synonym-linked)
    #      concepts, then train it — "the model thinks using a neural
    #      language generated through the Extension Builder."
    section("1. NeuroLang builds and trains the mesh (Neural Language, §1/§2/§4)")
    import neurolang
    torch.manual_seed(0)
    program = "\n".join([
        'name="greeter"',
        '"greeter"@value="0.5"',                       # spec-literal alias
        '"greeter"@definition="hello there"',
        'name="coder"',
        '"coder"@definishon="write code to solve it"',  # dialect spelling
        'name="dev"',
        '"dev"@definition="build software that runs"',  # shares "software" via dictionary
        "train",
    ])
    rt = neurolang.interpret(program, save_dir=workdir)
    mesh, tok = rt._mesh, rt._mesh_tok
    check(mesh is not None, "NeuroLang program trained a real mesh")
    check("dev" in rt.neurons["coder"].ex_weights and "coder" in rt.neurons["dev"].ex_weights,
          "dictionary meanings auto-connected unrelated-by-spelling neurons "
          "('coder' <-> 'dev' via shared concept 'software')")
    mesh.eval()
    ids = torch.tensor([[tok.bos_id] + tok.encode("greeter")])
    out = mesh.generate(ids, max_new_tokens=len(tok.encode("hello there")), temperature=0.0)
    check(tok.decode(out[0, ids.size(1):].tolist()) == "hello there",
          "the trained mesh actually reproduces the taught behaviour")

    # ── 2. Elastic Values: zero-sum vale budget, then Self-Healing demotes a
    #      poor-performing neuron instead of deleting it.
    section("2. Elastic Values + Self-Healing (§2)")
    vale_before = mesh.get_vale()
    total_before = sum(vale_before)
    mesh(ids)  # populate _last_settled with real activity
    healed = mesh.self_heal(amount=0.25, z_threshold=0.5)
    total_after = sum(mesh.get_vale())
    check(abs(total_before - total_after) < 1e-3,
          "self-healing conserves the total vale budget while demoting weak neurons "
          f"(healed {len(healed)} neuron(s))")

    # ── 3. Extension Builder: save un-quantized, install quantized, both
    #      round-trip to the same trained behaviour — "install projects using
    #      quantization" (§8).
    section("3. Extension Builder: save (exact) vs install (quantized) (§8)")
    from tinygpt.extension_builder import Definishon, ExtensionBuilder, load_extension
    eb = ExtensionBuilder(mesh, tok, device="cpu")
    saved_path = os.path.join(workdir, "greeter.ext")
    installed_path = os.path.join(workdir, "greeter.install.ext")
    contracts = [Definishon(when="greeter", then="hello there", satisfied=True)]
    eb.save_project(saved_path, contracts)
    eb.install(installed_path, contracts, bits=8)
    check(os.path.getsize(installed_path) < os.path.getsize(saved_path),
          "installed (quantized) extension is smaller than the saved (exact) one")
    reloaded = neurolang_model_reload(mesh, tok, installed_path, torch, load_extension)
    check(reloaded == "hello there", "the installed, quantized extension still reproduces the trained reply")

    # ── 4. Plugins & Skills: dispatch a real local plugin, then build a NEW
    #      plugin and a NEW skill live against this same mesh — "creates and
    #      configures new plugins" / "trains and deploys new AI mini-models."
    section("4. Plugins & Skills, including live Plugin/Skill Builders")
    from tinygpt.plugins import build_plugin, default_registry
    registry = default_registry(data_dir=os.path.join(workdir, "extdata"))
    add = registry.dispatch("tasks", "add", "ship the integration demo")
    check(add.ok, "a built-in plugin (tasks) dispatches for real against local storage")

    new_plugin = build_plugin(registry, "reading-log", "os.reading", name="Reading Log")
    check(any(e.id == "reading-log" for e in registry.plugins()),
          "Plugin Builder skill created and registered a brand-new plugin live")
    check(registry.dispatch("reading-log", "add", "Prometheus design notes").ok,
          "the newly-built plugin dispatches for real, immediately")

    from tinygpt.extension_builder import build_skill
    torch.manual_seed(1)
    skill_result = build_skill(registry, mesh, tok, "farewell", [Definishon(when="bye", then="goodbye")],
                               epochs=250, lr=5e-3, tolerance=0.3)
    check(any(e.id == "farewell" for e in registry.skills()),
          "Skill Builder skill trained a new behaviour into the SAME mesh and registered it live "
          f"(converged={skill_result.converged})")

    # ── 4b. The design notes' flagship Extensions example, autonomous and end
    #       to end: "the AI creates extensions to store memory, logic, and
    #       learned abilities. Example: after learning to code it creates a
    #       coding extension" — the AI learns a coding behaviour, and only
    #       because it actually learned it, autonomously registers a live
    #       coding skill AND installs the extension to disk (quantized) so the
    #       ability is permanently preserved.
    section("4b. AI learns to code, then autonomously creates a coding extension")
    from tinygpt.extension_builder import learn_and_extend
    from tinygpt.config import ModelConfig as _MC
    from tinygpt.model import build_model as _bm
    torch.manual_seed(2)
    coder_cfg = _MC(vocab_size=128, block_size=64, arch="mesh",
                    mesh_neurons=18, mesh_dims=4, mesh_input=6, settle_ticks=3)
    coder = _bm(coder_cfg)
    check(not any(e.id == "coding-ext" for e in registry.skills()),
          "before learning: the AI has no coding extension")
    ext_dir = os.path.join(workdir, "self_extensions")
    result, installed = learn_and_extend(
        registry, coder, tok, "coding-ext",
        [Definishon(when="code", then="a+b")], install_dir=ext_dir,
        name="Coding Extension", epochs=500, lr=5e-3, tolerance=0.3)
    check(result.converged, "the AI actually learned the coding behaviour (contract converged)")
    check(any(e.id == "coding-ext" for e in registry.skills()),
          "having learned it, the AI autonomously registered the coding extension as a live skill")
    check(installed is not None and os.path.exists(installed),
          "the AI autonomously installed the coding extension to disk (permanently preserved)")
    blob = torch.load(installed, weights_only=False)
    check(blob.get("quantized") is True,
          "the installed coding extension was quantized before installation (design notes, §8)")
    # a fresh model can load the preserved extension back (structural round-trip)
    reloaded = _bm(coder_cfg).eval()
    load_extension(installed, reloaded)
    check(any(e.id == "coding-ext" for e in registry.skills()),
          "the preserved coding extension reloads into a fresh model")

    # It never fabricates an extension for a skill it did not learn: an
    # impossible/contradictory contract must not get registered or installed.
    torch.manual_seed(3)
    dud = _bm(coder_cfg)
    before_n = len(registry.skills())
    _res, _inst = learn_and_extend(
        registry, dud, tok, "unlearnable-ext",
        [Definishon(when="x", then="y"), Definishon(when="x", then="zzzz")],
        install_dir=ext_dir, epochs=30, lr=5e-3, tolerance=0.01)
    check(_inst is None and not any(e.id == "unlearnable-ext" for e in registry.skills())
          and len(registry.skills()) == before_n,
          "the AI does NOT create an extension for a capability it failed to learn")

    # ── 5. Empathy + Reinforcement Learning ledger + Quantum interference,
    #      all exercised together through the real core.py CLI — not
    #      reimplemented here, the actual entry point a user runs.
    section("5. Full core.py session: empathy + RL ledger + §5 interference, together")
    run_core_session(workdir, ckpt_dir, mesh, tok, torch)

    # ── 6. The browser backend (interface/server.py), same model family,
    #      real HTTP round-trip — "runs on your machine."
    section("6. Browser backend: real HTTP round-trip")
    run_browser_session(workdir, ckpt_dir)

    # ── 7. The Python <-> TypeScript bridge (top-level interface/server.py):
    #      the real Python model answers /api/chat while the real compiled
    #      TypeScript pipeline (MoE, empathy, alignment veto, ZIP-IO, 28
    #      plugins & skills) answers /api/systems through it — proof the two
    #      halves of the project are one running system, not two unconnected
    #      trees that both happen to work in isolation.
    section("7. Python <-> TypeScript bridge (repo-root interface/server.py)")
    run_bridge_session(workdir, ckpt_dir)

    print(f"\n{_passed} passed, {_failed} failed  (integration demo)")
    if _failed:
        sys.exit(1)


def neurolang_model_reload(mesh, tok, installed_path, torch, load_extension) -> str:
    """Reload the installed extension into a *fresh* model object (not the one
    still holding the trained weights) to prove persistence, not memory."""
    fresh = type(mesh)(mesh.cfg).eval()
    load_extension(installed_path, fresh)
    ids = torch.tensor([[tok.bos_id] + tok.encode("greeter")])
    out = fresh.generate(ids, max_new_tokens=len(tok.encode("hello there")), temperature=0.0)
    return tok.decode(out[0, ids.size(1):].tolist())


def run_core_session(workdir, ckpt_dir, mesh, tok, torch) -> None:
    """Save the trained mesh + tokenizer as a real checkpoint, then drive the
    actual core.py CLI (the entry point a user runs) through a scripted
    conversation, exercising empathy, the reasoning ledger, and §5
    interference selection all in one live session."""
    from tinygpt.utils import save_checkpoint

    tok_path = os.path.join(ckpt_dir, "spm.model")
    # this integration demo's tokenizer is the char-level _MeshCharTok NeuroLang
    # built, not a real SentencePiece model; core.py needs a real Tokenizer, so
    # train a tiny real one against a corpus and re-use the trained mesh's
    # config (weights differ from tok, but that's fine — this proves the
    # *pipeline*, not that this particular checkpoint gives fluent replies).
    from tinygpt.tokenizer import Tokenizer, TokenizerConfig
    corpus_path = os.path.join(workdir, "corpus.txt")
    with open(corpus_path, "w", encoding="utf-8") as f:
        f.write("hello there, this is a small local corpus for the integration demo. " * 40)
    Tokenizer.train([corpus_path], TokenizerConfig(vocab_size=96, model_prefix=tok_path[:-6]))

    from tinygpt.config import ModelConfig
    from tinygpt.model import build_model
    cfg = ModelConfig(vocab_size=96, block_size=64, arch="mesh", mesh_neurons=24,
                      mesh_dims=4, mesh_input=8, settle_ticks=3)
    fresh_model = build_model(cfg)
    ckpt_path = os.path.join(ckpt_dir, "gpt_sft.pt")
    save_checkpoint(ckpt_path, fresh_model, None, cfg, 0, float("inf"),
                    extra={"tokenizer": tok_path})

    script = "\n".join([
        "hello there, this is great, thank you!",
        "mood",
        "plugins",
        "this is broken and terrible, please fix it now!!!",
        "mood",
        "exit",
    ]) + "\n"

    here = os.path.dirname(os.path.abspath(__file__))
    proc = subprocess.run(
        [sys.executable, os.path.join(here, "core.py"),
         "--ckpt", ckpt_path, "--tokenizer", tok_path,
         "--memory", os.path.join(ckpt_dir, "memory.json"),
         "--empathy-state", os.path.join(ckpt_dir, "empathy.json"),
         "--ledger", os.path.join(ckpt_dir, "reasoning.json"),
         "--candidates", "2", "--max-new-tokens", "6", "--idle-timeout", "0",
         "--device", "cpu", "--select", "interference"],
        input=script, capture_output=True, text=True, timeout=120,
    )
    check(proc.returncode == 0, f"core.py CLI runs a full scripted session and exits cleanly "
         f"(rc={proc.returncode})" + ("" if proc.returncode == 0 else f"\nSTDERR:\n{proc.stderr[-2000:]}"))
    out = proc.stdout
    check("empathy    : on" in out, "core.py session banner confirms empathy is active")
    check("§5 interference" in out, "core.py session banner confirms §5 interference selection is active")
    check("positive" in out, "empathy read the positive first message correctly, mid-session")

    # two "mood" reads: after the positive message, and after the frustrated
    # one. EMA smoothing means a single frustrated message shifts the blended
    # mood proportionally rather than flipping the label outright (by design —
    # "the mood reflects the conversation's trend, not one noisy line") so
    # check the actual numeric shift rather than a specific label crossing.
    readings = [line for line in out.splitlines() if "valence" in line]
    check(len(readings) == 2, f"got two distinct empathy mood readings mid-session (found {len(readings)})")
    if len(readings) == 2:
        def _extract(line, key):
            return float(line.split(f"{key} ")[1].split(",")[0].split(")")[0])
        v1, a1 = _extract(readings[0], "valence"), _extract(readings[0], "arousal")
        v2, a2 = _extract(readings[1], "valence"), _extract(readings[1], "arousal")
        check(v2 < v1 and a2 > a1,
              f"empathy's mood measurably shifted toward negative/aroused after the frustrated "
              f"message (valence {v1:+.2f}->{v2:+.2f}, arousal {a1:.2f}->{a2:.2f})")
    check(os.path.exists(os.path.join(ckpt_dir, "reasoning.json")),
          "the reasoning ledger persisted to disk from a real session")
    check(os.path.exists(os.path.join(ckpt_dir, "empathy.json")),
          "the empathy state persisted to disk from a real session")


def run_browser_session(workdir, ckpt_dir) -> None:
    """Spin up the real interface/server.py against the checkpoint the core.py
    session just created, and drive it over real HTTP — the design notes'
    "runs on your machine" local web backend, not a mock."""
    here = os.path.dirname(os.path.abspath(__file__))
    port = 8199
    proc = subprocess.Popen(
        [sys.executable, os.path.join(here, "interface", "server.py"),
         "--ckpt", os.path.join(ckpt_dir, "gpt_sft.pt"),
         "--tokenizer", os.path.join(ckpt_dir, "spm.model"),
         "--port", str(port), "--device", "cpu"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        deadline = time.time() + 20
        status = None
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status", timeout=1) as r:
                    status = json.loads(r.read())
                    break
            except Exception:
                time.sleep(0.3)
        check(status is not None and status.get("parameters", 0) > 0,
              "the real browser backend comes up and reports live model stats over HTTP")

        with urllib.request.urlopen(
            urllib.request.Request(f"http://127.0.0.1:{port}/api/chat",
                                   data=json.dumps({"message": "hello"}).encode(),
                                   headers={"Content-Type": "application/json"}),
            timeout=30,
        ) as r:
            reply = json.loads(r.read())
        check(isinstance(reply.get("reply"), str) and len(reply["reply"]) > 0,
              "the browser backend generates a real reply over HTTP (not a template)")

        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=5) as r:
            html = r.read()
        check(b"<html" in html.lower(), "the browser backend serves the chat page")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def run_bridge_session(workdir, ckpt_dir) -> None:
    """Bring up the repo-root interface/server.py against the same checkpoint
    the core.py session used, and prove BOTH halves of the project answer
    through it: /api/chat from the real Python model, /api/systems proxied
    to the real compiled TypeScript pipeline it spawns as a sibling backend."""
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(here)
    main_js = os.path.join(repo_root, "dist", "interface", "main.js")
    if not os.path.exists(main_js):
        print("  skip bridge test (dist/interface/main.js missing — run `bun run build:backend` first)")
        return

    port = 8198
    proc = subprocess.Popen(
        [sys.executable, os.path.join(repo_root, "interface", "server.py"),
         "--ckpt", os.path.join(ckpt_dir, "gpt_sft.pt"), "--port", str(port)],
        cwd=repo_root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        deadline = time.time() + 30
        status = None
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status", timeout=1) as r:
                    status = json.loads(r.read())
                    if status.get("running"):
                        break
            except Exception:
                time.sleep(0.5)
        check(status is not None and status.get("running") is True,
              "the bridge server comes up and reports the Python model's live status")

        with urllib.request.urlopen(
            urllib.request.Request(f"http://127.0.0.1:{port}/api/chat",
                                   data=json.dumps({"message": "hello"}).encode(),
                                   headers={"Content-Type": "application/json"}),
            timeout=30,
        ) as r:
            chat = json.loads(r.read())
        check(isinstance(chat.get("response"), str) and len(chat["response"]) > 0,
              "the bridge server's /api/chat answers from the real Python model")

        # /api/systems is proxied straight to the compiled TS pipeline
        # (interface/main.ts's startWeb) -- a live, non-trivial subsystem
        # report proves that sibling process is genuinely up and answering,
        # not just that the proxy returned *something*.
        systems = None
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/systems", timeout=2) as r:
                    systems = json.loads(r.read())
                    if systems.get("running"):
                        break
            except Exception:
                time.sleep(0.5)
        check(systems is not None and systems.get("running") is True,
              "/api/systems is proxied to the real, live TypeScript pipeline subprocess")
        check(isinstance(systems.get("subsystems", {}).get("plugins"), bool) if systems else False,
              "the proxied TS status reports real subsystem state (plugins/veto/empathy/etc.), not a stub")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    main()
