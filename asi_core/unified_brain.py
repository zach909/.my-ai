"""
Unified Brain

Wires the previously independent asi_core subsystems into the single
continuously-operating pipeline described by the project architecture:

    Input -> Dynamic Neural State -> Memory -> Reasoning -> Skills -> Output -> Learning

Before this module existed, neural_mesh.NeuralMesh, vale_system.ValeSystem,
hyperdim_thinking.HDThinkingSystem and neural_states.StateManager /
LearningSystem were each fully implemented and individually tested, but
never called each other:

- NeuralMesh carried its own simplistic, ad-hoc zero-sum vale bookkeeping
  (redistribute_vale / raise_vale / demote_vale) instead of using the
  dedicated, invariant-checked ValeSystem.
- HDThinkingSystem's hyper-dimensional memory and analogy-style reasoning
  never saw anything the mesh produced.
- neural_states.LearningSystem's multi-rule plasticity (Hebbian/Oja/BCM/
  homeostatic) never ran against the mesh's synapses.

UnifiedBrain makes ValeSystem the single source of truth for every
neuron's vale (the mesh's own vale fields are treated as a read-only
mirror, refreshed after every vale update), drives HDThinkingSystem's
memory/reasoning from the mesh's settled output on every cycle, and runs
the richer neural_states plasticity rules over the mesh's synapses in
addition to the mesh's own Hebbian update.
"""

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

from .neural_mesh import NeuralMesh
from .vale_system import ValeSystem, ValeConfig
from .hyperdim_thinking import HDThinkingSystem, HDConfig, HDVector, MemoryKind, cosine_similarity
from .neural_states import StateManager, LearningSystem
from .extension_system import ExtensionSystem, Extension


Skill = Callable[[List[float]], List[float]]


@dataclass
class CycleResult:
    """Everything produced by one full perceive() cycle."""
    output: List[float]
    memory_consolidated: int
    average_vale: float
    average_surprise: float
    recalled_confidence: float = 0.0
    active_skills: List[str] = field(default_factory=list)
    active_groups: List[int] = field(default_factory=list)
    active_experts: List[str] = field(default_factory=list)


@dataclass
class Introspection:
    """Self-observation snapshot (spec Part 2 section 18)."""
    most_stable_neurons: List[int]
    most_flexible_neurons: List[int]
    removal_candidates: List[int]
    average_vale: float
    average_surprise: float
    memory_size: int
    active_skills: List[str]
    active_groups: List[int]
    active_experts: List[str]


