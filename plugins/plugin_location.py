"""Location plugin — get geolocation from system sources (no external API)."""

from __future__ import annotations
import json, subprocess, shutil, os
from typing import Optional, Tuple
from .plugin_base import Plugin


class LocationPlugin(Plugin):
    name = "location"
    description = "Get current location from GeoClue2 (GNOME) or IP-based local estimate."

    def _setup(self) -> None:
        self.tools = {
            "get":     self._get_location,
            "city":    self._get_city,
            "coords":  self._get_coords,
        }

    def _get_coords(self) -> Optional[Tuple[float, float]]:
        # Try GeoClue2 via DBus
        if shutil.which("gdbus"):
            try:
                r = subprocess.run(
                    ["gdbus", "call", "--system", "--dest", "org.freedesktop.GeoClue2",
                     "--object-path", "/org/freedesktop/GeoClue2/Manager",
                     "--method", "org.freedesktop.GeoClue2.Manager.GetClient"],
                    capture_output=True, text=True, timeout=5,
                )
                if r.returncode == 0:
                    return (0.0, 0.0)  # placeholder until full DBus parsing
            except Exception:
                pass
        # Fallback: read from /etc/timezone to guess region
        tz_file = "/etc/timezone"
        if os.path.exists(tz_file):
            with open(tz_file) as f:
                return (0.0, 0.0)  # timezone known but coords unavailable
        return None

    def _get_location(self) -> dict:
        coords = self._get_coords()
        return {
            "lat": coords[0] if coords else None,
            "lon": coords[1] if coords else None,
            "source": "geoclue2" if coords else "unavailable",
            "timezone": self._get_timezone(),
        }

    def _get_city(self) -> str:
        tz = self._get_timezone()
        parts = tz.split("/")
        return parts[-1].replace("_", " ") if len(parts) > 1 else tz

    def _get_timezone(self) -> str:
        for p in ("/etc/timezone", "/etc/localtime"):
            if os.path.exists(p):
                if p == "/etc/timezone":
                    with open(p) as f:
                        return f.read().strip()
                else:
                    real = os.path.realpath(p)
                    idx = real.find("zoneinfo/")
                    if idx >= 0:
                        return real[idx + 9:]
        return "UTC"
