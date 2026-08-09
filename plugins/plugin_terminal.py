"""Terminal plugin — execute shell commands with output capture.

Runs commands in a subprocess. A best-effort blocklist rejects the specific
destructive patterns named below (rm -rf on a root-like path, mkfs, a fork
bomb, shutdown/reboot/halt/poweroff, dd writing to a raw disk device) before
handing the command to the shell. This is NOT a security boundary: a
blocklist over free-form shell text can never enumerate every way to destroy
a filesystem (a Python one-liner, `find -delete`, `truncate`, overwriting a
device via `cp`, ...), and quoting/escaping/subshells can obscure a command
from these patterns entirely. Treat this as a guardrail against the most
common catastrophic accidents, not protection against a deliberately hostile
command. The AI uses this for full system access without interrupting the
user (separate virtual desktop if GNOME plugin is active).
"""

from __future__ import annotations
import os, subprocess, shlex, re, time
from typing import Optional
from .plugin_base import Plugin

_FORK_BOMB = re.compile(r":\(\)\{\s*[:\s|&]+\};:")
_DANGEROUS_SIMPLE = re.compile(r"\bmkfs|\bshutdown|\breboot|\bhalt|\bpoweroff", re.I)
_DD_RAW_DISK = re.compile(r"\bdd\b.*\bof=/dev/(sd[a-z]|nvme|mmcblk)", re.I)
_SENSITIVE_ENV_PATTERN = re.compile(
    r"key|secret|password|token|auth|pass|credential|cert|cookie|jwt|hash|salt|ssh|database|db_|session|bearer|sig|private",
    re.I
)

# `rm -rf /` was previously matched literally, so trivial variants slipped
# through: trailing content after the slash (`rm -rf /*`, `rm -rf //`),
# reordered short flags (`rm -fr`), separated flags (`rm -r -f`), and
# long-form flags (`rm --recursive --force`) all bypassed it while being
# just as destructive. Matched independently instead: the command names
# `rm`, a recursive indicator, a force indicator, and a root-like target
# (just slashes, optionally followed by a wildcard or single `.`) can each
# appear anywhere in the string and in any order/spacing.
_RM_CMD = re.compile(r"\brm\b", re.I)
_RM_RECURSIVE = re.compile(r"(?<![\w-])-[a-zA-Z]*r[a-zA-Z]*(?![\w-])|--recursive\b", re.I)
_RM_FORCE = re.compile(r"(?<![\w-])-[a-zA-Z]*f[a-zA-Z]*(?![\w-])|--force\b", re.I)
_ROOT_LIKE_PATH = re.compile(r"(?<!\S)/+[*.]{0,3}(?=\s|$|;|&|\|)")


def _is_blocked(cmd: str) -> bool:
    if _FORK_BOMB.search(cmd) or _DANGEROUS_SIMPLE.search(cmd) or _DD_RAW_DISK.search(cmd):
        return True
    if _RM_CMD.search(cmd) and _RM_RECURSIVE.search(cmd) and _RM_FORCE.search(cmd) and _ROOT_LIKE_PATH.search(cmd):
        return True
    return False


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
        if _is_blocked(cmd):
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
        """Start a background process, return its PID. Raises ValueError if blocked."""
        if _is_blocked(cmd):
            raise ValueError("Blocked: destructive command pattern detected")
        proc = subprocess.Popen(cmd, shell=True, cwd=cwd,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self._bg_procs.append(proc)
        return proc.pid

    def _which(self, name: str) -> Optional[str]:
        import shutil
        return shutil.which(name)

    def _env(self, var: str = None) -> dict:
        if var:
            if _SENSITIVE_ENV_PATTERN.search(var):
                raise ValueError(f"Security Error: Access to sensitive environment variable is blocked: {var}")
            return {var: os.environ.get(var)}

        safe_env = {}
        for k, v in os.environ.items():
            if not _SENSITIVE_ENV_PATTERN.search(k):
                safe_env[k] = v
        return safe_env
