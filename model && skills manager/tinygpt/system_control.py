"""System control layer for multi-input / multi-desktop interaction.

⚠️  SANDBOX DISCLAIMER: This module is untestable in headless environments.
It is designed for RTX 5070 deployment with X11/Wayland display and input devices.

Provides:
- Desktop environment detection (X11, Wayland, GNOME, KDE, etc.)
- Multi-input device monitoring (keyboard, mouse, joystick)
- Window management and focus control
- Screenshot/screen recording capabilities

Note: the action-performing classes here (KeyboardMouseControl,
WindowControl, ScreenCapture) call xdotool/wmctrl/scrot/ffmpeg directly via
subprocess -- none of them are gated by the alignment veto (veto.py's
AlignmentVeto) or require confirmation. The only veto-gated, confirmation-
required path to desktop control is the separate, opt-in terminal action
in actions.py (enable_shell_actions()) -- a raw shell command string that
could itself invoke these same tools, not a call into this module.
SystemControlHub has no live caller today beyond its own self-check in
test_core.py's test_system_control().
"""
from __future__ import annotations

import os
import subprocess
import sys
from typing import Optional
from dataclasses import dataclass


@dataclass
class InputEvent:
    """Represents a user input event."""
    device_type: str  # "keyboard", "mouse", "joystick", "touch"
    action: str  # "press", "move", "click", "scroll", etc.
    key_or_button: Optional[str] = None  # "ctrl", "shift", "left", etc.
    position: Optional[tuple[int, int]] = None  # (x, y) for mouse/touch
    value: Optional[float] = None  # analog value for joystick


@dataclass
class ScreenState:
    """Represents the current desktop state."""
    active_window: Optional[str] = None
    focused_app: Optional[str] = None
    screen_dim: Optional[tuple[int, int]] = None  # (width, height)
    displays: list[str] = None  # list of connected displays


class DesktopEnv:
    """Detects and manages the desktop environment."""

    def __init__(self):
        self.env_type = self._detect_env()
        self.display = os.environ.get("DISPLAY", ":0")
        self.wayland_display = os.environ.get("WAYLAND_DISPLAY")
        self.available = self.env_type is not None

    def _detect_env(self) -> Optional[str]:
        """Detect which desktop environment is running."""
        xdg_session = os.environ.get("XDG_SESSION_TYPE", "").lower()
        if xdg_session == "wayland":
            return "wayland"
        if xdg_session == "x11" or os.environ.get("DISPLAY"):
            return "x11"
        # Try to detect by running env detection commands
        try:
            result = subprocess.run(["echo", os.environ.get("XDG_CURRENT_DESKTOP", "")],
                                    capture_output=True, text=True, timeout=1)
            desktop = result.stdout.strip().lower()
            if "gnome" in desktop:
                return "gnome"
            if "kde" in desktop or "plasma" in desktop:
                return "kde"
            if "xfce" in desktop:
                return "xfce"
            if "i3" in desktop or "sway" in desktop:
                return "i3"
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        return None

    def get_screen_state(self) -> ScreenState:
        """Get current desktop state (active window, screen size, etc.)."""
        if not self.available:
            return ScreenState()

        state = ScreenState()
        try:
            # Get active window via wmctrl (works on X11)
            if self.env_type == "x11":
                result = subprocess.run(["wmctrl", "-l"], capture_output=True, text=True, timeout=2)
                lines = result.stdout.strip().split("\n")
                if lines and lines[0]:
                    # Parse wmctrl output to find active window
                    for line in lines:
                        if " -1 " in line:  # -1 means active
                            parts = line.split()
                            if len(parts) >= 4:
                                state.active_window = " ".join(parts[3:])
                                break
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

        try:
            # Get screen dimensions via xdpyinfo (X11) or wlr-randr (Wayland)
            if self.env_type == "x11":
                result = subprocess.run(["xdpyinfo"], capture_output=True, text=True, timeout=2)
                for line in result.stdout.split("\n"):
                    if "dimensions:" in line:
                        # Parse "  dimensions:    1920x1080 pixels"
                        parts = line.split()
                        if len(parts) >= 2:
                            dims = parts[-2].split("x")
                            if len(dims) == 2:
                                state.screen_dim = (int(dims[0]), int(dims[1]))
                                break
        except (subprocess.TimeoutExpired, FileNotFoundError, ValueError):
            pass

        return state


