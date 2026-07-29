"""Reusable text-generation helper for a trained TinyGPT checkpoint.

Both the CLI (`chat.py`) and the browser backend (`interface/server.py`) load a
checkpoint and sample from it the same way; this module is the single place that
logic lives, so the interface and the CLI can never drift apart. It reconstructs
the exact architecture stored in the checkpoint (standard transformer *or* the
elastic-mesh core) and exposes a small `Generator` object.
"""
from __future__ import annotations

import os
import re
from typing import Optional

import torch
import torch.nn as nn

from .config import ModelConfig
from .model import build_model
from .tokenizer import Tokenizer
from .utils import load_checkpoint, resolve_device

# role markers the SFT format uses; a completion should stop if it wanders into one
_ROLE_MARKERS = ("<|user|>", "<|assistant|>", "<|system|>")
# sentence-final punctuation, for trimming an over-generation to whole sentences
_SENTENCE_END = re.compile(r"[.!?]['\")\]]?\s")


def trim_to_last_sentence(text: str) -> str:
    """Cut trailing dangling words so a reply ends on a complete sentence.

    Small models reliably stop mid-phrase when the token budget runs out; keeping
    only up to the last sentence-ending punctuation yields clean multi-sentence
    prose instead of a fragment. Falls back to the whole text if no sentence
    boundary is present.
    """
    text = text.strip()
    matches = list(_SENTENCE_END.finditer(text + " "))
    if not matches:
        return text
    end = matches[-1].end()
    return text[:end].strip()


class Generator:
    """A loaded model + tokenizer with a simple `generate()` entry point."""

    def __init__(self, model: nn.Module, tokenizer: Tokenizer, config: ModelConfig,
                 device: str, ckpt_path: str):
        self.model = model
        self.tokenizer = tokenizer
        self.config = config
        self.device = device
        self.ckpt_path = ckpt_path

    def generate(
        self,
        prompt: str,
        *,
        max_new_tokens: int = 140,
        temperature: float = 0.8,
        top_k: int = 40,
        top_p: float = 0.95,
        repetition_penalty: float = 1.15,
        seed: Optional[int] = None,
        paragraph: bool = True,
    ) -> str:
        """Generate a continuation of `prompt` and return only the new text.

        With `paragraph=True` the result is trimmed to whole sentences and cut at
        any role marker, so callers get clean multi-sentence prose.
        """
        if seed is not None:
            torch.manual_seed(seed)
        prompt_ids = self.tokenizer.encode(prompt, bos=True)
        n_prompt = len(prompt_ids)
        idx = torch.tensor([prompt_ids], dtype=torch.long, device=self.device)

        # In paragraph mode, stop once the reply forms a few complete sentences
        # (past a minimum length), so we don't spend compute generating tokens
        # that sentence-trimming would only throw away.
        stop_fn = None
        if paragraph:
            min_new, max_sentences = 24, 4

            def stop_fn(cur):  # noqa: E306
                new_ids = cur[0, n_prompt:].tolist()
                if len(new_ids) < min_new:
                    return False
                text = self.tokenizer.decode(new_ids)
                return len(_SENTENCE_END.findall(text + " ")) >= max_sentences

        with torch.no_grad():
            out = self.model.generate(
                idx, max_new_tokens=max_new_tokens, temperature=temperature,
                top_k=top_k, top_p=top_p, repetition_penalty=repetition_penalty,
                eos_id=self.tokenizer.eos_id, stop_fn=stop_fn,
            )
        text = self.tokenizer.decode(out[0, len(prompt_ids):].tolist())
        if not paragraph:
            return text
        for marker in _ROLE_MARKERS:
            if marker in text:
                text = text.split(marker)[0]
        return trim_to_last_sentence(text)

    def stats(self) -> dict:
        """Architecture summary for a status endpoint."""
        n_params = sum(p.numel() for p in self.model.parameters())
        c = self.config
        return {
            "parameters": n_params,
            "n_layer": c.n_layer,
            "n_head": c.n_head,
            "n_embd": c.n_embd,
            "block_size": c.block_size,
            "vocab_size": c.vocab_size,
            "use_elastic_mesh": c.use_elastic_mesh,
            "mesh_num_experts": c.mesh_num_experts if c.use_elastic_mesh else 0,
            "mesh_n_neurons": c.mesh_n_neurons if c.use_elastic_mesh else 0,
            "mesh_n_qubits": c.mesh_n_qubits if c.use_elastic_mesh else 0,
        }


def load_generator(ckpt_path: str, device: str = "cpu",
                   tokenizer_path: Optional[str] = None,
                   quantize: bool = False, mmap: bool = False) -> Generator:
    """Load a checkpoint into a ready-to-use `Generator`.

    The architecture (standard or elastic-mesh) and the tokenizer path are read
    from the checkpoint itself, so the caller only supplies the `.pt` path.

    `quantize=True` applies int8 dynamic quantization to the Linear layers,
    ~4x-shrinking their weights for memory-constrained (e.g. Raspberry-Pi)
    deployment — design doc mechanism 8, quantization as native compression.
    Measured note: for these tiny models it does NOT speed up CPU inference
    (quant/dequant overhead outweighs int8 matmul gains), so it's off by default
    and is a memory optimization, not a latency one.

    `mmap=True` disk-offloads the checkpoint load itself (see
    `load_checkpoint`'s docstring) — a separate, complementary memory
    optimization from `quantize`: mmap reduces how much of the *stored*
    checkpoint must resident in RAM at once, quantization reduces the size of
    the *loaded* weights themselves.
    """
    device = resolve_device(device)
    ckpt = load_checkpoint(ckpt_path, map_location=device, mmap=mmap)
    config = ModelConfig(**ckpt["model_config"])
    model = build_model(config).to(device)
    model.load_state_dict(ckpt["model"])
    model.eval()
    if quantize and device == "cpu":
        model = _quantize_dynamic(model)
    tok_path = resolve_tokenizer(
        tokenizer_path or ckpt.get("tokenizer", "checkpoints/spm.model"), ckpt_path)
    tokenizer = Tokenizer(tok_path)
    return Generator(model, tokenizer, config, device, ckpt_path)


def _quantize_dynamic(model: nn.Module) -> nn.Module:
    """int8-quantize the Linear weights for lighter/faster CPU inference.

    Dynamic quantization swaps nn.Linear for int8 versions that dequantize on
    the fly; the token embedding and the elastic-mesh PennyLane TorchLayer aren't
    nn.Linear so they're left untouched.
    """
    import torch.ao.quantization as tq
    return tq.quantize_dynamic(model, {nn.Linear}, dtype=torch.qint8, inplace=False)


def resolve_tokenizer(tok_path: str, ckpt_path: str) -> str:
    """Find the tokenizer even when the checkpoint stored a relative path.

    Checkpoints record the tokenizer path relative to the training working
    directory (e.g. ``checkpoints_v2/spm.model``), which breaks when inference
    runs from a different cwd. The tokenizer is always saved alongside the
    checkpoint, so fall back to the checkpoint's own directory.
    """
    if os.path.exists(tok_path):
        return tok_path
    # The checkpoint and tokenizer may live in different checkpoint dirs (e.g. a
    # mesh checkpoint that reused a tokenizer trained for another run), so try a
    # few likely roots: next to the checkpoint, then relative to the tinygpt
    # package root (checkpoints are usually recorded relative to it).
    candidates = [
        os.path.join(os.path.dirname(os.path.abspath(ckpt_path)), os.path.basename(tok_path)),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), tok_path),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return tok_path  # let Tokenizer raise a clear FileNotFoundError
