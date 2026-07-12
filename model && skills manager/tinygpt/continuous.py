"""Continuous, never-idle operation (§9).

The mesh should not be a request-in / response-out function that sits idle
between calls. Output generation and input reception are two independent
activities that communicate only through the shared mesh state:

  - the OUTPUT stream keeps emitting tokens from the carried neuron state,
    writing to a bounded ring buffer, without ever pausing for input;
  - INPUT can be injected at any moment; it settles into the same shared state
    and the output stream picks it up on its next step.

Long/continuous OPERATION (keep thinking) and bounded STORAGE (a ring buffer
that overwrites rather than growing) are separate concerns — both are here.

`ContinuousRunner` exposes a deterministic stepper (`step`, `run`, `inject`) for
testing, and an optional background thread (`start`/`stop`) for genuinely
concurrent input/output. A lock guards the shared model so inject and step never
interleave a single forward.
"""
from __future__ import annotations

import threading
from collections import deque
from typing import List, Union

import torch

from .sampling import sample_next_token


class ContinuousRunner:
    def __init__(self, model, tokenizer, output_capacity: int = 512,
                 temperature: float = 0.8, top_k: int = 40, top_p: float = 0.95,
                 repetition_penalty: float = 1.1, device: str = "cpu"):
        self.model = model
        self.tok = tokenizer
        self.device = device
        model.enable_continuous(True)   # §9: carry neuron state across steps
        model.eval()
        # bounded output ring buffer — overwrites oldest, never grows unbounded
        self.output = deque(maxlen=output_capacity)
        self.temperature = temperature
        self.top_k = top_k
        self.top_p = top_p
        self.repetition_penalty = repetition_penalty
        self._last = getattr(tokenizer, "bos_id", 0)
        self._lock = threading.Lock()
        self._thread = None
        self._running = False

    @torch.no_grad()
    def _forward_token(self, tid: int) -> torch.Tensor:
        idx = torch.tensor([[tid]], dtype=torch.long, device=self.device)
        logits, _ = self.model(idx)     # updates the carried mesh state
        return logits[:, -1, :]

    @torch.no_grad()
    def inject(self, text: Union[str, List[int]]) -> None:
        """Inject external input into the shared mesh state. Non-blocking w.r.t.
        the output stream — it just settles input into the same state."""
        ids = self.tok.encode(text) if isinstance(text, str) else list(text)
        if not ids:
            return
        with self._lock:
            for tid in ids:
                self._forward_token(tid)
            self._last = ids[-1]

    @torch.no_grad()
    def step(self) -> int:
        """Emit one output token from the current state into the ring buffer."""
        with self._lock:
            logits = self._forward_token(self._last)
            ctx = torch.tensor([list(self.output) or [self._last]], dtype=torch.long, device=self.device)
            nxt = sample_next_token(logits, ctx, temperature=self.temperature,
                                    top_k=self.top_k, top_p=self.top_p,
                                    repetition_penalty=self.repetition_penalty)
            tid = int(nxt.item())
            self.output.append(tid)
            self._last = tid
            return tid

    def run(self, n_steps: int) -> List[int]:
        return [self.step() for _ in range(n_steps)]

    def output_text(self) -> str:
        return self.tok.decode(list(self.output))

    # ---- genuinely-concurrent background output stream ---------------------
    def start(self, delay: float = 0.0) -> None:
        """Run the output stream in a background thread; inject() from the main
        thread at any time. The output never blocks on input."""
        if self._running:
            return
        self._running = True

        def _loop():
            import time
            while self._running:
                self.step()
                if delay:
                    time.sleep(delay)

        self._thread = threading.Thread(target=_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None