class InputMonitor:
    """Monitor multiple input devices (keyboard, mouse, joystick)."""

    def __init__(self, desktop_env: DesktopEnv):
        self.desktop = desktop_env
        self.devices = []
        self.last_events = []
        self._scan_devices()

    def _scan_devices(self) -> None:
        """Scan /dev/input for available input devices."""
        if not os.path.exists("/dev/input"):
            return
        try:
            for dev in os.listdir("/dev/input"):
                path = f"/dev/input/{dev}"
                if dev.startswith("event"):
                    self.devices.append(path)
        except (OSError, PermissionError):
            # Not accessible or not on Linux
            pass

    def poll_events(self, max_events: int = 10) -> list[InputEvent]:
        """Poll input devices for new events (non-blocking).

        ⚠️  Requires: read permission on /dev/input/event*
        This is untestable in sandbox.
        """
        if not self.devices:
            return []
        events = []
        # Note: full implementation would use evdev library or direct event reading
        # For now, return empty list (sandbox doesn't have input devices)
        return events


class ScreenCapture:
    """Capture and analyze screen contents."""

    def __init__(self, desktop_env: DesktopEnv):
        self.desktop = desktop_env
        self.last_screenshot_path: Optional[str] = None

    def screenshot(self, output_path: str = "/tmp/mesh_screenshot.png") -> Optional[str]:
        """Take a screenshot of the current screen.

        ⚠️  Requires: X11/Wayland display available + screenshot tool (scrot/gnome-screenshot)
        Returns path to saved PNG, or None if failed.
        """
        if not self.desktop.available:
            return None

        try:
            if self.desktop.env_type == "x11":
                # Try scrot first, fall back to gnome-screenshot
                try:
                    subprocess.run(["scrot", output_path], timeout=5, check=True)
                except (FileNotFoundError, subprocess.CalledProcessError):
                    subprocess.run(["gnome-screenshot", "-f", output_path], timeout=5, check=True)
            elif self.desktop.env_type == "wayland":
                subprocess.run(["gnome-screenshot", "-f", output_path], timeout=5, check=True)
            else:
                return None
            self.last_screenshot_path = output_path
            return output_path
        except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.CalledProcessError):
            return None

    def screen_recording_start(self, output_path: str = "/tmp/mesh_recording.mkv") -> bool:
        """Start screen recording (GNOME/X11 only).

        ⚠️  Requires: ffmpeg or simplescreenrecorder installed.
        Returns True if recording started.
        """
        if not self.desktop.available or self.desktop.env_type == "wayland":
            return False
        try:
            # ffmpeg to record X11
            subprocess.Popen(
                ["ffmpeg", "-f", "x11grab", "-i", self.desktop.display,
                 "-pix_fmt", "yuv420p", "-c:v", "libx264", output_path],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            return True
        except FileNotFoundError:
            return False


class WindowControl:
    """Control windows and focus."""

    def __init__(self, desktop_env: DesktopEnv):
        self.desktop = desktop_env

    def list_windows(self) -> list[dict]:
        """List all open windows with metadata."""
        if not self.desktop.available or self.desktop.env_type != "x11":
            return []
        try:
            result = subprocess.run(["wmctrl", "-l"], capture_output=True, text=True, timeout=2)
            windows = []
            for line in result.stdout.strip().split("\n"):
                if not line:
                    continue
                parts = line.split(None, 4)
                if len(parts) >= 5:
                    windows.append({
                        "id": parts[0],
                        "desktop": parts[1],
                        "pid": parts[2],
                        "name": parts[4],
                        "active": "-1" in parts[1]
                    })
            return windows
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return []

    def focus_window(self, window_id: str) -> bool:
        """Focus a specific window by ID."""
        if not self.desktop.available or self.desktop.env_type != "x11":
            return False
        try:
            subprocess.run(["wmctrl", "-i", "-a", window_id], timeout=2, check=True)
            return True
        except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.CalledProcessError):
            return False

    def move_window(self, window_id: str, x: int, y: int) -> bool:
        """Move a window to (x, y)."""
        if not self.desktop.available or self.desktop.env_type != "x11":
            return False
        try:
            subprocess.run(["wmctrl", "-i", "-b", f"add,maximized_vert,maximized_horz", "-r", window_id],
                           timeout=2, check=True)
            return True
        except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.CalledProcessError):
            return False


