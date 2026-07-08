#!/usr/bin/env python
"""Train a SentencePiece tokenizer on a Markdown corpus.

Usage:
    python train_tokenizer.py --data-dir data/pretrain --vocab-size 8000 \
        --model-prefix checkpoints/spm
"""
from __future__ import annotations

import argparse

from tinygpt.config import TokenizerConfig
from tinygpt.tokenizer import Tokenizer


def main():
    ap = argparse.ArgumentParser(description="Train a SentencePiece tokenizer.")
    ap.add_argument("--data-dir", default="data/pretrain", help="Directory of .md/.txt files")
    ap.add_argument("--model-prefix", default="checkpoints/spm")
    ap.add_argument("--vocab-size", type=int, default=8000)
    ap.add_argument("--model-type", default="bpe", choices=["bpe", "unigram", "char", "word"])
    ap.add_argument("--character-coverage", type=float, default=1.0)
    args = ap.parse_args()

    cfg = TokenizerConfig(
        model_prefix=args.model_prefix,
        vocab_size=args.vocab_size,
        model_type=args.model_type,
        character_coverage=args.character_coverage,
    )

    paths = Tokenizer.collect_markdown(args.data_dir)
    if not paths:
        raise SystemExit(f"No .md/.markdown/.txt files found under {args.data_dir}")
    print(f"Training {cfg.model_type} tokenizer (vocab={cfg.vocab_size}) on {len(paths)} files...")

    tok = Tokenizer.train(paths, cfg)
    print(f"Done. Model: {cfg.model_prefix}.model  (vocab_size={tok.vocab_size})")

    sample = "# Hello world\n\nThis is a *tiny* GPT tokenizer test."
    ids = tok.encode(sample)
    print(f"Sample encode -> {ids}")
    print(f"Sample decode -> {tok.decode(ids)!r}")


if __name__ == "__main__":
    main()
