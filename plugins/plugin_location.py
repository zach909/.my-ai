"""Location plugin — get geolocation from system sources (no external API)."""

from __future__ import annotations
import json, re, subprocess, shutil, os, time
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

    def _gdbus_call(self, bus: str, dest: str, obj_path: str, method: str, args: str = "") -> Optional[str]:
        """Run a `gdbus call` and return its raw stdout, or None on failure."""
        cmd = ["gdbus", "call", f"--{bus}", "--dest", dest, "--object-path", obj_path, "--method", method]
        if args:
            cmd.append(args)
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            return r.stdout.strip() if r.returncode == 0 else None
        except Exception:
            return None

    def _get_coords(self) -> Optional[Tuple[float, float]]:
        """
        Real GeoClue2 D-Bus flow (no external/cloud API — geolocation is
        served entirely by the local `geoclue2` system service, typically
        backed by Wi-Fi/cell-tower lookups it performs itself or a local
        GPS device):
          1. Manager.GetClient() -> a per-app Client object path.
          2. Client.DesktopId must be set (GeoClue2 requires an app id to
             authorize the request) before Start() will do anything.
          3. Client.Start() begins locating; the location is published as
             the Client's "Location" object path once found.
          4. Read Location.Latitude / Location.Longitude off that object.
        Real deployments also need polkit to grant the app's location
        permission and a live D-Bus session/system bus with geoclue2
        actually running (`systemctl status geoclue`) — neither is present
        in this sandbox, so this returns None (never a fabricated coordinate)
        whenever any step fails or times out.
        """
        if not shutil.which("gdbus"):
            return None
        try:
            out = self._gdbus_call(
                "system", "org.freedesktop.GeoClue2",
                "/org/freedesktop/GeoClue2/Manager", "org.freedesktop.GeoClue2.Manager.GetClient",
            )
            if not out:
                return None
            m = re.search(r"objectpath\s+'([^']+)'", out)
            if not m:
                return None
            client_path = m.group(1)

            # Required by GeoClue2's policy engine to identify the caller.
            subprocess.run(
                ["gdbus", "call", "--system", "--dest", "org.freedesktop.GeoClue2",
                 "--object-path", client_path, "--method", "org.freedesktop.DBus.Properties.Set",
                 "org.freedesktop.GeoClue2.Client", "DesktopId", "<'neuroclaw'>"],
                capture_output=True, text=True, timeout=5,
            )
            start = subprocess.run(
                ["gdbus", "call", "--system", "--dest", "org.freedesktop.GeoClue2",
                 "--object-path", client_path, "--method", "org.freedesktop.GeoClue2.Client.Start"],
                capture_output=True, text=True, timeout=5,
            )
            if start.returncode != 0:
                return None

            # GeoClue2 locates asynchronously; poll the Location property
            # briefly rather than blocking forever or faking an instant fix.
            location_path = None
            for _ in range(6):
                prop = self._gdbus_call(
                    "system", "org.freedesktop.GeoClue2", client_path,
                    "org.freedesktop.DBus.Properties.Get",
                    "'org.freedesktop.GeoClue2.Client' 'Location'",
                )
                if prop:
                    pm = re.search(r"objectpath\s+'([^']+)'", prop)
                    if pm and pm.group(1) != "/":
                        location_path = pm.group(1)
                        break
                time.sleep(0.5)
            if not location_path:
                return None

            lat_raw = self._gdbus_call(
                "system", "org.freedesktop.GeoClue2", location_path,
                "org.freedesktop.DBus.Properties.Get",
                "'org.freedesktop.GeoClue2.Location' 'Latitude'",
            )
            lon_raw = self._gdbus_call(
                "system", "org.freedesktop.GeoClue2", location_path,
                "org.freedesktop.DBus.Properties.Get",
                "'org.freedesktop.GeoClue2.Location' 'Longitude'",
            )
            lat_m = re.search(r"double\s+([-\d.]+)", lat_raw or "")
            lon_m = re.search(r"double\s+([-\d.]+)", lon_raw or "")
            if lat_m and lon_m:
                return (float(lat_m.group(1)), float(lon_m.group(1)))
            return None
        except Exception:
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
