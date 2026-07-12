#!/usr/bin/env python
"""Extension builder CLI — teach TinyGPT declarative "definishon" contracts.

Give it a JSON list of contracts and it trains the model until each contract
holds (or reports the ones that conflict), then saves the extended model.

Contracts file (JSON):
    [
      {"when": "ping", "then": "pong"},
      {"when": "who are you?", "then": "I am TinyGPT."}
    ]

Usage:
    python extend.py --ckpt checkpoints/gpt_sft.pt --contracts data/contracts.json \
        --out checkpoints/gpt_extended.pt --epochs 200
"""
from __future__ import annotations

import argparse
import json

import torch

from tinygpt.config import ModelConfig
from tinygpt.extension_builder import Definishon, ExtensionBuilder
from tinygpt.model import GPT
from tinygpt.tokenizer import Tokenizer
from tinygpt.utils import load_checkpoint, resolve_device, save_checkpoint


def parse_args():
    ap = argparse.ArgumentParser(description="Teach TinyGPT definishon contracts.")
    ap.add_argument("--ckpt", default="checkpoints/gpt_sft.pt")
    ap.add_argument("--tokenizer", default=None)
    ap.add_argument("--contracts", required=True, help="JSON list of {when, then}")
    ap.add_argument("--out", default="checkpoints/gpt_extended.pt")
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--weight-penalty", type=float, default=1e-3)
    ap.add_argument("--tolerance", type=float, default=0.5)
    ap.add_argument("--device", default="cuda")
    return ap.parse_args()


def main():
    args = parse_args()
    device = resolve_device(args.device)

    ckpt = load_checkpoint(args.ckpt, map_location=device)
    model_cfg = ModelConfig(**ckpt["model_config"])
    model = GPT(model_cfg).to(device)
    model.load_state_dict(ckpt["model"])
    tok_path = args.tokenizer or ckpt.get("tokenizer", "checkpoints/spm.model")
    tokenizer = Tokenizer(tok_path)

    with open(args.contracts, "r", encoding="utf-8") as f:
        raw = json.load(f)
    contracts = [Definishon(when=c["when"], then=c["then"]) for c in raw]
    print(f"Teaching {len(contracts)} contract(s) to {args.ckpt}...")

    builder = ExtensionBuilder(model, tokenizer, device=device)
    result = builder.train(contracts, epochs=args.epochs, lr=args.lr,
                           weight_penalty=args.weight_penalty, tolerance=args.tolerance,
                           verbose=True)

    print(f"\nconverged={result.converged} after {result.epochs} epochs")
    for i, c in enumerate(contracts):
        mark = "OK " if c.satisfied else "XX "
        print(f"  [{mark}] when {c.when!r} -> then {c.then!r} (loss {c.final_loss:.3f})")
    if result.conflicts:
        print("\nCONFLICTS (contradictory contracts — cannot all hold):")
        for i, j, corr in result.conflicts:
            print(f"  contract {i} <-> {j}  (correlation {corr:.2f})")
            print(f"    {contracts[i].when!r}->{contracts[i].then!r}  vs  "
                  f"{contracts[j].when!r}->{contracts[j].then!r}")

    save_checkpoint(args.out, model, None, model_cfg, ckpt.get("step", 0),
                    ckpt.get("best_val", float("inf")),
                    extra={"tokenizer": tok_path, "extended": True})
    print(f"\nsaved extended model -> {args.out}")


if __name__ == "__main__":
    main()
