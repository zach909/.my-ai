"""Zip I/O loop memory (Prometheus section 2), Python port.

A fixed-capacity ring buffer of conversation turns that never truly empties — it
cycles, overwriting the oldest turn when full — with periodic disk checkpoints so
context survives past the live window and across restarts. This is the memory
layer of the unified core.

The "zip" is literal: checkpoints are zlib-compressed on disk (the design
notes' compressed input/output — more remembered context per byte stored).
Plain-JSON checkpoints from older versions still load.
"""
from __future__ import annotations

import json
import os
import zlib
from collections import deque
from typing import Deque, Dict, List, Optional

_ZIP_MAGIC = b"ZIP1"  # checkpoint header for the compressed format


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
        raw = json.dumps({"capacity": self.capacity, "turns": list(self.buffer)},
                         ensure_ascii=False).encode("utf-8")
        with open(self.persist_path, "wb") as f:
            f.write(_ZIP_MAGIC + zlib.compress(raw, level=6))

    def load(self) -> None:
        if not self.persist_path or not os.path.exists(self.persist_path):
            return
        with open(self.persist_path, "rb") as f:
            blob = f.read()
        try:
            if blob.startswith(_ZIP_MAGIC):
                data = json.loads(zlib.decompress(blob[len(_ZIP_MAGIC):]))
            else:
                data = json.loads(blob.decode("utf-8"))  # pre-compression format
        except (zlib.error, json.JSONDecodeError, UnicodeDecodeError):
            return  # a corrupt checkpoint must never take down the core
        self.buffer = deque(data.get("turns", []), maxlen=self.capacity)

    def compression_stats(self) -> Dict[str, int]:
        """Uncompressed vs on-disk bytes of the current buffer (for status UIs)."""
        raw = json.dumps({"capacity": self.capacity, "turns": list(self.buffer)},
                         ensure_ascii=False).encode("utf-8")
        return {"raw_bytes": len(raw),
                "zipped_bytes": len(_ZIP_MAGIC) + len(zlib.compress(raw, level=6))}

    def __len__(self) -> int:
        return len(self.buffer)
