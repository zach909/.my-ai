"""Local, at-rest encryption for the AI's private data — "all data remains
private through end-to-end encryption", runs on your machine.

Pure Python standard library only (``hashlib``, ``hmac``, ``os``): no external
APIs, no third-party crypto package, nothing leaves the machine. It is an
authenticated stream cipher built from SHA-256:

  - key derivation: PBKDF2-HMAC-SHA256 over a passphrase + random salt;
  - confidentiality: a SHA-256 counter-mode keystream XORed with the plaintext
    (each 32-byte block is ``SHA256(key || nonce || counter)``);
  - integrity: encrypt-then-MAC with HMAC-SHA256 over nonce+ciphertext, verified
    in constant time before anything is decrypted, so tampering is detected.

This is deliberately simple and dependency-free for a local personal AI; it is
not a substitute for a vetted library (e.g. AES-GCM via ``cryptography``) in a
hostile multi-user setting. The format is versioned so a stronger backend can
be swapped in later without breaking existing files.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from typing import Optional

_MAGIC = b"ENC1"          # file/format marker + version
_SALT_LEN = 16
_NONCE_LEN = 16
_TAG_LEN = 32             # HMAC-SHA256
_PBKDF2_ITERS = 100_000


def derive_key(passphrase: str, salt: bytes, iterations: int = _PBKDF2_ITERS) -> bytes:
    """PBKDF2-HMAC-SHA256 → 32-byte key."""
    return hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), salt, iterations)


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    """SHA-256 counter-mode keystream of `length` bytes."""
    out = bytearray()
    counter = 0
    while len(out) < length:
        block = hashlib.sha256(key + nonce + counter.to_bytes(8, "big")).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:length])


def _xor(data: bytes, stream: bytes) -> bytes:
    return bytes(a ^ b for a, b in zip(data, stream))


class LocalCipher:
    """A key + authenticated encrypt/decrypt of bytes and JSON.

    Construct from a passphrase (``LocalCipher.from_passphrase``) — the salt is
    embedded in the output so the same passphrase reproduces the key on load.
    """

    def __init__(self, key: bytes, salt: bytes):
        self.key = key
        self.salt = salt

    @classmethod
    def from_passphrase(cls, passphrase: str, salt: Optional[bytes] = None) -> "LocalCipher":
        salt = salt if salt is not None else os.urandom(_SALT_LEN)
        return cls(derive_key(passphrase, salt), salt)

    def _mac_key(self) -> bytes:
        # separate MAC key so the same key isn't used for both cipher and MAC
        return hashlib.sha256(b"mac" + self.key).digest()

    def encrypt(self, plaintext: bytes) -> bytes:
        nonce = os.urandom(_NONCE_LEN)
        ct = _xor(plaintext, _keystream(self.key, nonce, len(plaintext)))
        body = _MAGIC + self.salt + nonce + ct
        tag = hmac.new(self._mac_key(), body, hashlib.sha256).digest()
        return body + tag

    def decrypt(self, blob: bytes) -> bytes:
        if not blob.startswith(_MAGIC):
            raise ValueError("not an ENC1 blob")
        body, tag = blob[:-_TAG_LEN], blob[-_TAG_LEN:]
        expected = hmac.new(self._mac_key(), body, hashlib.sha256).digest()
        if not hmac.compare_digest(tag, expected):
            raise ValueError("authentication failed (wrong key or tampered data)")
        off = len(_MAGIC)
        salt = body[off:off + _SALT_LEN]                        # noqa: F841 (informational)
        nonce = body[off + _SALT_LEN:off + _SALT_LEN + _NONCE_LEN]
        ct = body[off + _SALT_LEN + _NONCE_LEN:]
        return _xor(ct, _keystream(self.key, nonce, len(ct)))

    def encrypt_json(self, obj) -> bytes:
        return self.encrypt(json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def decrypt_json(self, blob: bytes):
        return json.loads(self.decrypt(blob).decode("utf-8"))

    @staticmethod
    def salt_of(blob: bytes) -> bytes:
        """Read the salt embedded in a blob (to rebuild the key from a passphrase)."""
        if not blob.startswith(_MAGIC):
            raise ValueError("not an ENC1 blob")
        off = len(_MAGIC)
        return blob[off:off + _SALT_LEN]


def is_encrypted(blob: bytes) -> bool:
    return blob[:len(_MAGIC)] == _MAGIC


def cipher_for(passphrase: str, existing: Optional[bytes] = None) -> LocalCipher:
    """Build a cipher for a passphrase, reusing the salt embedded in an existing
    blob when decrypting so the key matches."""
    if existing and is_encrypted(existing):
        return LocalCipher.from_passphrase(passphrase, LocalCipher.salt_of(existing))
    return LocalCipher.from_passphrase(passphrase)
