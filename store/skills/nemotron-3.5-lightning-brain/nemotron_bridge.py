#!/usr/bin/env python3
"""
Local bridge to NVIDIA's Nemotron 3.5 Lightning, for use as an extra OneBrain
expert. UNOFFICIAL — a community adapter, not affiliated with NVIDIA.

Shaped like this repo's existing PyTorch worker: a persistent process reading
one JSON object per line from stdin and writing one per line to stdout. That
shape is the point — a 17.8B model takes a long time to load, so loading it
once and answering many requests is the difference between usable and not.

Nothing here calls a network service at run time. The weights are read from a
local directory that the person installing chose to download.
"""

import json
import os
import sys
import time

_state = {"model": None, "tokenizer": None, "device": None, "path": None}

MODEL_ID = "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4"


def _reply(obj):
    """One JSON object per line, flushed — the caller reads line by line."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _model_path():
    """Where the weights live. Explicit env var first, then a conventional path."""
    return os.environ.get("NEUROCLAW_NEMOTRON_PATH") or os.path.join(
        os.getcwd(), "nemotron-3.5-lightning"
    )


def op_load(_req):
    if _state["model"] is not None:
        return {"ok": True, "already": True, "device": _state["device"]}

    path = _model_path()
    if not os.path.isdir(path):
        # Say exactly what is missing and how to get it, rather than surfacing
        # a transformers stack trace about a directory.
        return {
            "ok": False,
            "error": (
                f"No model directory at {path!r}. Download it first:\n"
                f"  huggingface-cli download {MODEL_ID} --local-dir {path}\n"
                "and accept NVIDIA's licence on the model page. "
                "Set NEUROCLAW_NEMOTRON_PATH to point somewhere else."
            ),
        }

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as e:
        return {"ok": False, "error": f"Missing dependency: {e}. See requirements.txt."}

    started = time.time()
    try:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        tokenizer = AutoTokenizer.from_pretrained(path)
        model = AutoModelForCausalLM.from_pretrained(
            path,
            torch_dtype="auto",
            # Let accelerate place layers; on a machine that cannot hold the
            # whole model this is what makes it load at all instead of OOMing.
            device_map="auto" if device == "cuda" else None,
            trust_remote_code=True,
        )
        model.eval()
    except Exception as e:  # noqa: BLE001 - report anything, never crash the worker
        return {"ok": False, "error": f"Failed to load: {type(e).__name__}: {e}"}

    _state.update({"model": model, "tokenizer": tokenizer, "device": device, "path": path})
    return {"ok": True, "device": device, "load_seconds": round(time.time() - started, 1)}


def op_generate(req):
    if _state["model"] is None:
        loaded = op_load({})
        if not loaded.get("ok"):
            return loaded

    prompt = req.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        return {"ok": False, "error": "generate needs a non-empty 'prompt'."}

    # Bounded so one request cannot run away with the machine.
    max_tokens = max(1, min(int(req.get("max_tokens", 256)), 2048))
    temperature = float(req.get("temperature", 0.7))

    try:
        import torch

        tok = _state["tokenizer"]
        model = _state["model"]
        inputs = tok(prompt, return_tensors="pt")
        if _state["device"] == "cuda":
            inputs = {k: v.to(model.device) for k, v in inputs.items()}
        with torch.no_grad():
            out = model.generate(
                **inputs,
                max_new_tokens=max_tokens,
                do_sample=temperature > 0,
                temperature=temperature if temperature > 0 else None,
                pad_token_id=tok.eos_token_id,
            )
        # Return only what was generated, not the prompt echoed back.
        generated = out[0][inputs["input_ids"].shape[-1]:]
        return {"ok": True, "text": tok.decode(generated, skip_special_tokens=True)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def op_status(_req):
    return {
        "ok": True,
        "loaded": _state["model"] is not None,
        "device": _state["device"],
        "path": _state["path"] or _model_path(),
        "model_id": MODEL_ID,
        "official": False,
    }


OPS = {"load": op_load, "generate": op_generate, "status": op_status}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            _reply({"ok": False, "error": f"Bad JSON: {e}"})
            continue
        handler = OPS.get(req.get("op"))
        if handler is None:
            _reply({"ok": False, "error": f"Unknown op {req.get('op')!r}. Expected: {', '.join(OPS)}."})
            continue
        try:
            _reply(handler(req))
        except Exception as e:  # noqa: BLE001
            # A worker that dies on one bad request loses a very expensive
            # model load, so nothing is allowed to escape the loop.
            _reply({"ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
