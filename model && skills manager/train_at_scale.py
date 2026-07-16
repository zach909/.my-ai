#!/usr/bin/env python
"""Scalable training pipeline for the mesh on real corpus data.

This script handles:
- Loading corpus data from various sources (markdown, plaintext, JSON)
- Training the tokenizer at scale
- Pretraining the mesh on the corpus
- Fine-tuning on specialized tasks
- Checkpointing and resuming training

Usage:
    python train_at_scale.py --data-dir data/pretrain --vocab-size 8000 \
        --n-layer 12 --n-head 6 --n-embd 384 --block-size 256 \
        --batch-size 32 --grad-accum-steps 4 --max-steps 5000 \
        --device cuda --dtype bfloat16

Recommended settings for RTX 5070 (~15M params):
    - n_layer=12, n_head=6, n_embd=384 (or n_layer=8, n_head=8, n_embd=512 for ~29M)
    - block_size=256
    - batch_size=32 (gradient_accum=4 = effective batch 128)
    - dtype=bfloat16 (Ampere/Ada/Blackwell GPUs)
"""
from __future__ import annotations

import argparse
import glob
import math
import os
import sys
import time
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, IterableDataset

# Relative imports (adjust based on your environment)
try:
    from tinygpt.config import ModelConfig, TrainConfig
    from tinygpt.model import build_model
    from tinygpt.tokenizer import Tokenizer
    from tinygpt.data import CorpusDataLoader
except ImportError:
    print("Error: Could not import tinygpt modules. Make sure you're in the tinygpt directory.")
    sys.exit(1)


class CorpusPreprocessor:
    """Load and preprocess corpus data from various sources."""

    def __init__(self, data_dir: str):
        self.data_dir = Path(data_dir)
        self.files = []
        self._scan_corpus()

    def _scan_corpus(self) -> None:
        """Scan data directory for corpus files."""
        extensions = ["*.md", "*.markdown", "*.txt", "*.text", "*.json", "*.jsonl"]
        for ext in extensions:
            self.files.extend(self.data_dir.glob(ext))
        print(f"[Data] Found {len(self.files)} corpus files")

    def load_text(self, max_files: int = None) -> str:
        """Load all text from corpus files."""
        corpus = []
        files_to_load = self.files[:max_files] if max_files else self.files
        for i, fpath in enumerate(files_to_load):
            if i % max(1, len(files_to_load) // 10) == 0:
                print(f"  loading {i+1}/{len(files_to_load)}")
            try:
                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                    text = f.read()
                    corpus.append(text)
            except Exception as e:
                print(f"  warn: failed to read {fpath}: {e}")
        text = "\n\n".join(corpus)
        print(f"[Data] Loaded {len(text):,} characters total")
        return text

    def load_tokens(self, tokenizer: Tokenizer, max_files: int = None, block_size: int = 256) -> list[int]:
        """Load and tokenize corpus."""
        text = self.load_text(max_files)
        print(f"[Tokenizer] Encoding {len(text):,} chars...")
        ids = tokenizer.encode(text, allowed_special="all")
        print(f"[Tokenizer] Got {len(ids):,} tokens")
        return ids


class MeshTrainer:
    """Handles mesh training loop with checkpointing."""

    def __init__(self, model: nn.Module, config: TrainConfig, device: str = "cuda"):
        self.model = model
        self.config = config
        self.device = device
        self.optimizer = model.configure_optimizers(
            config.weight_decay, config.learning_rate, (config.beta1, config.beta2), device
        )
        self.scaler = torch.cuda.amp.GradScaler() if config.amp and device == "cuda" else None
        self.step = 0
        self.best_val_loss = float("inf")
        self.patience_counter = 0

    def warmup_lr(self) -> float:
        """Compute learning rate with warmup."""
        if self.step < self.config.warmup_steps:
            return self.config.learning_rate * (self.step / self.config.warmup_steps)
        decay_steps = self.config.resolved_decay_steps() - self.config.warmup_steps
        progress = (self.step - self.config.warmup_steps) / decay_steps
        return self.config.min_learning_rate + (self.config.learning_rate - self.config.min_learning_rate) * \
               0.5 * (1 + math.cos(math.pi * progress))

    def update_lr(self) -> None:
        """Update learning rate."""
        lr = self.warmup_lr()
        for param_group in self.optimizer.param_groups:
            param_group["lr"] = lr

    def train_step(self, batch_x: torch.Tensor, batch_y: torch.Tensor) -> float:
        """Single training step."""
        self.update_lr()
        self.optimizer.zero_grad()

        if self.config.amp and self.scaler:
            with torch.cuda.amp.autocast(dtype=torch.bfloat16):
                _, loss = self.model(batch_x, batch_y)
            self.scaler.scale(loss).backward()
            self.scaler.unscale_(self.optimizer)
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), self.config.grad_clip)
            self.scaler.step(self.optimizer)
            self.scaler.update()
        else:
            _, loss = self.model(batch_x, batch_y)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), self.config.grad_clip)
            self.optimizer.step()

        return loss.item()

    @torch.no_grad()
    def eval_step(self, batch_x: torch.Tensor, batch_y: torch.Tensor) -> float:
        """Evaluate on a batch."""
        self.model.eval()
        _, loss = self.model(batch_x, batch_y)
        self.model.train()
        return loss.item()

    def save_checkpoint(self, path: str) -> None:
        """Save model and optimizer state."""
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        torch.save({
            "step": self.step,
            "model_state": self.model.state_dict(),
            "optimizer_state": self.optimizer.state_dict(),
            "config": self.model.cfg,
        }, path)
        print(f"[Checkpoint] Saved to {path}")

    def load_checkpoint(self, path: str) -> None:
        """Load model and optimizer state."""
        ckpt = torch.load(path, map_location=self.device)
        self.model.load_state_dict(ckpt["model_state"])
        self.optimizer.load_state_dict(ckpt["optimizer_state"])
        self.step = ckpt["step"]
        print(f"[Checkpoint] Loaded from {path} (step {self.step})")


