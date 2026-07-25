"""Shared conversational-turn engine.

core.py's CLI loop wires memory, empathy, best-of-N selection, live guidance,
the reasoning ledger, and the gated action layer around a loaded model.
desktop_app.py (a native GUI) needs the exact same real behavior, not a
reimplementation that can quietly drift from the CLI's -- the same reasoning
tinygpt/infer.py already applies one level down for `chat.py`/
`interface/server.py`'s shared checkpoint-loading + generation path.

`ConversationEngine` is that single place: construct it once from an
`EngineConfig`, then call `respond()` per turn. Any frontend (terminal, GUI,
future ones) drives the same real system through this one class.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Callable, Optional

from .actions import ActionLayer, enable_shell_actions
from .config import ModelConfig
from .data import build_chat_prompt
from .empathy import EmpathyEngine
from .extension_builder import ExtensionBuilder
from .infer import resolve_tokenizer
from .live_guide import LiveGuide
from .memory import ZipLoopMemory
from .model import build_model
from .plugins import default_registry, PluginSkillRegistry
from .rl import ReasoningLedger
from .selection import best_of_n, select_by_interference
from .tokenizer import Tokenizer
from .utils import load_checkpoint, resolve_device
from .veto import AlignmentVeto

ROLE_MARKERS = ("<|user|>", "<|assistant|>", "<|system|>")


def clean_reply(text: str) -> str:
    for marker in ROLE_MARKERS:
        if marker in text:
            text = text.split(marker)[0]
    return text.strip()


@dataclass
class EngineConfig:
    ckpt: str = "checkpoints/gpt_sft.pt"
    tokenizer: Optional[str] = None
    device: str = "cuda"
    mmap: bool = False
    candidates: int = 3
    max_new_tokens: int = 200
    temperature: float = 0.8
    top_k: int = 40
    top_p: float = 0.95
    repetition_penalty: float = 1.1
    memory: str = "checkpoints/memory.json"
    memory_turns: int = 8
    encrypt: Optional[str] = None
    select: str = "confidence"
    empathy: bool = True
    empathy_state: str = "checkpoints/empathy.json"
    ledger: bool = True
    ledger_path: str = "checkpoints/reasoning.json"
    actions: bool = True
    enable_shell: bool = False
    guide: bool = True
    guide_low_confidence: float = 0.25
    guide_patience: int = 3
    seed: Optional[int] = None


@dataclass
class TurnResult:
    reply: str
    candidates: int
    confidence: float
    guidance_corrections: int
    action_output: Optional[str] = None
    action_needs_confirmation: bool = False


class ConversationEngine:
    """One loaded model + every real orchestration layer core.py wires around
    it, with a single `respond()` entry point any frontend can call for
    exactly the same behavior core.py's CLI produces."""

    def __init__(self, cfg: EngineConfig, confirm_fn: Optional[Callable[[str], bool]] = None):
        import torch
        self.cfg = cfg
        if cfg.seed is not None:
            torch.manual_seed(cfg.seed)
        self.device = resolve_device(cfg.device)

        ckpt = load_checkpoint(cfg.ckpt, map_location=self.device, mmap=cfg.mmap)
        self.model = build_model(ModelConfig(**ckpt["model_config"])).to(self.device)
        self.model.load_state_dict(ckpt["model"])
        self.model.eval()
        self.ckpt = ckpt

        self.tokenizer_path = resolve_tokenizer(
            cfg.tokenizer or ckpt.get("tokenizer", "checkpoints/spm.model"), cfg.ckpt)
        self.tokenizer = Tokenizer(self.tokenizer_path)

        passphrase = cfg.encrypt or os.environ.get("MYAI_PASSPHRASE")
        self.memory = ZipLoopMemory(capacity=512, persist_path=cfg.memory, passphrase=passphrase)
        self.empathy = EmpathyEngine(persist_path=cfg.empathy_state) if cfg.empathy else None
        self.ledger = ReasoningLedger(persist_path=cfg.ledger_path) if cfg.ledger else None
        self.registry: PluginSkillRegistry = default_registry()
        self.veto = AlignmentVeto()
        self.action_layer: Optional[ActionLayer] = None
        if cfg.actions:
            self.action_layer = ActionLayer(veto=self.veto, confirm_fn=confirm_fn)
            if cfg.enable_shell:
                enable_shell_actions(self.action_layer)
        self.guide: Optional[LiveGuide] = None
        if cfg.guide:
            self.guide = LiveGuide(base_temperature=cfg.temperature, base_top_k=cfg.top_k,
                                   base_top_p=cfg.top_p, low_confidence=cfg.guide_low_confidence,
                                   patience=cfg.guide_patience)
        self.builder = ExtensionBuilder(self.model, self.tokenizer, device=self.device)

    def respond(self, user_text: str) -> TurnResult:
        """Run one conversational turn: the same logic as core.py's main loop
        body (memory -> empathy-adjusted sampling -> best-of-N/interference
        selection under live guidance -> ledger -> gated action layer ->
        persist). Frontend-specific commands (reset/mood/plugin:/teach:/...)
        are the caller's job; this is only the "the user said X" path."""
        self.memory.add("user", user_text)
        if self.empathy is not None:
            self.empathy.observe(user_text)

        turns = self.memory.recent(self.cfg.memory_turns)
        prompt = build_chat_prompt(turns, self.tokenizer) + "<|assistant|>\n"
        prompt_ids = [self.tokenizer.bos_id] + self.tokenizer.encode(prompt)

        temperature, top_p = self.cfg.temperature, self.cfg.top_p
        if self.empathy is not None:
            adj = self.empathy.sampling_adjustment()
            temperature = self.cfg.temperature * adj["temperature_scale"]
            if self.cfg.top_p is not None:
                top_p = self.cfg.top_p * adj["top_p_scale"]

        if self.guide is not None:
            self.guide.corrections = 0
        select_fn = select_by_interference if self.cfg.select == "interference" else best_of_n
        best = select_fn(
            self.model, self.tokenizer, prompt_ids, n=self.cfg.candidates,
            max_new_tokens=self.cfg.max_new_tokens, temperature=temperature,
            top_k=self.cfg.top_k, top_p=top_p,
            repetition_penalty=self.cfg.repetition_penalty, eos_id=self.tokenizer.eos_id,
            device=self.device, guide=self.guide, ledger=self.ledger,
        )
        reply = clean_reply(best.text)
        if self.ledger is not None:
            self.ledger.record(reply)

        action_output = None
        action_needs_confirmation = False
        if self.action_layer is not None:
            result = self.action_layer.maybe_execute(reply)
            if result.proposed:
                action_output = result.output
                action_needs_confirmation = not result.executed
                if result.executed:
                    self.memory.add("system", f"action result: {result.output[:500]}")

        self.memory.add("assistant", reply)
        self.memory.save()
        if self.empathy is not None:
            self.empathy.save()
        if self.ledger is not None:
            self.ledger.save()

        return TurnResult(
            reply=reply, candidates=self.cfg.candidates, confidence=best.score,
            guidance_corrections=self.guide.corrections if self.guide is not None else 0,
            action_output=action_output, action_needs_confirmation=action_needs_confirmation,
        )

    def reset_memory(self) -> None:
        self.memory.clear()
        self.memory.save()

    def mood(self) -> Optional[str]:
        return self.empathy.describe() if self.empathy is not None else None
