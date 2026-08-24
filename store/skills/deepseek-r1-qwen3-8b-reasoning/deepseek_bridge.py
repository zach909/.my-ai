#!/usr/bin/env python3
"""
Local bridge to DeepSeek-R1-0528-Qwen3-8B, for use as an extra OneBrain expert.
Community adapter — not affiliated with DeepSeek. The model is MIT licensed.

Persistent stdin/stdout JSON-line worker: one process, model loaded once,
answering many requests. Reloading an 8B model per call would dominate the
cost of using it at all.

R1-family models emit their working inside <think>...</think> before the
answer, and this returns the two as separate fields rather than one blob. That
separation is the main thing this bridge does beyond loading the model: the
reasoning is useful on its own, and splicing it into the answer is what makes
these models look like they are rambling.

Nothing here calls a network service at run time.
"""

import json
import os
import re
import sys
import time

MODEL_ID = "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B"
LICENSE = "MIT"

_state = {"model": None, "tokenizer": None, "device": None, "path": None}

# DOTALL so the working can span lines, which it almost always does. Tolerates
# a missing opening tag: some sampling paths emit only the closing one, and
# dropping the reasoning entirely there would be worse than keeping it.
_THINK = re.compile(r"<think>(.*?)</think>", re.DOTALL)
_ORPHAN_CLOSE = re.compile(r"^(.*?)</think>", re.DOTALL)


def _reply(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _model_path():
    return os.environ.get("NEUROCLAW_DEEPSEEK_PATH") or os.path.join(
        os.getcwd(), "deepseek-r1-qwen3-8b"
    )


def split_reasoning(raw):
    """
    Separate <think> working from the answer.

    Returns (reasoning, answer). Either may be empty. Exposed as a plain
    function so it can be tested without loading eight billion parameters.
    """
    if not raw:
        return "", ""
    match = _THINK.search(raw)
    if match:
        reasoning = match.group(1).strip()
        answer = (raw[: match.start()] + raw[match.end():]).strip()
        return reasoning, answer
    orphan = _ORPHAN_CLOSE.search(raw)
    if orphan and "</think>" in raw:
        return orphan.group(1).strip(), raw[orphan.end():].strip()
    return "", raw.strip()


def op_load(_req):
    if _state["model"] is not None:
        return {"ok": True, "already": True, "device": _state["device"]}

    path = _model_path()
    if not os.path.isdir(path):
        return {
            "ok": False,
            "error": (
                f"No model directory at {path!r}. Download it first:\n"
                f"  huggingface-cli download {MODEL_ID} --local-dir {path}\n"
                "Set NEUROCLAW_DEEPSEEK_PATH to point somewhere else."
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
            device_map="auto" if device == "cuda" else None,
        )
        model.eval()
    except Exception as e:  # noqa: BLE001
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

    # Reasoning models need headroom -- they spend tokens thinking before
    # answering -- but not unbounded headroom.
    max_tokens = max(1, min(int(req.get("max_tokens", 512)), 4096))
    temperature = float(req.get("temperature", 0.6))

    try:
        import torch

        tok = _state["tokenizer"]
        model = _state["model"]

        # Use the chat template when the tokenizer ships one: R1 is trained
        # with it, and prompting the raw text instead measurably degrades the
        # reasoning behaviour.
        if getattr(tok, "chat_template", None):
            text = tok.apply_chat_template(
                [{"role": "user", "content": prompt}],
                tokenize=False,
                add_generation_prompt=True,
            )
        else:
            text = prompt

        inputs = tok(text, return_tensors="pt")
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
        generated = out[0][inputs["input_ids"].shape[-1]:]
        raw = tok.decode(generated, skip_special_tokens=True)
        reasoning, answer = split_reasoning(raw)
        return {"ok": True, "reasoning": reasoning, "text": answer}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def op_status(_req):
    return {
        "ok": True,
        "loaded": _state["model"] is not None,
        "device": _state["device"],
        "path": _state["path"] or _model_path(),
        "model_id": MODEL_ID,
        "license": LICENSE,
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
            # Nothing escapes the loop: a worker that dies on one bad request
            # loses an expensive model load.
            _reply({"ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
