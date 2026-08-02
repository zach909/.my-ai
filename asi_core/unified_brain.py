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
from typing import Any, Callable, Dict, List, Optional

from .neural_mesh import NeuralMesh
from .vale_system import ValeSystem, ValeConfig
from .hyperdim_thinking import HDThinkingSystem, HDConfig, HDVector, MemoryKind, cosine_similarity
from .neural_states import StateManager, LearningSystem
from .extension_system import ExtensionSystem, Extension
from .circular_context import CircularContextSystem
from .mistake_tracker import MistakeTracker, MistakeRecord


Skill = Callable[[List[float]], List[float]]


@dataclass
class SkillRecord:
    """
    Spec Part 8 section 143 (Skill Storage Format). The callable itself
    lives in UnifiedBrain.skills; this is the metadata a skill accrues by
    actually running — activation_count and performance_score aren't
    something a caller sets, they're measured from the reward of every
    cycle in which the skill participated.
    """
    name: str
    activation_count: int = 0
    performance_score: float = 0.0  # EMA of reward across cycles this skill ran in
    improvement_history: List[float] = field(default_factory=list)


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
    mistake_signature: Optional[str] = None
    mistake_repeated: bool = False


@dataclass
class ReasoningPath:
    """
    One candidate reasoning path (spec Part 7 section 108). Rather than
    committing to the single nearest memory trace, multi_path_reason()
    recalls several candidates and scores each as its own path.
    """
    solution: List[float]
    expected_outcome: List[float]
    confidence: float
    supporting_trace_kind: Optional[str]