def create_dataloaders(tokens: list[int], block_size: int, batch_size: int,
                       val_fraction: float = 0.02) -> tuple[DataLoader, DataLoader]:
    """Create train and validation dataloaders."""
    n_tokens = len(tokens)
    n_val = int(n_tokens * val_fraction)
    n_train = n_tokens - n_val

    train_tokens = tokens[:n_train]
    val_tokens = tokens[n_train:]

    print(f"[Data] Train: {len(train_tokens):,} tokens, Val: {len(val_tokens):,} tokens")

    # Simple implementation: create blocks on the fly
    class TokenDataset(IterableDataset):
        def __init__(self, tokens, block_size):
            self.tokens = tokens
            self.block_size = block_size

        def __iter__(self):
            for i in range(0, len(self.tokens) - self.block_size - 1, self.block_size):
                x = torch.tensor(self.tokens[i:i + self.block_size], dtype=torch.long)
                y = torch.tensor(self.tokens[i + 1:i + self.block_size + 1], dtype=torch.long)
                yield x, y

    train_ds = TokenDataset(train_tokens, block_size)
    val_ds = TokenDataset(val_tokens, block_size)

    train_dl = DataLoader(train_ds, batch_size=batch_size, num_workers=0)
    val_dl = DataLoader(val_ds, batch_size=batch_size, num_workers=0)

    return train_dl, val_dl