class UnifiedBrain:
    """
    Single entry point combining the neural mesh, elastic vale system,
    hyper-dimensional memory/reasoning, and multi-rule learning system
    into one architecture with persistent internal state.
    """

    def __init__(
        self,
        n_neurons: int = 64,
        n_dimensions: int = 4,
        n_input: int = 8,
        n_groups: int = 4,
        hd_dimensions: int = 256,
        seed: Optional[int] = 42,
        expert_names: Optional[List[str]] = None,
    ):
        self.mesh = NeuralMesh(
            n_neurons=n_neurons,
            n_dimensions=n_dimensions,
            n_input=n_input,
            n_groups=n_groups,
            continuous=True,
            seed=seed,
            auto_route=True,
        )

        # Spec Part 4 section 39: name expert groups (e.g. "coding",
        # "language", "reasoning") instead of leaving them as bare ids.
        if expert_names:
            for group_id, name in enumerate(expert_names[:n_groups]):
                self.mesh.set_group_name(group_id, name)

        # ValeSystem replaces the mesh's own redistribute_vale bookkeeping
        # as the single conserving ledger of plasticity budget.
        self.vale = ValeSystem(ValeConfig(n_neurons=n_neurons), seed=seed)

        hd_neurons = max(2, n_groups)
        self.hd = HDThinkingSystem(
            n_neurons=hd_neurons,
            dimensions=hd_dimensions,
            n_input=1,
            n_groups=n_groups,
            config=HDConfig(dimensions=hd_dimensions),
            seed=seed,
        )
        self._hd_cue_neuron = 0

        self.states = StateManager()
        self.learning = LearningSystem(self.states)
        for nid in self.mesh.neurons:
            self.states.register_neuron(str(nid))
        for (source_id, target_id) in self.mesh.connections:
            self.states.register_synapse(str(source_id), str(target_id))

        self.skills: Dict[str, Skill] = {}
        self._pattern_skills: Dict[int, str] = {}  # id(trace) -> skill name
        self._pattern_counter = 0
        self.extensions = ExtensionSystem()
        self._sync_vale_to_mesh()

    # -- Skills / extension points -----------------------------------

    def register_skill(self, name: str, fn: Skill) -> None:
        """
        Register a named skill: a callable applied, in registration order,
        to the reasoned output vector before it is returned. This is the
        seam through which the Mixture-of-Experts / skill system plugs
        into the brain without the brain needing to know about it.
        """
        self.skills[name] = fn

    def unregister_skill(self, name: str) -> None:
        self.skills.pop(name, None)

    def _apply_skills(self, output: List[float]) -> List[float]:
        for fn in self.skills.values():
            output = fn(output)
        return output

    # -- Vale <-> Mesh sync -----------------------------------------

    def _sync_vale_to_mesh(self) -> None:
        """Mirror ValeSystem's ledger onto the mesh's neuron.vale fields,
        which the mesh's own Hebbian update reads to gate plasticity."""
        for nid, neuron in self.mesh.neurons.items():
            if nid < len(self.vale.v):
                neuron.vale = self.vale.v[nid]

    # -- HD encoding ----------------------------------------------------

    def _vector_to_hd(self, values: List[float]) -> HDVector:
        dims = self.hd.config.dimensions
        data = list(values[:dims]) + [0.0] * max(0, dims - len(values))
        return HDVector(data, HDVector._compute_bounds(dims))

    # -- Core cycle ----------------------------------------------------

    def perceive(self, input_vector: List[float], reward: float = 0.5) -> CycleResult:
        """Run one full perceive-think-act-learn cycle."""

        # 1. Dynamic neural state: settle the mesh on the new input,
        #    carrying state forward between calls (continuous mode).
        raw_output = self.mesh.step_continuous(input_vector)
        settle_vector = raw_output if raw_output else input_vector

        # 2. Memory: encode the settled state as a hypervector and tick the
        #    HD thinking system so it can integrate, predict, and
        #    surprise-gate consolidation into long-term memory.
        cue = self._vector_to_hd(settle_vector)
        tick_result = self.hd.tick(inputs={self._hd_cue_neuron: cue}, reward=reward)

        # 3. Reasoning: recall the closest existing memory trace and fold
        #    its semantic content back into the output as context.
        traces = self.hd.recall(cue, k=1)
        recalled_confidence = 0.0
        if traces and raw_output:
            recalled_confidence = cosine_similarity(cue, traces[0].key)
            recalled_sem = traces[0].value.sem
            reasoned = [
                (v + recalled_sem[i % len(recalled_sem)]) / 2.0 if recalled_sem else v
                for i, v in enumerate(raw_output)
            ]
        else:
            reasoned = list(raw_output)

        # 4. Skills: pluggable expert transforms (Mixture-of-Experts seam).
        output = self._apply_skills(reasoned)

        # 5. Learning: derive each neuron's contribution to this cycle's
        #    outcome from the reward signal (spec Part 2 section 9: vale
        #    should track "contribution to successful reasoning/outputs",
        #    not raw activation alone), refresh vale from it, re-sync onto
        #    the mesh, run the mesh's vale-gated Hebbian update, and run
        #    the richer per-synapse plasticity rules.
        activations = {nid: n.activation for nid, n in self.mesh.neurons.items()}
        signed_reward = (reward - 0.5) * 2.0  # -1 (harmful) .. 0 (neutral) .. +1 (helpful)
        contributions = [
            self.mesh.neurons[i].activation * signed_reward for i in range(len(self.vale.v))
        ]
        self.vale.step(utility=contributions)
        for nid, neuron in self.mesh.neurons.items():
            self.vale.record_activity(nid, neuron.activation, contribution=neuron.activation * signed_reward)
        self._sync_vale_to_mesh()

        self.mesh.apply_hebbian_learning(activations, activations, reward_signal=reward)

        for nid, neuron in self.mesh.neurons.items():
            state = self.states.get_neuron_state(str(nid))
            if state is not None:
                state.activation = neuron.activation
        self.learning.apply_learning()
        self.learning.apply_reinforcement(reward)
        self.states.update_time(1.0)

        return CycleResult(
            output=output,
            memory_consolidated=tick_result.consolidated,
            average_vale=sum(self.vale.v) / len(self.vale.v),
            average_surprise=sum(tick_result.surprises.values()) / max(1, len(tick_result.surprises)),
            recalled_confidence=recalled_confidence,
            active_skills=list(self.skills.keys()),
            active_groups=sorted(self.mesh.active_groups),
            active_experts=self.mesh.active_expert_names(),
        )

    def reason(self, a: List[float], b: List[float], c: List[float]) -> List[float]:
        """Analogy-style reasoning over three externally supplied vectors:
        a is to b as c is to the returned vector."""
        result = self.hd.reason(
            self._vector_to_hd(a), self._vector_to_hd(b), self._vector_to_hd(c)
        )
        return list(result.sem)

    def get_statistics(self) -> Dict:
        return {
            "mesh": self.mesh.get_statistics(),
            "vale": self.vale.statistics(),
            "hd": self.hd.get_statistics(),
            "states": self.states.get_statistics(),
            "skills": list(self.skills.keys()),
        }

    # -- Self-observation (spec Part 2 section 18) -----------------------

    def introspect(self, top_k: int = 5) -> Introspection:
        """
        Inspect the brain's own internal state: which neurons currently
        carry the most/least importance, which low-vale neurons are
        candidates for demotion/merging/removal (section 9), and how
        confident the most recent memory recall was.
        """
        ranked = sorted(range(len(self.vale.v)), key=lambda i: self.vale.v[i], reverse=True)
        # Spec Part 2 section 9: neurons that have lost enough vale become
        # candidates for retraining, merging, or deletion.
        removal_candidates = [nid for nid in ranked if self.vale.plasticity(nid) > 0.9]
        recent_surprise = (
            self.hd.history[-1]["avg_surprise"] if self.hd.history else 0.0
        )
        return Introspection(
            most_stable_neurons=ranked[:top_k],
            most_flexible_neurons=list(reversed(ranked[-top_k:])),
            removal_candidates=removal_candidates[:top_k],
            average_vale=sum(self.vale.v) / len(self.vale.v),
            average_surprise=recent_surprise,
            memory_size=len(self.hd.memory),
            active_skills=list(self.skills.keys()),
            active_groups=sorted(self.mesh.active_groups),
            active_experts=self.mesh.active_expert_names(),
        )

    # -- Background maintenance (spec Part 2 section 19) ------------------

    def maintain(self) -> Dict:
        """
        Low-priority idle-time maintenance: consolidate/prune hyper-
        dimensional memory and correct any float-drift in the vale ledger.
        Safe to call between perceive() cycles; does not touch mesh state.
        """
        consolidated = self.hd.consolidate()
        before = len(self.hd.memory)
        self.hd.memory.decay_and_prune()
        pruned = before - len(self.hd.memory)
        self.vale._renormalize()
        return {
            "memory_consolidated": consolidated,
            "memory_pruned": pruned,
            "memory_size": len(self.hd.memory),
            "vale_invariant_ok": self.vale.validate_invariant(),
        }

    # -- Self-improvement loop (spec Part 3 section 36) -------------------

    def self_improve(self, min_strength: float = 1.5) -> List[str]:
        """
        Close the loop described in section 36: experience -> memory ->
        pattern -> skill -> permanent ability. A long-term memory trace
        that has been merged/reinforced enough times (strength above
        min_strength, i.e. the same pattern was seen and confirmed more
        than once — see section 24, "Pattern learned") is promoted into a
        permanent skill via register_skill, so it participates in future
        perceive() cycles without the brain needing to re-derive it.
        Skills whose backing pattern later gets pruned from memory are
        retired, so nothing "successful" is faked as permanent forever.
        """
        created: List[str] = []
        live_ids = set()

        for trace in self.hd.memory.traces:
            if trace.kind != MemoryKind.LONG_TERM.value or trace.strength < min_strength:
                continue
            trace_id = id(trace)
            live_ids.add(trace_id)
            if trace_id in self._pattern_skills:
                continue

            self._pattern_counter += 1
            name = f"pattern_{self._pattern_counter}"
            pattern = list(trace.value.sem)

            def _apply_pattern(values: List[float], pattern: List[float] = pattern) -> List[float]:
                if not pattern:
                    return values
                return [(v + pattern[i % len(pattern)]) / 2.0 for i, v in enumerate(values)]

            self.register_skill(name, _apply_pattern)
            self._pattern_skills[trace_id] = name
            created.append(name)

        for trace_id in list(self._pattern_skills):
            if trace_id not in live_ids:
                self.unregister_skill(self._pattern_skills.pop(trace_id))

        return created

    # -- Extensions (spec Part 3 sections 25-27) ---------------------------

    def create_extension(
        self,
        name: str,
        purpose: str,
        skills: Optional[List[str]] = None,
        permissions: Optional[List[str]] = None,
        documentation: str = "",
        auto_advance: bool = True,
    ) -> Extension:
        """
        Bundle skills (by default, every skill self_improve() has promoted
        so far) into a named Extension and, if auto_advance, drive it
        through the full lifecycle (section 27): test -> optimize ->
        quantize. If it fails testing, it's left in the FAILED stage rather
        than silently discarded, so a caller can inspect test_results.
        """
        bundled = skills if skills is not None else list(self._pattern_skills.values())
        ext = self.extensions.create(
            name,
            purpose=purpose,
            skills=bundled,
            memory_trace_ids=[tid for tid, sname in self._pattern_skills.items() if sname in bundled],
            permissions=permissions,
            documentation=documentation,
        )
        if auto_advance and self.extensions.test(name):
            self.extensions.optimize(name)
            self.extensions.quantize(name)
        return ext