@dataclass
class DebugSnapshot:
    """Spec Part 8 section 153 (Debugging System)."""
    active_neuron_count: int
    active_experts: List[str]
    memory_size: int
    context_input_size: int
    context_output_size: int
    predictions_made: int
    recent_average_surprise: float
    errors_detected: List[str]
    extensions_installed: List[str]


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
        context_capacity: int = 32,
        mistake_reward_threshold: float = 0.3,
        mistake_repeat_penalty: float = -1.0,
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
        self.skill_records: Dict[str, SkillRecord] = {}
        self._pattern_skills: Dict[int, str] = {}  # id(trace) -> skill name
        self._pattern_counter = 0
        self.extensions = ExtensionSystem()

        # Spec Part 5 sections 66-69 (Circular Context System): instead of
        # a fixed context window that simply drops old input/output, the
        # oldest entry is compressed into long-term HD memory on eviction.
        self.context = CircularContextSystem(
            capacity=context_capacity,
            on_input_evict=self._compress_evicted_context,
            on_output_evict=self._compress_evicted_context,
        )

        # Spec Part 7 sections 111-112 (Self-Correction / Mistake
        # Tracking): a low-reward cycle is logged as a mistake, bucketed by
        # which experts were active and roughly what the input looked
        # like, so a *repeated* mistake (not just one bad cycle) is
        # distinguishable and can be penalized harder.
        self.mistakes = MistakeTracker()
        self.mistake_reward_threshold = mistake_reward_threshold
        self.mistake_repeat_penalty = mistake_repeat_penalty

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
        self.skill_records.setdefault(name, SkillRecord(name=name))

    def unregister_skill(self, name: str) -> None:
        """Removes the skill from active rotation; its SkillRecord (spec
        section 143: performance history) is kept for later inspection."""
        self.skills.pop(name, None)

    def _apply_skills(self, output: List[float], reward: float) -> List[float]:
        decay = 0.9
        for name, fn in self.skills.items():
            output = fn(output)
            record = self.skill_records.setdefault(name, SkillRecord(name=name))
            record.activation_count += 1
            record.performance_score = decay * record.performance_score + (1 - decay) * reward
            record.improvement_history.append(record.performance_score)
            if len(record.improvement_history) > 50:
                record.improvement_history.pop(0)
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

    # -- Circular context (spec Part 5 sections 66-69) ---------------------

    def _compress_evicted_context(self, values: List[float]) -> None:
        """
        Called when the input or output buffer overflows. Rather than
        letting the oldest entry vanish, fold it into long-term HD memory
        as its own key/value trace (bundled with any existing similar
        trace, per MemoryStore.write) — "important information moves into
        memory" (section 67).
        """
        vec = self._vector_to_hd(values)
        self.hd.memory.write(vec, vec, self.hd.current_tick, kind=MemoryKind.LONG_TERM.value)

    # -- Core cycle ----------------------------------------------------

    def perceive(self, input_vector: List[float], reward: float = 0.5) -> CycleResult:
        """Run one full perceive-think-act-learn cycle."""

        # 0. Circular context: record this input in the continuous input
        #    buffer (section 67); the corresponding output is recorded once
        #    computed, below.
        self.context.record_input(list(input_vector))

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
        output = self._apply_skills(reasoned, reward)

        # 5. Learning: derive each neuron's contribution to this cycle's
        #    outcome from the reward signal (spec Part 2 section 9: vale
        #    should track "contribution to successful reasoning/outputs",
        #    not raw activation alone), refresh vale from it, re-sync onto
        #    the mesh, run the mesh's vale-gated Hebbian update, and run
        #    the richer per-synapse plasticity rules.
        activations = {nid: n.activation for nid, n in self.mesh.neurons.items()}
        signed_reward = (reward - 0.5) * 2.0  # -1 (harmful) .. 0 (neutral) .. +1 (helpful)

        # 5a. Self-correction (spec Part 7 sections 111-112): a low-reward
        #     cycle is logged as a mistake, bucketed by which experts were
        #     active and the rough shape of the input. A *repeated*
        #     mistake gets an extra vale penalty on top of the normal
        #     reward-driven contribution below, on the neurons that were
        #     actually active for it.
        mistake_signature: Optional[str] = None
        mistake_repeated = False
        if reward < self.mistake_reward_threshold:
            mistake_signature = self._mistake_signature(input_vector)
            self.mistakes.record(
                mistake_signature,
                what=f"low-reward outcome (reward={reward:.2f}) for input {input_vector}",
                why=f"experts {self.mesh.active_expert_names()} were active and produced an unsatisfactory result",
                contributing_systems=self.mesh.active_expert_names(),
            )
            mistake_repeated = self.mistakes.is_repeated(mistake_signature)

        contributions = [
            self.mesh.neurons[i].activation * signed_reward for i in range(len(self.vale.v))
        ]
        if mistake_repeated:
            for nid, neuron in self.mesh.neurons.items():
                if neuron.group in self.mesh.active_groups:
                    contributions[nid] += self.mistake_repeat_penalty * abs(neuron.activation)

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

        self.context.record_output(list(output))

        return CycleResult(
            output=output,
            memory_consolidated=tick_result.consolidated,
            average_vale=sum(self.vale.v) / len(self.vale.v),
            average_surprise=sum(tick_result.surprises.values()) / max(1, len(tick_result.surprises)),
            recalled_confidence=recalled_confidence,
            active_skills=list(self.skills.keys()),
            active_groups=sorted(self.mesh.active_groups),
            active_experts=self.mesh.active_expert_names(),
            mistake_signature=mistake_signature,
            mistake_repeated=mistake_repeated,
        )

    def _mistake_signature(self, input_vector: List[float]) -> str:
        """Bucket a situation by rounded input shape and which experts were
        active, so near-identical mistakes accumulate onto one record."""
        bucket = tuple(round(v, 1) for v in input_vector)
        return f"{sorted(self.mesh.active_groups)}:{bucket}"

    def reason(self, a: List[float], b: List[float], c: List[float]) -> List[float]:
        """Analogy-style reasoning over three externally supplied vectors:
        a is to b as c is to the returned vector."""
        result = self.hd.reason(
            self._vector_to_hd(a), self._vector_to_hd(b), self._vector_to_hd(c)
        )
        return list(result.sem)

    def multi_path_reason(self, input_vector: List[float], n_paths: int = 3) -> List[ReasoningPath]:
        """
        Spec Part 7 section 108 (Multi-Path Reasoning): recall several
        candidate memory traces for the given input and score each as its
        own path, strongest first, instead of committing to a single
        nearest match.

        A path is stronger when it matches previous experience (higher
        cosine similarity to the cue) and comes from reliable,
        repeatedly-confirmed knowledge (higher trace.strength,
        MemoryKind.LONG_TERM). It's weaker — and can go outright negative —
        when the closest match is a known mistake (MemoryKind.EXPERIENCE):
        a confident match to a bad outcome is a contradiction to avoid, not
        support for the path (section 108: "weaker when it conflicts with
        high-value memories").
        """
        cue = self._vector_to_hd(input_vector)
        traces = self.hd.memory.recall(cue, k=n_paths)

        paths: List[ReasoningPath] = []
        for trace in traces:
            similarity = cosine_similarity(cue, trace.key)
            reliability = min(1.0, trace.strength / 2.0)  # strength caps at 2.0 in MemoryStore.write
            if trace.kind == MemoryKind.EXPERIENCE.value:
                confidence = -abs(similarity) * reliability
            else:
                confidence = similarity * reliability

            paths.append(
                ReasoningPath(
                    solution=list(trace.value.sem),
                    expected_outcome=list(trace.value.sem),
                    confidence=confidence,
                    supporting_trace_kind=trace.kind,
                )
            )

        paths.sort(key=lambda p: p.confidence, reverse=True)
        return paths

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

    # -- Debugging (spec Part 8 section 153) -------------------------------

    def debug_snapshot(self, top_k_errors: int = 5) -> DebugSnapshot:
        """
        Section 153 asks for one debugging view covering "active neurons,
        activated experts, memory used, predictions made, errors
        detected" — each of those is already tracked by a different
        subsystem (NeuralMesh, HDThinkingSystem, CircularContextSystem,
        MistakeTracker); this aggregates them instead of making a caller
        know which subsystem to query for each.
        """
        active_neuron_count = sum(
            1 for n in self.mesh.neurons.values() if n.group in self.mesh.active_groups
        )
        errors = [f"{r.what} (x{r.occurrences})" for r in self.mistakes.most_repeated(top_k_errors)]
        recent_surprise = self.hd.history[-1]["avg_surprise"] if self.hd.history else 0.0

        return DebugSnapshot(
            active_neuron_count=active_neuron_count,
            active_experts=self.mesh.active_expert_names(),
            memory_size=len(self.hd.memory),
            context_input_size=len(self.context.input_buffer),
            context_output_size=len(self.context.output_buffer),
            predictions_made=self.hd.current_tick,
            recent_average_surprise=recent_surprise,
            errors_detected=errors,
            extensions_installed=list(self.extensions.extensions.keys()),
        )

    # -- Backup / restore (spec Part 9 section 171-172) --------------------

    def backup(self) -> Dict[str, Any]:
        """
        A portable snapshot of everything the brain has learned and
        built: mesh, vale, hyper-dimensional memory, extensions, mistake
        history, skill performance records, and circular context buffers.

        Deliberately NOT included: the raw callables in self.skills.
        Arbitrary Python closures can't be safely or portably serialized —
        a caller-registered skill must be re-registered after restore(),
        and pattern skills created by self_improve() can be regenerated by
        calling self_improve() again once memory has been restored (their
        backing traces come back with their original vale/strength).
        """
        return {
            "mesh": self.mesh.save_state(),
            "vale": self.vale.to_dict(),
            "hd": self.hd.save_state(),
            "extensions": self.extensions.to_dict(),
            "mistakes": self.mistakes.to_dict(),
            "skill_records": {
                name: {
                    "activation_count": r.activation_count,
                    "performance_score": r.performance_score,
                    "improvement_history": list(r.improvement_history),
                }
                for name, r in self.skill_records.items()
            },
            "context": {
                "input": self.context.input_buffer.items,
                "output": self.context.output_buffer.items,
            },
        }

    def restore(self, backup: Dict[str, Any]) -> None:
        """
        Restore state produced by backup(). This brain must already be
        constructed with matching architecture (n_neurons, n_dimensions,
        n_groups, ...) — restore() loads state into the existing instance
        rather than reconstructing one, the same contract
        NeuralMesh.load_state()/ValeSystem.from_dict() already use, and
        raises ValueError (via mesh.load_state) if the architecture
        doesn't match.
        """
        self.mesh.load_state(backup["mesh"])
        self.vale = ValeSystem.from_dict(backup["vale"])
        self.hd.load_state(backup["hd"])
        self.extensions = ExtensionSystem.from_dict(backup.get("extensions", {}))
        self.mistakes = MistakeTracker.from_dict(backup.get("mistakes", {}))

        self.skill_records = {
            name: SkillRecord(
                name=name,
                activation_count=r["activation_count"],
                performance_score=r["performance_score"],
                improvement_history=list(r["improvement_history"]),
            )
            for name, r in backup.get("skill_records", {}).items()
        }

        ctx = backup.get("context", {})
        self.context.input_buffer.load_items(ctx.get("input", []))
        self.context.output_buffer.load_items(ctx.get("output", []))

        self._sync_vale_to_mesh()

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

    # -- Expert creation (spec Part 4 section 42) --------------------------

    def create_expert(self, name: str, n_new_neurons: int = 4) -> int:
        """
        Grow the mesh with a new, named expert group of freshly
        initialized neurons wired into the existing mesh ("new neurons are
        created... the new expert is trained"). ValeSystem is the single
        source of truth for vale, so the new neurons' real vale stake
        comes from vale.add_neurons() (funded proportionally out of the
        existing budget), immediately re-synced onto the mesh, rather than
        the mesh inventing vale for them itself. Their synapses are
        registered with the learning system so they participate in every
        subsequent perceive() cycle. Returns the new expert's group id.
        """
        group_id, new_ids = self.mesh.add_expert_group(name, n_new_neurons)
        self.vale.add_neurons(n_new_neurons, policy="rescale")
        self._sync_vale_to_mesh()

        new_id_set = set(new_ids)
        for nid in new_ids:
            self.states.register_neuron(str(nid))
        for (source_id, target_id) in self.mesh.connections:
            if source_id in new_id_set or target_id in new_id_set:
                self.states.register_synapse(str(source_id), str(target_id))

        return group_id
