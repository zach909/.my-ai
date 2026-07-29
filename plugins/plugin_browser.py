"""Browser plugin — connect to Chrome/Chromium via CDP (Chrome DevTools Protocol).

Opens browser sessions, navigates pages, extracts content.
No external API — communicates directly with local browser over localhost.
"""

from __future__ import annotations
import json, socket, urllib.request, urllib.error
from typing import Any, Dict, List, Optional
from .plugin_base import Plugin


def _cdp_request(port: int, path: str) -> Any:
    url = f"http://localhost:{port}{path}"
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return json.loads(r.read())
    except Exception:
        return None


class BrowserPlugin(Plugin):
    name = "browser"
    description = "Control local Chrome/Chromium browser via Chrome DevTools Protocol."

    def _setup(self) -> None:
        self._port = 9222  # default CDP port
        self.tools = {
            "open":      self._open,
            "navigate":  self._navigate,
            "get_title": self._get_title,
            "get_text":  self._get_text,
            "tabs":      self._list_tabs,
            "screenshot": self._screenshot,
            "is_running": self._is_running,
            "launch":    self._launch,
        }

    def _is_running(self) -> bool:
        data = _cdp_request(self._port, "/json/version")
        return data is not None

    def _launch(self) -> str:
        """Launch Chrome with remote debugging if not already running."""
        import subprocess
        for exe in ("google-chrome", "chromium", "chromium-browser", "chrome"):
            import shutil
            if shutil.which(exe):
                subprocess.Popen(
                    [exe, f"--remote-debugging-port={self._port}",
                     "--no-first-run", "--no-default-browser-check"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                return f"Launched {exe} with CDP on port {self._port}"
        return "Chrome/Chromium not found. Install it for browser plugin support."

    def _list_tabs(self) -> List[Dict]:
        data = _cdp_request(self._port, "/json")
        if not data:
            return []
        return [{"id": t.get("id"), "title": t.get("title"), "url": t.get("url")}
                for t in data if t.get("type") == "page"]

    def _open(self, url: str) -> str:
        """Open a URL in a new Chrome app (no external API — uses local browser)."""
        import subprocess, shutil, os
        from urllib.parse import urlparse

        # Security Check: Prevent argument/flag injection
        if url.strip().startswith("-"):
            raise ValueError("Security Error: Invalid URL (potential argument injection).")

        # Security Check: Restrict protocol schemes and check path traversal for file scheme or local paths
        parsed = urlparse(url)
        scheme = parsed.scheme.lower() if parsed.scheme else ""
        if scheme and scheme not in ("http", "https", "ftp", "file"):
            raise ValueError("Security Error: Forbidden protocol scheme.")

        if scheme == "file" or not scheme:
            path_part = parsed.path
            if parsed.netloc and parsed.netloc.lower() != "localhost":
                path_part = parsed.netloc + path_part

            is_potential_local_path = (
                scheme == "file" or
                path_part.startswith("/") or
                path_part.startswith(".") or
                path_part.startswith("~") or
                ".." in path_part
            )
            if is_potential_local_path:
                target_path = os.path.realpath(os.path.abspath(os.path.expanduser(path_part)))
                cwd = os.path.realpath(os.getcwd())
                rel = os.path.relpath(target_path, cwd)
                if rel.startswith("..") or os.path.isabs(rel):
                    raise ValueError("Security Error: Path traversal detected in file or local path.")

        for exe in ("google-chrome", "chromium", "chromium-browser", "xdg-open"):
            if shutil.which(exe):
                subprocess.Popen([exe, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return f"Opened {url}"
        return f"No browser found to open {url}"

    def _navigate(self, url: str, tab_id: str = None) -> str:
        tabs = self._list_tabs()
        if not tabs:
            return self._open(url)
        # Use first tab if none specified
        tab = next((t for t in tabs if t["id"] == tab_id), tabs[0])
        # Use CDP WebSocket to navigate (simplified: just open)
        return self._open(url)

    def _get_title(self) -> List[str]:
        return [t["title"] for t in self._list_tabs()]

    def _get_text(self) -> str:
        return "Browser text extraction requires CDP WebSocket connection."

    def _safe_path(self, path: str) -> str:
        """Validate and resolve target paths to prevent path traversal and argument injection.

        Enforces that target paths remain either within the current working directory or /tmp directory.
        """
        import os

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

    def _screenshot(self, path: str = "/tmp/screenshot.png") -> str:
        """Take a screenshot using scrot or import (no browser needed)."""
        import subprocess, shutil
        path = self._safe_path(path)
        for tool in ("scrot", "import", "gnome-screenshot"):
            if shutil.which(tool):
                subprocess.run([tool, path], capture_output=True)
                return path
        return "No screenshot tool found (install scrot)"
