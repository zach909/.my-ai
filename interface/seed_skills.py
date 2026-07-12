#!/usr/bin/env python3
"""Seed a starter set of skills for the Neuroclaw dashboard.

Skills are extensions the browser Extension Builder produces; each is a neuron
whose name is a trigger phrase and whose definition is the response. server.py
routes a chat message to a matching skill before falling back to the mesh-core
language model. This script writes a small, genuinely useful starter set so the
AI answers common meta-questions accurately instead of hallucinating them — the
model still handles everything else.

The triggers are intentionally specific (mostly multi-word) so they don't hijack
ordinary conversation. Edit or delete these freely; they're just extensions.

    python interface/seed_skills.py

Files land in extension-builder/extensions/*.ext.json (gitignored runtime
output) and are picked up the next time the dashboard loads.
"""
from __future__ import annotations

import json
import os
import time

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DIR = os.path.join(_ROOT, "extension-builder", "extensions")

# (extension name, trigger phrase, response) — honest, capability-accurate.
STARTER_SKILLS = [
    ("help", "help",
     "Type in the chat to talk to the mesh-core language model. Open the "
     "Extension Builder tab to add your own skills (a trigger phrase and a "
     "response); the Systems tab shows the live mesh / MoE / quantum subsystems."),
    ("capabilities", "what can you do",
     "I run a local elastic-mesh language model that writes prose, plus a skill "
     "system you extend in the browser. I can route to skills you define, show "
     "my subsystems live, and generate text — all offline, no external APIs."),
    ("identity", "who are you",
     "I'm Neuroclaw — a local, private AI whose core is an all-to-all neuron "
     "mesh with MoE routing and a quantum-interference layer, trained on CPU. "
     "I'm small and run entirely on your machine."),
    ("how-it-works", "how do you work",
     "My language core is an elastic mesh: every neuron connects to every other, "
     "state settles over ticks, a router activates only the needed experts, and "
     "candidate outputs are combined by simulated quantum interference. Skills "
     "you build are extra router-gated neurons layered on top."),
    ("offline", "are you online",
     "No — I run fully offline on this machine and use no external APIs. "
     "Everything, including the model and your skills, is local."),
]


def main() -> None:
    os.makedirs(_DIR, exist_ok=True)
    written = 0
    for i, (name, trigger, response) in enumerate(STARTER_SKILLS):
        ts = int(time.time() * 1000) + i
        data = {
            "project": {
                "id": f"seed_{ts}", "name": name, "description": "starter skill",
                "dims": 3, "createdAt": ts, "updatedAt": ts,
            },
            "neurons": [{
                "id": f"n_{ts}", "name": trigger, "value": 0.9,
                "definition": response, "type": "neuron",
            }],
            "connections": [], "layers": [], "labels": [],
        }
        path = os.path.join(_DIR, f"seed_{name}_{ts}.ext.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        written += 1
        print(f"  + skill '{trigger}' -> {os.path.basename(path)}")
    print(f"\nWrote {written} starter skills to {os.path.relpath(_DIR, _ROOT)}. "
          f"Restart the dashboard (or hit /api/skills) to load them.")


if __name__ == "__main__":
    main()
