"""Calendar plugin — manage events with JSON storage."""

from __future__ import annotations
import os, json, time
from typing import List, Optional
from .plugin_base import Plugin

_CAL_FILE = os.path.expanduser("~/.neuroclaw/calendar/events.json")


class CalendarPlugin(Plugin):
    name = "calendar"
    description = "Calendar event management."

    def _setup(self) -> None:
        self.tools = {
            "list":    self._list,
            "add":     self._add,
            "remove":  self._remove,
            "upcoming": self._upcoming,
        }
        self._events: List[dict] = []
        self._load()

    def _list(self, from_ts: float = 0, to_ts: float = 0) -> List[dict]:
        result = self._events
        if from_ts:
            result = [e for e in result if e.get("start", 0) >= from_ts]
        if to_ts:
            result = [e for e in result if e.get("end", 0) <= to_ts]
        return sorted(result, key=lambda e: e.get("start", 0))

    def _add(self, title: str, start: float, end: float,
             description: str = "", location: str = "") -> dict:
        ev = {
            "id": f"cal-{int(time.time()*1000)}-{os.urandom(4).hex()}",
            "title": title, "start": start, "end": end,
            "description": description, "location": location,
            "created": time.time(),
        }
        self._events.append(ev)
        self._save()
        return ev

    def _remove(self, event_id: str) -> bool:
        before = len(self._events)
        self._events = [e for e in self._events if e.get("id") != event_id]
        if len(self._events) < before:
            self._save()
            return True
        return False

    def _upcoming(self, count: int = 5) -> List[dict]:
        now = time.time()
        upcoming = [e for e in self._events if e.get("start", 0) >= now]
        return sorted(upcoming, key=lambda e: e.get("start", 0))[:count]

    def _load(self) -> None:
        if os.path.exists(_CAL_FILE):
            try:
                with open(_CAL_FILE) as f:
                    self._events = json.load(f)
            except Exception:
                self._events = []

    def _save(self) -> None:
        os.makedirs(os.path.dirname(_CAL_FILE), exist_ok=True)
        with open(_CAL_FILE, "w") as f:
            json.dump(self._events, f, indent=2)
