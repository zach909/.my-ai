"""Screenshot and screen recording plugin."""

from __future__ import annotations
import os, subprocess, shutil, time
from typing import Optional
from .plugin_base import Plugin


class ScreenshotPlugin(Plugin):
    name = "screenshot"
    description = "Take screenshots and record the screen."

    def _setup(self) -> None:
        self.tools = {
            "capture":    self._capture,
            "capture_area": self._capture_area,
            "record":     self._record,
            "stop_record": self._stop_record,
        }
        self._recorder = None

    def _safe_path(self, path: Optional[str], default_filename: str) -> str:
        if path is None:
            return os.path.join("/tmp", default_filename)
        path_str = path.strip()
        if path_str.startswith("-"):
            raise ValueError("Security Error: Invalid path (potential argument injection)")
        # Resolve target path
        target = os.path.realpath(os.path.abspath(os.path.expanduser(path_str)))
        cwd = os.path.realpath(os.getcwd())
        tmp = os.path.realpath("/tmp")
        # Check if it starts with cwd or tmp
        is_in_cwd = os.path.commonpath([target, cwd]) == cwd
        is_in_tmp = os.path.commonpath([target, tmp]) == tmp
        if not (is_in_cwd or is_in_tmp):
            raise ValueError("Security Error: Path traversal detected. Path must be within the current working directory or /tmp")
        return target

    def _capture(self, path: str = None) -> str:
        path = self._safe_path(path, f"screenshot_{int(time.time())}.png")
        for tool, args in [
            ("scrot",           [path]),
            ("gnome-screenshot", ["-f", path]),
            ("import",          ["-window", "root", path]),
            ("xwd",             ["-root", "-out", path + ".xwd"]),
        ]:
            if shutil.which(tool):
                r = subprocess.run([tool] + args, capture_output=True, timeout=10)
                if r.returncode == 0:
                    return path
        return "No screenshot tool available"

    def _capture_area(self, x: int, y: int, w: int, h: int, path: str = None) -> str:
        path = self._safe_path(path, f"area_{int(time.time())}.png")
        for tool, args in [
            ("scrot",  ["-a", f"{x},{y},{w},{h}", path]),
            ("import", ["-crop", f"{w}x{h}+{x}+{y}", "root:", path]),
        ]:
            if shutil.which(tool):
                r = subprocess.run([tool] + args, capture_output=True, timeout=10)
                if r.returncode == 0:
                    return path
        return "No area screenshot tool available"

    def _record(self, path: str = None, fps: int = 25) -> str:
        path = self._safe_path(path, f"recording_{int(time.time())}.mp4")
        for tool, args in [
            ("ffmpeg",  ["-f", "x11grab", "-r", str(fps), "-i", ":0.0",
                         "-c:v", "libx264", "-preset", "fast", path]),
            ("recordmydesktop", ["--output", path]),
        ]:
            if shutil.which(tool):
                self._recorder = subprocess.Popen([tool] + args,
                                                  stdout=subprocess.DEVNULL,
                                                  stderr=subprocess.DEVNULL)
                return f"Recording started → {path} (PID {self._recorder.pid})"
        return "No recording tool available (install ffmpeg)"

    def _stop_record(self) -> str:
        if self._recorder and self._recorder.poll() is None:
            self._recorder.terminate()
            self._recorder = None
            return "Recording stopped"
        return "No active recording"
