"""Plugins and skills registry — the single place the design notes' two kinds
of extension are distinguished and connected to the mesh.

  - A **plugin** connects to a *service* (a local capability: the file system,
    diagnostics, a screenshot tool, …). Plugins are local-only connectors:
    there are **no external APIs** here. A plugin declares what local service it
    fronts, whether that service is actually available on this host, and a
    `dispatch()` that runs a real local handler where one exists (file system,
    diagnostics) or returns a clear "unavailable on this host" otherwise — it
    never phones out.
  - A **skill** is a Mixture-of-Experts expert (`tinygpt/experts.py`) that plugs
    straight into the mesh's settle loop. `build_expert_moe()` turns the
    registered skills into a real `ExpertMoE`, and `attach_to_config()` wires
    that onto a `ModelConfig` so the mesh actually routes through them — "skills
    are MoE experts; all integrate naturally into the neural mesh".

The registry enumerates the complete Extensions list from the design notes so
plugins and skills are described in one authoritative place, in the canonical
Python core, instead of only in the TypeScript tree.
"""
from __future__ import annotations

import os
import platform
import shutil
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Optional


class ExtensionType(str, Enum):
    PLUGIN = "plugin"   # connects to a (local) service
    SKILL = "skill"     # a MoE expert integrated into the mesh


@dataclass
class DispatchResult:
    ok: bool
    output: str = ""
    reason: str = ""


# ── plugins: local service connectors (no external APIs) ─────────────────────

class Plugin:
    """A connector to one local service. Subclasses implement `_run`; the base
    handles availability and the no-op fallback so an unavailable service fails
    cleanly instead of erroring."""

    def __init__(self, plugin_id: str, name: str, service: str,
                 capabilities: Optional[List[str]] = None):
        self.id = plugin_id
        self.name = name
        self.service = service
        self.capabilities = capabilities or [plugin_id]

    def available(self) -> bool:
        """Cheap local probe. Base plugins front hardware/OS services we can't
        assume exist in a headless container, so default to unavailable; the
        plugins with a genuine local implementation override this."""
        return False

    def dispatch(self, command: str = "", arg: str = "") -> DispatchResult:
        if not self.available():
            return DispatchResult(
                ok=False,
                reason=f"{self.name}: local service '{self.service}' not available "
                       f"on this host (connector present, no external API used).")
        try:
            return DispatchResult(ok=True, output=self._run(command, arg))
        except Exception as e:  # a plugin fault must never crash the core
            return DispatchResult(ok=False, reason=f"{self.name}: {e}")

    def _run(self, command: str, arg: str) -> str:
        raise NotImplementedError


class FileSystemPlugin(Plugin):
    """Real local file-system access (read-only): list a directory, read a file."""

    def __init__(self):
        super().__init__("file-system", "File System", "os.fs",
                         ["list_dir", "read_file"])

    def available(self) -> bool:
        return True

    def _run(self, command: str, arg: str) -> str:
        cmd = (command or "list_dir").strip()
        target = (arg or ".").strip()
        if cmd == "list_dir":
            entries = sorted(os.listdir(target))
            return "\n".join(entries[:200])
        if cmd == "read_file":
            with open(target, "r", encoding="utf-8", errors="replace") as f:
                return f.read(4096)
        return f"unknown file-system command {cmd!r} (use list_dir|read_file)"


class AppDiagnosticsPlugin(Plugin):
    """Real local diagnostics: platform / CPU / memory summary."""

    def __init__(self):
        super().__init__("app-diagnostics", "App Diagnostics", "os.diagnostics",
                         ["diagnostics"])

    def available(self) -> bool:
        return True

    def _run(self, command: str, arg: str) -> str:
        return (f"system={platform.system()} release={platform.release()} "
                f"machine={platform.machine()} python={platform.python_version()} "
                f"cpus={os.cpu_count()}")


class ScreenshotPlugin(Plugin):
    """Connects to a local screenshot tool if one is installed. Reports the tool
    it would use; capture itself is a side effect left to the gated action layer
    so listing plugins never takes a screenshot."""

    _TOOLS = ("gnome-screenshot", "scrot", "spectacle", "screencapture")

    def __init__(self):
        super().__init__("screenshot", "Screenshot & Screen Recording",
                         "desktop.capture", ["screenshot", "screen-record"])

    def _tool(self) -> Optional[str]:
        for t in self._TOOLS:
            if shutil.which(t):
                return t
        return None

    def available(self) -> bool:
        return self._tool() is not None

    def _run(self, command: str, arg: str) -> str:
        return f"local capture tool available: {self._tool()}"


# Every extension from the design notes, each tagged plugin vs skill. Plugins
# front local services; skills are MoE experts (built lazily via SKILL_FACTORIES).
_PLUGIN_CLASSES: Dict[str, Callable[[], Plugin]] = {
    "file-system": FileSystemPlugin,
    "app-diagnostics": AppDiagnosticsPlugin,
    "screenshot": ScreenshotPlugin,
}

