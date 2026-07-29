"""Zip I/O loop memory (Prometheus section 2), Python port.

A fixed-capacity ring buffer of conversation turns that never truly empties — it
cycles, overwriting the oldest turn when full — with periodic disk checkpoints so
context survives past the live window and across restarts. This is the memory
layer of the unified core.
"""
from __future__ import annotations

import json
import os
import zlib
from collections import deque
from typing import Deque, Dict, List, Optional

# Marks a persisted buffer as zlib-compressed (Prometheus §2, "zipped" I/O).
# Older, pre-compression checkpoints lack this prefix and are read as plain
# JSON for backward compatibility (see load()).
_ZIP_MAGIC = b"ZL01"


class ZipLoopMemory:
    def __init__(self, capacity: int = 512, persist_path: Optional[str] = None,
                 passphrase: Optional[str] = None):
        self.capacity = capacity
        self.persist_path = persist_path
        # When a passphrase is given, the on-disk conversation is encrypted at
        # rest with the local stdlib cipher (tinygpt/crypto.py) — the design's
        # "all data remains private through end-to-end encryption". The cipher
        # is built lazily so the salt from an existing file is reused.
        self.passphrase = passphrase
        self._cipher = None
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

    def _get_cipher(self, existing: Optional[bytes] = None):
        if not self.passphrase:
            return None
        from .crypto import cipher_for
        # reuse the salt embedded in an existing blob so the key matches on load
        if existing is not None or self._cipher is None:
            self._cipher = cipher_for(self.passphrase, existing)
        return self._cipher

    def save(self) -> None:
        if not self.persist_path:
            return
        os.makedirs(os.path.dirname(self.persist_path) or ".", exist_ok=True)
        raw = json.dumps({"capacity": self.capacity, "turns": list(self.buffer)},
                         ensure_ascii=False).encode("utf-8")
        payload = _ZIP_MAGIC + zlib.compress(raw, level=6)
        cipher = self._get_cipher()
        if cipher is not None:
            payload = cipher.encrypt(payload)   # encrypt the compressed blob at rest
        with open(self.persist_path, "wb") as f:
            f.write(payload)

    def load(self) -> None:
        if not self.persist_path or not os.path.exists(self.persist_path):
            return
        with open(self.persist_path, "rb") as f:
            blob = f.read()
        try:
            from .crypto import is_encrypted
            if is_encrypted(blob):
                cipher = self._get_cipher(existing=blob)
                if cipher is None:
                    return  # encrypted on disk but no passphrase given
                blob = cipher.decrypt(blob)     # raises on wrong key / tamper
            if blob.startswith(_ZIP_MAGIC):
                data = json.loads(zlib.decompress(blob[len(_ZIP_MAGIC):]))
            else:
                data = json.loads(blob.decode("utf-8"))  # pre-compression format
        except (zlib.error, json.JSONDecodeError, UnicodeDecodeError, ValueError):
            return  # a corrupt / unreadable checkpoint must never take down the core
        self.buffer = deque(data.get("turns", []), maxlen=self.capacity)

    def __len__(self) -> int:
        return len(self.buffer)
