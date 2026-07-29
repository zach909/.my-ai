"""Empathy engine (design doc "Empathy") — track the user's emotional state so
generation stays aligned with what they actually want, not just what they typed.

Pure local heuristics over the VAD (valence / arousal / dominance) space:
keyword and punctuation analysis, no external APIs, no network calls. A single
message never overwrites the tracked mood outright — each reading is blended
into a running estimate with exponential smoothing, so the mood reflects the
conversation's trend rather than one noisy line.

  - valence:   -1 (negative/frustrated) .. +1 (positive/happy)
  - arousal:    0 (calm)                ..  1 (excited/urgent)
  - dominance: -1 (submissive/hedging)  .. +1 (assertive/demanding)

This is the layer the design doc means by "the model independently makes
decisions that match the user's preferences without requiring repeated
instructions": `sampling_adjustment()` turns the current mood into concrete
generation knobs (e.g. tighten sampling when the user reads frustrated).
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Deque, Dict, List, Optional
from collections import deque

_POSITIVE = {
    "good", "great", "love", "loved", "thanks", "thank", "awesome", "nice",
    "perfect", "excellent", "happy", "glad", "cool", "appreciate", "amazing",
    "wonderful", "yes", "yay", "brilliant", "helpful",
}
_NEGATIVE = {
    "bad", "hate", "terrible", "awful", "annoyed", "angry", "frustrated",
    "frustrating", "upset", "sad", "worse", "worst", "broken", "wrong",
    "fail", "failed", "failing", "useless", "stupid", "no", "never", "ugh",
}
_HIGH_AROUSAL = {
    "urgent", "now", "asap", "immediately", "hurry", "emergency", "critical",
    "help", "please", "quick", "quickly",
}
_LOW_AROUSAL = {
    "whenever", "calm", "relax", "relaxed", "slowly", "eventually", "fine",
    "sometime", "later",
}
_DOMINANT = {"must", "need", "require", "do it", "fix", "now", "stop"}
_SUBMISSIVE = {
    "maybe", "perhaps", "could you", "would you mind", "if possible",
    "sorry", "i think", "possibly", "kind of",
}

_WORD_RE = re.compile(r"[a-zA-Z']+")


def _hits(text_lower: str, vocab: set) -> int:
    words = set(_WORD_RE.findall(text_lower))
    count = sum(1 for w in vocab if w in words)
    # also check multi-word phrases directly against the raw text
    count += sum(1 for w in vocab if " " in w and w in text_lower)
    return count


@dataclass
class MoodReading:
    valence: float
    arousal: float
    dominance: float


def read_mood(text: str) -> MoodReading:
    """Score a single message's VAD signal from keywords + punctuation.
    Pure function — no state — so it is trivially testable on its own."""
    lower = text.lower()

    pos, neg = _hits(lower, _POSITIVE), _hits(lower, _NEGATIVE)
    valence = 0.0
    if pos or neg:
        valence = (pos - neg) / max(1, pos + neg)

    exclaims = text.count("!")
    caps_words = sum(1 for w in text.split() if len(w) > 2 and w.isupper())
    high, low = _hits(lower, _HIGH_AROUSAL), _hits(lower, _LOW_AROUSAL)
    arousal = min(1.0, 0.15 * exclaims + 0.1 * caps_words + 0.25 * high - 0.2 * low)
    arousal = max(0.0, arousal)

    dom, sub = _hits(lower, _DOMINANT), _hits(lower, _SUBMISSIVE)
    dominance = 0.0
    if dom or sub:
        dominance = (dom - sub) / max(1, dom + sub)

    return MoodReading(valence=valence, arousal=arousal, dominance=dominance)


class EmpathyEngine:
    """Tracks a smoothed VAD mood estimate across a conversation, with optional
    JSON persistence (mirrors ZipLoopMemory / ReasoningLedger's persist_path
    convention) so mood survives a restart."""

    def __init__(self, smoothing: float = 0.35, history: int = 50,
                 persist_path: Optional[str] = None):
        self.smoothing = smoothing
        self.persist_path = persist_path
        self.valence = 0.0
        self.arousal = 0.0
        self.dominance = 0.0
        self.observations = 0
        self.history: Deque[Dict[str, float]] = deque(maxlen=history)
        if persist_path and os.path.exists(persist_path):
            self.load()

    def observe(self, text: str) -> MoodReading:
        """Blend a new message's mood reading into the running estimate."""
        reading = read_mood(text)
        a = self.smoothing
        self.valence = (1 - a) * self.valence + a * reading.valence
        self.arousal = (1 - a) * self.arousal + a * reading.arousal
        self.dominance = (1 - a) * self.dominance + a * reading.dominance
        self.observations += 1
        self.history.append({
            "valence": reading.valence, "arousal": reading.arousal,
            "dominance": reading.dominance,
        })
        return reading

    def alignment_score(self) -> float:
        """Heuristic 0..1 read of how smoothly the interaction is going: high
        when the user reads non-negative and not agitated, low when frustrated
        and aroused at once (the "user is upset" signal)."""
        frustration = max(0.0, -self.valence) * self.arousal
        score = 0.5 + 0.5 * self.valence - 0.5 * frustration
        return max(0.0, min(1.0, score))

    def sampling_adjustment(self) -> Dict[str, float]:
        """Turn the current mood into concrete generation knobs. A frustrated,
        aroused user gets tighter (lower-temperature, more careful) sampling;
        a calm/positive one keeps the caller's defaults."""
        frustration = max(0.0, -self.valence) * self.arousal
        temperature_scale = 1.0 - 0.3 * frustration
        top_p_scale = 1.0 - 0.15 * frustration
        return {
            "temperature_scale": max(0.5, temperature_scale),
            "top_p_scale": max(0.6, top_p_scale),
        }

    def describe(self) -> str:
        if self.observations == 0:
            return "no reading yet (mood is neutral by default)"
        mood = "positive" if self.valence > 0.15 else "negative" if self.valence < -0.15 else "neutral"
        energy = "high-energy" if self.arousal > 0.4 else "calm"
        stance = "assertive" if self.dominance > 0.15 else "hedging" if self.dominance < -0.15 else "even"
        return (f"{mood}, {energy}, {stance} "
                f"(valence {self.valence:+.2f}, arousal {self.arousal:.2f}, "
                f"dominance {self.dominance:+.2f}, alignment {self.alignment_score():.2f})")

    def save(self) -> None:
        if not self.persist_path:
            return
        os.makedirs(os.path.dirname(self.persist_path) or ".", exist_ok=True)
        with open(self.persist_path, "w", encoding="utf-8") as f:
            json.dump({
                "valence": self.valence, "arousal": self.arousal,
                "dominance": self.dominance, "observations": self.observations,
                "history": list(self.history),
            }, f)

    def load(self) -> None:
        if not self.persist_path or not os.path.exists(self.persist_path):
            return
        try:
            with open(self.persist_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return  # a corrupt checkpoint must never take down the core
        self.valence = data.get("valence", 0.0)
        self.arousal = data.get("arousal", 0.0)
        self.dominance = data.get("dominance", 0.0)
        self.observations = data.get("observations", 0)
        self.history = deque(data.get("history", []), maxlen=self.history.maxlen)

    def __len__(self) -> int:
        return self.observations
