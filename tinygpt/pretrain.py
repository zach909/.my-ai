#!/usr/bin/env python
"""Pretrain TinyGPT on a Markdown corpus (next-token prediction).

Features: AdamW, linear-warmup + cosine LR decay, automatic mixed precision,
gradient accumulation, gradient clipping, periodic validation, checkpointing,
and early stopping on validation loss.

Usage:
    python pretrain.py --data-dir data/pretrain --max-steps 5000 --batch-size 32
"""
from __future__ import annotations

import argparse
import os
import time
from contextlib import nullcontext

import numpy as np
import torch
from torch.utils.data import DataLoader

from tinygpt.config import ModelConfig, TrainConfig
from tinygpt.data import PackedDataset, build_token_stream, train_val_split
from tinygpt.model import GPT
from tinygpt.tokenizer import Tokenizer
from tinygpt.utils import (cosine_lr, human_count, load_checkpoint, resolve_device,
                           resolve_dtype, save_checkpoint, set_seed)


def parse_args():
    ap = argparse.ArgumentParser(description="Pretrain TinyGPT.")
    ap.add_argument("--data-dir", default="data/pretrain")
    ap.add_argument("--tokenizer", default="checkpoints/spm.model")
    ap.add_argument("--out-dir", default="checkpoints")
    ap.add_argument("--ckpt-name", default="gpt.pt")
    ap.add_argument("--resume", action="store_true", help="Resume from out-dir/ckpt-name")
    # model
    ap.add_argument("--n-layer", type=int, default=12)
    ap.add_argument("--n-head", type=int, default=6)
    ap.add_argument("--n-embd", type=int, default=384)
    ap.add_argument("--block-size", type=int, default=256)
    ap.add_argument("--dropout", type=float, default=0.1)
    # Section 5.2: swap the model core (position-wise MLP -> elastic mesh),
    # keeping this entire training loop — data, optimizer, schedule,
    # checkpointing — identical either way.
    ap.add_argument("--use-elastic-mesh", action="store_true",
                     help="Replace the MLP sublayer with the elastic mesh block (Section 5.2)")
    ap.add_argument("--mesh-num-experts", type=int, default=4)
    ap.add_argument("--mesh-top-k", type=int, default=2)
    ap.add_argument("--mesh-n-neurons", type=int, default=64)
    ap.add_argument("--mesh-settle-steps", type=int, default=3)
    ap.add_argument("--mesh-n-qubits", type=int, default=4)
    # training
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--grad-accum-steps", type=int, default=4)
    ap.add_argument("--max-steps", type=int, default=5000)
    ap.add_argument("--learning-rate", type=float, default=3e-4)
    ap.add_argument("--weight-decay", type=float, default=0.1)
    ap.add_argument("--warmup-steps", type=int, default=200)
    ap.add_argument("--eval-interval", type=int, default=250)
    ap.add_argument("--eval-iters", type=int, default=100)
    ap.add_argument("--early-stopping-patience", type=int, default=5)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--dtype", default="bfloat16", choices=["bfloat16", "float16", "float32"])
    ap.add_argument("--no-amp", action="store_true")
    ap.add_argument("--compile", action="store_true")
    ap.add_argument("--seed", type=int, default=1337)
    return ap.parse_args()


