"""Dataset utilities.

Pretraining: concatenate a Markdown corpus into one token stream and serve
contiguous (x, y) blocks. Fine-tuning: format chat records into
<|user|>/<|assistant|> turns and mask the loss so only assistant tokens are
learned.
"""
from __future__ import annotations

import json
import os
from typing import List, Tuple

import numpy as np
import torch
from torch.utils.data import Dataset

from .tokenizer import Tokenizer


# ------------------------------- pretraining -------------------------------
def build_token_stream(data_dir: str, tokenizer: Tokenizer) -> np.ndarray:
    """Tokenize every markdown file under data_dir into one uint16/int32 stream,
    separating documents with EOS so the model learns document boundaries."""
    paths = Tokenizer.collect_markdown(data_dir)
    if not paths:
        raise FileNotFoundError(f"No .md/.txt files found under {data_dir}")

    ids: List[int] = []
    for path in paths:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
        if not text.strip():
            continue
        ids.extend(tokenizer.encode(text, bos=True, eos=True))

    dtype = np.uint16 if tokenizer.vocab_size < 2 ** 16 else np.int32
    return np.array(ids, dtype=dtype)


def train_val_split(stream: np.ndarray, val_fraction: float,
                    block_size: int = 0) -> Tuple[np.ndarray, np.ndarray]:
    """Split a token stream into train/val tails.

    When `block_size` is given, the validation tail is guaranteed to be at least
    `block_size + 2` tokens (so it can form one block) whenever the corpus is
    large enough — otherwise a tiny corpus would produce an unusable val set.
    """
    n_val = max(1, int(len(stream) * val_fraction))
    if block_size:
        min_val = block_size + 2
        # need at least one usable block in *both* splits
        if len(stream) < 2 * min_val:
            raise ValueError(
                f"Corpus ({len(stream)} tokens) is too small for block_size {block_size}. "
                f"Use a larger corpus or a smaller --block-size."
            )
        n_val = min(max(n_val, min_val), len(stream) - min_val)
    return stream[:-n_val], stream[-n_val:]


class PackedDataset(Dataset):
    """Serves fixed-length (x, y) blocks from a flat token stream. y is x shifted
    by one, which is the standard next-token-prediction target."""

    def __init__(self, stream: np.ndarray, block_size: int):
        if len(stream) <= block_size + 1:
            raise ValueError(
                f"Token stream ({len(stream)}) is too short for block_size {block_size}. "
                f"Add more data or reduce block_size."
            )
        self.stream = stream
        self.block_size = block_size

    def __len__(self) -> int:
        return len(self.stream) - self.block_size - 1

    def __getitem__(self, i: int):
        chunk = self.stream[i: i + self.block_size + 1].astype(np.int64)
        x = torch.from_numpy(chunk[:-1])
        y = torch.from_numpy(chunk[1:])
        return x, y


# ------------------------------- fine-tuning -------------------------------
def _load_chat_records(path: str) -> List[dict]:
    """Load chat data as either a JSON array or JSONL (one object per line).

    Each record is either:
      {"messages": [{"role": "user"|"assistant"|"system", "content": "..."}]}
    or the simple {"prompt": "...", "response": "..."} shape.
    """
    records: List[dict] = []
    with open(path, "r", encoding="utf-8") as f:
        content = f.read().strip()
    if not content:
        return records
    try:
        data = json.loads(content)
        records = data if isinstance(data, list) else [data]
    except json.JSONDecodeError:
        for line in content.splitlines():
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def _record_to_messages(rec: dict) -> List[dict]:
    if "messages" in rec:
        return rec["messages"]
    if "prompt" in rec and "response" in rec:
        return [
            {"role": "user", "content": rec["prompt"]},
            {"role": "assistant", "content": rec["response"]},
        ]
    raise ValueError(f"Unrecognised chat record shape: {list(rec.keys())}")


