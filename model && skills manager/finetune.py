#!/usr/bin/env python
"""Supervised fine-tuning (SFT) of a pretrained TinyGPT on chat data.

Loads a pretrained checkpoint, then trains on <|user|>/<|assistant|> turns with
the loss masked to the assistant replies only. Reuses the same optimisation
machinery as pretraining (AdamW, cosine LR, AMP, grad accumulation, early stop).

Usage:
    python finetune.py --init checkpoints/gpt.pt --data data/sft/chat.jsonl \
        --out-dir checkpoints --ckpt-name gpt_sft.pt --max-steps 1000
"""
from __future__ import annotations

import argparse
import os
import time
from contextlib import nullcontext
from functools import partial

import numpy as np
import torch
from torch.utils.data import DataLoader, random_split

from tinygpt.config import ModelConfig, TrainConfig
from tinygpt.data import ChatSFTDataset, collate_pad
from tinygpt.model import GPT
from tinygpt.tokenizer import Tokenizer
from tinygpt.utils import (cosine_lr, human_count, load_checkpoint, resolve_device,
                           resolve_dtype, save_checkpoint, set_seed)


def parse_args():
    ap = argparse.ArgumentParser(description="Supervised fine-tuning of TinyGPT.")
    ap.add_argument("--init", default="checkpoints/gpt.pt", help="Pretrained checkpoint")
    ap.add_argument("--tokenizer", default="checkpoints/spm.model")
    ap.add_argument("--data", default="data/sft/chat.jsonl")
    ap.add_argument("--out-dir", default="checkpoints")
    ap.add_argument("--ckpt-name", default="gpt_sft.pt")
    ap.add_argument("--batch-size", type=int, default=8)
    ap.add_argument("--grad-accum-steps", type=int, default=4)
    ap.add_argument("--max-steps", type=int, default=1000)
    ap.add_argument("--learning-rate", type=float, default=1e-4)
    ap.add_argument("--warmup-steps", type=int, default=50)
    ap.add_argument("--weight-decay", type=float, default=0.1)
    ap.add_argument("--eval-interval", type=int, default=100)
    ap.add_argument("--early-stopping-patience", type=int, default=4)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--dtype", default="bfloat16", choices=["bfloat16", "float16", "float32"])
    ap.add_argument("--no-amp", action="store_true")
    ap.add_argument("--seed", type=int, default=1337)
    return ap.parse_args()


@torch.no_grad()
def evaluate(model, loader, device, autocast_ctx):
    model.eval()
    losses = []
    for x, y in loader:
        x, y = x.to(device), y.to(device)
        with autocast_ctx:
            _, loss = model(x, y)
        if torch.isfinite(loss):
            losses.append(loss.item())
    model.train()
    return float(np.mean(losses)) if losses else float("inf")


def cycle(loader):
    while True:
        for batch in loader:
            yield batch


def main():
    args = parse_args()
    cfg = TrainConfig(
        out_dir=args.out_dir, ckpt_name=args.ckpt_name, batch_size=args.batch_size,
        grad_accum_steps=args.grad_accum_steps, max_steps=args.max_steps,
        learning_rate=args.learning_rate, warmup_steps=args.warmup_steps,
        weight_decay=args.weight_decay, eval_interval=args.eval_interval,
        early_stopping_patience=args.early_stopping_patience, device=args.device,
        dtype=args.dtype, amp=not args.no_amp, seed=args.seed,
    )
    set_seed(cfg.seed)
    device = resolve_device(cfg.device)
    device_type = "cuda" if device == "cuda" else "cpu"
    dtype = resolve_dtype(cfg.dtype, device)
    print(f"device={device} dtype={dtype}")

    tokenizer = Tokenizer(args.tokenizer)

    # load the pretrained model
    ckpt = load_checkpoint(args.init, map_location=device)
    model_cfg = ModelConfig(**ckpt["model_config"])
    model = GPT(model_cfg).to(device)
    model.load_state_dict(ckpt["model"])
    print(f"loaded pretrained model ({human_count(model.num_params())} params) from {args.init}")

    # dataset (small val split for early stopping)
    full = ChatSFTDataset(args.data, tokenizer, model_cfg.block_size)
    n_val = max(1, int(len(full) * 0.1))
    n_train = len(full) - n_val
    if n_train <= 0:
        train_ds, val_ds = full, full
    else:
        train_ds, val_ds = random_split(full, [n_train, n_val],
                                        generator=torch.Generator().manual_seed(cfg.seed))
    collate = partial(collate_pad, pad_id=tokenizer.pad_id)
    train_loader = DataLoader(train_ds, batch_size=cfg.batch_size, shuffle=True,
                              collate_fn=collate, drop_last=False)
    val_loader = DataLoader(val_ds, batch_size=cfg.batch_size, shuffle=False,
                            collate_fn=collate)
    train_iter = cycle(train_loader)
    print(f"SFT examples: train={n_train} val={n_val}")

    optimizer = model.configure_optimizers(cfg.weight_decay, cfg.learning_rate,
                                           (cfg.beta1, cfg.beta2), device_type)

    use_amp = cfg.amp and device == "cuda" and dtype in (torch.float16, torch.bfloat16)
    autocast_ctx = (torch.autocast(device_type=device_type, dtype=dtype)
                    if use_amp else nullcontext())
    scaler = torch.amp.GradScaler('cuda', enabled=(use_amp and dtype == torch.float16))

    ckpt_path = os.path.join(cfg.out_dir, cfg.ckpt_name)
    best_val = float("inf")
    patience_left = cfg.early_stopping_patience
    model.train()
    t0 = time.time()

    for step in range(cfg.max_steps):
        lr = cosine_lr(step, cfg)
        for group in optimizer.param_groups:
            group["lr"] = lr

        optimizer.zero_grad(set_to_none=True)
        accum_loss = 0.0
        for _ in range(cfg.grad_accum_steps):
            x, y = next(train_iter)
            x, y = x.to(device), y.to(device)
            with autocast_ctx:
                _, loss = model(x, y)
                loss = loss / cfg.grad_accum_steps
            scaler.scale(loss).backward()
            accum_loss += loss.item()

        if cfg.grad_clip > 0:
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), cfg.grad_clip)
        scaler.step(optimizer)
        scaler.update()

        if step % cfg.log_interval == 0:
            print(f"step {step:5d} | loss {accum_loss:.4f} | lr {lr:.2e} | {time.time()-t0:.1f}s")

        if step > 0 and step % cfg.eval_interval == 0:
            val_loss = evaluate(model, val_loader, device, autocast_ctx)
            print(f"  [eval] step {step} val_loss {val_loss:.4f} (best {best_val:.4f})")
            if val_loss < best_val:
                best_val = val_loss
                patience_left = cfg.early_stopping_patience
                save_checkpoint(ckpt_path, model, optimizer, model_cfg, step, best_val,
                                extra={"tokenizer": args.tokenizer, "sft": True})
                print(f"  saved checkpoint -> {ckpt_path}")
            else:
                patience_left -= 1
                if patience_left <= 0:
                    print("Early stopping.")
                    break

    if not os.path.exists(ckpt_path):
        save_checkpoint(ckpt_path, model, optimizer, model_cfg, cfg.max_steps, best_val,
                        extra={"tokenizer": args.tokenizer, "sft": True})
        print(f"saved final checkpoint -> {ckpt_path}")
    print("Fine-tuning complete.")


if __name__ == "__main__":
    main()
