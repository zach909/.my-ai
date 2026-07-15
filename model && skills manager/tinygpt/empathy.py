"""Empathy engine — keep the model aligned with the user's intent and state.

Ported from the retired TypeScript core (`models && skills/core/empathy.ts`)
into the unified Python core so it actually runs in the chat loop.

What it honestly does (no claimed feeling, just useful signal):
  - reads each user turn and estimates an emotional state on the standard
    valence / arousal / dominance (VAD) axes from a small keyword lexicon plus
    punctuation/capitalisation cues;
  - tracks a rolling history and gradually syncs a "model emotional state"
    toward the user's (the empathy mechanism), exposing an alignment score;
  - detects durable *preferences* stated in passing ("keep it short", "more
    detail please", "stop apologising") and remembers them, so the core keeps
    honouring them without the user repeating instructions;
  - turns all of that into concrete sampling adjustments: a frustrated user
    gets tighter, more deterministic sampling and shorter replies; an
    enthusiastic user gets a little more temperature.

The state is JSON-persistable so alignment survives restarts alongside the
zip-loop memory.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional


@dataclass
class EmotionalState:
    valence: float = 0.0      # -1 (negative) .. 1 (positive)
    arousal: float = 0.5      # 0 (calm) .. 1 (excited)
    dominance: float = 0.5    # 0 (submissive) .. 1 (dominant)
    confidence: float = 0.5   # 0 .. 1, confidence in this assessment

    def clamped(self) -> "EmotionalState":
        return EmotionalState(
            valence=max(-1.0, min(1.0, self.valence)),
            arousal=max(0.0, min(1.0, self.arousal)),
            dominance=max(0.0, min(1.0, self.dominance)),
            confidence=max(0.0, min(1.0, self.confidence)),
        )


@dataclass
class SamplingAdjustment:
    """Multiplicative/absolute tweaks the core applies on top of its base
    sampling parameters. Neutral defaults mean "no change"."""
    temperature_scale: float = 1.0
    max_tokens_scale: float = 1.0
    top_p_delta: float = 0.0


# emotional keyword lexicon: word -> (valence, arousal, dominance)
_LEXICON: Dict[str, tuple] = {
    "love": (0.9, 0.6, 0.6), "great": (0.8, 0.5, 0.6), "good": (0.6, 0.4, 0.5),
    "thanks": (0.7, 0.3, 0.5), "thank": (0.7, 0.3, 0.5), "awesome": (0.9, 0.8, 0.6),
    "perfect": (0.9, 0.5, 0.6), "excellent": (0.9, 0.5, 0.6), "nice": (0.6, 0.4, 0.5),
    "happy": (0.8, 0.6, 0.6), "excited": (0.8, 0.9, 0.6), "cool": (0.6, 0.5, 0.5),
    "wow": (0.7, 0.9, 0.5), "amazing": (0.9, 0.8, 0.6), "yes": (0.4, 0.4, 0.6),
    "hate": (-0.9, 0.7, 0.6), "bad": (-0.6, 0.4, 0.5), "terrible": (-0.9, 0.6, 0.4),
    "awful": (-0.8, 0.6, 0.4), "wrong": (-0.6, 0.5, 0.5), "broken": (-0.7, 0.5, 0.4),
    "angry": (-0.8, 0.8, 0.7), "frustrated": (-0.7, 0.7, 0.5), "annoying": (-0.7, 0.6, 0.5),
    "stupid": (-0.8, 0.6, 0.6), "useless": (-0.8, 0.5, 0.5), "fail": (-0.7, 0.5, 0.4),
    "failed": (-0.7, 0.5, 0.4), "no": (-0.3, 0.4, 0.6), "stop": (-0.4, 0.6, 0.8),
    "sad": (-0.7, 0.3, 0.3), "confused": (-0.4, 0.5, 0.3), "lost": (-0.5, 0.4, 0.3),
    "help": (-0.2, 0.5, 0.3), "please": (0.2, 0.3, 0.3), "sorry": (-0.3, 0.3, 0.3),
    "urgent": (-0.2, 0.9, 0.6), "quick": (0.0, 0.7, 0.6), "now": (0.0, 0.7, 0.7),
}

# durable preference patterns: name -> regex on the lowercased input
_PREFERENCES: Dict[str, str] = {
    "brief": r"\b(keep it (short|brief)|shorter|be brief|too long|less detail|tl;?dr)\b",
    "detailed": r"\b(more detail|longer|elaborate|explain more|in depth)\b",
    "precise": r"\b(be (precise|exact|accurate)|stop guessing|just the facts)\b",
    "casual": r"\b(be casual|relax|informal|chatty)\b",
}


class EmpathyEngine:
    def __init__(self, memory_length: int = 50, empathy_strength: float = 0.8,
                 adaptation_rate: float = 0.1, persist_path: Optional[str] = None):
        self.memory_length = memory_length
        self.empathy_strength = empathy_strength
        self.adaptation_rate = adaptation_rate
        self.persist_path = persist_path
        self.history: List[EmotionalState] = []
        self.preferences: Dict[str, float] = {}   # name -> strength 0..1
        self.model_state = EmotionalState()
        self.alignment = 1.0
        if persist_path and os.path.exists(persist_path):
            self.load()

    # ---- analysis ---------------------------------------------------------

    def analyze(self, text: str) -> EmotionalState:
        """Estimate the emotional state of one user turn."""
        lower = text.lower()
        v = a = d = 0.0
        matches = 0
        for word, (wv, wa, wd) in _LEXICON.items():
            if re.search(rf"\b{re.escape(word)}\b", lower):
                v += wv
                a += wa
                d += wd
                matches += 1
        exclaim = text.count("!")
        question = text.count("?")
        caps = sum(1 for c in text if c.isupper()) / max(1, len(text))
        arousal_punct = min(1.0, exclaim * 0.2 + question * 0.1 + caps * 0.5)
        if matches:
            state = EmotionalState(
                valence=v / matches,
                arousal=(a / matches + arousal_punct) / 2,
                dominance=d / matches,
                confidence=min(1.0, matches * 0.2 + 0.3),
            )
        else:
            state = EmotionalState(valence=0.0, arousal=arousal_punct,
                                    dominance=0.5, confidence=0.3)
        return state.clamped()

    # ---- state tracking ---------------------------------------------------

    def observe(self, text: str) -> EmotionalState:
        """Analyze a user turn, update history/preferences, sync the model state."""
        emotion = self.analyze(text)
        self.history.append(emotion)
        if len(self.history) > self.memory_length:
            self.history.pop(0)

        lower = text.lower()
        for name, pattern in _PREFERENCES.items():
            if re.search(pattern, lower):
                # stated preferences are durable; opposites decay each other
                self.preferences[name] = min(1.0, self.preferences.get(name, 0.0) + 0.5)
                opposite = {"brief": "detailed", "detailed": "brief"}.get(name)
                if opposite and opposite in self.preferences:
                    self.preferences[opposite] = max(0.0, self.preferences[opposite] - 0.5)

        # empathy: gradually align the model's state with the user's
        rate = self.empathy_strength * self.adaptation_rate
        m, u = self.model_state, emotion
        self.model_state = EmotionalState(
            valence=m.valence + (u.valence - m.valence) * rate,
            arousal=m.arousal + (u.arousal - m.arousal) * rate,
            dominance=m.dominance + (u.dominance - m.dominance) * rate,
            confidence=m.confidence + (u.confidence - m.confidence) * rate,
        ).clamped()
        diff = (abs(self.model_state.valence - u.valence)
                + abs(self.model_state.arousal - u.arousal)
                + abs(self.model_state.dominance - u.dominance)) / 3.0
        self.alignment = 1.0 - diff
        if self.persist_path:
            self.save()
        return emotion

    def user_mood(self, last_n: int = 5) -> EmotionalState:
        """Average recent emotional state (neutral if no history)."""
        recent = self.history[-last_n:]
        if not recent:
            return EmotionalState()
        n = len(recent)
        return EmotionalState(
            valence=sum(e.valence for e in recent) / n,
            arousal=sum(e.arousal for e in recent) / n,
            dominance=sum(e.dominance for e in recent) / n,
            confidence=sum(e.confidence for e in recent) / n,
        )

    # ---- behaviour --------------------------------------------------------

    def adjustment(self) -> SamplingAdjustment:
        """Concrete sampling tweaks from mood + remembered preferences.

        Frustrated (negative valence) => be precise: cooler sampling, tighter
        nucleus, shorter replies. Enthusiastic (positive + aroused) => slightly
        warmer sampling. Preferences override mood where they conflict.
        """
        mood = self.user_mood()
        adj = SamplingAdjustment()
        if mood.valence < -0.2:
            severity = min(1.0, -mood.valence)
            adj.temperature_scale = 1.0 - 0.35 * severity
            adj.top_p_delta = -0.05 * severity
            adj.max_tokens_scale = 1.0 - 0.3 * severity
        elif mood.valence > 0.4 and mood.arousal > 0.5:
            adj.temperature_scale = 1.1
        if self.preferences.get("brief", 0.0) >= 0.5:
            adj.max_tokens_scale = min(adj.max_tokens_scale, 0.5)
        if self.preferences.get("detailed", 0.0) >= 0.5:
            adj.max_tokens_scale = max(adj.max_tokens_scale, 1.5)
        if self.preferences.get("precise", 0.0) >= 0.5:
            adj.temperature_scale = min(adj.temperature_scale, 0.7)
        return adj

    def describe(self) -> str:
        mood = self.user_mood()
        label = ("frustrated" if mood.valence < -0.2 else
                 "positive" if mood.valence > 0.3 else "neutral")
        prefs = [k for k, v in self.preferences.items() if v >= 0.5]
        pref_note = f", prefers: {', '.join(sorted(prefs))}" if prefs else ""
        return f"user mood {label} (v={mood.valence:+.2f}, alignment {self.alignment:.2f}){pref_note}"

    # ---- persistence ------------------------------------------------------

    def save(self) -> None:
        if not self.persist_path:
            return
        os.makedirs(os.path.dirname(self.persist_path) or ".", exist_ok=True)
        payload = {
            "history": [asdict(e) for e in self.history],
            "preferences": self.preferences,
            "model_state": asdict(self.model_state),
            "alignment": self.alignment,
        }
        with open(self.persist_path, "w", encoding="utf-8") as f:
            json.dump(payload, f)

    def load(self) -> None:
        try:
            with open(self.persist_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            self.history = [EmotionalState(**e) for e in payload.get("history", [])]
            self.preferences = dict(payload.get("preferences", {}))
            self.model_state = EmotionalState(**payload.get("model_state", {}))
            self.alignment = float(payload.get("alignment", 1.0))
        except (json.JSONDecodeError, TypeError, ValueError, OSError):
            # a corrupt state file must never take down the core
            self.history, self.preferences = [], {}
            self.model_state, self.alignment = EmotionalState(), 1.0
