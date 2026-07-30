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

    def _validate_str(self, val: str) -> None:
        if not isinstance(val, str):
            raise ValueError("Security Error: Input must be a string.")
        if val.strip().startswith("-"):
            raise ValueError("Security Error: Potential argument injection detected in input.")

    def _notify(self, title: str, body: str = "", icon: str = "dialog-information",
                timeout: int = 5000) -> str:
        self._validate_str(title)
        self._validate_str(body)
        self._validate_str(icon)
        try:
            timeout_val = int(timeout)
        except (ValueError, TypeError):
            raise ValueError("Security Error: timeout must be an integer.")
        if timeout_val <= 0:
            raise ValueError("Security Error: timeout must be a positive integer.")

        if shutil.which("notify-send"):
            subprocess.run(
                ["notify-send", "-t", str(timeout_val), "-i", icon, title, body],
                capture_output=True,
            )
            return f"Notification sent: {title}"
        # Fallback: print to terminal
        print(f"\n[NOTIFICATION] {title}: {body}")
        return f"Notification (terminal fallback): {title}"

    def _urgent(self, title: str, body: str = "") -> str:
        self._validate_str(title)
        self._validate_str(body)
        if shutil.which("notify-send"):
            subprocess.run(
                ["notify-send", "-u", "critical", title, body],
                capture_output=True,
            )
            return f"Urgent notification: {title}"
        print(f"\n[URGENT] {title}: {body}")
        return f"Urgent: {title}"

    def _progress(self, title: str, value: int) -> str:
        try:
            val_int = int(value)
        except (ValueError, TypeError):
            raise ValueError("Security Error: value must be an integer.")
        if not (0 <= val_int <= 100):
            raise ValueError("Security Error: progress value must be between 0 and 100.")
        return self._notify(title, f"{val_int}%", icon="dialog-information", timeout=2000)
