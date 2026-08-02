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

        # Secure directory and file permissions on Unix-like platforms
        cal_dir = os.path.dirname(_CAL_FILE)
        os.makedirs(cal_dir, exist_ok=True)
        if os.name == 'posix':
            os.chmod(cal_dir, 0o700)
            if os.path.exists(_CAL_FILE):
                os.chmod(_CAL_FILE, 0o600)

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
        cal_dir = os.path.dirname(_CAL_FILE)
        os.makedirs(cal_dir, exist_ok=True)
        if os.name == 'posix':
            os.chmod(cal_dir, 0o700)

        # Securely create and write the calendar file with 0o600 permissions
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        fd = os.open(_CAL_FILE, flags, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(self._events, f, indent=2)
        if os.name == 'posix':
            os.chmod(_CAL_FILE, 0o600)