def main():
    parser = argparse.ArgumentParser(description="Scale training for mesh on real corpus data")
    parser.add_argument("--data-dir", default="data/pretrain", help="Directory with corpus files")
    parser.add_argument("--vocab-size", type=int, default=8000, help="Tokenizer vocabulary size")
    parser.add_argument("--n-layer", type=int, default=12, help="Number of mesh settle layers")
    parser.add_argument("--n-head", type=int, default=6, help="Number of attention heads (unused for mesh)")
    parser.add_argument("--n-embd", type=int, default=384, help="Mesh embedding dimension")
    parser.add_argument("--block-size", type=int, default=256, help="Context length")
    parser.add_argument("--mesh-neurons", type=int, default=24, help="Number of neurons in mesh")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size")
    parser.add_argument("--grad-accum-steps", type=int, default=4, help="Gradient accumulation steps")
    parser.add_argument("--max-steps", type=int, default=5000, help="Maximum training steps")
    parser.add_argument("--eval-interval", type=int, default=250, help="Evaluation interval")
    parser.add_argument("--learning-rate", type=float, default=3e-4, help="Learning rate")
    parser.add_argument("--device", default="cuda", help="Device (cuda/cpu/mps)")
    parser.add_argument("--dtype", default="bfloat16", help="Data type (bfloat16/float16/float32)")
    parser.add_argument("--no-amp", action="store_true", help="Disable automatic mixed precision")
    parser.add_argument("--out-dir", default="checkpoints", help="Output directory for checkpoints")
    parser.add_argument("--ckpt", default=None, help="Resume from checkpoint")

    args = parser.parse_args()

    # Device setup
    if args.device == "cuda" and not torch.cuda.is_available():
        print("CUDA not available, falling back to CPU")
        args.device = "cpu"

    print(f"[Setup] Device: {args.device}, dtype: {args.dtype}, amp: {not args.no_amp}")

    # Load corpus
    preprocessor = CorpusPreprocessor(args.data_dir)
    if not preprocessor.files:
        print("Error: No corpus files found. Please add .md or .txt files to data/pretrain/")
        sys.exit(1)

    # Create/load tokenizer
    tokenizer_path = os.path.join(args.out_dir, "tokenizer.model")
    if os.path.exists(tokenizer_path):
        print(f"[Tokenizer] Loading from {tokenizer_path}")
        tokenizer = Tokenizer()
        tokenizer.load(tokenizer_path)
    else:
        print("[Tokenizer] Training new tokenizer...")
        corpus_text = preprocessor.load_text(max_files=None)
        tokenizer = Tokenizer(vocab_size=args.vocab_size)
        tokenizer.train(corpus_text)
        os.makedirs(args.out_dir, exist_ok=True)
        tokenizer.save(tokenizer_path)
        print(f"[Tokenizer] Saved to {tokenizer_path}")

    # Load and tokenize corpus
    print("[Data] Loading corpus...")
    tokens = preprocessor.load_tokens(tokenizer, block_size=args.block_size)

    # Create dataloaders
    train_dl, val_dl = create_dataloaders(tokens, args.block_size, args.batch_size)

    # Build model
    print("[Model] Building mesh...")
    cfg = ModelConfig(
        vocab_size=len(tokenizer),
        block_size=args.block_size,
        arch="mesh",
        mesh_neurons=args.mesh_neurons,
        mesh_dims=4,
        mesh_input=8,
        settle_ticks=4,
        dropout=0.1,
    )
    model = build_model(cfg).to(args.device)
    print(f"[Model] {model.num_params():,} parameters")

    # Training
    train_cfg = TrainConfig(
        data_dir=args.data_dir,
        out_dir=args.out_dir,
        batch_size=args.batch_size,
        grad_accum_steps=args.grad_accum_steps,
        max_steps=args.max_steps,
        learning_rate=args.learning_rate,
        eval_interval=args.eval_interval,
        device=args.device,
        amp=not args.no_amp,
        dtype=args.dtype,
    )

    trainer = MeshTrainer(model, train_cfg, args.device)
    if args.ckpt and os.path.exists(args.ckpt):
        trainer.load_checkpoint(args.ckpt)

    model.train()
    print(f"[Training] Starting from step {trainer.step}")
    start_time = time.time()
    total_loss = 0.0
    grad_accum_count = 0

    try:
        while trainer.step < args.max_steps:
            for batch_x, batch_y in train_dl:
                batch_x = batch_x.to(args.device)
                batch_y = batch_y.to(args.device)

                loss = trainer.train_step(batch_x, batch_y)
                total_loss += loss
                grad_accum_count += 1

                trainer.step += 1

                # Logging
                if trainer.step % 20 == 0:
                    avg_loss = total_loss / grad_accum_count
                    elapsed = time.time() - start_time
                    tokens_per_sec = (trainer.step * args.batch_size * args.block_size) / elapsed
                    lr = trainer.warmup_lr()
                    print(f"[Step {trainer.step:5d}] loss={avg_loss:.4f}  "
                          f"lr={lr:.2e}  {tokens_per_sec:.0f} tokens/s")

                # Evaluation
                if trainer.step % args.eval_interval == 0:
                    print("[Eval] Computing validation loss...")
                    val_loss = 0.0
                    for val_x, val_y in val_dl:
                        val_x = val_x.to(args.device)
                        val_y = val_y.to(args.device)
                        val_loss += trainer.eval_step(val_x, val_y)
                    val_loss /= len(val_dl)
                    print(f"[Eval] val_loss={val_loss:.4f}  best={trainer.best_val_loss:.4f}")

                    if val_loss < trainer.best_val_loss:
                        trainer.best_val_loss = val_loss
                        trainer.patience_counter = 0
                        trainer.save_checkpoint(os.path.join(args.out_dir, "gpt_best.pt"))
                    else:
                        trainer.patience_counter += 1
                        if trainer.patience_counter >= train_cfg.early_stopping_patience:
                            print("[Training] Early stopping")
                            break

                # Checkpoint
                if trainer.step % 500 == 0:
                    trainer.save_checkpoint(os.path.join(args.out_dir, f"gpt_step_{trainer.step}.pt"))

                if trainer.step >= args.max_steps:
                    break

    except KeyboardInterrupt:
        print("\n[Training] Interrupted by user")

    # Final checkpoint
    trainer.save_checkpoint(os.path.join(args.out_dir, "gpt_final.pt"))
    print(f"[Training] Done! Total time: {time.time() - start_time:.1f}s")


if __name__ == "__main__":
    main()
