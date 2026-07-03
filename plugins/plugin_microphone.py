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

    def _record(self, path: str = None, duration: int = 0, rate: int = 44100) -> str:
        if path is None:
            path = f"/tmp/audio_{int(time.time())}.wav"
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