def build_chat_prompt(messages: List[dict], tokenizer: Tokenizer,
                      user_token: str = "<|user|>",
                      assistant_token: str = "<|assistant|>",
                      system_token: str = "<|system|>") -> str:
    """Render a conversation into the training/inference text format."""
    role_token = {"user": user_token, "assistant": assistant_token, "system": system_token}
    parts = []
    for m in messages:
        tok = role_token.get(m["role"], user_token)
        parts.append(f"{tok}\n{m['content'].strip()}\n")
    return "".join(parts)


class ChatSFTDataset(Dataset):
    """Supervised fine-tuning dataset. The loss is masked (target = -1) on every
    token except the assistant's replies, so the model only learns to *respond*,
    not to reproduce the prompts."""

    def __init__(self, path: str, tokenizer: Tokenizer, block_size: int,
                 cfg_tokens: Tuple[str, str, str] = ("<|user|>", "<|assistant|>", "<|system|>")):
        self.tok = tokenizer
        self.block_size = block_size
        self.user_token, self.assistant_token, self.system_token = cfg_tokens
        self.examples: List[Tuple[np.ndarray, np.ndarray]] = []

        skipped = 0
        for rec in _load_chat_records(path):
            messages = _record_to_messages(rec)
            ids, mask = self._encode_conversation(messages)
            if len(ids) < 2:
                continue
            ids = ids[: block_size + 1]
            mask = mask[: block_size + 1]
            # After truncation the target positions are mask[1:]. If none are
            # learnable (e.g. the assistant reply was cut off past block_size),
            # the example's loss would be over all-ignored targets -> NaN. Skip
            # it rather than poison training/eval.
            if sum(mask[1:]) == 0:
                skipped += 1
                continue
            self.examples.append((np.array(ids, dtype=np.int64), np.array(mask, dtype=np.int64)))

        if not self.examples:
            raise ValueError(
                f"No usable chat examples parsed from {path} "
                f"(skipped {skipped} with no assistant tokens inside block_size={block_size}; "
                f"increase --block-size or shorten conversations)."
            )
        if skipped:
            print(f"[SFT] skipped {skipped} example(s) with no learnable tokens within block_size={block_size}")

    def _encode_conversation(self, messages: List[dict]):
        role_token = {"user": self.user_token, "assistant": self.assistant_token,
                      "system": self.system_token}
        ids: List[int] = [self.tok.bos_id]
        learn: List[int] = [0]  # 1 where loss should be computed
        for m in messages:
            tok = role_token.get(m["role"], self.user_token)
            header = self.tok.encode(f"{tok}\n")
            body = self.tok.encode(f"{m['content'].strip()}\n")
            ids.extend(header); learn.extend([0] * len(header))
            is_assistant = m["role"] == "assistant"
            ids.extend(body); learn.extend([1 if is_assistant else 0] * len(body))
            if is_assistant:
                ids.append(self.tok.eos_id); learn.append(1)
        return ids, learn

    def __len__(self) -> int:
        return len(self.examples)

    def __getitem__(self, i: int):
        ids, learn = self.examples[i]
        x = torch.from_numpy(ids[:-1])
        y = torch.from_numpy(ids[1:].copy())
        # mask loss: positions whose *target* isn't an assistant token -> -1
        loss_mask = torch.from_numpy(learn[1:])
        y[loss_mask == 0] = -1
        return x, y


def collate_pad(batch, pad_id: int):
    """Pad a batch of variable-length (x, y) SFT examples to the same length."""
    max_len = max(x.size(0) for x, _ in batch)
    xs, ys = [], []
    for x, y in batch:
        pad = max_len - x.size(0)
        xs.append(torch.cat([x, torch.full((pad,), pad_id, dtype=torch.long)]))
        ys.append(torch.cat([y, torch.full((pad,), -1, dtype=torch.long)]))
    return torch.stack(xs), torch.stack(ys)
