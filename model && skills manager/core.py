#!/usr/bin/env python
"""Prometheus / TinyGPT unified core.

One runtime where the pieces work together, with the real TinyGPT model as the
language engine and the genuinely-applicable Prometheus mechanisms wrapped around
it as real, working layers:

  - Zip-loop memory (section 2): persistent ring buffer of the conversation.
  - Predict-before-commit (section 11): generate N candidate replies, score by
    the model's own confidence, commit the best.
  - Alignment veto (section 3) + human-in-the-loop action layer (the safe basis
    for computer control): the model may propose `ACTION: <name> <args>`; it is
    vetoed and must be approved before it runs. Read-only actions only by default.

This is the honest unification: a real (small) language model, with real
orchestration/safety/memory/selection around it — no faked capability.

Usage:
    python core.py --ckpt checkpoints/gpt_sft.pt            # chat
    python core.py --ckpt checkpoints/gpt.pt --candidates 5 # best-of-5 selection
"""
from __future__ import annotations

import argparse

import torch

import select
import sys

from tinygpt.actions import ActionLayer, enable_shell_actions
from tinygpt.config import ModelConfig
from tinygpt.data import build_chat_prompt
from tinygpt.extension_builder import Definishon, ExtensionBuilder
from tinygpt.live_guide import LiveGuide
from tinygpt.memory import ZipLoopMemory
from tinygpt.model import build_model
from tinygpt.selection import best_of_n
from tinygpt.tokenizer import Tokenizer
from tinygpt.utils import load_checkpoint, resolve_device, save_checkpoint
from tinygpt.veto import AlignmentVeto

ROLE_MARKERS = ("<|user|>", "<|assistant|>", "<|system|>")


def parse_args():
    ap = argparse.ArgumentParser(description="Prometheus/TinyGPT unified core.")
    ap.add_argument("--ckpt", default="checkpoints/gpt_sft.pt")
    ap.add_argument("--tokenizer", default=None)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--candidates", type=int, default=3, help="best-of-N (section 11)")
    ap.add_argument("--max-new-tokens", type=int, default=200)
    ap.add_argument("--temperature", type=float, default=0.8)
    ap.add_argument("--top-k", type=int, default=40)
    ap.add_argument("--top-p", type=float, default=0.95)
    ap.add_argument("--repetition-penalty", type=float, default=1.1)
    ap.add_argument("--memory", default="checkpoints/memory.json", help="zip-loop persist path")
    ap.add_argument("--memory-turns", type=int, default=8, help="turns of context to condition on")
    ap.add_argument("--no-actions", action="store_true", help="disable the action layer entirely")
    ap.add_argument("--enable-shell", action="store_true",
                    help="register the terminal action (gnome/desktop control). Always confirms.")
    # live guidance (section 7): steer generation back when it drifts
    ap.add_argument("--no-guide", action="store_true", help="disable live guidance")
    ap.add_argument("--guide-low-confidence", type=float, default=0.25)
    ap.add_argument("--guide-patience", type=int, default=3)
    # idle power-save (the kill switch: sleep when there's nothing to do)
    ap.add_argument("--idle-timeout", type=float, default=120.0,
                    help="seconds of no input before releasing GPU memory to save power (0=off)")
    ap.add_argument("--seed", type=int, default=None)
    return ap.parse_args()


def load_model(ckpt_path: str, device: str):
    ckpt = load_checkpoint(ckpt_path, map_location=device)
    model = build_model(ModelConfig(**ckpt["model_config"])).to(device)
    model.load_state_dict(ckpt["model"])
    model.eval()
    return model, ckpt


def clean_reply(text: str) -> str:
    for marker in ROLE_MARKERS:
        if marker in text:
            text = text.split(marker)[0]
    return text.strip()


def _power_save(device: str) -> None:
    """Kill switch = save power when idle. Release GPU memory; the model stays
    loaded and wakes instantly on the next input. Never stops on drift."""
    if device == "cuda":
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass


def read_input(prompt: str, idle_timeout: float, device: str):
    """Read a line, releasing GPU memory once if the user is idle past
    idle_timeout (POSIX TTY only; plain readline elsewhere). Returns None on EOF."""
    sys.stdout.write(prompt)
    sys.stdout.flush()
    if idle_timeout and idle_timeout > 0 and sys.stdin.isatty():
        slept = False
        while True:
            ready, _, _ = select.select([sys.stdin], [], [], idle_timeout)
            if ready:
                line = sys.stdin.readline()
                return None if line == "" else line
            if not slept:
                _power_save(device)
                print(f"\n[power-save] idle {idle_timeout:.0f}s — released GPU cache; "
                      f"waiting (wakes on input)...")
                sys.stdout.write(prompt)
                sys.stdout.flush()
                slept = True
    line = sys.stdin.readline()
    return None if line == "" else line