# Service connectors that front hardware/OS services we don't assume in a
# headless host: (id, display name, service). They register as plugins with the
# honest default-unavailable behaviour above.
_SERVICE_PLUGINS: List = [
    ("location", "Location", "os.location"),
    ("camera", "Camera", "hw.camera"),
    ("microphone", "Microphone", "hw.microphone"),
    ("voice-activation", "Voice Activation", "hw.microphone"),
    ("notifications", "Notifications", "os.notifications"),
    ("account-info", "Account Info", "os.accounts"),
    ("contacts", "Contacts", "os.contacts"),
    ("calendar", "Calendar", "os.calendar"),
    ("phone-calls", "Phone Calls", "os.telephony"),
    ("call-history", "Call History", "os.telephony"),
    ("email", "Email", "os.mail"),
    ("tasks", "Tasks", "os.tasks"),
    ("messaging", "Messaging", "os.messaging"),
    ("radio", "Radio", "hw.radio"),
    ("device-connectivity", "Device Connectivity", "os.connectivity"),
    ("passkeys", "Passkeys", "os.keystore"),
    ("browser", "Browser", "os.browser"),
]

# Skills = MoE experts. Each maps to an expert factory (in_dim/out_dim supplied
# by attach_to_config so they match the mesh's input width).
SKILL_IDS = ["coding", "net-search", "plugin-builder", "skill-builder", "self-healing"]
_SKILL_NAMES = {
    "coding": "Coding Skill",
    "net-search": "Net Search Skill",
    "plugin-builder": "Plugin Builder Skill",
    "skill-builder": "Skill Builder Skill",
    "self-healing": "Self-Healing Skill",
}


def _skill_expert(skill_id: str, in_dim: int, out_dim: int):
    """Build the MoE expert that realises a skill (imported lazily so the plugin
    side of the registry works without torch). Each expert is named for its
    skill so usage tracking keeps them distinct even when several share an
    expert class."""
    from .experts import CodeNetExpert, SearchExpert
    if skill_id in ("coding", "plugin-builder", "skill-builder", "self-healing"):
        expert = CodeNetExpert(in_dim=in_dim, out_dim=out_dim)
    else:
        expert = SearchExpert(vocab_dim=in_dim, out_dim=out_dim)
    expert.name = skill_id
    return expert


@dataclass
class Extension:
    id: str
    name: str
    type: ExtensionType
    service: Optional[str] = None          # plugins only
    plugin: Optional[Plugin] = None        # instantiated plugin


class PluginSkillRegistry:
    """One registry that distinguishes plugins from skills and connects skills to
    the mesh MoE."""

    def __init__(self):
        self.extensions: Dict[str, Extension] = {}
        for pid, factory in _PLUGIN_CLASSES.items():
            p = factory()
            self.extensions[pid] = Extension(pid, p.name, ExtensionType.PLUGIN,
                                             p.service, p)
        for pid, name, service in _SERVICE_PLUGINS:
            if pid in self.extensions:
                continue
            p = Plugin(pid, name, service)
            self.extensions[pid] = Extension(pid, name, ExtensionType.PLUGIN, service, p)
        for sid in SKILL_IDS:
            self.extensions[sid] = Extension(sid, _SKILL_NAMES[sid], ExtensionType.SKILL)

    # ---- listing -----------------------------------------------------------
    def plugins(self) -> List[Extension]:
        return [e for e in self.extensions.values() if e.type is ExtensionType.PLUGIN]

    def skills(self) -> List[Extension]:
        return [e for e in self.extensions.values() if e.type is ExtensionType.SKILL]

    def get(self, ext_id: str) -> Optional[Extension]:
        return self.extensions.get(ext_id)

    def register_skill(self, skill_id: str, name: Optional[str] = None) -> Extension:
        """Register a new skill (e.g. the coding extension the AI creates after
        learning to code). Idempotent."""
        ext = Extension(skill_id, name or skill_id.replace("-", " ").title(),
                        ExtensionType.SKILL)
        self.extensions[skill_id] = ext
        return ext

    # ---- plugins: local dispatch ------------------------------------------
    def dispatch(self, plugin_id: str, command: str = "", arg: str = "") -> DispatchResult:
        ext = self.extensions.get(plugin_id)
        if ext is None or ext.type is not ExtensionType.PLUGIN or ext.plugin is None:
            return DispatchResult(ok=False, reason=f"no plugin {plugin_id!r}")
        return ext.plugin.dispatch(command, arg)

    # ---- skills: integrate into the mesh MoE ------------------------------
    def build_expert_moe(self, in_dim: int, out_dim: int = 16, top_k: int = 2):
        """Construct an ExpertMoE from the registered skills so they become real
        mesh experts. Returns None if there are no skills."""
        from .experts import ExpertMoE
        skills = self.skills()
        if not skills:
            return None
        experts = [_skill_expert(s.id, in_dim, out_dim) for s in skills]
        return ExpertMoE(experts, top_k=min(top_k, len(experts)))

    def attach_to_config(self, cfg, out_dim: int = 16, top_k: int = 2):
        """Wire the skills onto a ModelConfig as its expert MoE. The mesh input
        width is n_input * (n_dims - 1) content dims — matched here so the
        experts line up with what the mesh feeds them."""
        in_dim = cfg.mesh_input * (cfg.mesh_dims - 1)
        cfg.expert_moe = self.build_expert_moe(in_dim, out_dim=out_dim, top_k=top_k)
        return cfg.expert_moe

    def summary(self) -> Dict[str, List[str]]:
        return {
            "plugins": [f"{e.name} -> {e.service}"
                        + ("" if e.plugin and e.plugin.available() else " (unavailable)")
                        for e in self.plugins()],
            "skills": [e.name for e in self.skills()],
        }


def default_registry() -> PluginSkillRegistry:
    """The full extension set from the design notes."""
    return PluginSkillRegistry()
