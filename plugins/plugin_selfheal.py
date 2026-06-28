"""Self-heal plugin — monitors the AI system and restarts failed components.

Checks process health, model consistency, and plugin status periodically.
Restarts anything that's stopped unexpectedly.
"""

from __future__ import annotations
import os, sys, subprocess, threading, time, json
from typing import Callable, Dict, List, Optional
from .plugin_base import Plugin


class SelfHealPlugin(Plugin):
    name = "self_heal"
    description = "Monitors and auto-restarts AI components on failure."

    def _setup(self) -> None:
        self.tools = {
            "start":   self._start_monitor,
            "stop":    self._stop_monitor,
            "status":  self._status,
            "check":   self._check_now,
            "add_watch": self._add_watch,
        }
        self._watches: Dict[str, dict] = {}
        self._monitor_thread: Optional[threading.Thread] = None
        self._running = False
        self._log: List[dict] = []

    def _add_watch(self, name: str, check_fn: Callable, restart_fn: Callable,
                   interval: int = 30) -> str:
        self._watches[name] = {
            "check": check_fn,
            "restart": restart_fn,
            "interval": interval,
            "last_check": 0,
            "failures": 0,
        }
        return f"Added watch for '{name}'"

    def _start_monitor(self) -> str:
        if self._running:
            return "Monitor already running"
        self._running = True
        self._monitor_thread = threading.Thread(target=self._loop, daemon=True)
        self._monitor_thread.start()
        return "Self-heal monitor started"

    def _stop_monitor(self) -> str:
        self._running = False
        return "Self-heal monitor stopped"

    def _loop(self) -> None:
        while self._running:
            self._check_now()
            time.sleep(10)

    def _check_now(self) -> dict:
        results = {}
        now = time.time()
        for name, watch in self._watches.items():
            if now - watch["last_check"] < watch["interval"]:
                continue
            watch["last_check"] = now
            try:
                healthy = watch["check"]()
                if not healthy:
                    watch["failures"] += 1
                    self._log.append({
                        "ts": now, "name": name,
                        "event": "failure", "count": watch["failures"]
                    })
                    watch["restart"]()
                    self._log.append({"ts": time.time(), "name": name, "event": "restarted"})
                    results[name] = "restarted"
                else:
                    watch["failures"] = 0
                    results[name] = "healthy"
            except Exception as e:
                results[name] = f"error: {e}"
        return results

    def _status(self) -> dict:
        return {
            "running": self._running,
            "watches": list(self._watches.keys()),
            "recent_log": self._log[-20:],
        }

    def watch_server(self, port: int, restart_cmd: str) -> str:
        """Convenience: watch an HTTP server port and restart if down."""
        import urllib.request, urllib.error

        def check() -> bool:
            try:
                urllib.request.urlopen(f"http://localhost:{port}/health", timeout=2)
                return True
            except Exception:
                return False

        def restart() -> None:
            subprocess.Popen(restart_cmd, shell=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        return self._add_watch(f"server:{port}", check, restart)
