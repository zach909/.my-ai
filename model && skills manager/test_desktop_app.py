"""Smoke test for the native desktop GUI (desktop_app.py).

Drives the real ChatWindow class -- built on tinygpt.engine.ConversationEngine,
the exact same shared engine core.py's terminal CLI uses -- through one real
conversational turn inside a real (virtual) Tk window, the same way
test_integration.py's run_core_session() drives the real core.py CLI as a
subprocess rather than reimplementing its logic.

Tkinter is an OPTIONAL, environment-dependent component: it's Python's own
stdlib GUI toolkit (ships by default with the python.org Windows/macOS
installers), but on some Linux distributions it needs one extra OS package
matched to the Python minor version in use (e.g. `apt install python3.11-tk`;
see INSTALL.md), and actually opening a window needs a display. Neither is
assumed present, so this skips cleanly rather than failing when tkinter isn't
importable, or when no real or virtual (Xvfb) display is available -- the
same "skip, don't fail" convention test_elastic_mesh.py uses for PennyLane.

Run with: python3 test_desktop_app.py
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time

try:
    import tkinter as tk
except ImportError:
    print("tkinter not installed — test_desktop_app.py needs it "
          "(e.g. apt install python3-tk on Debian/Ubuntu); skipping")
    sys.exit(0)

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


def _ensure_display():
    """Return True if a display is already available, or if a throwaway Xvfb
    instance was started and DISPLAY now points at it. False (skip) if
    neither a real display nor Xvfb is available."""
    if os.environ.get("DISPLAY"):
        try:
            probe = tk.Tk()
            probe.destroy()
            return True
        except tk.TclError:
            pass  # DISPLAY is set but stale/unusable; fall through to Xvfb
    xvfb = shutil.which("Xvfb")
    if xvfb is None:
        return False
    display_num = ":97"
    proc = subprocess.Popen([xvfb, display_num, "-screen", "0", "1024x768x24"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.environ["DISPLAY"] = display_num
    for _ in range(50):  # Xvfb needs a moment to start listening
        try:
            probe = tk.Tk()
            probe.destroy()
            _ensure_display._xvfb_proc = proc  # keep a reference; caller doesn't need to manage it
            return True
        except tk.TclError:
            time.sleep(0.1)
    proc.terminate()
    return False


def test_chat_window_real_turn():
    try:
        import torch  # noqa: F401
    except ImportError:
        print("  skip desktop-app test (torch not installed)")
        return
    if not _ensure_display():
        print("  skip desktop-app test (no display and no Xvfb available)")
        return

    from core import engine_config_from_args
    from desktop_app import ChatWindow
    from tinygpt.config import ModelConfig
    from tinygpt.engine import ConversationEngine
    from tinygpt.model import build_model
    from tinygpt.tokenizer import Tokenizer, TokenizerConfig
    from tinygpt.utils import save_checkpoint

    workdir = tempfile.mkdtemp()
    corpus_path = os.path.join(workdir, "corpus.txt")
    with open(corpus_path, "w", encoding="utf-8") as f:
        f.write("hello there, this is a small local corpus for the desktop app test. " * 40)
    tok_path = os.path.join(workdir, "spm")
    Tokenizer.train([corpus_path], TokenizerConfig(vocab_size=96, model_prefix=tok_path))

    cfg = ModelConfig(vocab_size=96, block_size=64, arch="mesh", mesh_neurons=24,
                      mesh_dims=4, mesh_input=8, settle_ticks=3)
    model = build_model(cfg)
    ckpt_path = os.path.join(workdir, "gpt_sft.pt")
    save_checkpoint(ckpt_path, model, None, cfg, 0, float("inf"),
                    extra={"tokenizer": tok_path + ".model"})

    class _Args:
        ckpt = ckpt_path
        tokenizer = tok_path + ".model"
        device = "cpu"
        mmap = False
        candidates = 2
        max_new_tokens = 6
        temperature = 0.8
        top_k = 40
        top_p = 0.95
        repetition_penalty = 1.1
        memory = os.path.join(workdir, "memory.json")
        memory_turns = 8
        encrypt = None
        select = "confidence"
        no_empathy = False
        empathy_state = os.path.join(workdir, "empathy.json")
        no_ledger = False
        ledger = os.path.join(workdir, "reasoning.json")
        no_actions = True  # no live model to approve/deny actions against in this test
        enable_shell = False
        no_guide = False
        guide_low_confidence = 0.25
        guide_patience = 3
        seed = 0

    engine = ConversationEngine(engine_config_from_args(_Args()))
    root = tk.Tk()
    try:
        window = ChatWindow(root, engine)
        check("Loaded" in window.transcript.get("1.0", "end"),
              "the window's transcript shows the startup banner")

        window.entry.insert(0, "hello there, this is great, thank you!")
        window.send()
        check(window.send_button["state"] == "disabled",
              "the Send button disables itself while a turn is in flight")

        deadline = time.time() + 30
        while time.time() < deadline:
            root.update()
            if window.send_button["state"] == "normal":
                break
            time.sleep(0.05)
        transcript = window.transcript.get("1.0", "end")
        check("bot>" in transcript, "a real conversational turn completes and appears in the transcript")
        check(window.send_button["state"] == "normal",
              "the Send button re-enables itself once the turn completes")
        check(window.entry.get() == "", "the input box is cleared after sending")

        window.reset_memory()
        check("(memory cleared)" in window.transcript.get("1.0", "end"),
              "the Reset memory button actually clears the engine's memory")
        check(len(engine.memory) == 0, "engine.memory is genuinely empty after reset, not just the label")
    finally:
        root.destroy()


def main():
    for fn in (test_chat_window_real_turn,):
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
