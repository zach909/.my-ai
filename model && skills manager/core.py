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

The orchestration itself (`tinygpt/engine.py`'s `ConversationEngine`) is shared
with `desktop_app.py`'s native GUI, so the terminal and the GUI can never drift
apart on what a "turn" actually does — the same reasoning `tinygpt/infer.py`
already applies one level down for `chat.py`/`interface/server.py`.

Usage:
    python core.py --ckpt checkpoints/gpt_sft.pt            # chat
    python core.py --ckpt checkpoints/gpt.pt --candidates 5 # best-of-5 selection
"""
from __future__ import annotations

import argparse
import select
import sys

from tinygpt.engine import ConversationEngine, EngineConfig
from tinygpt.extension_builder import Definishon
from tinygpt.utils import save_checkpoint


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
    ap.add_argument("--encrypt", metavar="PASSPHRASE", default=None,
                    help="encrypt persisted memory at rest with a local passphrase "
                         "(stdlib cipher; no external APIs). Or set MYAI_PASSPHRASE.")
    # answer selection: pure confidence ranking, or §5 quantum interference
    # (phase consensus over the mesh's settled-state wave signatures + collapse)
    ap.add_argument("--select", choices=["confidence", "interference"], default="confidence",
                    help="how to commit among the N candidates")
    # empathy: track user mood/preferences and adapt sampling to stay aligned
    ap.add_argument("--no-empathy", action="store_true", help="disable the empathy engine")
    ap.add_argument("--empathy-state", default="checkpoints/empathy.json")
    # RL reasoning ledger: completed steps are recorded and repeats scored down
    ap.add_argument("--no-ledger", action="store_true", help="disable the reasoning ledger")
    ap.add_argument("--ledger", default="checkpoints/reasoning.json")
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
    ap.add_argument("--mmap", action="store_true",
                    help="disk-offload: memory-map the checkpoint instead of loading it fully "
                         "into RAM, so a model larger than available memory can still load "
                         "(OS pages weights in from disk on demand; torch>=2.1, no new dependency)")
    ap.add_argument("--seed", type=int, default=None)
    return ap.parse_args()


def engine_config_from_args(args) -> EngineConfig:
    return EngineConfig(
        ckpt=args.ckpt, tokenizer=args.tokenizer, device=args.device, mmap=args.mmap,
        candidates=args.candidates, max_new_tokens=args.max_new_tokens,
        temperature=args.temperature, top_k=args.top_k, top_p=args.top_p,
        repetition_penalty=args.repetition_penalty, memory=args.memory,
        memory_turns=args.memory_turns, encrypt=args.encrypt, select=args.select,
        empathy=not args.no_empathy, empathy_state=args.empathy_state,
        ledger=not args.no_ledger, ledger_path=args.ledger,
        actions=not args.no_actions, enable_shell=args.enable_shell,
        guide=not args.no_guide, guide_low_confidence=args.guide_low_confidence,
        guide_patience=args.guide_patience, seed=args.seed,
    )


def _power_save(device: str) -> None:
    """Kill switch = save power when idle. Release GPU memory; the model stays
    loaded and wakes instantly on the next input. Never stops on drift."""
    if device == "cuda":
        import torch
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
    engine = ConversationEngine(engine_config_from_args(args))

    print("Prometheus/TinyGPT core.")
    print(f"  model      : {args.ckpt} on {engine.device}{' [mmap disk-offload]' if args.mmap else ''}")
    print(f"  selection  : best-of-{args.candidates} (predict-before-commit)")
    print(f"  memory     : zip-loop ({len(engine.memory)} turns loaded){' @ ' + args.memory if args.memory else ''}"
          f"{' [encrypted at rest]' if engine.memory.passphrase else ''}")
    shell_note = " + terminal (opt-in, always confirms)" if (not args.no_actions and args.enable_shell) else ""
    print(f"  actions    : {'disabled' if args.no_actions else 'human-in-the-loop (read-only allowlist)' + shell_note}")
    print(f"  guidance   : {'off' if args.no_guide else 'live (steer drift back mid-generation, §7)'}")
    print(f"  select     : {'§5 interference (phase consensus + collapse)' if args.select == 'interference' else 'confidence ranking'}")
    print(f"  empathy    : {'off' if engine.empathy is None else 'on (mood-aware sampling, remembered preferences)'}")
    print(f"  ledger     : {'off' if engine.ledger is None else f'{len(engine.ledger)} completed reasoning step(s); repeats scored down'}")
    print(f"  extensions : {len(engine.registry.plugins())} plugin(s) + {len(engine.registry.skills())} skill(s) "
          f"(plugins connect to local services; skills are mesh experts)")
    print(f"  power-save : {'off' if args.idle_timeout <= 0 else f'release GPU after {args.idle_timeout:.0f}s idle'}")
    print("  Type 'exit' to quit, 'reset' to clear memory, 'mood' for the empathy read.")
    print("  Inspect the mesh:  simulate: <neuron_id>   |   neurons: <text>   (extension builder)")
    print("  Extensions:  plugins  |  skills  |  plugin: <id> [command] [arg]   (local services)")
    print("  Teach the model live:  teach: <prompt> => <required reply>   (extension builder, §4)\n")
    if not args.no_actions:
        print("  The model can propose 'ACTION: time' / 'list_dir <p>' / 'read_file <p>' / "
              "'system_info' — each needs your approval.\n")

    while True:
        try:
            line = read_input("you> ", args.idle_timeout, engine.device)
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
            engine.reset_memory()
            print("(memory cleared)")
            continue
        if user.lower() == "sleep":
            _power_save(engine.device)
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
            res = engine.builder.train(contract, epochs=200, lr=1e-3, weight_penalty=1e-3,
                                       tolerance=0.5)
            ok = "learned" if contract[0].satisfied else "did not fully converge"
            print(f"[teach] {ok} in {res.epochs} epochs (loss {contract[0].final_loss:.3f})")
            save_checkpoint(args.ckpt, engine.model, None, engine.model.cfg,
                            engine.ckpt.get("step", 0), engine.ckpt.get("best_val", float('inf')),
                            extra={"tokenizer": engine.tokenizer_path, "extended": True})
            print(f"[teach] saved -> {args.ckpt}")
            continue
        if user.lower() == "mood" and engine.empathy is not None:
            print(f"({engine.mood()})")
            continue
        if user.lower().startswith("simulate:"):
            # Extension Builder: simulate the output of an individual neuron
            try:
                nid = int(user.split(":", 1)[1].strip())
                sim = engine.model.simulate_neuron(nid)
                infl = ", ".join(f"#{i}({v:.2f})" for i, v in sim["influenced"])
                print(f"[neuron {nid}] amplitude {sim['amplitude']:.3f}, "
                      f"wave signature {sim['wave_signature']:.3f}; drove {infl}")
            except (ValueError, IndexError) as e:
                print(f"(usage: simulate: <neuron_id 0..{engine.model.N - 1}>; {e})")
            continue
        if user.lower().startswith("neurons:"):
            # Extension Builder: search neurons within the model by input
            query = user.split(":", 1)[1].strip()
            hits = engine.builder.search_neurons(query, top_k=5)
            print("[search] " + ", ".join(f"#{i}({v:.2f})" for i, v in hits))
            continue
        if user.lower() in ("plugins", "skills"):
            # plugins connect to local services; skills are MoE experts
            summ = engine.registry.summary()
            for line in summ[user.lower()]:
                print(f"  - {line}")
            continue
        if user.lower().startswith("plugin:"):
            # dispatch a local plugin (no external APIs); read-only by default
            rest = user.split(":", 1)[1].strip().split(maxsplit=2)
            pid = rest[0] if rest else ""
            cmd = rest[1] if len(rest) > 1 else ""
            arg = rest[2] if len(rest) > 2 else ""
            res = engine.registry.dispatch(pid, cmd, arg)
            print(f"[plugin] {res.output if res.ok else res.reason}")
            continue
        if not user:
            continue

        result = engine.respond(user)
        print(f"bot> {result.reply}")
        if args.candidates > 1:
            print(f"     (chose best of {args.candidates}, confidence {result.confidence:.3f})")
        if result.guidance_corrections > 0:
            print(f"     (live guidance steered {result.guidance_corrections} time(s))")
        if result.action_output is not None:
            print(f"[action] {result.action_output}")
        print()


if __name__ == "__main__":
    main()
