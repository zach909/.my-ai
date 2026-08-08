"""Voice activation plugin — listens for wake word and processes voice commands."""

from __future__ import annotations
import os, subprocess, json, time, re
from typing import Optional, List
from .plugin_base import Plugin


class VoiceActivationPlugin(Plugin):
    name = "voice_activation"
    description = "Listen for wake word and process voice commands."

    def _setup(self) -> None:
        self.tools = {
            "start_listening": self._start_listening,
            "stop_listening":  self._stop_listening,
            "process_text":    self._process_text,
            "set_wake_word":   self._set_wake_word,
        }
        self._listening = False
        self._wake_word = "neuroclaw"

    def _start_listening(self) -> bool:
        self._listening = True
        return True

    def _stop_listening(self) -> bool:
        self._listening = False
        return True

    def _set_wake_word(self, word: str) -> None:
        if not word or not isinstance(word, str):
            raise ValueError("Security Error: Wake word must be a non-empty string.")
        if len(word) > 64:
            raise ValueError("Security Error: Wake word exceeds maximum length of 64 characters.")
        if word.startswith("-"):
            raise ValueError("Security Error: Wake word cannot start with a hyphen to prevent argument injection.")
        import re
        if not re.match(r"^[a-zA-Z0-9_-]+$", word):
            raise ValueError("Security Error: Wake word contains invalid characters. Only alphanumeric, hyphens, and underscores are allowed.")
        self._wake_word = word

    def _process_text(self, text: str) -> Optional[dict]:
        lower = text.lower()
        confidence = 0.9 if self._wake_word.lower() in lower else 0.3
        if confidence < 0.5:
            return None
        action = None
        if re.search(r'\b(open|launch|start)\b', lower):
            action = "launch"
        elif re.search(r'\b(search|find|look)\b', lower):
            action = "search"
        elif re.search(r'\b(create|make|build|generate)\b', lower):
            action = "create"
        elif re.search(r'\b(stop|cancel|halt)\b', lower):
            action = "stop"
        elif re.search(r'\b(help)\b', lower):
            action = "help"
        return {"transcript": text, "confidence": confidence,
                "action": action, "timestamp": time.time()}
