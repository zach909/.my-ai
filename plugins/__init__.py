"""plugins — all NeuroClaw plugin implementations."""

import importlib, os, pkgutil
from typing import Dict

from .plugin_base import Plugin

_registry: Dict[str, Plugin] = {}


def discover_plugins() -> None:
    """Import every plugin_*.py module in this package and register instances."""
    pkg_dir = os.path.dirname(__file__)
    for finder, modname, ispkg in pkgutil.iter_modules([pkg_dir]):
        if modname.startswith("plugin_") and modname != "plugin_base":
            try:
                mod = importlib.import_module(f".{modname}", package=__name__)
                for attr in dir(mod):
                    obj = getattr(mod, attr)
                    if (isinstance(obj, type) and issubclass(obj, Plugin)
                            and obj is not Plugin):
                        instance = obj()
                        _registry[instance.name] = instance
            except Exception:
                pass


def all_plugins() -> Dict[str, Plugin]:
    if not _registry:
        discover_plugins()
    return dict(_registry)


def get_plugin(name: str) -> Plugin:
    return all_plugins().get(name)


__all__ = ["Plugin", "discover_plugins", "all_plugins", "get_plugin"]