def main():
    args = parse_args()
    if args.seed is not None:
        torch.manual_seed(args.seed)
    device = resolve_device(args.device)

    model, ckpt = load_model(args.ckpt, device)
    tok_path = args.tokenizer or ckpt.get("tokenizer", "checkpoints/spm.model")
    tokenizer = Tokenizer(tok_path)

    memory = ZipLoopMemory(capacity=512, persist_path=args.memory)
    veto = AlignmentVeto()
    action_layer = None if args.no_actions else ActionLayer(veto=veto)
    if action_layer is not None and args.enable_shell:
        enable_shell_actions(action_layer)
    guide = None if args.no_guide else LiveGuide(
        base_temperature=args.temperature, base_top_k=args.top_k, base_top_p=args.top_p,
        low_confidence=args.guide_low_confidence, patience=args.guide_patience)

    print("Prometheus/TinyGPT core.")
    print(f"  model      : {args.ckpt} on {device}")
    print(f"  selection  : best-of-{args.candidates} (predict-before-commit)")
    print(f"  memory     : zip-loop ({len(memory)} turns loaded){' @ ' + args.memory if args.memory else ''}")
    shell_note = " + terminal (opt-in, always confirms)" if (not args.no_actions and args.enable_shell) else ""
    print(f"  actions    : {'disabled' if args.no_actions else 'human-in-the-loop (read-only allowlist)' + shell_note}")
    print(f"  guidance   : {'off' if args.no_guide else 'live (steer drift back mid-generation, §7)'}")
    print(f"  power-save : {'off' if args.idle_timeout <= 0 else f'release GPU after {args.idle_timeout:.0f}s idle'}")
    print("  Type 'exit' to quit, 'reset' to clear memory.")
    print("  Teach the model live:  teach: <prompt> => <required reply>   (extension builder, §4)\n")
    if not args.no_actions:
        print("  The model can propose 'ACTION: time' / 'list_dir <p>' / 'read_file <p>' / "
              "'system_info' — each needs your approval.\n")

    builder = ExtensionBuilder(model, tokenizer, device=device)

    while True:
        try:
            line = read_input("you> ", args.idle_timeout, device)
        except KeyboardInterrupt:
            print()
            break
        if line is None:
            print()
            break
        user = line.strip()
        if user.lower() in ("exit", "quit"):
            break
        if user.lower() == "reset":
            memory.clear(); memory.save()
            print("(memory cleared)")
            continue
        if user.lower() == "sleep":
            _power_save(device)
            print("(power-save — released GPU cache; keep typing to continue)")
            continue
        if user.lower().startswith("teach:") and "=>" in user:
            # extension builder (§4): teach a definishon contract live, then
            # persist the modified weights so the new behaviour sticks.
            spec = user[len("teach:"):]
            when, then = (s.strip() for s in spec.split("=>", 1))
            if not when or not then:
                print("(usage: teach: <prompt> => <required reply>)")
                continue
            contract = [Definishon(when=when, then=then)]
            print(f"[teach] training: when {when!r} => then {then!r} ...")
            res = builder.train(contract, epochs=200, lr=1e-3, weight_penalty=1e-3,
                                tolerance=0.5)
            ok = "learned" if contract[0].satisfied else "did not fully converge"
            print(f"[teach] {ok} in {res.epochs} epochs (loss {contract[0].final_loss:.3f})")
            save_checkpoint(args.ckpt, model, None, model.cfg, ckpt.get("step", 0),
                            ckpt.get("best_val", float('inf')),
                            extra={"tokenizer": tok_path, "extended": True})
            print(f"[teach] saved -> {args.ckpt}")
            continue
        if not user:
            continue

        memory.add("user", user)

        # build prompt from recent zip-loop memory + the assistant header
        turns = memory.recent(args.memory_turns)
        prompt = build_chat_prompt(turns, tokenizer) + "<|assistant|>\n"
        prompt_ids = [tokenizer.bos_id] + tokenizer.encode(prompt)

        # section 11 (predict-before-commit) + section 7 (live guidance): generate
        # N candidates under live guidance — when the model drifts into sustained
        # low confidence mid-generation, sampling tightens to steer it back rather
        # than stopping — then commit the model's most-confident candidate.
        if guide is not None:
            guide.corrections = 0
        best = best_of_n(
            model, tokenizer, prompt_ids, n=args.candidates,
            max_new_tokens=args.max_new_tokens, temperature=args.temperature,
            top_k=args.top_k, top_p=args.top_p,
            repetition_penalty=args.repetition_penalty, eos_id=tokenizer.eos_id,
            device=device, guide=guide,
        )
        reply = clean_reply(best.text)
        print(f"bot> {reply}")
        if args.candidates > 1:
            print(f"     (chose best of {args.candidates}, confidence {best.score:.3f})")
        if guide is not None and guide.corrections > 0:
            print(f"     (live guidance steered {guide.corrections} time(s))")

        # section 3 + action layer: any proposed ACTION is vetoed + confirmed
        if action_layer is not None:
            result = action_layer.maybe_execute(reply)
            if result.proposed:
                print(f"[action] {result.output}")
                if result.executed:
                    memory.add("system", f"action result: {result.output[:500]}")

        memory.add("assistant", reply)
        memory.save()
        print()


if __name__ == "__main__":
    main()