class KeyboardMouseControl:
    """Simulate keyboard and mouse input."""

    def __init__(self, desktop_env: DesktopEnv):
        self.desktop = desktop_env

    def press_key(self, key: str, duration: float = 0.1) -> bool:
        """Press a key for a duration (uses xdotool).

        ⚠️  Requires: xdotool installed and X11 display.
        """
        if not self.desktop.available or self.desktop.env_type != "x11":
            return False
        try:
            subprocess.run(["xdotool", "key", key], timeout=2, check=True)
            return True
        except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.CalledProcessError):
            return False

    def type_text(self, text: str) -> bool:
        """Type text to the focused window."""
        if not self.desktop.available or self.desktop.env_type != "x11":
            return False
        try:
            subprocess.run(["xdotool", "type", text], timeout=2, check=True)
            return True
        except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.CalledProcessError):
            return False

    def mouse_move(self, x: int, y: int) -> bool:
        """Move mouse to (x, y)."""
        if not self.desktop.available or self.desktop.env_type != "x11":
            return False
        try:
            subprocess.run(["xdotool", "mousemove", str(x), str(y)], timeout=2, check=True)
            return True
        except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.CalledProcessError):
            return False

    def mouse_click(self, button: int = 1) -> bool:
        """Click mouse button (1=left, 2=middle, 3=right)."""
        if not self.desktop.available or self.desktop.env_type != "x11":
            return False
        try:
            subprocess.run(["xdotool", "click", str(button)], timeout=2, check=True)
            return True
        except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.CalledProcessError):
            return False


class SystemControlHub:
    """Central hub for all system control capabilities."""

    def __init__(self, enable_input: bool = False, enable_capture: bool = False):
        """Initialize system control.

        Args:
            enable_input: Enable input monitoring (requires /dev/input access)
            enable_capture: Enable screen capture (requires display + tools)
        """
        self.desktop = DesktopEnv()
        self.screen = ScreenCapture(self.desktop) if enable_capture else None
        self.input_monitor = InputMonitor(self.desktop) if enable_input else None
        self.windows = WindowControl(self.desktop)
        self.keyboard = KeyboardMouseControl(self.desktop)

    def status(self) -> dict:
        """Get system control status and capabilities."""
        return {
            "available": self.desktop.available,
            "environment": self.desktop.env_type,
            "display": self.desktop.display,
            "wayland_display": self.desktop.wayland_display,
            "input_monitoring": self.input_monitor is not None,
            "screen_capture": self.screen is not None,
            "devices": len(self.input_monitor.devices) if self.input_monitor else 0,
        }

    def get_state(self) -> dict:
        """Get current desktop state."""
        state = self.desktop.get_screen_state()
        return {
            "active_window": state.active_window,
            "screen_dim": state.screen_dim,
            "windows": self.windows.list_windows(),
            "input_events": self.input_monitor.poll_events(5) if self.input_monitor else [],
        }
