"""Zip I/O loop memory (Prometheus section 2), Python port.

A fixed-capacity ring buffer of conversation turns that never truly empties — it
cycles, overwriting the oldest turn when full — with periodic disk checkpoints so
context survives past the live window and across restarts. This is the memory
layer of the unified core.
"""
from __future__ import annotations

import json
import os
from collections import deque
from typing import Deque, Dict, List, Optional


class ZipLoopMemory:
    def __init__(self, capacity: int = 512, persist_path: Optional[str] = None):
        self.capacity = capacity
        self.persist_path = persist_path
        self.buffer: Deque[Dict[str, str]] = deque(maxlen=capacity)
        if persist_path and os.path.exists(persist_path):
            self.load()

    def add(self, role: str, content: str) -> None:
        self.buffer.append({"role": role, "content": content})

    def recent(self, n: Optional[int] = None) -> List[Dict[str, str]]:
        turns = list(self.buffer)
        return turns if n is None else turns[-n:]

    def clear(self) -> None:
        self.buffer.clear()

    def save(self) -> None:
        if not self.persist_path:
            return
        os.makedirs(os.path.dirname(self.persist_path) or ".", exist_ok=True)
        with open(self.persist_path, "w", encoding="utf-8") as f:
            json.dump({"capacity": self.capacity, "turns": list(self.buffer)}, f)

    def load(self) -> None:
        if not self.persist_path or not os.path.exists(self.persist_path):
            return
        with open(self.persist_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.buffer = deque(data.get("turns", []), maxlen=self.capacity)

    def __len__(self) -> int:
        return len(self.buffer)
