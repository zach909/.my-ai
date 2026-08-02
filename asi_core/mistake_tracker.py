"""
Mistake Tracking / Self-Correction

Implements spec Part 7 sections 111-112. MemoryKind.EXPERIENCE traces
(Part 3 section 22) already capture "a confidently bad outcome happened,
here is roughly what the state looked like" as a hypervector. That's not
what section 112 asks for: a structured record of *why* it happened,
*which systems contributed*, and *whether the correction worked* — plus
tracking repetition, since "repeated mistakes lower the value of the
responsible patterns" is a distinct signal from a single bad outcome.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class MistakeRecord:
    what: str
    why: str
    contributing_systems: List[str] = field(default_factory=list)
    correction: Optional[str] = None
    correction_worked: Optional[bool] = None
    occurrences: int = 1


class MistakeTracker:
    """
    Maintains a mistake history keyed by a caller-supplied signature (e.g.
    a bucketed description of the situation that produced the mistake),
    so repeated mistakes accumulate onto one record — tracking occurrence
    count — instead of growing an unbounded list of near-duplicates.
    """

    def __init__(self):
        self.records: Dict[str, MistakeRecord] = {}

    def record(
        self,
        signature: str,
        what: str,
        why: str,
        contributing_systems: Optional[List[str]] = None,
    ) -> MistakeRecord:
        existing = self.records.get(signature)
        if existing is not None:
            existing.occurrences += 1
            existing.what = what
            existing.why = why
            if contributing_systems:
                existing.contributing_systems = list(
                    dict.fromkeys(existing.contributing_systems + contributing_systems)
                )
            return existing

        record = MistakeRecord(what=what, why=why, contributing_systems=list(contributing_systems or []))
        self.records[signature] = record
        return record

    def correct(self, signature: str, correction: str, worked: bool) -> MistakeRecord:
        """Section 111 step 4-5: log how a mistake was addressed and whether it stuck."""
        record = self._get(signature)
        record.correction = correction
        record.correction_worked = worked
        return record

    def is_repeated(self, signature: str, threshold: int = 2) -> bool:
        record = self.records.get(signature)
        return record is not None and record.occurrences >= threshold

    def get(self, signature: str) -> Optional[MistakeRecord]:
        return self.records.get(signature)

    def most_repeated(self, top_k: int = 5) -> List[MistakeRecord]:
        return sorted(self.records.values(), key=lambda r: r.occurrences, reverse=True)[:top_k]

    def _get(self, signature: str) -> MistakeRecord:
        record = self.records.get(signature)
        if record is None:
            raise KeyError(f"no mistake recorded under signature {signature!r}")
        return record

    # -- Serialization (spec Part 9 section 171, Backup System) -----------

    def to_dict(self) -> Dict[str, Dict]:
        return {
            signature: {
                "what": r.what,
                "why": r.why,
                "contributing_systems": list(r.contributing_systems),
                "correction": r.correction,
                "correction_worked": r.correction_worked,
                "occurrences": r.occurrences,
            }
            for signature, r in self.records.items()
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Dict]) -> "MistakeTracker":
        tracker = cls()
        for signature, r in data.items():
            tracker.records[signature] = MistakeRecord(
                what=r["what"],
                why=r["why"],
                contributing_systems=list(r.get("contributing_systems", [])),
                correction=r.get("correction"),
                correction_worked=r.get("correction_worked"),
                occurrences=r.get("occurrences", 1),
            )
        return tracker
