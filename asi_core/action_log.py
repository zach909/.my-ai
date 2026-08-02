"""
Action Log / Human Approval System

Implements spec Part 9 sections 161-163 and Part 10 section 191
(Transparency: "The AI should explain: what it did, why it did it, what
changed"): every action the AI performs is logged with what happened, why,
and which system performed it, and a caller-registered rule can mark
certain actions as requiring explicit human approval before they execute.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, List, Optional


class ApprovalStatus(Enum):
    NOT_REQUIRED = "not_required"
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"


@dataclass
class ActionRecord:
    """Spec Part 9 section 162 (Action History)."""
    action: str
    why: str
    system: str
    result: Optional[str] = None
    approval: ApprovalStatus = ApprovalStatus.NOT_REQUIRED


class ActionLog:
    """
    Records every AI action and gates actions matching a caller-registered
    "requires approval" rule behind explicit user approval before perform()
    will run them (spec section 163: "Certain actions require approval").
    """

    def __init__(self):
        self.records: List[ActionRecord] = []
        self._approval_rules: List[Callable[[str], bool]] = []

    def require_approval_for(self, predicate: Callable[[str], bool]) -> None:
        """Register a rule: any action for which predicate(action) is True
        requires approval before perform() will run it."""
        self._approval_rules.append(predicate)

    def needs_approval(self, action: str) -> bool:
        return any(rule(action) for rule in self._approval_rules)

    def request(self, action: str, why: str, system: str) -> ActionRecord:
        """
        Log an action as requested. If it needs approval (per the
        registered rules), it's recorded PENDING and perform() will
        refuse to run it until approve()/deny() resolves it.
        """
        status = ApprovalStatus.PENDING if self.needs_approval(action) else ApprovalStatus.NOT_REQUIRED
        record = ActionRecord(action=action, why=why, system=system, approval=status)
        self.records.append(record)
        return record

    def approve(self, record: ActionRecord) -> None:
        if record.approval != ApprovalStatus.PENDING:
            raise ValueError(f"action is not pending approval: {record.approval}")
        record.approval = ApprovalStatus.APPROVED

    def deny(self, record: ActionRecord) -> None:
        if record.approval != ApprovalStatus.PENDING:
            raise ValueError(f"action is not pending approval: {record.approval}")
        record.approval = ApprovalStatus.DENIED

    def perform(self, record: ActionRecord, fn: Callable[[], Any]) -> Any:
        """
        Execute fn() and log its result — but only if the action doesn't
        require approval, or has already been approved. Raises
        PermissionError if the action is still pending or was denied, and
        records a failed action's error instead of leaving `result` blank.
        """
        if record.approval == ApprovalStatus.PENDING:
            raise PermissionError(f"action '{record.action}' is awaiting approval")
        if record.approval == ApprovalStatus.DENIED:
            raise PermissionError(f"action '{record.action}' was denied")
        try:
            result = fn()
            record.result = "success"
            return result
        except Exception as exc:
            record.result = f"error: {exc}"
            raise

    def history(self, system: Optional[str] = None) -> List[ActionRecord]:
        if system is None:
            return list(self.records)
        return [r for r in self.records if r.system == system]
