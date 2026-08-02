"""
Extension System

Implements spec Part 3 sections 25-27 (creation -> testing -> optimization
-> quantization) and Part 6 sections 98-99 (Version Control / Self-Healing
Safety): an extension is a permanent, versioned package of
knowledge/skills/memory the AI can create for itself.

This is the natural next step after UnifiedBrain.self_improve() (Part 3
section 36): self_improve() promotes a single reinforced memory pattern
into a standalone skill; ExtensionSystem bundles related skills together
into one named, versioned, testable unit ("Programming Extension" in the
spec's example), matching section 26's "Self-Created Extensions" process.

update() implements section 99's safety sequence directly: "create
backups, test changes, compare performance, roll back if worse" — every
update() snapshots the current version, applies the change, re-tests, and
automatically reverts if the test fails.
"""

import copy
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional


class ExtensionStage(Enum):
    """Spec Part 3 section 27 (Extension Lifecycle)."""
    CREATED = "created"
    TESTED = "tested"
    OPTIMIZED = "optimized"
    QUANTIZED = "quantized"
    FAILED = "failed"


class ExtensionError(Exception):
    pass


@dataclass
class Extension:
    """
    A permanent package of knowledge/logic/abilities (section 25). Skills
    and memory_trace_ids are references, not copies: the extension is a
    bundle that groups already-registered UnifiedBrain skills and the
    memory patterns that produced them under one name, purpose, and
    permission set.
    """
    name: str
    purpose: str
    skills: List[str] = field(default_factory=list)
    memory_trace_ids: List[int] = field(default_factory=list)
    permissions: List[str] = field(default_factory=list)
    documentation: str = ""
    stage: ExtensionStage = ExtensionStage.CREATED
    test_results: Dict[str, Any] = field(default_factory=dict)
    quantized: bool = False
    version: int = 1

    def to_dict(self) -> Dict[str, Any]:
        """Spec Part 9 section 171 (Backup System)."""
        return {
            "name": self.name,
            "purpose": self.purpose,
            "skills": list(self.skills),
            "memory_trace_ids": list(self.memory_trace_ids),
            "permissions": list(self.permissions),
            "documentation": self.documentation,
            "stage": self.stage.value,
            "test_results": dict(self.test_results),
            "quantized": self.quantized,
            "version": self.version,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Extension":
        return cls(
            name=data["name"],
            purpose=data["purpose"],
            skills=list(data.get("skills", [])),
            memory_trace_ids=list(data.get("memory_trace_ids", [])),
            permissions=list(data.get("permissions", [])),
            documentation=data.get("documentation", ""),
            stage=ExtensionStage(data.get("stage", ExtensionStage.CREATED.value)),
            test_results=dict(data.get("test_results", {})),
            quantized=data.get("quantized", False),
            version=data.get("version", 1),
        )


class ExtensionSystem:
    """Manages the lifecycle of self-created and human-created extensions."""

    def __init__(self):
        self.extensions: Dict[str, Extension] = {}
        self._history: Dict[str, List[Extension]] = {}  # past versions, oldest first

    def create(
        self,
        name: str,
        purpose: str,
        skills: Optional[List[str]] = None,
        memory_trace_ids: Optional[List[int]] = None,
        permissions: Optional[List[str]] = None,
        documentation: str = "",
    ) -> Extension:
        if name in self.extensions:
            raise ExtensionError(f"extension '{name}' already exists")
        ext = Extension(
            name=name,
            purpose=purpose,
            skills=list(dict.fromkeys(skills or [])),
            memory_trace_ids=list(dict.fromkeys(memory_trace_ids or [])),
            permissions=list(permissions or []),
            documentation=documentation,
        )
        self.extensions[name] = ext
        return ext

    def test(self, name: str, test_fn: Optional[Callable[[Extension], bool]] = None) -> bool:
        """
        Run the extension's test. The default test (section 27: "Does it
        work?") just requires the extension to actually bundle at least one
        skill; callers may pass a richer test_fn (e.g. run each bundled
        skill against sample data and check for errors/conflicts).
        """
        ext = self._get(name)
        checker = test_fn or (lambda e: len(e.skills) > 0)
        try:
            passed = bool(checker(ext))
            ext.test_results = {"passed": passed}
        except Exception as exc:
            passed = False
            ext.test_results = {"passed": False, "error": str(exc)}
        ext.stage = ExtensionStage.TESTED if passed else ExtensionStage.FAILED
        return passed

    def optimize(self, name: str) -> Extension:
        """Section 27 (Optimization): remove unnecessary/duplicate parts."""
        ext = self._get(name)
        if ext.stage != ExtensionStage.TESTED:
            raise ExtensionError(f"extension '{name}' must pass testing before optimization")
        ext.skills = list(dict.fromkeys(ext.skills))
        ext.memory_trace_ids = list(dict.fromkeys(ext.memory_trace_ids))
        ext.stage = ExtensionStage.OPTIMIZED
        return ext

    def quantize(self, name: str) -> Extension:
        """
        Section 27 (Quantization): mark the extension as converted into a
        compressed, no-longer-editable-in-place form. The editable
        Extension object itself remains available (the spec: "The original
        editable version can remain stored separately").
        """
        ext = self._get(name)
        if ext.stage != ExtensionStage.OPTIMIZED:
            raise ExtensionError(f"extension '{name}' must be optimized before quantization")
        ext.quantized = True
        ext.stage = ExtensionStage.QUANTIZED
        return ext

    def merge(self, name: str, into: str) -> Extension:
        """Section 27 (Optimization): merge with other extensions."""
        source = self._get(name)
        target = self._get(into)
        target.skills = list(dict.fromkeys(target.skills + source.skills))
        target.memory_trace_ids = list(dict.fromkeys(target.memory_trace_ids + source.memory_trace_ids))
        target.permissions = list(dict.fromkeys(target.permissions + source.permissions))
        del self.extensions[name]
        return target

    def get(self, name: str) -> Optional[Extension]:
        return self.extensions.get(name)

    def list_by_stage(self, stage: ExtensionStage) -> List[Extension]:
        return [e for e in self.extensions.values() if e.stage == stage]

    def remove(self, name: str) -> None:
        self.extensions.pop(name, None)
        self._history.pop(name, None)

    # -- Version control / self-healing safety (spec Part 6 sections 98-99) --

    def update(
        self,
        name: str,
        skills: Optional[List[str]] = None,
        permissions: Optional[List[str]] = None,
        documentation: Optional[str] = None,
        test_fn: Optional[Callable[[Extension], bool]] = None,
    ) -> bool:
        """
        Modify an existing extension's contents, versioned and
        safety-checked (section 99): snapshot the current version, apply
        the change, bump the version, and re-test. If the test fails, the
        extension is rolled back to the pre-update snapshot automatically
        and this returns False; otherwise the change stands and this
        returns True.
        """
        ext = self._get(name)
        self._history.setdefault(name, []).append(copy.deepcopy(ext))

        if skills is not None:
            ext.skills = list(dict.fromkeys(skills))
        if permissions is not None:
            ext.permissions = list(permissions)
        if documentation is not None:
            ext.documentation = documentation
        ext.version += 1
        ext.stage = ExtensionStage.CREATED

        if self.test(name, test_fn):
            return True
        self.rollback(name)
        return False

    def rollback(self, name: str, to_version: Optional[int] = None) -> Extension:
        """
        Restore a previous version (section 98). With no `to_version`,
        undoes the most recent update(). With `to_version`, restores that
        specific version and discards every version recorded after it.
        """
        history = self._history.get(name)
        if not history:
            raise ExtensionError(f"no history to roll back for '{name}'")

        if to_version is None:
            restored = history.pop()
        else:
            matches = [i for i, h in enumerate(history) if h.version == to_version]
            if not matches:
                raise ExtensionError(f"no such version {to_version} for '{name}'")
            idx = matches[-1]
            restored = history[idx]
            self._history[name] = history[:idx]

        self.extensions[name] = restored
        return restored

    def history(self, name: str) -> List[Extension]:
        """Past versions of an extension, oldest first, most recent last."""
        return list(self._history.get(name, []))

    # -- Serialization (spec Part 9 section 171, Backup System) -----------

    def to_dict(self) -> Dict[str, Any]:
        return {
            "extensions": {name: ext.to_dict() for name, ext in self.extensions.items()},
            "history": {
                name: [ext.to_dict() for ext in versions]
                for name, versions in self._history.items()
            },
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExtensionSystem":
        system = cls()
        system.extensions = {
            name: Extension.from_dict(ext_data)
            for name, ext_data in data.get("extensions", {}).items()
        }
        system._history = {
            name: [Extension.from_dict(v) for v in versions]
            for name, versions in data.get("history", {}).items()
        }
        return system

    def _get(self, name: str) -> Extension:
        ext = self.extensions.get(name)
        if ext is None:
            raise ExtensionError(f"no such extension: '{name}'")
        return ext
