"""Human-in-the-loop action layer — the safe basis for "control my computer".

The model can propose an action by emitting a line of the form:

    ACTION: <name> <args...>

The action layer parses it, runs it through the alignment veto, and — for any
action that isn't trivially safe — shows you exactly what it will do and waits
for your explicit approval before executing. It ships only read-only actions by
default; anything that writes or runs commands must be registered deliberately
and always requires confirmation. There is no autonomous execution path.
"""
from __future__ import annotations

import os
import platform
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Dict, List, Optional, Tuple

from .veto import AlignmentVeto, ProposedAction, VetoDecision

_ACTION_RE = re.compile(r"ACTION:\s*(\w+)[ \t]*([^\n]*)", re.IGNORECASE)


@dataclass
class ActionSpec:
    name: str
    run: Callable[[str], str]
    capabilities: List[str]
    reversible: bool
    external_effect: bool
    description: str
    # Force human confirmation even when the veto wouldn't (e.g. reading files is
    # reversible and has no external effect, but can still expose private data).
    requires_confirmation: bool = False


@dataclass
class ActionResult:
    proposed: bool
    executed: bool
    output: str
    decision: Optional[VetoDecision] = None


# ---- built-in, read-only, safe actions ------------------------------------
def _act_time(_: str) -> str:
    return f"Current time: {datetime.now().isoformat(timespec='seconds')}"


def _act_system_info(_: str) -> str:
    return (f"System: {platform.system()} {platform.release()} | "
            f"python {platform.python_version()} | machine {platform.machine()}")


def _act_list_dir(arg: str) -> str:
    path = arg.strip() or "."
    if not os.path.isdir(path):
        return f"Not a directory: {path}"
    entries = sorted(os.listdir(path))[:100]
    return f"{path} ({len(entries)} shown):\n" + "\n".join(entries)


def _act_read_file(arg: str) -> str:
    path = arg.strip()
    if not os.path.isfile(path):
        return f"Not a file: {path}"
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()[:4000]


DEFAULT_ACTIONS: Dict[str, ActionSpec] = {
    "time": ActionSpec("time", _act_time, [], reversible=True, external_effect=False,
                       description="Read the current time (read-only)."),
    "system_info": ActionSpec("system_info", _act_system_info, [], reversible=True,
                              external_effect=False, description="Read OS/python info (read-only)."),
    "list_dir": ActionSpec("list_dir", _act_list_dir, ["filesystem-read"], reversible=True,
                           external_effect=False, description="List a directory (read-only).",
                           requires_confirmation=True),
    "read_file": ActionSpec("read_file", _act_read_file, ["filesystem-read"], reversible=True,
                            external_effect=False, description="Read a text file (read-only).",
                            requires_confirmation=True),
}


class ActionLayer:
    """Parses, vetoes, confirms, and executes model-proposed actions."""

    def __init__(self, veto: Optional[AlignmentVeto] = None,
                 actions: Optional[Dict[str, ActionSpec]] = None,
                 confirm_fn: Optional[Callable[[str], bool]] = None):
        self.veto = veto or AlignmentVeto()
        self.actions = actions if actions is not None else dict(DEFAULT_ACTIONS)
        # default confirmer asks on stdin; callers can inject their own (e.g. auto-deny)
        self.confirm_fn = confirm_fn or self._stdin_confirm

    @staticmethod
    def _stdin_confirm(prompt: str) -> bool:
        try:
            return input(f"{prompt} [y/N] ").strip().lower() in ("y", "yes")
        except (EOFError, KeyboardInterrupt):
            return False

    def register(self, spec: ActionSpec) -> None:
        self.actions[spec.name] = spec

    def parse(self, text: str) -> Optional[Tuple[str, str]]:
        m = _ACTION_RE.search(text or "")
        if not m:
            return None
        return m.group(1).lower(), m.group(2).strip()

    def maybe_execute(self, text: str, self_model_surprise: float = 0.0) -> ActionResult:
        parsed = self.parse(text)
        if parsed is None:
            return ActionResult(proposed=False, executed=False, output="")
        name, arg = parsed

        spec = self.actions.get(name)
        if spec is None:
            return ActionResult(proposed=True, executed=False,
                                output=f"Refused: '{name}' is not an allowlisted action.")

        action = ProposedAction(
            id=f"action-{name}", name=name, capabilities=list(spec.capabilities),
            reversible=spec.reversible, external_effect=spec.external_effect,
        )
        decision = self.veto.evaluate(action, self_model_surprise)

        if not decision.allowed:
            return ActionResult(proposed=True, executed=False, decision=decision,
                                output=f"Blocked by alignment veto: {'; '.join(decision.reasons)}")

        if decision.requires_confirmation or spec.requires_confirmation:
            ok = self.confirm_fn(f"Run action '{name} {arg}'? ({spec.description})")
            if not ok:
                return ActionResult(proposed=True, executed=False, decision=decision,
                                    output=f"Declined: action '{name}' not approved.")

        try:
            output = spec.run(arg)
        except Exception as e:  # execution errors are surfaced, never silent
            output = f"Action '{name}' failed: {e}"
        return ActionResult(proposed=True, executed=True, decision=decision, output=output)
