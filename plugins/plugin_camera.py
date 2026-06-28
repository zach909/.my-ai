"""Camera plugin — capture images from webcam using v4l2."""

from __future__ import annotations
import subprocess, shutil, time
from .plugin_base import Plugin


class CameraPlugin(Plugin):
    name = "camera"
    description = "Capture images from webcam (v4l2/fswebcam)."

    def _setup(self) -> None:
        self.tools = {
            "capture": self._capture,
            "list":    self._list_devices,
        }

    def _capture(self, path: str = None, device: str = "/dev/video0") -> str:
        if path is None:
            path = f"/tmp/cam_{int(time.time())}.jpg"
        for tool, args in [
            ("fswebcam",  ["-d", device, "--no-banner", path]),
            ("ffmpeg",    ["-f", "v4l2", "-i", device, "-frames:v", "1", "-y", path]),
            ("v4l2-ctl",  ["--device", device, "--stream-mmap", "--stream-to=" + path]),
        ]:
            if shutil.which(tool):
                r = subprocess.run([tool] + args, capture_output=True, timeout=10)
                if r.returncode == 0:
                    return path
        return "No camera tool available (install fswebcam)"

    def _list_devices(self) -> list:
        import glob
        return sorted(glob.glob("/dev/video*"))