@torch.no_grad()
def evaluate(model, loader, device, autocast_ctx, max_iters):
    model.eval()
    losses = []
    it = iter(loader)
    for _ in range(max_iters):
        try:
            x, y = next(it)
        except StopIteration:
            break
        x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
        with autocast_ctx:
            _, loss = model(x, y)
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
        data_dir=args.data_dir, out_dir=args.out_dir, ckpt_name=args.ckpt_name,
        batch_size=args.batch_size, grad_accum_steps=args.grad_accum_steps,
        max_steps=args.max_steps, learning_rate=args.learning_rate,
        weight_decay=args.weight_decay, warmup_steps=args.warmup_steps,
        eval_interval=args.eval_interval, eval_iters=args.eval_iters,
        early_stopping_patience=args.early_stopping_patience, device=args.device,
        dtype=args.dtype, amp=not args.no_amp, compile=args.compile, seed=args.seed,
    )
    set_seed(cfg.seed)
    device = resolve_device(cfg.device)
    device_type = "cuda" if device == "cuda" else "cpu"
    dtype = resolve_dtype(cfg.dtype, device)
    print(f"device={device} dtype={dtype}")

    tokenizer = Tokenizer(args.tokenizer)

    # data
    print("Building token stream...")
    stream = build_token_stream(cfg.data_dir, tokenizer)
    train_stream, val_stream = train_val_split(stream, cfg.val_fraction, args.block_size)
    print(f"tokens: train={human_count(len(train_stream))} val={human_count(len(val_stream))}")
    train_ds = PackedDataset(train_stream, args.block_size)
    val_ds = PackedDataset(val_stream, args.block_size)
    train_loader = DataLoader(train_ds, batch_size=cfg.batch_size, shuffle=True,
                              num_workers=cfg.num_workers, pin_memory=(device == "cuda"),
                              drop_last=True)
    val_loader = DataLoader(val_ds, batch_size=cfg.batch_size, shuffle=True,
                            num_workers=cfg.num_workers, pin_memory=(device == "cuda"),
                            drop_last=False)
    train_iter = cycle(train_loader)

    # model
    model_cfg = ModelConfig(
        vocab_size=tokenizer.vocab_size, block_size=args.block_size,
        n_layer=args.n_layer, n_head=args.n_head, n_embd=args.n_embd, dropout=args.dropout,
        use_elastic_mesh=args.use_elastic_mesh, mesh_num_experts=args.mesh_num_experts,
        mesh_top_k=args.mesh_top_k, mesh_n_neurons=args.mesh_n_neurons,
        mesh_settle_steps=args.mesh_settle_steps, mesh_n_qubits=args.mesh_n_qubits,
    )
    model = GPT(model_cfg).to(device)
    print(f"model parameters: {human_count(model.num_params())}")

    optimizer = model.configure_optimizers(cfg.weight_decay, cfg.learning_rate,
                                           (cfg.beta1, cfg.beta2), device_type)

    start_step, best_val = 0, float("inf")
    if args.resume:
        ckpt = load_checkpoint(os.path.join(cfg.out_dir, cfg.ckpt_name), map_location=device)
        model.load_state_dict(ckpt["model"])
        if ckpt.get("optimizer"):
            optimizer.load_state_dict(ckpt["optimizer"])
        start_step = ckpt.get("step", 0)
        best_val = ckpt.get("best_val", float("inf"))
        print(f"resumed at step {start_step} (best_val={best_val:.4f})")

    if cfg.compile and hasattr(torch, "compile"):
        model = torch.compile(model)

    use_amp = cfg.amp and device == "cuda" and dtype in (torch.float16, torch.bfloat16)
    autocast_ctx = (torch.autocast(device_type=device_type, dtype=dtype)
                    if use_amp else nullcontext())
    scaler = torch.amp.GradScaler('cuda', enabled=(use_amp and dtype == torch.float16))

    ckpt_path = os.path.join(cfg.out_dir, cfg.ckpt_name)
    patience_left = cfg.early_stopping_patience
    model.train()
    t0 = time.time()

    for step in range(start_step, cfg.max_steps):
        lr = cosine_lr(step, cfg)
        for group in optimizer.param_groups:
            group["lr"] = lr

        optimizer.zero_grad(set_to_none=True)
        accum_loss = 0.0
        for _ in range(cfg.grad_accum_steps):
            x, y = next(train_iter)
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
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
            dt = time.time() - t0
            print(f"step {step:5d} | loss {accum_loss:.4f} | lr {lr:.2e} | {dt:.1f}s")

        if step > 0 and step % cfg.eval_interval == 0:
            val_loss = evaluate(model, val_loader, device, autocast_ctx, cfg.eval_iters)
            print(f"  [eval] step {step} val_loss {val_loss:.4f} (best {best_val:.4f})")
            if val_loss < best_val:
                best_val = val_loss
                patience_left = cfg.early_stopping_patience
                save_checkpoint(ckpt_path, model, optimizer, model_cfg, step, best_val,
                                extra={"tokenizer": args.tokenizer})
                print(f"  saved checkpoint -> {ckpt_path}")
            else:
                patience_left -= 1
                print(f"  no improvement; patience left {patience_left}")
                if patience_left <= 0:
                    print("Early stopping.")
                    break

    # final save if we never hit an eval improvement
    if not os.path.exists(ckpt_path):
        save_checkpoint(ckpt_path, model, optimizer, model_cfg, cfg.max_steps, best_val,
                        extra={"tokenizer": args.tokenizer})
        print(f"saved final checkpoint -> {ckpt_path}")
    print("Pretraining complete.")


if __name__ == "__main__":
    main()
