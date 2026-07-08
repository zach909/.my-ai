"""SentencePiece tokenizer: training, save/load, encode/decode.

A thin wrapper around the `sentencepiece` library that fixes the special-token
ids (pad/unk/bos/eos) and adds chat control tokens (<|user|>, <|assistant|>,
<|system|>) so pretraining and supervised fine-tuning share one vocabulary.
"""
from __future__ import annotations

import os
import glob
import tempfile
from typing import Iterable, List, Optional

import sentencepiece as spm

from .config import TokenizerConfig


class Tokenizer:
    def __init__(self, model_path: str):
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Tokenizer model not found: {model_path}. Train one first with "
                f"`python train_tokenizer.py`."
            )
        self.sp = spm.SentencePieceProcessor(model_file=model_path)
        self.model_path = model_path

    # ---- properties -------------------------------------------------------
    @property
    def vocab_size(self) -> int:
        return self.sp.get_piece_size()

    @property
    def pad_id(self) -> int:
        return self.sp.pad_id()

    @property
    def unk_id(self) -> int:
        return self.sp.unk_id()

    @property
    def bos_id(self) -> int:
        return self.sp.bos_id()

    @property
    def eos_id(self) -> int:
        return self.sp.eos_id()

    def piece_to_id(self, piece: str) -> int:
        return self.sp.piece_to_id(piece)

    # ---- encode / decode --------------------------------------------------
    def encode(self, text: str, bos: bool = False, eos: bool = False) -> List[int]:
        ids = self.sp.encode(text, out_type=int)
        if bos:
            ids = [self.bos_id] + ids
        if eos:
            ids = ids + [self.eos_id]
        return ids

    def decode(self, ids: Iterable[int]) -> str:
        # drop pad tokens; sentencepiece handles bos/eos/unk gracefully
        ids = [int(i) for i in ids if int(i) != self.pad_id]
        return self.sp.decode(ids)

    # ---- training ---------------------------------------------------------
    @staticmethod
    def train(input_paths: List[str], cfg: TokenizerConfig) -> "Tokenizer":
        """Train a SentencePiece model on the given text/markdown files."""
        if not input_paths:
            raise ValueError("No input files provided for tokenizer training.")

        os.makedirs(os.path.dirname(cfg.model_prefix) or ".", exist_ok=True)

        # sentencepiece wants a comma-separated list of files
        spm.SentencePieceTrainer.train(
            input=",".join(input_paths),
            model_prefix=cfg.model_prefix,
            vocab_size=cfg.vocab_size,
            model_type=cfg.model_type,
            character_coverage=cfg.character_coverage,
            input_sentence_size=cfg.input_sentence_size,
            shuffle_input_sentence=True,
            pad_id=cfg.pad_id,
            unk_id=cfg.unk_id,
            bos_id=cfg.bos_id,
            eos_id=cfg.eos_id,
            user_defined_symbols=[cfg.user_token, cfg.assistant_token, cfg.system_token],
            normalization_rule_name="nmt_nfkc_cf",
        )
        return Tokenizer(cfg.model_prefix + ".model")

    @staticmethod
    def collect_markdown(data_dir: str) -> List[str]:
        """Recursively collect .md / .markdown / .txt files under data_dir."""
        exts = ("*.md", "*.markdown", "*.txt")
        paths: List[str] = []
        for ext in exts:
            paths.extend(glob.glob(os.path.join(data_dir, "**", ext), recursive=True))
        return sorted(paths)
