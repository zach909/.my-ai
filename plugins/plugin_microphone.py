"""Microphone plugin — record audio from the microphone."""

from __future__ import annotations
import os, subprocess, shutil, time, threading
from typing import Optional
from .plugin_base import Plugin


class MicrophonePlugin(Plugin):
    name = "microphone"
    description = "Record audio from the microphone using ALSA/PulseAudio."

    def _setup(self) -> None:
        self.tools = {
            "record":   self._record,
            "stop":     self._stop,
            "is_active": lambda: self._proc is not None and self._proc.poll() is None,
            "devices":  self._list_devices,
        }
        self._proc: Optional[subprocess.Popen] = None
        self._current_path: Optional[str] = None

    def _safe_path(self, path: str) -> str:
        """Validate and resolve target paths to prevent path traversal and argument injection.

        Enforces that target paths remain either within the current working directory or /tmp directory.
        """
        if path.strip().startswith("-"):
            raise ValueError("Security Error: Potential argument injection detected in path.")

        target = os.path.realpath(os.path.abspath(os.path.expanduser(path)))

        cwd = os.path.realpath(os.getcwd())
        tmp_resolved = os.path.realpath("/tmp")

        rel_cwd = os.path.relpath(target, cwd)
        rel_tmp = os.path.relpath(target, tmp_resolved)

        is_inside_cwd = not rel_cwd.startswith("..") and not os.path.isabs(rel_cwd)
        is_inside_tmp = not rel_tmp.startswith("..") and not os.path.isabs(rel_tmp)

        if not (is_inside_cwd or is_inside_tmp):
            raise ValueError("Security Error: Path traversal or unauthorized path detected.")

        return target

    def _record(self, path: str = None, duration: int = 0, rate: int = 44100) -> str:
        try:
            rate = int(rate)
            duration = int(duration)
        except (ValueError, TypeError):
            raise ValueError("Security Error: rate and duration must be integers.")

        if rate <= 0 or duration < 0:
            raise ValueError("Security Error: rate and duration must be positive numbers.")

        if path is None:
            path = f"/tmp/audio_{int(time.time())}.wav"
        path = self._safe_path(path)
        self._current_path = path
        cmd = None
        if shutil.which("arecord"):
            args = ["arecord", "-f", "cd", "-r", str(rate)]
            if duration > 0:
                args += ["-d", str(duration)]
            args.append(path)
            cmd = args
        elif shutil.which("ffmpeg"):
            args = ["ffmpeg", "-f", "alsa", "-i", "default",
                    "-ar", str(rate), "-ac", "1"]
            if duration > 0:
                args += ["-t", str(duration)]
            args.append(path)
            cmd = args
        if cmd:
            self._proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return f"Recording to {path} (PID {self._proc.pid})"
        return "No audio recording tool available (install alsa-utils or ffmpeg)"

    def _stop(self) -> str:
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
            self._proc = None
            return f"Recording stopped → {self._current_path}"
        return "No active recording"

    def _list_devices(self) -> str:
        r = subprocess.run(["arecord", "-l"], capture_output=True, text=True)
        return r.stdout if r.returncode == 0 else "arecord not available"
