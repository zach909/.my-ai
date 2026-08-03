"""Camera plugin — capture images from webcam using v4l2."""

from __future__ import annotations
import os, subprocess, shutil, time
from .plugin_base import Plugin


class CameraPlugin(Plugin):
    name = "camera"
    description = "Capture images from webcam (v4l2/fswebcam)."

    def _setup(self) -> None:
        self.tools = {
            "capture": self._capture,
            "list":    self._list_devices,
        }

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

    def _safe_device(self, device: str) -> str:
        """Validate and resolve target device paths to prevent path traversal and argument injection.

        Enforces that target device paths remain strictly within the /dev directory.
        """
        if device.strip().startswith("-"):
            raise ValueError("Security Error: Potential argument injection detected in device.")

        target = os.path.realpath(os.path.abspath(os.path.expanduser(device)))

        dev_resolved = os.path.realpath("/dev")

        rel_dev = os.path.relpath(target, dev_resolved)

        is_inside_dev = not rel_dev.startswith("..") and not os.path.isabs(rel_dev)

        if not is_inside_dev:
            raise ValueError("Security Error: Path traversal or unauthorized path detected in device.")

        return target

    def _capture(self, path: str = None, device: str = "/dev/video0") -> str:
        if path is None:
            path = f"/tmp/cam_{int(time.time())}.jpg"
        path = self._safe_path(path)
        device = self._safe_device(device)
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
