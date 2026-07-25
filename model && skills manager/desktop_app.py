#!/usr/bin/env python
"""Native desktop chat window for the Prometheus/TinyGPT unified core.

A real, native GUI: Tkinter, Python's own stdlib GUI toolkit. No browser, no
Electron/Chromium runtime, no webview -- this opens as a genuine native
window using the OS's own Tk widgets, not a page rendered in a browser
engine. Tkinter ships with the standard python.org Windows/macOS installers;
on some Linux distributions it's one extra OS package (`apt install
python3-tk`, matched to your Python's minor version) -- see INSTALL.md.

Drives the exact same tinygpt.engine.ConversationEngine that core.py's
terminal CLI uses, so the GUI and the terminal can never drift apart on what
a "turn" actually does (the same reasoning tinygpt/infer.py already applies
one level down for chat.py/interface/server.py's shared generation path).
Model generation runs on a background thread so the window stays responsive
while it thinks; the gated action layer's confirmation prompt becomes a real
modal dialog instead of core.py's terminal y/N prompt.

Usage:
    python desktop_app.py --ckpt checkpoints/gpt_sft.pt
"""
from __future__ import annotations

import argparse
import queue
import threading
import tkinter as tk
from tkinter import messagebox, scrolledtext

from core import engine_config_from_args
from tinygpt.engine import ConversationEngine


def parse_args():
    ap = argparse.ArgumentParser(description="Native desktop chat window for TinyGPT.")
    ap.add_argument("--ckpt", default="checkpoints/gpt_sft.pt")
    ap.add_argument("--tokenizer", default=None)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--candidates", type=int, default=3, help="best-of-N (section 11)")
    ap.add_argument("--max-new-tokens", type=int, default=200)
    ap.add_argument("--temperature", type=float, default=0.8)
    ap.add_argument("--top-k", type=int, default=40)
    ap.add_argument("--top-p", type=float, default=0.95)
    ap.add_argument("--repetition-penalty", type=float, default=1.1)
    ap.add_argument("--memory", default="checkpoints/memory.json", help="zip-loop persist path")
    ap.add_argument("--memory-turns", type=int, default=8)
    ap.add_argument("--encrypt", metavar="PASSPHRASE", default=None,
                    help="encrypt persisted memory at rest. Or set MYAI_PASSPHRASE.")
    ap.add_argument("--select", choices=["confidence", "interference"], default="confidence")
    ap.add_argument("--no-empathy", action="store_true")
    ap.add_argument("--empathy-state", default="checkpoints/empathy.json")
    ap.add_argument("--no-ledger", action="store_true")
    ap.add_argument("--ledger", default="checkpoints/reasoning.json")
    ap.add_argument("--no-actions", action="store_true")
    ap.add_argument("--enable-shell", action="store_true",
                    help="register the terminal action (gnome/desktop control). Always confirms.")
    ap.add_argument("--no-guide", action="store_true")
    ap.add_argument("--guide-low-confidence", type=float, default=0.25)
    ap.add_argument("--guide-patience", type=int, default=3)
    ap.add_argument("--mmap", action="store_true",
                    help="disk-offload: memory-map the checkpoint instead of loading it fully into RAM")
    ap.add_argument("--seed", type=int, default=None)
    return ap.parse_args()


class ChatWindow:
    """The native window. Tk widgets may only be touched from the thread that
    created them, so every engine call runs on a worker thread and results
    come back through a queue the Tk main loop polls."""

    def __init__(self, root: tk.Tk, engine: ConversationEngine):
        self.root = root
        self.engine = engine
        self._results: "queue.Queue" = queue.Queue()
        if engine.action_layer is not None:
            engine.action_layer.confirm_fn = self._confirm_from_worker

        root.title(f"Prometheus/TinyGPT — {engine.cfg.ckpt}")
        root.geometry("720x520")

        self.transcript = scrolledtext.ScrolledText(root, state="disabled", wrap="word")
        self.transcript.pack(fill="both", expand=True, padx=8, pady=(8, 4))

        entry_frame = tk.Frame(root)
        entry_frame.pack(fill="x", padx=8, pady=(0, 8))
        self.entry = tk.Entry(entry_frame)
        self.entry.pack(side="left", fill="x", expand=True)
        self.entry.bind("<Return>", lambda _event: self.send())
        self.entry.focus_set()
        self.send_button = tk.Button(entry_frame, text="Send", command=self.send)
        self.send_button.pack(side="left", padx=(6, 0))
        self.reset_button = tk.Button(entry_frame, text="Reset memory", command=self.reset_memory)
        self.reset_button.pack(side="left", padx=(6, 0))

        self._append(
            f"Loaded {engine.cfg.ckpt} on {engine.device}"
            f"{' [mmap disk-offload]' if engine.cfg.mmap else ''}\n"
            f"Memory: {len(engine.memory)} turn(s) loaded"
            f"{' [encrypted at rest]' if engine.memory.passphrase else ''}\n\n"
        )
        self._poll_results()

    def _append(self, text: str) -> None:
        self.transcript.configure(state="normal")
        self.transcript.insert("end", text)
        self.transcript.configure(state="disabled")
        self.transcript.see("end")

    def send(self) -> None:
        text = self.entry.get().strip()
        if not text:
            return
        self.entry.delete(0, "end")
        self._append(f"you> {text}\n")
        self.send_button.configure(state="disabled")
        threading.Thread(target=self._respond_worker, args=(text,), daemon=True).start()

    def _respond_worker(self, text: str) -> None:
        try:
            result = self.engine.respond(text)
            self._results.put(("ok", result))
        except Exception as e:  # a bad generation must never crash the window
            self._results.put(("error", str(e)))

    def _confirm_from_worker(self, prompt: str) -> bool:
        """The action layer calls confirm_fn synchronously from whichever
        thread is running respond() (the worker thread here). Schedule the
        real dialog on the main thread and block the worker until answered,
        so the model's proposed action still can't run without a real,
        explicit human confirmation -- the same guarantee core.py's terminal
        y/N prompt gives, just presented as a native dialog."""
        answered = threading.Event()
        box: dict = {}

        def _ask():
            box["answer"] = messagebox.askyesno("Confirm action", prompt)
            answered.set()

        self.root.after(0, _ask)
        answered.wait()
        return box["answer"]

    def reset_memory(self) -> None:
        self.engine.reset_memory()
        self._append("(memory cleared)\n\n")

    def _poll_results(self) -> None:
        try:
            while True:
                kind, payload = self._results.get_nowait()
                if kind == "ok":
                    result = payload
                    self._append(f"bot> {result.reply}\n")
                    if self.engine.cfg.candidates > 1:
                        self._append(f"     (chose best of {self.engine.cfg.candidates}, "
                                    f"confidence {result.confidence:.3f})\n")
                    if result.guidance_corrections > 0:
                        self._append(f"     (live guidance steered {result.guidance_corrections} time(s))\n")
                    if result.action_output is not None:
                        self._append(f"[action] {result.action_output}\n")
                    self._append("\n")
                else:
                    self._append(f"(error: {payload})\n\n")
                self.send_button.configure(state="normal")
        except queue.Empty:
            pass
        self.root.after(100, self._poll_results)


def main() -> None:
    args = parse_args()
    engine = ConversationEngine(engine_config_from_args(args))
    root = tk.Tk()
    ChatWindow(root, engine)
    root.mainloop()


if __name__ == "__main__":
    main()
