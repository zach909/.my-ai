"""
Hive Mind / Multi-Agent Collaboration

Implements spec Part 12: a Hive Mind lets multiple UnifiedBrain instances
("agents") share extensions with each other, gated by verification
(section 223: re-test before accepting, don't just trust the label) and a
per-agent trust score (section 234) that rises with successful, verified
shares and falls with rejected/bad ones.

Deliberately scoped to extensions, not raw memory traces or skill
callables: an Extension is already the portable, testable, versioned unit
(sections 25-27, 98-99), and a memory trace from one agent's
hyper-dimensional space has no meaning in another agent's — HD vectors are
keyed to that specific system's config/RNG, not a universal representation
(spec section 231 does distinguish "distributed memory" as a further
concept, but nothing in the spec text defines what a cross-agent memory
representation would look like, so it isn't invented here).
"""

from dataclasses import dataclass, field
from typing import Dict, List

from .extension_system import Extension, ExtensionSystem


@dataclass
class ShareRecord:
    """Spec section 226 (Improvement Tracking) applied to a single share attempt."""
    extension_name: str
    from_agent: str
    to_agent: str
    accepted: bool
    reason: str


class TrustSystem:
    """Spec section 234 (Trust System): a per-agent trust score."""

    def __init__(self, initial_trust: float = 0.5, min_trust: float = 0.0, max_trust: float = 1.0):
        self.initial_trust = initial_trust
        self.min_trust = min_trust
        self.max_trust = max_trust
        self.scores: Dict[str, float] = {}

    def register(self, agent_id: str) -> None:
        self.scores.setdefault(agent_id, self.initial_trust)

    def get(self, agent_id: str) -> float:
        return self.scores.get(agent_id, self.initial_trust)

    def reward(self, agent_id: str, amount: float = 0.05) -> float:
        self.register(agent_id)
        self.scores[agent_id] = min(self.max_trust, self.scores[agent_id] + amount)
        return self.scores[agent_id]

    def penalize(self, agent_id: str, amount: float = 0.1) -> float:
        self.register(agent_id)
        self.scores[agent_id] = max(self.min_trust, self.scores[agent_id] - amount)
        return self.scores[agent_id]


class HiveMind:
    """
    Coordinates knowledge sharing between named agents (spec sections
    219-223). Each agent owns an ExtensionSystem (its private/local
    registry); HiveMind copies an Extension from one agent's registry into
    another's only if:

      1. the sending agent's trust score meets min_trust_to_share, and
      2. the extension re-verifies (a fresh test(), not just trusting its
         already-recorded stage) inside the receiving registry.

    A rejected share penalizes the sender's trust; an accepted one rewards
    it — "trust increases through... successful improvements" / "decreases
    through... incorrect information" (section 234).
    """

    def __init__(self, min_trust_to_share: float = 0.3):
        self.trust = TrustSystem()
        self.min_trust_to_share = min_trust_to_share
        self.share_history: List[ShareRecord] = []

    def register_agent(self, agent_id: str) -> None:
        self.trust.register(agent_id)

    def share(
        self,
        extension: Extension,
        from_agent: str,
        to_agent: str,
        to_registry: ExtensionSystem,
    ) -> ShareRecord:
        """Attempt to share `extension` from from_agent to to_agent's ExtensionSystem."""
        self.register_agent(from_agent)
        self.register_agent(to_agent)

        if self.trust.get(from_agent) < self.min_trust_to_share:
            return self._log(
                extension.name, from_agent, to_agent, False,
                f"sender trust {self.trust.get(from_agent):.2f} below threshold {self.min_trust_to_share:.2f}",
            )

        if to_registry.get(extension.name) is not None:
            return self._log(
                extension.name, from_agent, to_agent, False,
                "an extension with this name already exists in the receiving registry",
            )

        to_registry.create(
            extension.name,
            purpose=extension.purpose,
            skills=list(extension.skills),
            # A sender's memory_trace_ids reference HD vectors in its own
            # hyper-dimensional space, which has no meaning to the
            # receiver's — not carried across (see module docstring).
            memory_trace_ids=[],
            permissions=list(extension.permissions),
            documentation=extension.documentation,
        )

        if not to_registry.test(extension.name):
            to_registry.remove(extension.name)
            self.trust.penalize(from_agent)
            return self._log(
                extension.name, from_agent, to_agent, False, "failed verification on receiving side"
            )

        to_registry.optimize(extension.name)
        to_registry.quantize(extension.name)
        self.trust.reward(from_agent)
        return self._log(extension.name, from_agent, to_agent, True, "verified and installed")

    def history_for(self, agent_id: str) -> List[ShareRecord]:
        return [r for r in self.share_history if agent_id in (r.from_agent, r.to_agent)]

    def _log(self, extension_name: str, from_agent: str, to_agent: str, accepted: bool, reason: str) -> ShareRecord:
        record = ShareRecord(
            extension_name=extension_name, from_agent=from_agent, to_agent=to_agent,
            accepted=accepted, reason=reason,
        )
        self.share_history.append(record)
        return record
