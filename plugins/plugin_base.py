"""Abstract base class for all plugins.

A plugin bridges the AI to an external service or OS capability.
It exposes a `tools` dict of {tool_name: callable} that the AI can call.
"""

from __future__ import annotations
from typing import Any, Callable, Dict, Optional


class Plugin:
    name: str = "base"
    description: str = "Abstract plugin"

    def __init__(self) -> None:
        self.tools: Dict[str, Callable] = {}
        self._active = False
        self._setup()
        self._active = True

    def _setup(self) -> None:
        """Override to populate self.tools."""

    def call(self, tool: str, *args, **kwargs) -> Any:
        if tool not in self.tools:
            raise KeyError(f"Plugin {self.name!r} has no tool {tool!r}")
        return self.tools[tool](*args, **kwargs)

    def status(self) -> dict:
        return {"name": self.name, "active": self._active, "tools": list(self.tools)}

    def __repr__(self) -> str:
        return f"Plugin({self.name!r}, tools={list(self.tools)})"
