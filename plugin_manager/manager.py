"""PluginManager — loads, registers, and manages all plugins.

Discovers plugins from the plugins/ directory, handles their lifecycle,
and connects them to the AI model's MoE and tool system.
"""

from __future__ import annotations
import os, sys, importlib, pkgutil, json, time
from typing import Dict, List, Optional, Any

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)

from plugins.plugin_base import Plugin


class PluginManager:
    """Central registry for all loaded plugins."""

    def __init__(self) -> None:
        self._plugins: Dict[str, Plugin] = {}
        self._load_log: List[dict] = []

    # ── discovery & loading ───────────────────────────────────────────────────

    def discover(self) -> int:
        """Scan the plugins/ directory and load all plugin_*.py files."""
        plugins_dir = os.path.join(_ROOT, "plugins")
        sys.path.insert(0, plugins_dir)
        count = 0
        for finder, modname, ispkg in pkgutil.iter_modules([plugins_dir]):
            if modname.startswith("plugin_") and modname != "plugin_base":
                try:
                    mod = importlib.import_module(f"plugins.{modname}")
                    for attr in dir(mod):
                        obj = getattr(mod, attr)
                        if (isinstance(obj, type) and issubclass(obj, Plugin)
                                and obj is not Plugin and obj.__module__ == mod.__name__):
                            instance = obj()
                            self.register(instance)
                            count += 1
                            break
                except Exception as e:
                    self._load_log.append({
                        "module": modname, "error": str(e), "ts": time.time()
                    })
        return count

    def register(self, plugin: Plugin) -> None:
        self._plugins[plugin.name] = plugin
        self._load_log.append({"plugin": plugin.name, "event": "registered", "ts": time.time()})

    def unregister(self, name: str) -> None:
        self._plugins.pop(name, None)

    # ── access ────────────────────────────────────────────────────────────────

    def get(self, name: str) -> Optional[Plugin]:
        return self._plugins.get(name)

    def all(self) -> Dict[str, Plugin]:
        return dict(self._plugins)

    def list_names(self) -> List[str]:
        return sorted(self._plugins.keys())

    def call(self, plugin_name: str, tool: str, *args, **kwargs) -> Any:
        plugin = self._plugins.get(plugin_name)
        if not plugin:
            raise KeyError(f"Plugin {plugin_name!r} not loaded")
        return plugin.call(tool, *args, **kwargs)

    # ── model integration ─────────────────────────────────────────────────────

    def inject_into_model(self, model) -> None:
        """Register all plugin tools as callable tools in the model's MoE."""
        for name, plugin in self._plugins.items():
            for tool_name, fn in plugin.tools.items():
                model.moe.register(f"plugin_{name}_{tool_name}", fn)

    def inject_into_thorns(self, thorns) -> None:
        """Give THORNS access to all plugins."""
        thorns.connect_plugins(self._plugins)

    # ── status ────────────────────────────────────────────────────────────────

    def status(self) -> dict:
        return {
            "count": len(self._plugins),
            "plugins": {name: p.status() for name, p in self._plugins.items()},
            "errors": [e for e in self._load_log if "error" in e],
        }

    def save_config(self, path: str) -> None:
        with open(path, "w") as f:
            json.dump({"plugins": self.list_names()}, f, indent=2)
