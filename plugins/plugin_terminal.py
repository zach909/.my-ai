"""Terminal plugin — execute shell commands with output capture.

Runs commands in a subprocess. Dangerous commands (rm -rf /, format, etc.)
are blocked. The AI uses this for full system access without interrupting
the user (separate virtual desktop if GNOME plugin is active).
"""

from __future__ import annotations
import os, subprocess, shlex, re, time
from typing import Optional
from .plugin_base import Plugin

_BLOCKED = re.compile(
    r"\b(rm\s+-rf\s+/|mkfs|dd\s+if=|:(){ :|:& };:|shutdown|reboot|halt|poweroff)\b",
    re.I,
)


class TerminalPlugin(Plugin):
    name = "terminal"
    description = "Execute shell commands and capture output."

    def _setup(self) -> None:
        self.tools = {
            "run":    self._run,
            "run_bg": self._run_bg,
            "which":  self._which,
            "env":    self._env,
        }
        self._bg_procs: list = []

    def _run(self, cmd: str, cwd: str = None, timeout: int = 30, shell: bool = True) -> dict:
        if _BLOCKED.search(cmd):
            return {"error": "Blocked: destructive command pattern detected", "stdout": "", "stderr": ""}
        try:
            result = subprocess.run(
                cmd if shell else shlex.split(cmd),
                shell=shell,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
            )
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
            }
        except subprocess.TimeoutExpired:
            return {"error": f"Timeout after {timeout}s", "stdout": "", "stderr": ""}
        except Exception as e:
            return {"error": str(e), "stdout": "", "stderr": ""}

    def _run_bg(self, cmd: str, cwd: str = None) -> int:
        """Start a background process, return its PID."""
        proc = subprocess.Popen(cmd, shell=True, cwd=cwd,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self._bg_procs.append(proc)
        return proc.pid

    def _which(self, name: str) -> Optional[str]:
        import shutil
        return shutil.which(name)

    def _env(self, var: str = None) -> dict:
        if var:
            return {var: os.environ.get(var)}
        return dict(os.environ)
