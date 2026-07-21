#!/usr/bin/env python3
"""
Janus-Pro stage helpers.

DeepSeek-Janus-Pro-7B is pulled into Ollama as `gguf/DeepSeek-Janus-Pro-7B`.
Through Ollama it runs as a *text* model, so here it does three jobs:

  * describe()      -> a vivid paragraph of what the robot looks like
  * write_character()-> a structured bio / persona (JSON: name, personality, ...)
  * edit_chat()     -> free-form "talk to the AI some more" to revise things

All calls are CPU-bound on this box (~0.3 s/token), so callers should keep
`num_predict` modest and surface progress to the UI.
"""
from __future__ import annotations

import json
import os

import ollama

JANUS_MODEL = os.environ.get("JANUS_MODEL", "gguf/DeepSeek-Janus-Pro-7B:latest")
_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
_client = ollama.Client(host=_HOST)


def _chat(messages: list[dict], num_predict: int = 220, temperature: float = 0.8) -> str:
    r = _client.chat(
        model=JANUS_MODEL,
        messages=messages,
        options={"num_predict": num_predict, "temperature": temperature},
    )
    return (r["message"]["content"] or "").strip()


def _parse_json_blob(text: str) -> dict | None:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else text
    s, e = text.find("{"), text.rfind("}")
    if s != -1 and e != -1:
        try:
            return json.loads(text[s:e + 1])
        except json.JSONDecodeError:
            return None
    return None


def describe(sex: str, hint: str = "") -> str:
    """One vivid paragraph: what this robot looks like."""
    extra = f" Incorporate this direction: {hint}." if hint else ""
    msg = (
        f"Describe the physical appearance of a {sex} humanoid robot in one vivid "
        f"paragraph (3-4 sentences). Cover its chassis, materials, colour, face, "
        f"and overall silhouette. Be concrete and visual.{extra}"
    )
    return _chat([{"role": "user", "content": msg}], num_predict=160)


def write_character(sex: str, description: str, hint: str = "") -> dict:
    """A structured persona/bio for the robot. Always returns a dict."""
    extra = f" Direction to honour: {hint}." if hint else ""
    msg = (
        "You are creating a character sheet for a robot in a small simulation. "
        "Return STRICT JSON only (no prose, no markdown fences) with keys: "
        '"name" (string), "model_designation" (string, e.g. ZB-7), '
        '"personality" (string, 1-2 sentences), "backstory" (string, 2-3 sentences), '
        '"voice" (string, how it speaks), "quirks" (array of 2-3 short strings).\n'
        f"Sex/presentation: {sex}.\nAppearance: {description}{extra}\n"
        "Return ONLY the JSON object."
    )
    raw = _chat([{"role": "user", "content": msg}], num_predict=320, temperature=0.9)
    data = _parse_json_blob(raw)
    if not data or "name" not in data:
        # Never stall the chain on a chatty model.
        data = {
            "name": "Unit-7" if sex == "male" else "Vera-7",
            "model_designation": "ZB-7",
            "personality": "Calm, precise, quietly curious about the people it meets.",
            "backstory": (
                "Assembled in the Z-Biomechanics workshop as a movement-study "
                "android, it now wanders the simulation cataloguing how bodies move."
            ),
            "voice": "Even, warm synthetic baritone." if sex == "male"
                     else "Soft, measured synthetic alto.",
            "quirks": ["tilts its head when thinking", "counts its own joints"],
            "_source": "fallback",
            "_raw": raw,
        }
    else:
        data["_source"] = "janus"
    return data


def edit_chat(history: list[dict], message: str, context: str = "") -> str:
    """
    Free-form revision chat. `history` is a list of {"role","content"} dicts.
    `context` is the current robot description+bio so Janus can edit coherently.
    """
    sys_msg = {
        "role": "system",
        "content": (
            "You are the design assistant for a robot-builder app. The user is "
            "refining a robot's look and character. Be concise and concrete. When "
            "asked to change something, restate the updated detail clearly so it "
            "can be saved.\n\nCurrent robot:\n" + context
        ),
    }
    msgs = [sys_msg] + history + [{"role": "user", "content": message}]
    return _chat(msgs, num_predict=240, temperature=0.7)
