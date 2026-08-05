"""GNOME multi-desktop plugin — manage virtual desktops and input routing.

The AI gets its own dedicated GNOME workspace with virtual input devices
(pointer + keyboard) so it never steals the user's cursor or keyboard focus.

Multi-input isolation works on three tiers:
  1. GNOME Shell extension (Wayland-native, uses Clutter.Seat API)
  2. xinput virtual masters (X11, creates separate pointer/keyboard pairs)
  3. Simulated mode (no isolation, AI gets its own workspace but shares input)

The plugin auto-detects which methods are available and chains fallbacks.
"""

from __future__ import annotations
import subprocess, shutil, os, json, time, re
from typing import Any, Dict, List, Optional, Tuple
from .plugin_terminal import _is_blocked


def _run(cmd: list, timeout: int = 5) -> Optional[str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def _safe_workspace(workspace: Any) -> int:
    try:
        if isinstance(workspace, bool):
            raise ValueError()
        val = int(workspace)
        if val < 0 or val > 1000:
            raise ValueError()
        return val
    except (TypeError, ValueError):
        raise ValueError("Security Error: Invalid workspace index.")


def _safe_window_id(window_id: str) -> str:
    if not isinstance(window_id, str):
        raise ValueError("Security Error: window_id must be a string.")
    if not window_id:
        raise ValueError("Security Error: window_id cannot be empty.")
    if window_id.startswith("-"):
        raise ValueError("Security Error: Potential argument injection detected in window_id.")
    if not re.match(r"^[a-zA-Z0-9_xX][a-zA-Z0-9_xX-]*$", window_id):
    if not re.match(r"^(0x)?[a-fA-F0-9_]+$", window_id) and not re.match(r"^\d+$", window_id) and not re.match(r"^[a-zA-Z0-9_xX][a-zA-Z0-9_xX-]*$", window_id):
        raise ValueError("Security Error: Invalid window_id format.")
    return window_id


def _safe_workspace_name(name: str) -> str:
    if not isinstance(name, str):
        raise ValueError("Security Error: workspace name must be a string.")
    if len(name) > 100:
        raise ValueError("Security Error: workspace name is too long.")
    if name.startswith("-"):
        raise ValueError("Security Error: Potential argument injection in workspace name.")
    if any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise ValueError("Security Error: workspace name contains invalid characters.")
    return name


def _gdbus(method: str, *args) -> Optional[str]:
    if not shutil.which("gdbus"):
        return None
    cmd = [
        "gdbus", "call", "--session",
        "--dest", "org.gnome.Shell",
        "--object-path", "/org/gnome/Shell",
        "--method", f"org.gnome.Shell.{method}",
    ] + list(str(a) for a in args)
    return _run(cmd)


def _gdbus_eval(js: str) -> Optional[str]:
    """Evaluate JS in GNOME Shell via Eval."""
    return _gdbus("Eval", js)


def _has_extension() -> bool:
    """Check if the MultiInput GNOME Shell extension is installed and enabled."""
    r = _run(["gnome-extensions", "show", "multi-input@neuroclaw.local"], timeout=3)
    return r is not None and "ENABLED" in r.upper() if r else False


def _xinput_available() -> bool:
    return shutil.which("xinput") is not None


def _get_xinput_devices() -> List[dict]:
    """Enumerate xinput devices with their master/slave status.

    Floating (unmastered) devices are listed by `xinput list --long` after
    all master/slave trees, tagged "floating slave" -- since that text still
    contains the substring "slave", a plain `"slave" in line` check used to
    misattribute every floating device as a slave of whichever master was
    last seen (in practice, always the keyboard master, since xinput lists
    it after the pointer master). A floating device isn't a slave of
    anything by definition, so it's tracked here as its own top-level
    pseudo-master entry (`type: "floating"`, no slaves) instead of being
    nested under the wrong master.
    """
    if not _xinput_available():
        return []
    r = _run(["xinput", "list", "--long"], timeout=3)
    if not r:
        return []
    devices = []
    current_master = None
    for line in r.split("\n"):
        if "floating" in line.lower() and "slave" in line.lower():
            m = re.search(r"id=(\d+)", line)
            if m:
                devices.append({"id": int(m.group(1)), "type": "floating", "name": line.strip(), "slaves": []})
        elif "master" in line.lower() and "pointer" in line.lower():
            m = re.search(r"id=(\d+)", line)
            if m:
                current_master = {"id": int(m.group(1)), "type": "pointer", "name": line.strip(), "slaves": []}
                devices.append(current_master)
        elif "master" in line.lower() and "keyboard" in line.lower():
            m = re.search(r"id=(\d+)", line)
            if m:
                current_master = {"id": int(m.group(1)), "type": "keyboard", "name": line.strip(), "slaves": []}
                devices.append(current_master)
        elif "slave" in line.lower() and current_master:
            m = re.search(r"id=(\d+)", line)
            if m:
                current_master["slaves"].append({"id": int(m.group(1)), "name": line.strip()})
    return devices


class GnomePlugin:
    """GNOME workspace management for AI multi-desktop isolation.

    The AI gets:
      - Its own dedicated workspace (created at index n)
      - Virtual pointer + keyboard on its workspace
      - Physical device isolation so the user's input is never stolen

    Usage:
      plugin = GnomePlugin()
      plugin.init_ai_workspace()
      plugin.create_virtual_input_devices()
      plugin.focus_ai()
      # AI does its work...
      plugin.focus_user()
    """

    name = "gnome_desktop"
    description = "GNOME workspace management for AI multi-desktop isolation."

    def __init__(self) -> None:
        self.tools: Dict[str, callable] = {}
        self._ai_ws: int = -1
        self._user_ws: int = 0
        self._virtual_pointer_id: Optional[int] = None
        self._virtual_keyboard_id: Optional[int] = None
        self._floated_devices: List[dict] = []
        self._setup()

    def _setup(self) -> None:
        self.tools = {
            "list_workspaces":          self._list_workspaces,
            "switch_workspace":         self._switch_workspace,
            "current_workspace":        self._current_workspace,
            "add_workspace":            self._add_workspace,
            "remove_workspace":         self._remove_workspace,
            "move_window":              self._move_window,
            "launch_on_desktop":        self._launch_on_desktop,
            "focus_user":               self._focus_user,
            "focus_ai":                 self._focus_ai,
            "init_ai_workspace":        self._init_ai_workspace,
            "create_virtual_devices":   self._create_virtual_devices,
            "destroy_virtual_devices":  self._destroy_virtual_devices,
            "isolate_input":            self._isolate_input,
            "restore_input":            self._restore_input,
            "list_physical_devices":    self._list_physical_devices,
            "status":                   self._status,
            "ai_workspace_idx":         lambda: self._ai_ws,
        }
        self._active = True

    def call(self, tool: str, *args, **kwargs):
        if tool not in self.tools:
            raise KeyError(f"Plugin {self.name!r} has no tool {tool!r}")
        return self.tools[tool](*args, **kwargs)

    def status(self):
        return {
            "name": self.name,
            "active": self._active,
            "tools": list(self.tools),
            "ai_workspace": self._ai_ws,
            "virtual_pointer": self._virtual_pointer_id is not None,
            "virtual_keyboard": self._virtual_keyboard_id is not None,
            "extension_installed": _has_extension(),
            "xinput_available": _xinput_available(),
        }

    # ─── Workspace Management ───────────────────────────────────────────

    def _num_workspaces(self) -> int:
        r = _run(["gsettings", "get", "org.gnome.desktop.wm.preferences", "num-workspaces"])
        return int(r) if r else 1

    def _set_num_workspaces(self, n: int) -> None:
        if shutil.which("gsettings"):
            subprocess.run(
                ["gsettings", "set", "org.gnome.desktop.wm.preferences", "num-workspaces", str(n)],
                capture_output=True, timeout=5,
            )

    def _workspace_names(self) -> List[str]:
        r = _run(["gsettings", "get", "org.gnome.desktop.wm.preferences", "workspace-names"])
        if not r:
            return []
        # gsettings returns "@as []" or "['a', 'b']"
        cleaned = r.strip()
        if cleaned.startswith("@as "):
            cleaned = cleaned[4:]
        try:
            return json.loads(cleaned) if cleaned and cleaned != "[]" else []
        except (json.JSONDecodeError, ValueError):
            return []

    def _set_workspace_names(self, names: List[str]) -> None:
        if shutil.which("gsettings"):
            subprocess.run(
                ["gsettings", "set", "org.gnome.desktop.wm.preferences", "workspace-names",
                 json.dumps(names)],
                capture_output=True, timeout=5,
            )

    def _list_workspaces(self) -> List[dict]:
        n = self._num_workspaces()
        names = self._workspace_names()
        return [
            {"index": i, "name": names[i] if i < len(names) else f"Desktop {i+1}", "is_ai": i == self._ai_ws}
            for i in range(n)
        ]

    def _current_workspace(self) -> int:
        # Try GNOME Shell JS eval
        r = _gdbus_eval("global.workspace_manager.get_active_workspace().index()")
        if r:
            m = re.search(r"\d+", r)
            if m:
                return int(m.group(0))
        # Fallback: wmctrl
        if shutil.which("wmctrl"):
            r = _run(["wmctrl", "-d"])
            if r:
                for line in r.split("\n"):
                    if " * " in line:
                        return int(line.split()[0])
        return 0

    def _validate_workspace_index(self, index: int) -> int:
        try:
            if isinstance(index, bool):
                raise ValueError()
            val = int(index)
        except (ValueError, TypeError):
            raise ValueError("Security Error: workspace index must be an integer.")
        if val < 0 or val > 1000:
            raise ValueError("Security Error: workspace index must be a non-negative integer within range.")
        return val

    def _validate_window_id(self, window_id: str) -> str:
        if not isinstance(window_id, str):
            raise ValueError("Security Error: window_id must be a string.")
        cleaned = window_id.strip()
        if cleaned.startswith("-"):
            raise ValueError("Security Error: Potential argument injection detected in window_id.")
        if not re.match(r"^[a-zA-Z0-9_xX][a-zA-Z0-9_xX-]*$", cleaned):
            raise ValueError("Security Error: Invalid characters in window_id.")
        return cleaned

    def _switch_workspace(self, index: int) -> str:
        index = self._validate_workspace_index(index)
        index = _safe_workspace(index)
        try:
            index = self._validate_workspace_index(index)
            index = _safe_workspace(index)
        except ValueError as e:
            raise ValueError(f"Security Error: Invalid workspace index: {e}") from e

        # Method 1: GNOME Shell JS eval (fastest)
        r = _gdbus_eval(f"global.workspace_manager.get_workspace_by_index({index}).activate(global.get_current_time())")
        if r:
            return f"Switched to workspace {index}"
        # Method 2: wmctrl
        if shutil.which("wmctrl"):
            _run(["wmctrl", "-s", str(index)])
            return f"Switched to workspace {index}"
        # Method 3: xdotool
        if shutil.which("xdotool"):
            _run(["xdotool", "set_desktop", str(index)])
            return f"Switched to workspace {index} (xdotool)"
        return "ERROR: No method available to switch workspace"

    def _add_workspace(self, name: Optional[str] = None) -> int:
        if name:
            name = _safe_workspace_name(name)
        n = self._num_workspaces()
        self._set_num_workspaces(n + 1)
        if name:
            names = self._workspace_names()
            while len(names) < n + 1:
                names.append(f"Desktop {len(names) + 1}")
            names[n] = name
            self._set_workspace_names(names)
        return n

    def _remove_workspace(self, index: int) -> str:
        index = self._validate_workspace_index(index)
        index = _safe_workspace(index)
        try:
            index = self._validate_workspace_index(index)
            index = _safe_workspace(index)
        except ValueError as e:
            raise ValueError(f"Security Error: Invalid workspace index: {e}") from e

        n = self._num_workspaces()
        if n <= 1:
            return "ERROR: Cannot remove last workspace"
        if index >= n:
            return f"ERROR: Workspace {index} does not exist"
        if index == self._ai_ws:
            self._destroy_virtual_devices()
            self._ai_ws = -1
        # Switch away if we're on the removed workspace
        if self._current_workspace() == index:
            self._switch_workspace(0)
        self._set_num_workspaces(n - 1)
        return f"Removed workspace {index}"

    def _move_window(self, window_id: str, workspace: int) -> str:
        window_id = self._validate_window_id(window_id)
        workspace = self._validate_workspace_index(workspace)
        window_id = _safe_window_id(window_id)
        workspace = _safe_workspace(workspace)
        if shutil.which("wmctrl"):
            _run(["wmctrl", "-ir", window_id, "-t", str(workspace)])
            return f"Moved window {window_id} to workspace {workspace}"
        try:
            window_id = self._validate_window_id(window_id)
            window_id = _safe_window_id(window_id)
        except ValueError as e:
            raise ValueError(f"Security Error: Invalid window ID format: {e}") from e

        try:
            workspace = self._validate_workspace_index(workspace)
            workspace = _safe_workspace(workspace)
        except ValueError as e:
            raise ValueError(f"Security Error: Invalid workspace index: {e}") from e

        window_id_str = str(window_id)
        if shutil.which("wmctrl"):
            _run(["wmctrl", "-ir", window_id_str, "-t", str(workspace)])
            return f"Moved window {window_id_str} to workspace {workspace}"
        return "wmctrl required"

    def _launch_on_desktop(self, cmd: str, workspace: int = None) -> str:
        if _is_blocked(cmd):
            return "Blocked: destructive command pattern detected"
        if workspace is not None:
            workspace = self._validate_workspace_index(workspace)
            workspace = _safe_workspace(workspace)
        if workspace is None:
            try:
                workspace = self._validate_workspace_index(workspace)
                workspace = _safe_workspace(workspace)
            except ValueError as e:
                raise ValueError(f"Security Error: Invalid workspace index: {e}") from e
        else:
            workspace = self._ai_ws if self._ai_ws >= 0 else self._add_workspace()
            if self._ai_ws < 0:
                self._ai_ws = workspace
        cur = self._current_workspace()
        self._switch_workspace(workspace)
        subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.5)
        self._switch_workspace(cur)
        return f"Launched '{cmd}' on workspace {workspace}"

    def _focus_user(self) -> str:
        return self._switch_workspace(self._user_ws)

    def _focus_ai(self) -> str:
        if self._ai_ws < 0:
            self._init_ai_workspace()
        return self._switch_workspace(self._ai_ws)

    # ─── AI Workspace Initialization ──────────────────────────────────────

    def _init_ai_workspace(self) -> int:
        """Create or find the AI's dedicated workspace."""
        if self._ai_ws >= 0:
            return self._ai_ws
        # First try the GNOME Shell extension
        if _has_extension():
            r = _run([
                "gdbus", "call", "--session",
                "--dest", "org.gnome.Shell",
                "--object-path", "/org/gnome/Shell/Extensions/MultiInput",
                "--method", "org.gnome.Shell.Extensions.MultiInput.EnsureAiWorkspace",
            ], timeout=5)
            if r:
                m = re.search(r"\d+", r)
                if m:
                    self._ai_ws = int(m.group(0))
                    return self._ai_ws
        # Fallback: manual workspace creation
        n = self._num_workspaces()
        self._set_num_workspaces(n + 1)
        names = self._workspace_names()
        while len(names) < n + 1:
            names.append(f"Desktop {len(names) + 1}")
        names[n] = "AI Desktop"
        self._set_workspace_names(names)
        self._ai_ws = n
        return n

    # ─── Virtual Input Devices ───────────────────────────────────────────

    def _create_virtual_devices(self) -> dict:
        """Create virtual pointer + keyboard for the AI workspace."""
        if self._ai_ws < 0:
            self._init_ai_workspace()

        # Method 1: GNOME Shell extension virtual devices
        if _has_extension():
            ptr_r = _run([
                "gdbus", "call", "--session",
                "--dest", "org.gnome.Shell",
                "--object-path", "/org/gnome/Shell/Extensions/MultiInput",
                "--method", "org.gnome.Shell.Extensions.MultiInput.CreateVirtualPointer",
            ], timeout=5)
            kbd_r = _run([
                "gdbus", "call", "--session",
                "--dest", "org.gnome.Shell",
                "--object-path", "/org/gnome/Shell/Extensions/MultiInput",
                "--method", "org.gnome.Shell.Extensions.MultiInput.CreateVirtualKeyboard",
            ], timeout=5)
            ptr_id = int(re.search(r"\d+", ptr_r).group(0)) if ptr_r else 0
            kbd_id = int(re.search(r"\d+", kbd_r).group(0)) if kbd_r else 0
            self._virtual_pointer_id = ptr_id
            self._virtual_keyboard_id = kbd_id
            return {
                "pointer": self._virtual_pointer_id,
                "keyboard": self._virtual_keyboard_id,
                "method": "gnome-extension",
            }

        # Method 2: xinput virtual masters
        if _xinput_available():
            self._virtual_pointer_id = self._create_xinput_master("AI Virtual Pointer")
            self._virtual_keyboard_id = self._create_xinput_master("AI Virtual Keyboard")
            return {
                "pointer": self._virtual_pointer_id,
                "keyboard": self._virtual_keyboard_id,
                "method": "xinput",
            }

        # Method 3: No isolation available, but we still have a workspace
        return {
            "pointer": None,
            "keyboard": None,
            "method": "none",
            "note": "No virtual device method available. AI will share user's input.",
        }

    def _create_xinput_master(self, name: str) -> Optional[int]:
        """Create an xinput master device (pointer/keyboard pair)."""
        r = _run(["xinput", "create-master", name], timeout=5)
        if r is None:
            return None
        # Find the newly created master by name
        devices = _get_xinput_devices()
        for d in devices:
            if name in d["name"]:
                return d["id"]
        return None

    def _destroy_virtual_devices(self) -> dict:
        """Destroy all virtual input devices."""
        results = []

        # Method 1: GNOME Shell extension
        if _has_extension():
            r = _run([
                "gdbus", "call", "--session",
                "--dest", "org.gnome.Shell",
                "--object-path", "/org/gnome/Shell/Extensions/MultiInput",
                "--method", "org.gnome.Shell.Extensions.MultiInput.DestroyVirtualDevices",
            ], timeout=5)
            results.append("gnome-extension")

        # Method 2: xinput
        if _xinput_available():
            if self._virtual_pointer_id:
                _run(["xinput", "remove-master", str(self._virtual_pointer_id)], timeout=3)
                results.append("xinput-pointer")
            if self._virtual_keyboard_id:
                _run(["xinput", "remove-master", str(self._virtual_keyboard_id)], timeout=3)
                results.append("xinput-keyboard")

        self._virtual_pointer_id = None
        self._virtual_keyboard_id = None
        return {"destroyed": results}

    # ─── Input Isolation ────────────────────────────────────────────────

    def _isolate_input(self) -> dict:
        """Isolate physical input devices to the user's workspace.

        On X11, this floats all physical slave devices from the virtual core
        and attaches them to a new master that only operates on the user's
        workspace.

        On Wayland with the GNOME extension, this is handled automatically
        by Mutter's focus-per-workspace model.

        Returns:
            dict with 'isolated' bool, 'method' str, 'devices' list
        """
        if not _xinput_available():
            return {"isolated": False, "method": "none",
                    "note": "xinput not available for device isolation"}

        devices = _get_xinput_devices()
        floated = []

        for master in devices:
            if master["type"] == "floating":
                continue
            for slave in master.get("slaves", []):
                # Skip XTEST and virtual-core-synthesized pseudo-devices
                # (e.g. "Virtual core XTEST pointer") -- both substrings
                # describe the *slave's own name*, not the master it's
                # currently attached to. Checking master["name"] here would
                # match every default master ("Virtual core pointer"/
                # "Virtual core keyboard"), skipping every real physical
                # device attached to them -- the overwhelmingly common case
                # before any dedicated AI master has been created.
                if "XTEST" in slave["name"] or "Virtual core" in slave["name"]:
                    continue
                # Float the slave device from its current master
                _run(["xinput", "float", str(slave["id"])], timeout=3)
                floated.append(slave["name"])
                # Record the device's type *now*, while it's still attached
                # and its type is unambiguous -- once floating, xinput's own
                # listing no longer distinguishes pointer from keyboard, so
                # this is the only reliable point to capture it for restore.
                self._floated_devices.append({"id": slave["id"], "name": slave["name"], "type": master["type"]})

        if floated:
            return {"isolated": True, "method": "xinput", "floated": floated}
        return {"isolated": True, "method": "xinput", "note": "No slave devices to float"}

    def _restore_input(self) -> dict:
        """Restore physical input devices to the user.

        Reattaches devices this instance floated via `_isolate_input()` back
        to the matching-type virtual core master, using the type recorded at
        float time. Only devices this instance actually floated are
        restored -- `xinput`'s "floating slave" listing doesn't retain
        whether a floating device was originally a pointer or keyboard, so
        re-deriving type from a fresh query at restore time is unreliable
        (it previously matched every floating device against whichever
        master happened to be last in the device list, silently reattaching
        e.g. a floated mouse to the keyboard master).
        """
        if not _xinput_available():
            return {"restored": False, "method": "none"}

        if not self._floated_devices:
            return {"restored": False, "method": "xinput", "note": "No devices were floated by this session"}

        devices = _get_xinput_devices()
        restored = []
        for floated in self._floated_devices:
            target_master = next(
                (m["id"] for m in devices if m["type"] == floated["type"] and "Virtual core" in m["name"]),
                None,
            )
            if target_master:
                _run(["xinput", "reattach", str(floated["id"]), str(target_master)], timeout=3)
                restored.append(floated["name"])

        self._floated_devices = []
        if restored:
            return {"restored": True, "method": "xinput", "devices": restored}
        return {"restored": False, "method": "xinput", "note": "No matching virtual core master found"}

    def _list_physical_devices(self) -> List[dict]:
        """List all physical input devices detected by the system."""
        devices = []

        # From xinput
        if _xinput_available():
            xdevs = _get_xinput_devices()
            for master in xdevs:
                if master["type"] == "floating":
                    devices.append({
                        "id": master["id"],
                        "name": master["name"],
                        "type": "floating",
                        "master": None,
                    })
                    continue
                for slave in master.get("slaves", []):
                    devices.append({
                        "id": slave["id"],
                        "name": slave["name"],
                        "type": master["type"],
                        "master": master["name"],
                    })

        # Also try to list input devices via /proc/bus/input/devices
        try:
            with open("/proc/bus/input/devices") as f:
                for line in f:
                    if "N: Name=" in line:
                        name = line.split("=", 1)[1].strip().strip('"')
                        if name and not any(d["name"] == name for d in devices):
                            devices.append({
                                "id": len(devices),
                                "name": name,
                                "type": "unknown",
                                "source": "procfs",
                            })
        except (FileNotFoundError, PermissionError):
            pass

        return devices

    def _status(self) -> dict:
        """Return full status of the multi-desktop system."""
        return {
            "ai_workspace": self._ai_ws,
            "current_workspace": self._current_workspace(),
            "num_workspaces": self._num_workspaces(),
            "workspaces": self._list_workspaces(),
            "has_virtual_pointer": self._virtual_pointer_id is not None,
            "has_virtual_keyboard": self._virtual_keyboard_id is not None,
            "extension_installed": _has_extension(),
            "xinput_available": _xinput_available(),
            "physical_devices": self._list_physical_devices(),
        }

    def __repr__(self) -> str:
        return f"GnomePlugin(ai_ws={self._ai_ws}, tools={list(self.tools)})"

    def __del__(self):
        try:
            if self._virtual_pointer_id or self._virtual_keyboard_id:
                self._destroy_virtual_devices()
        except Exception:
            pass
