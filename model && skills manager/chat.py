#!/usr/bin/env python
"""CLI chat / completion inference for TinyGPT.

Loads a checkpoint + tokenizer and generates text with configurable temperature,
top-k, top-p, and repetition penalty. In --chat mode it maintains a running
conversation using the <|user|>/<|assistant|> format the SFT stage trained on.

Usage:
    python chat.py --ckpt checkpoints/gpt_sft.pt --chat
    python chat.py --ckpt checkpoints/gpt.pt --prompt "# Introduction" --max-new-tokens 200
"""
from __future__ import annotations

import argparse

import torch

from tinygpt.config import ModelConfig
from tinygpt.data import build_chat_prompt
from tinygpt.model import GPT
from tinygpt.tokenizer import Tokenizer
from tinygpt.utils import load_checkpoint, resolve_device


def parse_args():
    ap = argparse.ArgumentParser(description="Chat / generate with TinyGPT.")
    ap.add_argument("--ckpt", default="checkpoints/gpt_sft.pt")
    ap.add_argument("--tokenizer", default=None, help="Defaults to the one stored in the checkpoint")
    ap.add_argument("--prompt", default=None, help="One-shot completion; omit for interactive chat")
    ap.add_argument("--chat", action="store_true", help="Interactive multi-turn chat")
    ap.add_argument("--max-new-tokens", type=int, default=256)
    ap.add_argument("--temperature", type=float, default=0.8)
    ap.add_argument("--top-k", type=int, default=40)
    ap.add_argument("--top-p", type=float, default=0.95)
    ap.add_argument("--repetition-penalty", type=float, default=1.1)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--seed", type=int, default=None)
    return ap.parse_args()


def load_model(ckpt_path: str, device: str):
    ckpt = load_checkpoint(ckpt_path, map_location=device)
    model_cfg = ModelConfig(**ckpt["model_config"])
    model = GPT(model_cfg).to(device)
    model.load_state_dict(ckpt["model"])
    model.eval()
    return model, ckpt


def generate_text(model, tokenizer, prompt_ids, args, device):
    idx = torch.tensor([prompt_ids], dtype=torch.long, device=device)
    out = model.generate(
        idx, max_new_tokens=args.max_new_tokens, temperature=args.temperature,
        top_k=args.top_k, top_p=args.top_p, repetition_penalty=args.repetition_penalty,
        eos_id=tokenizer.eos_id,
    )
    new_ids = out[0, len(prompt_ids):].tolist()
    return tokenizer.decode(new_ids)


def main():
    args = parse_args()
    if args.seed is not None:
        torch.manual_seed(args.seed)
    device = resolve_device(args.device)

    model, ckpt = load_model(args.ckpt, device)
    tok_path = args.tokenizer or ckpt.get("tokenizer", "checkpoints/spm.model")
    tokenizer = Tokenizer(tok_path)
    print(f"loaded {args.ckpt} on {device} | tokenizer {tok_path}")

    # one-shot completion
    if args.prompt is not None and not args.chat:
        ids = tokenizer.encode(args.prompt, bos=True)
        text = generate_text(model, tokenizer, ids, args, device)
        print(args.prompt + text)
        return

    # interactive chat
    print("TinyGPT chat. Type 'exit' to quit, 'reset' to clear history.\n")
    history = []
    assistant_token = "<|assistant|>"
    while True:
        try:
            user = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if user.lower() in ("exit", "quit"):
            break
        if user.lower() == "reset":
            history = []
            print("(history cleared)")
            continue
        if not user:
            continue

        history.append({"role": "user", "content": user})
        # prompt ends with the assistant header so the model continues as the assistant
        prompt = build_chat_prompt(history, tokenizer) + f"{assistant_token}\n"
        ids = [tokenizer.bos_id] + tokenizer.encode(prompt)
        reply = generate_text(model, tokenizer, ids, args, device).strip()
        # cut the reply at the next role marker if the model over-generates
        for marker in ("<|user|>", "<|system|>", "<|assistant|>"):
            if marker in reply:
                reply = reply.split(marker)[0].strip()
        print(f"bot> {reply}\n")
        history.append({"role": "assistant", "content": reply})


if __name__ == "__main__":
    main()
