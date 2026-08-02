"""
Extension System

Implements spec Part 3 sections 25-27: an extension is a permanent package
of knowledge/skills/memory the AI can create for itself, with a defined
lifecycle (creation -> testing -> optimization -> quantization).

This is the natural next step after UnifiedBrain.self_improve() (Part 3
section 36): self_improve() promotes a single reinforced memory pattern
into a standalone skill; ExtensionSystem bundles related skills together
into one named, versioned, testable unit ("Programming Extension" in the
spec's example), matching section 26's "Self-Created Extensions" process.
"""

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


class ExtensionSystem:
    """Manages the lifecycle of self-created and human-created extensions."""

    def __init__(self):
        self.extensions: Dict[str, Extension] = {}

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

    def _get(self, name: str) -> Extension:
        ext = self.extensions.get(name)
        if ext is None:
            raise ExtensionError(f"no such extension: '{name}'")
        return ext
