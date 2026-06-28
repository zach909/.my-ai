"""System notifications plugin."""

from __future__ import annotations
import subprocess, shutil
from .plugin_base import Plugin


class NotificationsPlugin(Plugin):
    name = "notifications"
    description = "Send desktop notifications via libnotify or DBus."

    def _setup(self) -> None:
        self.tools = {
            "notify":  self._notify,
            "urgent":  self._urgent,
            "progress": self._progress,
        }

    def _notify(self, title: str, body: str = "", icon: str = "dialog-information",
                timeout: int = 5000) -> str:
        if shutil.which("notify-send"):
            subprocess.run(
                ["notify-send", "-t", str(timeout), "-i", icon, title, body],
                capture_output=True,
            )
            return f"Notification sent: {title}"
        # Fallback: print to terminal
        print(f"\n[NOTIFICATION] {title}: {body}")
        return f"Notification (terminal fallback): {title}"

    def _urgent(self, title: str, body: str = "") -> str:
        if shutil.which("notify-send"):
            subprocess.run(
                ["notify-send", "-u", "critical", title, body],
                capture_output=True,
            )
            return f"Urgent notification: {title}"
        print(f"\n[URGENT] {title}: {body}")
        return f"Urgent: {title}"

    def _progress(self, title: str, value: int) -> str:
        return self._notify(title, f"{value}%", icon="dialog-information", timeout=2000)
