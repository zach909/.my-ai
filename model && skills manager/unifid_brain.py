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
from .action_log import ActionLog


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

        # Spec Part 9 sections 161-163 / Part 10 section 191 (Action
        # History / Human Approval / Transparency): structural actions
        # below (create_expert, create_extension) are logged here. By
        # default nothing requires approval — a caller opts in via
        # actions.require_approval_for(...) to gate specific actions
        # behind approve()/deny() before they're allowed to run.
        self.actions = ActionLog()

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

        Logged as an action (sections 161-163): by default this runs
        immediately, but if a caller has registered an approval rule
        matching "create_extension:<name>" via
        self.actions.require_approval_for(...), this raises
        PermissionError until the pending action is approved.
        """
        record = self.actions.request(f"create_extension:{name}", why=purpose, system="extensions")

        def _do() -> Extension:
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
                # Spec: "Extensions get quantized when the extension is
                # done" -- quantize the *real* numeric weights this
                # extension is actually built from (the brain's current
                # vale ledger and mesh connection strengths), not just
                # flip a flag. See background_quantization.Quantizer.
                self.extensions.quantize(name, weights=self._extension_weight_snapshot())
            return ext

        return self.actions.perform(record, _do)

    def _extension_weight_snapshot(self) -> Dict[str, Any]:
        """
        A snapshot of the brain's current learned numeric state, in the
        plain-nested-list shape background_quantization.Quantizer expects:
        the vale ledger (one float per neuron) and the mean weight of
        every mesh connection as an n_neurons x n_neurons matrix. This is
        what create_extension() hands to ExtensionSystem.quantize() so
        "quantized" means an extension actually carries a real compressed
        weight bundle, not merely a stage label.
        """
        n = len(self.vale.v)
        connections: List[List[float]] = [[0.0] * n for _ in range(n)]
        for (source_id, target_id), conn in self.mesh.connections.items():
            if source_id < n and target_id < n and conn.weight_matrix:
                flat = [w for row in conn.weight_matrix for w in row]
                connections[source_id][target_id] = sum(flat) / len(flat)
        return {
            "vale": list(self.vale.v),
            "connections": connections,
        }

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

        Logged as an action (sections 161-163): by default this runs
        immediately, but if a caller has registered an approval rule
        matching "create_expert:<name>" via
        self.actions.require_approval_for(...), this raises
        PermissionError until the pending action is approved.
        """
        record = self.actions.request(
            f"create_expert:{name}", why=f"grow mesh with {n_new_neurons} new neurons", system="mesh"
        )

        def _do() -> int:
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

        return self.actions.perform(record, _do)
    """
Circular Context System

Implements spec Part 5 sections 66-69: instead of a fixed context window
that simply forgets whatever falls off the end (Input -> Process ->
Forget), the AI uses continuous buffers where eviction is a handoff, not a
deletion (Input -> Buffer -> Process -> Continue -> Loop): "the oldest
information is compressed" and "important information moves into memory"
rather than vanishing.
"""

from typing import Any, Callable, Generic, List, Optional, TypeVar

T = TypeVar("T")


class CircularBuffer(Generic[T]):
    """
    A fixed-capacity FIFO buffer. Pushing past capacity evicts the oldest
    item and hands it to `on_evict` (typically "compress this into
    memory") before dropping it, so nothing disappears without a trace.
    """

    def __init__(self, capacity: int, on_evict: Optional[Callable[[T], None]] = None):
        if capacity < 1:
            raise ValueError("capacity must be >= 1")
        self.capacity = capacity
        self.on_evict = on_evict
        self._items: List[T] = []

    def push(self, item: T) -> None:
        self._items.append(item)
        if len(self._items) > self.capacity:
            oldest = self._items.pop(0)
            if self.on_evict is not None:
                self.on_evict(oldest)

    def load_items(self, items: List[T]) -> None:
        """Replace the buffer's contents directly (e.g. restoring from a
        backup), bypassing on_evict — nothing here counts as forgotten."""
        self._items = list(items[-self.capacity:])

    @property
    def items(self) -> List[T]:
        return list(self._items)

    def __len__(self) -> int:
        return len(self._items)

    def size(self) -> int:
        """Alias for __len__ to match common API expectations."""
        return len(self._items)

    def __iter__(self):
        return iter(self._items)

    def is_full(self) -> bool:
        return len(self._items) >= self.capacity


class CircularContextSystem:
    """
    Pairs an input buffer and an output buffer (sections 67-68) under one
    name, each with its own eviction handler, so a caller (UnifiedBrain)
    doesn't have to wire two CircularBuffers up separately.
    """

    def __init__(
        self,
        capacity: int,
        on_input_evict: Optional[Callable[[Any], None]] = None,
        on_output_evict: Optional[Callable[[Any], None]] = None,
    ):
        self.input_buffer: CircularBuffer = CircularBuffer(capacity, on_evict=on_input_evict)
        self.output_buffer: CircularBuffer = CircularBuffer(capacity, on_evict=on_output_evict)

    def record_input(self, item: Any) -> None:
        self.input_buffer.push(item)

    def record_output(self, item: Any) -> None:
        self.output_buffer.push(item)

"""
Neural States and Learning Systems - Stage 2 Implementation

Implements detailed neural state representations and advanced learning mechanisms:
- Neural state vectors and dynamics
- Synaptic plasticity rules (Hebbian, STDP, homeostatic)
- Value systems for reinforcement learning
- State persistence and serialization
- Learning rate adaptation
"""

import math
import time
import json
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Tuple, Any
from enum import Enum
import random


class LearningRule(Enum):
    """Available learning rules."""
    HEBBIAN = "hebbian"
    STDP = "stdp"
    OJA = "oja"  # Normalized Hebbian
    BCM = "bcm"  # Bienenstock-Cooper-Munro
    REINFORCEMENT = "reinforcement"
    HOMEOSTATIC = "homeostatic"


class StateType(Enum):
    """Types of neural states."""
    MEMBRANE_POTENTIAL = "membrane_potential"
    ACTIVATION = "activation"
    CALCIUM = "calcium"
    CAMP = "camp"  # cAMP second messenger
    GENE_EXPRESSION = "gene_expression"
    SYNAPTIC_TAG = "synaptic_tag"
    ELIGIBILITY_TRACE = "eligibility_trace"


@dataclass
class NeuralState:
    """
    Complete state vector for a neuron.
    
    Tracks all internal variables that define neuron state.
    """
    neuron_id: str
    
    # Electrical state
    membrane_potential: float = 0.0
    activation: float = 0.0
    threshold: float = 0.5
    
    # Ionic concentrations (simplified)
    calcium_concentration: float = 0.0
    sodium_concentration: float = 140.0
    potassium_concentration: float = 5.0
    
    # Second messengers
    camp_level: float = 0.5
    
    # Gene expression (for long-term changes)
    gene_expression_level: float = 0.0
    protein_synthesis_rate: float = 0.0
    
    # Synaptic tagging (for memory consolidation)
    synaptic_tag: float = 0.0
    
    # Eligibility traces (for delayed reinforcement)
    eligibility_trace: float = 0.0
    eligibility_decay: float = 0.9
    
    # Temporal state
    last_spike_time: float = -1.0
    last_update_time: float = 0.0
    refractory_remaining: float = 0.0
    
    # Statistics
    total_spikes: int = 0
    average_firing_rate: float = 0.0
    spike_times: List[float] = field(default_factory=list)
    
    def update_eligibility_trace(self, dt: float = 0.001):
        """Decay eligibility trace over time."""
        self.eligibility_trace *= self.eligibility_decay ** (dt * 1000)
    
    def update_firing_rate(self, current_time: float):
        """Update running estimate of firing rate."""
        self.spike_times.append(current_time)
        
        # Keep only recent spikes (last 1 second)
        cutoff = current_time - 1.0
        self.spike_times = [t for t in self.spike_times if t > cutoff]
        
        if len(self.spike_times) >= 2:
            interval = self.spike_times[-1] - self.spike_times[0]
            if interval > 0:
                self.average_firing_rate = len(self.spike_times) / interval
    
    def to_dict(self) -> Dict:
        """Convert state to dictionary."""
        return {
            'neuron_id': self.neuron_id,
            'membrane_potential': self.membrane_potential,
            'activation': self.activation,
            'threshold': self.threshold,
            'calcium': self.calcium_concentration,
            'camp': self.camp_level,
            'gene_expression': self.gene_expression_level,
            'eligibility_trace': self.eligibility_trace,
            'firing_rate': self.average_firing_rate,
            'total_spikes': self.total_spikes
        }


@dataclass 
class SynapticState:
    """
    Complete state for a synapse.
    
    Includes weight, plasticity parameters, and temporal traces.
    """
    source_id: str
    target_id: str
    weight: float = 0.5
    
    # Plasticity parameters
    learning_rule: LearningRule = LearningRule.HEBBIAN
    learning_rate: float = 0.01
    decay_rate: float = 0.001
    
    # STDP parameters
    stdp_window: float = 0.02
    stdp_amplitude: float = 0.1
    
    # Temporal traces
    pre_trace: float = 0.0  # Presynaptic activity trace
    post_trace: float = 0.0  # Postsynaptic activity trace
    trace_decay: float = 0.9
    
    # Calcium-dependent plasticity
    calcium_threshold_ltp: float = 0.7  # High calcium -> LTP
    calcium_threshold_ltd: float = 0.3  # Medium calcium -> LTD
    
    # Weight bounds
    min_weight: float = -1.0
    max_weight: float = 1.0
    
    # Metaplasticity (learning rate adaptation)
    metaplasticity_threshold: float = 0.5
    accumulated_activity: float = 0.0
    
    def update_traces(self, pre_active: bool, post_active: bool, dt: float = 0.001):
        """Update presynaptic and postsynaptic traces."""
        if pre_active:
            self.pre_trace = min(1.0, self.pre_trace + 0.1)
        else:
            self.pre_trace *= self.trace_decay
        
        if post_active:
            self.post_trace = min(1.0, self.post_trace + 0.1)
        else:
            self.post_trace *= self.trace_decay
    
    def apply_hebbian(self, pre_activation: float, post_activation: float, dt: float):
        """Standard Hebbian learning."""
        delta = self.learning_rate * pre_activation * post_activation
        self.weight += delta * dt
        self._clamp_weight()
    
    def apply_stdp(self, pre_spike_time: float, post_spike_time: float):
        """Spike-timing-dependent plasticity."""
        delta_t = post_spike_time - pre_spike_time
        
        if abs(delta_t) < self.stdp_window:
            if delta_t > 0:
                # Pre before post: LTP
                delta_w = self.stdp_amplitude * math.exp(-delta_t / self.stdp_window)
            else:
                # Post before pre: LTD
                delta_w = -self.stdp_amplitude * math.exp(delta_t / self.stdp_window)
            
            self.weight += delta_w
            self._clamp_weight()
    
    def apply_oja(self, pre_activation: float, post_activation: float, dt: float):
        """Oja's rule - normalized Hebbian learning."""
        # Oja's rule: dw = η(yx - y²w)
        delta = self.learning_rate * (
            post_activation * pre_activation - 
            post_activation ** 2 * self.weight
        )
        self.weight += delta * dt
        self._clamp_weight()
    
    def apply_bcm(self, pre_activation: float, post_activation: float, dt: float):
        """BCM rule - sliding threshold plasticity."""
        # BCM: dw = η * y * x * (y - θ_m)
        # where θ_m is the metaplasticity threshold
        delta = self.learning_rate * post_activation * pre_activation * (
            post_activation - self.metaplasticity_threshold
        )
        self.weight += delta * dt
        
        # Update metaplasticity threshold (slowly track average activity)
        self.metaplasticity_threshold += 0.001 * (post_activation - self.metaplasticity_threshold)
        self._clamp_weight()
    
    def apply_reinforcement(self, reward_signal: float, eligibility: float, dt: float):
        """Three-factor reinforcement learning rule."""
        # dw = η * reward * eligibility_trace
        delta = self.learning_rate * reward_signal * eligibility
        self.weight += delta * dt
        self._clamp_weight()
    
    def apply_homeostatic(self, target_rate: float, current_rate: float, dt: float):
        """Homeostatic plasticity to maintain target firing rate."""
        error = target_rate - current_rate
        self.learning_rate *= (1.0 + 0.1 * error)
        self.learning_rate = max(0.001, min(0.1, self.learning_rate))
    
    def _clamp_weight(self):
        """Ensure weight stays within bounds."""
        self.weight = max(self.min_weight, min(self.max_weight, self.weight))
    
    def to_dict(self) -> Dict:
        """Convert state to dictionary."""
        return {
            'source': self.source_id,
            'target': self.target_id,
            'weight': self.weight,
            'learning_rule': self.learning_rule.value,
            'learning_rate': self.learning_rate,
            'pre_trace': self.pre_trace,
            'post_trace': self.post_trace
        }


class StateManager:
    """
    Manages neural states across the entire network.
    
    Provides:
    - State initialization
    - State updates
    - State persistence
    - State queries
    """
    
    def __init__(self):
        self.neuron_states: Dict[str, NeuralState] = {}
        self.synapse_states: Dict[str, SynapticState] = {}
        self.global_state: Dict[str, Any] = {
            'time': 0.0,
            'learning_enabled': True,
            'global_learning_rate': 0.01,
            'neuromodulators': {
                'dopamine': 0.5,
                'serotonin': 0.5,
                'acetylcholine': 0.5,
                'norepinephrine': 0.5
            }
        }
        
        # History for analysis
        self.state_history: List[Dict] = []
        self.history_max_length = 1000
    
    def register_neuron(self, neuron_id: str) -> NeuralState:
        """Register a new neuron state."""
        if neuron_id not in self.neuron_states:
            self.neuron_states[neuron_id] = NeuralState(neuron_id=neuron_id)
        return self.neuron_states[neuron_id]
    
    def register_synapse(self, source_id: str, target_id: str, 
                        weight: float = 0.5) -> SynapticState:
        """Register a new synapse state."""
        synapse_key = f"{source_id}->{target_id}"
        if synapse_key not in self.synapse_states:
            self.synapse_states[synapse_key] = SynapticState(
                source_id=source_id,
                target_id=target_id,
                weight=weight
            )
        return self.synapse_states[synapse_key]
    
    def get_neuron_state(self, neuron_id: str) -> Optional[NeuralState]:
        """Get state for a specific neuron."""
        return self.neuron_states.get(neuron_id)
    
    def get_synapse_state(self, source_id: str, target_id: str) -> Optional[SynapticState]:
        """Get state for a specific synapse."""
        synapse_key = f"{source_id}->{target_id}"
        return self.synapse_states.get(synapse_key)
    
    def update_time(self, dt: float):
        """Advance global time."""
        self.global_state['time'] += dt
    
    def record_state_snapshot(self):
        """Record current state for history."""
        snapshot = {
            'time': self.global_state['time'],
            'neuron_count': len(self.neuron_states),
            'synapse_count': len(self.synapse_states),
            'average_activation': sum(s.activation for s in self.neuron_states.values()) / max(1, len(self.neuron_states)),
            'average_weight': sum(s.weight for s in self.synapse_states.values()) / max(1, len(self.synapse_states))
        }
        
        self.state_history.append(snapshot)
        if len(self.state_history) > self.history_max_length:
            self.state_history.pop(0)
    
    def set_neuromodulator(self, name: str, value: float):
        """Set neuromodulator concentration."""
        if name in self.global_state['neuromodulators']:
            self.global_state['neuromodulators'][name] = max(0.0, min(1.0, value))
    
    def get_statistics(self) -> Dict:
        """Get comprehensive statistics about network state."""
        stats = {
            'time': self.global_state['time'],
            'neurons': {
                'count': len(self.neuron_states),
                'active_count': sum(1 for s in self.neuron_states.values() if s.activation > 0.5),
                'total_spikes': sum(s.total_spikes for s in self.neuron_states.values()),
                'average_firing_rate': sum(s.average_firing_rate for s in self.neuron_states.values()) / max(1, len(self.neuron_states))
            },
            'synapses': {
                'count': len(self.synapse_states),
                'average_weight': sum(s.weight for s in self.synapse_states.values()) / max(1, len(self.synapse_states)),
                'max_weight': max((s.weight for s in self.synapse_states.values()), default=0),
                'min_weight': min((s.weight for s in self.synapse_states.values()), default=0)
            },
            'neuromodulators': dict(self.global_state['neuromodulators']),
            'history_length': len(self.state_history)
        }
        return stats
    
    def save_to_file(self, filepath: str):
        """Save state to JSON file."""
        data = {
            'global_state': self.global_state,
            'neuron_states': {k: v.to_dict() for k, v in self.neuron_states.items()},
            'synapse_states': {k: v.to_dict() for k, v in self.synapse_states.items()},
            'history': self.state_history[-100:]  # Last 100 snapshots
        }
        
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
    
    def load_from_file(self, filepath: str):
        """Load state from JSON file."""
        with open(filepath, 'r') as f:
            data = json.load(f)
        
        self.global_state = data.get('global_state', self.global_state)
        
        for neuron_id, state_dict in data.get('neuron_states', {}).items():
            state = self.register_neuron(neuron_id)
            state.membrane_potential = state_dict.get('membrane_potential', 0.0)
            state.activation = state_dict.get('activation', 0.0)
            state.threshold = state_dict.get('threshold', 0.5)
            state.total_spikes = state_dict.get('total_spikes', 0)
        
        for synapse_key, state_dict in data.get('synapse_states', {}).items():
            parts = synapse_key.split('->')
            if len(parts) == 2:
                source_id, target_id = parts
                state = self.register_synapse(source_id, target_id)
                state.weight = state_dict.get('weight', 0.5)
                state.learning_rate = state_dict.get('learning_rate', 0.01)


class LearningSystem:
    """
    Centralized learning system that applies plasticity rules.
    
    Coordinates:
    - Multiple learning rules
    - Neuromodulator gating
    - Metaplasticity
    - Consolidation
    """
    
    def __init__(self, state_manager: StateManager):
        self.state_manager = state_manager
        self.active_rules: List[LearningRule] = [LearningRule.HEBBIAN]
        self.consolidation_enabled = True
        
        # Consolidation parameters
        self.consolidation_threshold = 0.8  # Tag strength for consolidation
        self.consolidation_rate = 0.001
    
    def apply_learning(self, dt: float = 0.001):
        """Apply all active learning rules."""
        if not self.state_manager.global_state['learning_enabled']:
            return
        
        dopamine = self.state_manager.global_state['neuromodulators'].get('dopamine', 0.5)
        
        for synapse_key, synapse in self.state_manager.synapse_states.items():
            # Get pre and post neuron states
            pre_state = self.state_manager.neuron_states.get(synapse.source_id)
            post_state = self.state_manager.neuron_states.get(synapse.target_id)
            
            if not pre_state or not post_state:
                continue
            
            # Apply each active learning rule
            for rule in self.active_rules:
                if rule == LearningRule.HEBBIAN:
                    synapse.apply_hebbian(
                        pre_state.activation,
                        post_state.activation,
                        dt * dopamine
                    )
                elif rule == LearningRule.OJA:
                    synapse.apply_oja(
                        pre_state.activation,
                        post_state.activation,
                        dt
                    )
                elif rule == LearningRule.BCM:
                    synapse.apply_bcm(
                        pre_state.activation,
                        post_state.activation,
                        dt
                    )
            
            # Update traces
            synapse.update_traces(
                pre_state.activation > 0.5,
                post_state.activation > 0.5,
                dt
            )
            
            # Homeostatic regulation
            synapse.apply_homeostatic(
                target_rate=0.3,
                current_rate=post_state.average_firing_rate,
                dt=dt
            )
    
    def apply_reinforcement(self, reward: float, dt: float = 0.001):
        """Apply reinforcement learning based on reward signal."""
        for synapse_key, synapse in self.state_manager.synapse_states.items():
            post_state = self.state_manager.neuron_states.get(synapse.target_id)
            if post_state:
                eligibility = post_state.eligibility_trace
                synapse.apply_reinforcement(reward, eligibility, dt)
    
    def consolidate_memories(self, dt: float = 0.001):
        """Consolidate strong synaptic tags into long-term changes."""
        if not self.consolidation_enabled:
            return
        
        for synapse_key, synapse in self.state_manager.synapse_states.items():
            post_state = self.state_manager.neuron_states.get(synapse.target_id)
            if post_state and post_state.synaptic_tag > self.consolidation_threshold:
                # Strengthen synapse permanently
                synapse.weight += self.consolidation_rate * dt
                synapse._clamp_weight()
                
                # Reduce tag after consolidation
                post_state.synaptic_tag *= 0.9


__all__ = [
    'NeuralState',
    'SynapticState', 
    'StateManager',
    'LearningSystem',
    'LearningRule',
    'StateType'"""
Hyper-Dimensional Thinking (HDT) System

Reference implementation of the design in docs/HYPERDIMENSIONAL_THINKING.md.

Gives every neuron a structured, multi-subspace internal state (semantic,
context, value, temporary, meta) instead of a single scalar, and defines:
- hyperdimensional algebra for communication (bind/bundle/permute/unbind)
- per-neuron state transitions with temporary vs. long-term state
- online prediction with surprise-gated consolidation
- an associative long-term memory store
- compositional reasoning (analogy solving, sequence queries)

Pure Python, no external numeric dependencies, consistent with the rest of
asi_core (neural_core.py, neural_mesh.py, neural_states.py).
"""

import math
import random
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# 2. State vectors
# ---------------------------------------------------------------------------

class HDVector:
    """
    A D-dimensional hypervector partitioned into named subspaces:
    semantic (sem), context (ctx), value (val), temporary (tmp), meta (meta).

    Layout is fixed by fractional sizes so all vectors in a system are
    comparable under bind/bundle/similarity.
    """

    SEM_FRAC = 0.40
    CTX_FRAC = 0.25
    VAL_FRAC = 0.10
    TMP_FRAC = 0.15
    META_FRAC = 0.10

    __slots__ = ("data", "_bounds")

    def __init__(self, data: List[float], bounds: Tuple[int, int, int, int, int]):
        self.data = data
        self._bounds = bounds  # cumulative end indices: (sem_end, ctx_end, val_end, tmp_end, meta_end)

    @staticmethod
    def _compute_bounds(dimensions: int) -> Tuple[int, int, int, int, int]:
        sem = max(1, round(dimensions * HDVector.SEM_FRAC))
        ctx = max(1, round(dimensions * HDVector.CTX_FRAC))
        val = max(1, round(dimensions * HDVector.VAL_FRAC))
        tmp = max(1, round(dimensions * HDVector.TMP_FRAC))
        meta = dimensions - sem - ctx - val - tmp
        if meta < 1:
            meta = 1
        sem_end = sem
        ctx_end = sem_end + ctx
        val_end = ctx_end + val
        tmp_end = val_end + tmp
        meta_end = tmp_end + meta
        return (sem_end, ctx_end, val_end, tmp_end, meta_end)

    @classmethod
    def zeros(cls, dimensions: int) -> "HDVector":
        bounds = cls._compute_bounds(dimensions)
        return cls([0.0] * bounds[-1], bounds)

    @classmethod
    def random(cls, dimensions: int, seed: Optional[int] = None) -> "HDVector":
        rng = random.Random(seed)
        bounds = cls._compute_bounds(dimensions)
        data = [rng.uniform(-1.0, 1.0) for _ in range(bounds[-1])]
        vec = cls(data, bounds)
        return vec.normalized()

    @property
    def dimensions(self) -> int:
        return self._bounds[-1]

    def _slice(self, lo: int, hi: int) -> List[float]:
        return self.data[lo:hi]

    def _set_slice(self, lo: int, hi: int, values: List[float]) -> None:
        self.data[lo:hi] = list(values)[: hi - lo]

    @property
    def sem(self) -> List[float]:
        return self._slice(0, self._bounds[0])

    @sem.setter
    def sem(self, values: List[float]) -> None:
        self._set_slice(0, self._bounds[0], values)

    @property
    def ctx(self) -> List[float]:
        return self._slice(self._bounds[0], self._bounds[1])

    @ctx.setter
    def ctx(self, values: List[float]) -> None:
        self._set_slice(self._bounds[0], self._bounds[1], values)

    @property
    def val(self) -> List[float]:
        return self._slice(self._bounds[1], self._bounds[2])

    @val.setter
    def val(self, values: List[float]) -> None:
        self._set_slice(self._bounds[1], self._bounds[2], values)

    @property
    def tmp(self) -> List[float]:
        return self._slice(self._bounds[2], self._bounds[3])

    @tmp.setter
    def tmp(self, values: List[float]) -> None:
        self._set_slice(self._bounds[2], self._bounds[3], values)

    @property
    def meta(self) -> List[float]:
        return self._slice(self._bounds[3], self._bounds[4])

    @meta.setter
    def meta(self, values: List[float]) -> None:
        self._set_slice(self._bounds[3], self._bounds[4], values)

    def copy(self) -> "HDVector":
        return HDVector(list(self.data), self._bounds)

    def norm(self) -> float:
        return math.sqrt(sum(v * v for v in self.data)) or 1e-12

    def normalized(self) -> "HDVector":
        n = self.norm()
        return HDVector([v / n for v in self.data], self._bounds)

    def __len__(self) -> int:
        return len(self.data)

    def __repr__(self) -> str:
        return f"HDVector(D={self.dimensions})"


# ---------------------------------------------------------------------------
# 6. Communication — hyperdimensional algebra
# ---------------------------------------------------------------------------

def _check_compat(a: HDVector, b: HDVector) -> None:
    if a.dimensions != b.dimensions:
        raise ValueError(f"Dimension mismatch: {a.dimensions} vs {b.dimensions}")


def bind(a: HDVector, b: HDVector) -> HDVector:
    """Elementwise multiply — combine two vectors into a dissimilar-to-both one."""
    _check_compat(a, b)
    return HDVector([x * y for x, y in zip(a.data, b.data)], a._bounds)


def unbind(a: HDVector, b: HDVector) -> HDVector:
    """Inverse of bind under elementwise multiply (b assumed unit-magnitude components)."""
    _check_compat(a, b)
    out = []
    for x, y in zip(a.data, b.data):
        out.append(x / y if abs(y) > 1e-9 else 0.0)
    return HDVector(out, a._bounds)


def bundle(*vectors: HDVector, weights: Optional[List[float]] = None) -> HDVector:
    """Weighted elementwise mean, renormalized — superpose several vectors into one."""
    if not vectors:
        raise ValueError("bundle() requires at least one vector")
    bounds = vectors[0]._bounds
    for v in vectors:
        _check_compat(vectors[0], v)
    if weights is None:
        weights = [1.0] * len(vectors)
    total_w = sum(weights) or 1.0
    dims = bounds[-1]
    acc = [0.0] * dims
    for vec, w in zip(vectors, weights):
        for i in range(dims):
            acc[i] += vec.data[i] * w
    acc = [v / total_w for v in acc]
    return HDVector(acc, bounds).normalized()


def permute(a: HDVector, k: int) -> HDVector:
    """Cyclic shift by k — encodes sequence position without consuming a bind slot."""
    n = len(a.data)
    k = k % n
    if k == 0:
        return a.copy()
    shifted = a.data[-k:] + a.data[:-k]
    return HDVector(shifted, a._bounds)


def cosine_similarity(a: HDVector, b: HDVector) -> float:
    _check_compat(a, b)
    dot = sum(x * y for x, y in zip(a.data, b.data))
    denom = a.norm() * b.norm()
    return dot / denom if denom > 1e-12 else 0.0


# ---------------------------------------------------------------------------
# 13. Data structures
# ---------------------------------------------------------------------------

class NeuronPhase(Enum):
    IDLE = "idle"
    INTEGRATING = "integrating"
    PREDICTING = "predicting"
    CONSOLIDATING = "consolidating"


class MemoryKind(Enum):
    """
    Spec Part 3 section 22 ("Types of Memory"). Short-term working memory
    isn't stored here at all — it's the live `HDNeuron.state.tmp`, which is
    already exactly that: high-activity, temporary, low-vale. This enum
    covers what actually gets written into `MemoryStore`.
    """
    LONG_TERM = "long_term"      # proven-useful, high-value & low-surprise outcomes
    EXPERIENCE = "experience"    # confidently negative outcomes: mistakes/failures to avoid repeating


@dataclass
class HDConfig:
    dimensions: int = 512
    leak_sem: float = 0.3
    leak_ctx: float = 0.3
    leak_val: float = 0.05
    leak_tmp: float = 0.7  # fraction replaced by new evidence each tick
    predictor_lr: float = 0.05
    theta_val: float = 0.6       # long-term consolidation threshold: value/vale must exceed this
    theta_experience: float = 0.3  # experience-memory threshold: value/vale must fall below this
    theta_meta: float = 0.3      # consolidation threshold: surprise must be below this
    theta_merge: float = 0.85    # merge into existing memory trace if similarity exceeds this
    theta_confident: float = 0.8  # reasoning early-exit confidence
    decay_ltm: float = 0.9999
    min_strength: float = 0.05
    reasoning_max_depth: int = 3


@dataclass
class Message:
    sender_id: int
    vector: HDVector
    weight: float = 1.0


@dataclass
class MemoryTrace:
    key: HDVector
    value: HDVector
    strength: float = 1.0
    last_tick: int = 0
    kind: str = MemoryKind.LONG_TERM.value


@dataclass
class TickResult:
    tick: int
    activations: Dict[int, HDVector]
    surprises: Dict[int, float]
    consolidated: int
    statistics: Dict[str, Any]


class MemoryStore:
    """Associative long-term memory: consolidated (key, value) hypervector traces."""

    def __init__(self, config: HDConfig):
        self.config = config
        self.traces: List[MemoryTrace] = []

    def write(self, key: HDVector, value: HDVector, tick: int, kind: str = MemoryKind.LONG_TERM.value) -> bool:
        """Insert a trace, merging into an existing similar trace of the same
        kind instead of growing unboundedly (a mistake should never merge
        into a proven-good long-term trace just because they look similar)."""
        for trace in self.traces:
            if trace.kind == kind and cosine_similarity(key, trace.key) >= self.config.theta_merge:
                trace.value = bundle(trace.value, value, weights=[trace.strength, 1.0])
                trace.key = bundle(trace.key, key, weights=[trace.strength, 1.0])
                trace.strength = min(2.0, trace.strength + 1.0)
                trace.last_tick = tick
                return False
        self.traces.append(
            MemoryTrace(key=key.copy(), value=value.copy(), strength=1.0, last_tick=tick, kind=kind)
        )
        return True

    def recall(self, cue: HDVector, k: int = 1, kind: Optional[str] = None) -> List[MemoryTrace]:
        pool = self.traces if kind is None else [t for t in self.traces if t.kind == kind]
        scored = sorted(pool, key=lambda t: cosine_similarity(cue, t.key), reverse=True)
        return scored[:k]

    def decay_and_prune(self) -> None:
        for trace in self.traces:
            trace.strength *= self.config.decay_ltm
        self.traces = [t for t in self.traces if t.strength >= self.config.min_strength]

    def __len__(self) -> int:
        return len(self.traces)


class HDNeuron:
    """
    A single hyper-dimensional-thinking neuron.

    Holds a structured HDVector state (temporary, fast-moving), a slower
    linear predictor of its own next state, and bookkeeping for the phase
    state machine described in the spec (section 3).
    """

    def __init__(self, neuron_id: int, config: HDConfig, seed: Optional[int] = None):
        self.id = neuron_id
        self.config = config
        self.state = HDVector.zeros(config.dimensions)
        # Diagonal predictor by default (O(D)): x_hat = P ⊙ x_prev
        self.predictor_diag: List[float] = [1.0] * config.dimensions
        self.phase = NeuronPhase.IDLE
        self.last_error: float = 0.0
        self.consolidation_count: int = 0
        self._rng = random.Random(seed)

    def position_code(self) -> HDVector:
        """Deterministic per-neuron position hypervector used to bind context."""
        return HDVector.random(self.config.dimensions, seed=self.id * 7919 + 1)

    def predict(self, prev_state: HDVector) -> HDVector:
        return HDVector(
            [p * x for p, x in zip(self.predictor_diag, prev_state.data)],
            prev_state._bounds,
        )

    def _update_predictor(self, prev_state: HDVector, error: HDVector) -> None:
        lr = self.config.predictor_lr
        for i in range(len(self.predictor_diag)):
            self.predictor_diag[i] += lr * error.data[i] * prev_state.data[i]

    def step(self, inbound: HDVector, reward: float, dt: float = 1.0) -> float:
        """
        Run one full transition (integrate -> bind context -> update semantic
        -> update value -> predict & measure surprise). Returns the surprise
        (prediction error norm) for this tick.
        """
        prev_state = self.state.copy()

        # 1. Integrate inbound evidence into tmp (fast working state).
        self.phase = NeuronPhase.INTEGRATING
        rho_tmp = 1.0 - self.config.leak_tmp
        new_tmp = [
            rho_tmp * old + (1 - rho_tmp) * new
            for old, new in zip(self.state.tmp, inbound.tmp)
        ]
        self.state.tmp = new_tmp

        # 2. Bind context with this neuron's position code.
        pos = self.position_code()
        bound_ctx = [s * p for s, p in zip(self.state.sem, pos.sem)]
        leak_ctx = self.config.leak_ctx
        self.state.ctx = [
            (1 - leak_ctx) * old + leak_ctx * math.tanh(b)
            for old, b in zip(self.state.ctx, bound_ctx[: len(self.state.ctx)])
        ]

        # 3. Update semantic subspace toward tanh(inbound).
        leak_sem = self.config.leak_sem
        self.state.sem = [
            (1 - leak_sem) * old + leak_sem * math.tanh(new)
            for old, new in zip(self.state.sem, inbound.sem)
        ]

        # 4. Update value (reward-tracking EMA).
        leak_val = self.config.leak_val
        self.state.val = [
            max(0.0, min(1.0, (1 - leak_val) * old + leak_val * reward))
            for old in self.state.val
        ]

        # 5. Predict & measure surprise.
        self.phase = NeuronPhase.PREDICTING
        predicted = self.predict(prev_state)
        error_vec = HDVector(
            [a - b for a, b in zip(self.state.data, predicted.data)],
            self.state._bounds,
        )
        error_norm = error_vec.norm()
        self._update_predictor(prev_state, error_vec)
        # Overflow-safe softplus of error_norm, shifted so surprise -> 0 as
        # error_norm -> 0 (unshifted softplus floors at ln(2) even for a
        # perfect prediction, which made consolidation's avg_meta < theta_meta
        # check unreachable at the default threshold).
        surprise = math.log1p(math.exp(min(50.0, error_norm))) - math.log(2.0)
        self.state.meta = [surprise] * len(self.state.meta)
        self.last_error = surprise

        self.phase = NeuronPhase.IDLE
        return surprise

    def should_consolidate(self) -> bool:
        avg_val = sum(self.state.val) / len(self.state.val)
        avg_meta = sum(self.state.meta) / len(self.state.meta)
        return avg_val > self.config.theta_val and avg_meta < self.config.theta_meta

    def should_record_experience(self) -> bool:
        """
        Spec Part 3 section 22: experience memory captures confidently bad
        outcomes ("a previous coding mistake", "a failed experiment") so
        they aren't repeated — the mirror image of should_consolidate()'s
        confidently good outcomes.
        """
        avg_val = sum(self.state.val) / len(self.state.val)
        avg_meta = sum(self.state.meta) / len(self.state.meta)
        return avg_val < self.config.theta_experience and avg_meta < self.config.theta_meta


# ---------------------------------------------------------------------------
# 11. Public API — the orchestrating system
# ---------------------------------------------------------------------------

class HDThinkingSystem:
    """
    Orchestrates a mesh of HDNeurons: ticking, message routing, prediction,
    memory consolidation/recall, and compositional reasoning.
    """

    def __init__(
        self,
        n_neurons: int,
        dimensions: int = 512,
        n_input: int = 8,
        n_groups: int = 4,
        config: Optional[HDConfig] = None,
        seed: Optional[int] = 42,
    ):
        if n_input >= n_neurons:
            raise ValueError("n_input must be < n_neurons")
        self.config = config or HDConfig(dimensions=dimensions)
        self.n_neurons = n_neurons
        self.n_input = n_input
        self.n_groups = n_groups
        self._rng = random.Random(seed)

        self.neurons: Dict[int, HDNeuron] = {
            i: HDNeuron(i, self.config, seed=seed + i if seed is not None else None)
            for i in range(n_neurons)
        }
        # Sparse random connectivity (edge weight is a scalar gain applied
        # after binding — the O(D) "diagonal edge" mode from the spec).
        self.edge_weights: Dict[Tuple[int, int], float] = {}
        self._init_connections(connection_probability=0.15)

        self.memory = MemoryStore(self.config)
        self.current_tick: int = 0
        self.history: List[Dict[str, Any]] = []
        self._history_max = 500

    def _init_connections(self, connection_probability: float) -> None:
        for src in range(self.n_neurons):
            for tgt in range(self.n_neurons):
                if src != tgt and self._rng.random() < connection_probability:
                    self.edge_weights[(src, tgt)] = self._rng.uniform(-0.5, 0.5)

    # -- Communication -----------------------------------------------------

    def send_message(self, source: int, target: int, vector: HDVector) -> None:
        weight = self.edge_weights.get((source, target), 0.0)
        if weight == 0.0:
            return
        current = getattr(self, "_pending", None)
        if current is None:
            self._pending = {i: [] for i in range(self.n_neurons)}
            current = self._pending
        current[target].append(Message(source, vector, weight))

    def _gather_inbound(self, target: int) -> HDVector:
        dims = self.config.dimensions
        messages = [
            Message(src, self.neurons[src].state, w)
            for (src, tgt), w in self.edge_weights.items()
            if tgt == target
        ]
        if not messages:
            return HDVector.zeros(dims)
        bound = [bind(m.vector, HDVector([m.weight] * dims, m.vector._bounds)) for m in messages]
        return bundle(*bound)

    # -- Dynamic updates -----------------------------------------------------

    def tick(self, inputs: Optional[Dict[int, HDVector]] = None, reward: float = 0.5) -> TickResult:
        inputs = inputs or {}
        activations: Dict[int, HDVector] = {}
        surprises: Dict[int, float] = {}

        for nid, neuron in self.neurons.items():
            inbound = inputs.get(nid) or self._gather_inbound(nid)
            surprise = neuron.step(inbound, reward=reward)
            activations[nid] = neuron.state.copy()
            surprises[nid] = surprise

        consolidated = self.consolidate()
        self.current_tick += 1

        stats = self.get_statistics()
        result = TickResult(
            tick=self.current_tick,
            activations=activations,
            surprises=surprises,
            consolidated=consolidated,
            statistics=stats,
        )
        self.history.append({"tick": self.current_tick, "consolidated": consolidated,
                              "avg_surprise": sum(surprises.values()) / max(1, len(surprises))})
        if len(self.history) > self._history_max:
            self.history.pop(0)
        return result

    # -- Prediction -----------------------------------------------------

    def predict(self, horizon: int = 1) -> Dict[int, HDVector]:
        predictions: Dict[int, HDVector] = {}
        for nid, neuron in self.neurons.items():
            state = neuron.state
            for _ in range(horizon):
                state = neuron.predict(state)
            predictions[nid] = state
        return predictions

    # -- Memory interaction -----------------------------------------------------

    def consolidate(self) -> int:
        count = 0
        for neuron in self.neurons.values():
            kind = None
            if neuron.should_consolidate():
                kind = MemoryKind.LONG_TERM.value
            elif neuron.should_record_experience():
                kind = MemoryKind.EXPERIENCE.value

            if kind is not None:
                key = HDVector(neuron.state.ctx + [0.0] * (self.config.dimensions - len(neuron.state.ctx)),
                               neuron.state._bounds)
                value = HDVector(neuron.state.sem + [0.0] * (self.config.dimensions - len(neuron.state.sem)),
                                  neuron.state._bounds)
                if self.memory.write(key, value, self.current_tick, kind=kind):
                    count += 1
                neuron.consolidation_count += 1
        self.memory.decay_and_prune()
        return count

    def recall(self, cue: HDVector, k: int = 1, kind: Optional[str] = None) -> List[MemoryTrace]:
        return self.memory.recall(cue, k, kind=kind)

    # -- Reasoning -----------------------------------------------------

    def reason(self, a: HDVector, b: HDVector, c: HDVector) -> HDVector:
        """Analogy solve: a : b :: c : ? via d = bind(c, unbind(b, a))."""
        relation = unbind(b, a)
        d_hat = bind(c, relation)
        depth = 0
        best = d_hat
        while depth < self.config.reasoning_max_depth:
            matches = self.recall(best, k=1)
            if not matches:
                break
            sim = cosine_similarity(best, matches[0].value)
            if sim >= self.config.theta_confident:
                return matches[0].value
            best = bundle(best, matches[0].value)
            depth += 1
        return best

    # -- Persistence & stats -----------------------------------------------------

    def get_neuron(self, neuron_id: int) -> HDNeuron:
        return self.neurons[neuron_id]

    def get_statistics(self) -> Dict[str, Any]:
        avg_val = sum(sum(n.state.val) / len(n.state.val) for n in self.neurons.values()) / self.n_neurons
        avg_meta = sum(sum(n.state.meta) / len(n.state.meta) for n in self.neurons.values()) / self.n_neurons
        return {
            "tick": self.current_tick,
            "n_neurons": self.n_neurons,
            "n_connections": len(self.edge_weights),
            "memory_size": len(self.memory),
            "average_value": avg_val,
            "average_surprise": avg_meta,
        }

    def save_state(self) -> Dict[str, Any]:
        return {
            "tick": self.current_tick,
            "neurons": {
                nid: {"state": n.state.data, "predictor_diag": n.predictor_diag,
                      "consolidation_count": n.consolidation_count}
                for nid, n in self.neurons.items()
            },
            "memory": [
                {
                    "key": t.key.data,
                    "value": t.value.data,
                    "strength": t.strength,
                    "last_tick": t.last_tick,
                    "kind": t.kind,
                }
                for t in self.memory.traces
            ],
        }

    def load_state(self, state: Dict[str, Any]) -> None:
        self.current_tick = state.get("tick", 0)
        for nid_str, n_data in state.get("neurons", {}).items():
            nid = int(nid_str)
            if nid in self.neurons:
                neuron = self.neurons[nid]
                neuron.state = HDVector(list(n_data["state"]), neuron.state._bounds)
                neuron.predictor_diag = list(n_data["predictor_diag"])
                neuron.consolidation_count = n_data.get("consolidation_count", 0)
        bounds = HDVector.zeros(self.config.dimensions)._bounds
        self.memory.traces = [
            MemoryTrace(
                key=HDVector(list(t["key"]), bounds),
                value=HDVector(list(t["value"]), bounds),
                strength=t["strength"],
                last_tick=t["last_tick"],
                kind=t.get("kind", MemoryKind.LONG_TERM.value),
            )
            for t in state.get("memory", [])
        ]


__all__ = [
    "HDVector",
    "bind",
    "unbind",
    "bundle",
    "permute",
    "cosine_similarity",
    "NeuronPhase",
    "HDConfig",
    "Message",
    "MemoryTrace",
    "TickResult",
    "MemoryStore",
    "HDNeuron",
    "HDThinkingSystem",
]

]
"""
Background Value (Vale) System - Complete Reference Implementation

Vale is a strictly zero-sum scalar assigned to every neuron in the mesh.
It represents accumulated "stability capital": neurons that hold a large
share of vale change slowly (they are treated as consolidated, trustworthy
knowledge), while neurons holding little vale are free to change quickly
(they are treated as raw plastic capacity available for new learning).

Because the total amount of vale in the system is fixed, no neuron can gain
stability without an equal amount of plasticity capacity being released
somewhere else. This document/module treats that constraint as an
invariant, not a guideline: every operation that touches vale is defined in
terms of a single conserving primitive (`_apply_conserving`) that either
preserves the system-wide (or transfer-local) sum exactly, or reports the
shortfall when the bounds make exact conservation impossible.

See docs/VALE_SYSTEM.md for the full mathematical specification. This
module is the executable counterpart of that document; the two are kept in
sync deliberately -- section headers below mirror section headers there.
"""

import math
import random
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple, Union


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class ValeError(Exception):
    """Base class for vale-system errors."""


class ValeConfigError(ValeError):
    """Raised when a ValeConfig describes an infeasible system."""


class ValeInvariantError(ValeError):
    """Raised when the zero-sum or bounds invariant has been violated."""


# ---------------------------------------------------------------------------
# Policies
# ---------------------------------------------------------------------------

class DonorPolicy(Enum):
    """How a donor set shares the burden of giving up vale."""
    PROPORTIONAL = "proportional"       # give proportional to current vale ("wealth tax")
    UNIFORM = "uniform"                 # give equal absolute amounts
    INVERSE_UTILITY = "inverse_utility"  # least-useful neurons give first


class RecipientPolicy(Enum):
    """How a recipient set shares an incoming amount of vale."""
    PROPORTIONAL_HEADROOM = "proportional_headroom"  # more room -> more received
    UNIFORM = "uniform"                              # equal absolute amounts
    UTILITY_WEIGHTED = "utility_weighted"             # most-useful neurons receive first


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class ValeConfig:
    """
    Static configuration for a ValeSystem.

    v_min / v_max bound every individual neuron's vale. v_total is the
    conserved system-wide sum. Feasibility requires
    n_neurons * v_min <= v_total <= n_neurons * v_max; this is validated
    at construction time (see "Edge cases").
    """
    n_neurons: int
    v_min: float = 0.01
    v_max: float = 0.99
    v_total: Optional[float] = None          # default: n_neurons * 0.5 * (v_min+v_max)... see below
    v_init: Optional[float] = None           # default: v_total / n_neurons (uniform init)
    init_jitter: float = 0.0                 # optional Gaussian jitter std-dev at init

    # Learning-equation parameters
    utility_learning_rate: float = 0.02      # eta_v: how fast utility differences move vale
    utility_ema_decay: float = 0.98          # smoothing of raw per-tick utility signals
    plasticity_gamma: float = 1.0            # shape of the plasticity(v) curve

    # Long-term stability parameters
    relax_rate: float = 0.002                # eta_r: pull toward target distribution per tick
    target_distribution: Optional[Callable[[int], List[float]]] = None  # n -> target vale vector
    freeze_threshold: float = 0.97           # fraction of v_max considered "frozen"
    max_frozen_fraction: float = 0.25        # hard ceiling on frozen-neuron fraction
    renormalize_every: int = 500             # ticks between float-drift correction passes

    epsilon: float = 1e-9

    def __post_init__(self):
        if self.n_neurons < 1:
            raise ValeConfigError("n_neurons must be >= 1")
        if not (0.0 <= self.v_min < self.v_max):
            raise ValeConfigError("require 0 <= v_min < v_max")
        if self.v_total is None:
            self.v_total = self.n_neurons * 0.5 * (self.v_min + self.v_max)
        if self.v_init is None:
            self.v_init = self.v_total / self.n_neurons
        lo = self.n_neurons * self.v_min
        hi = self.n_neurons * self.v_max
        if not (lo - self.epsilon <= self.v_total <= hi + self.epsilon):
            raise ValeConfigError(
                f"v_total={self.v_total} infeasible for n={self.n_neurons} "
                f"neurons with bounds [{self.v_min}, {self.v_max}] "
                f"(feasible range is [{lo}, {hi}])"
            )
        if not (self.v_min - self.epsilon <= self.v_init <= self.v_max + self.epsilon):
            raise ValeConfigError("v_init must lie within [v_min, v_max]")


# ---------------------------------------------------------------------------
# Core system
# ---------------------------------------------------------------------------

class ValeSystem:
    """
    Manages the zero-sum vale ledger for a population of neurons.

    Internal data structures
    -------------------------
    v[i]            : current vale of neuron i                 (list[float])
    utility_ema[i]  : smoothed utility signal driving redistribution
    activation_ema[i]: smoothed |activation| used as a fallback utility term
    age[i]          : number of ticks the neuron has existed
    frozen[i]        : derived, True when v[i] >= freeze_threshold * v_max
    tick            : global step counter
    _history        : bounded ring buffer of summary snapshots (diagnostics/tests)
    """

    def __init__(self, config: ValeConfig, seed: Optional[int] = None):
        self.cfg = config
        self._rng = random.Random(seed)

        n = config.n_neurons
        self.v: List[float] = self._initial_distribution(n)
        self.utility_ema: List[float] = [0.0] * n
        self.activation_ema: List[float] = [0.0] * n
        self.age: List[int] = [0] * n

        self.tick: int = 0
        self._history: deque = deque(maxlen=2000)
        self.last_shortfall: float = 0.0

        self._validate(strict=True)

    # -- initialization -----------------------------------------------------

    def _initial_distribution(self, n: int) -> List[float]:
        """
        Uniform initialization with optional bounded Gaussian jitter.
        Jitter is applied then re-balanced with the conserving primitive so
        v_total is exact even when init_jitter > 0 (see "Initialization").
        """
        base = [self.cfg.v_init] * n
        if self.cfg.init_jitter > 0 and n > 1:
            noise = [self._rng.gauss(0.0, self.cfg.init_jitter) for _ in range(n)]
            mean = sum(noise) / n
            desired = [x - mean for x in noise]  # mean-centered => zero-sum by construction
            self.v = list(base)
            self._apply_conserving(desired)
            return self.v
        return base

    # -- invariant checking ---------------------------------------------------

    def _validate(self, strict: bool = False) -> bool:
        total = sum(self.v)
        ok_total = abs(total - self.cfg.v_total) <= max(1e-6, 1e-9 * len(self.v))
        ok_bounds = all(self.cfg.v_min - 1e-9 <= x <= self.cfg.v_max + 1e-9 for x in self.v)
        if strict and not (ok_total and ok_bounds):
            raise ValeInvariantError(
                f"vale invariant violated: total={total} (expected {self.cfg.v_total}), "
                f"bounds_ok={ok_bounds}"
            )
        return ok_total and ok_bounds

    def validate_invariant(self) -> bool:
        """Public, non-raising check. Use `_validate(strict=True)` to raise."""
        return self._validate(strict=False)

    # -- the conserving primitive --------------------------------------------

    def _apply_conserving(
        self,
        desired: Union[Dict[int, float], List[float]],
        participants: Optional[Iterable[int]] = None,
    ) -> Tuple[Dict[int, float], float]:
        """
        Apply per-neuron deltas subject to [v_min, v_max], redistributing any
        clipping overflow across the remaining `participants` in proportion
        to their available headroom, iterating to convergence (water-filling).

        `desired` should sum to ~0 over `participants` for a true zero-sum
        transfer; the one intentional exception is drift renormalization,
        which injects a small non-zero net sum on purpose.

        Returns (actual_delta_per_index, unresolved_shortfall). A non-zero
        shortfall means the requested transfer could not be completed
        without violating a bound -- e.g. every donor was already at v_min.
        """
        idx = list(participants) if participants is not None else list(range(len(self.v)))
        if isinstance(desired, list):
            remaining = {i: desired[i] for i in idx if abs(desired[i]) > self.cfg.epsilon}
        else:
            remaining = {i: d for i, d in desired.items() if abs(d) > self.cfg.epsilon}

        actual: Dict[int, float] = {i: 0.0 for i in idx}
        max_rounds = len(idx) + 3

        for _ in range(max_rounds):
            if not remaining:
                break
            overflow = 0.0
            for i, d in list(remaining.items()):
                v_new = self.v[i] + d
                if v_new > self.cfg.v_max + self.cfg.epsilon:
                    clipped = self.cfg.v_max - self.v[i]
                    overflow += d - clipped
                    self.v[i] = self.cfg.v_max
                    actual[i] += clipped
                elif v_new < self.cfg.v_min - self.cfg.epsilon:
                    clipped = self.cfg.v_min - self.v[i]
                    overflow += d - clipped
                    self.v[i] = self.cfg.v_min
                    actual[i] += clipped
                else:
                    self.v[i] = v_new
                    actual[i] += d

            if abs(overflow) <= self.cfg.epsilon:
                remaining = {}
                break

            if overflow > 0:
                candidates = [i for i in idx if self.v[i] < self.cfg.v_max - self.cfg.epsilon]
                headroom = {i: self.cfg.v_max - self.v[i] for i in candidates}
            else:
                candidates = [i for i in idx if self.v[i] > self.cfg.v_min + self.cfg.epsilon]
                headroom = {i: self.v[i] - self.cfg.v_min for i in candidates}

            total_headroom = sum(headroom.values())
            if not candidates or total_headroom <= self.cfg.epsilon:
                self.last_shortfall = overflow
                return actual, overflow

            remaining = {
                i: overflow * (headroom[i] / total_headroom)
                for i in candidates
            }

        self.last_shortfall = 0.0
        return actual, 0.0

    # -- runtime update (the learning equation) -------------------------------

    def step(self, utility: Optional[Sequence[float]] = None, dt: float = 1.0) -> Dict:
        """
        Advance the vale ledger by one tick.

        1. Ingest/derive a utility signal u_i for every neuron and smooth it
           with an EMA.
        2. Apply the mean-centered redistribution update:
               delta_i = eta_v * dt * (u_i - mean(u))
           This is zero-sum *by construction*: sum(delta_i) == 0 exactly,
           because it is a deviation from the mean. Bound clipping is then
           reconciled by `_apply_conserving`.
        3. Apply a slow relaxation toward the configured target distribution
           to prevent runaway polarization (also mean-centered).
        4. Enforce the max-frozen-fraction safety valve.
        5. Periodically correct floating-point drift.
        """
        n = len(self.v)
        if n == 0:
            self.tick += 1
            return self.statistics()

        if utility is None:
            u_raw = self._fallback_utility()
        else:
            u_raw = self._sanitize(list(utility))

        decay = self.cfg.utility_ema_decay
        self.utility_ema = [
            decay * self.utility_ema[i] + (1 - decay) * u_raw[i] for i in range(n)
        ]

        u = self.utility_ema
        ubar = sum(u) / n
        desired = [self.cfg.utility_learning_rate * dt * (u[i] - ubar) for i in range(n)]
        self._apply_conserving(desired)

        if self.cfg.relax_rate > 0 and n > 1:
            target = self._target_distribution()
            relax = [self.cfg.relax_rate * dt * (target[i] - self.v[i]) for i in range(n)]
            rbar = sum(relax) / n
            relax = [r - rbar for r in relax]  # mean-center: guarantees zero-sum even if
            self._apply_conserving(relax)      # `target` doesn't sum to exactly v_total

        self._enforce_frozen_fraction()

        self.age = [a + 1 for a in self.age]
        self.tick += 1

        if self.cfg.renormalize_every and self.tick % self.cfg.renormalize_every == 0:
            self._renormalize()

        self._record_snapshot()
        return self.statistics()

    def record_activity(self, neuron_id: int, activation: float, contribution: float = 0.0):
        """
        Hook for external callers (learning systems, memory systems) to feed
        per-tick signals that inform the fallback utility function when an
        explicit utility vector isn't supplied to `step()`.
        `contribution` should be a signed estimate of how much this neuron's
        recent activity reduced (positive) or increased (negative) error.
        """
        decay = self.cfg.utility_ema_decay
        self.activation_ema[neuron_id] = (
            decay * self.activation_ema[neuron_id] + (1 - decay) * abs(activation)
        )
        # contribution folded directly into the utility EMA so it participates
        # in the very next step() even before the fallback path recomputes it
        self.utility_ema[neuron_id] = (
            decay * self.utility_ema[neuron_id] + (1 - decay) * contribution
        )

    def _fallback_utility(self) -> List[float]:
        """
        Utility signal used when the caller doesn't supply one explicitly.
        Rewards moderate, homeostatic activity (neither dead nor saturated)
        using the activation EMA collected via `record_activity`.
        """
        target = 0.3
        return [-(abs(a - target)) for a in self.activation_ema]

    @staticmethod
    def _sanitize(values: List[float]) -> List[float]:
        return [0.0 if (v is None or math.isnan(v) or math.isinf(v)) else v for v in values]

    def _target_distribution(self) -> List[float]:
        n = len(self.v)
        if self.cfg.target_distribution is not None:
            target = list(self.cfg.target_distribution(n))
            tsum = sum(target)
            if tsum > 0:
                scale = self.cfg.v_total / tsum
                target = [t * scale for t in target]
            return target
        return [self.cfg.v_total / n] * n

    def _enforce_frozen_fraction(self):
        """
        Safety valve ("forgetting prevention" cuts both ways): if too many
        neurons have frozen solid, the system loses its ability to learn
        anything new. Force-demote the least-useful frozen neurons back to
        v_init whenever the frozen fraction exceeds the configured ceiling.
        """
        n = len(self.v)
        if n == 0:
            return
        threshold = self.cfg.freeze_threshold * self.cfg.v_max
        frozen = [i for i in range(n) if self.v[i] >= threshold]
        max_frozen = int(self.cfg.max_frozen_fraction * n)
        if len(frozen) <= max_frozen:
            return
        frozen.sort(key=lambda i: self.utility_ema[i])  # least useful first
        excess = frozen[: len(frozen) - max_frozen]
        self.demote(excess, amount=sum(max(0.0, self.v[i] - self.cfg.v_init) for i in excess))

    def _renormalize(self):
        """
        Correct accumulated floating-point drift by nudging every neuron by
        an equal share of (v_total - sum(v)). This is the one place a
        non-mean-centered (net non-zero) delta is applied on purpose: its
        entire point is to restore sum(v) == v_total exactly.
        """
        drift = self.cfg.v_total - sum(self.v)
        if abs(drift) <= self.cfg.epsilon:
            return
        n = len(self.v)
        self._apply_conserving([drift / n] * n)
        # Any residual (all neurons saturated) is intentionally left as
        # last_shortfall for callers/tests to notice.

    def _record_snapshot(self):
        self._history.append({
            "tick": self.tick,
            "mean": sum(self.v) / len(self.v) if self.v else 0.0,
            "min": min(self.v) if self.v else 0.0,
            "max": max(self.v) if self.v else 0.0,
            "frozen": sum(1 for x in self.v if x >= self.cfg.freeze_threshold * self.cfg.v_max),
        })

    # -- promotion / demotion / transfer (explicit API) ------------------------

    def transfer(
        self,
        from_ids: Sequence[int],
        to_ids: Sequence[int],
        amount: float,
        donor_policy: DonorPolicy = DonorPolicy.PROPORTIONAL,
        recipient_policy: RecipientPolicy = RecipientPolicy.PROPORTIONAL_HEADROOM,
    ) -> float:
        """
        Move up to `amount` of vale from from_ids to to_ids, respecting
        bounds. Returns the amount actually transferred (<= amount; less
        only if donors or recipients ran out of headroom).

        Implemented as two independently-conserving water-fills of the same
        feasible amount T: T is withdrawn from `from_ids` (bounded by their
        combined headroom-down) and then deposited into `to_ids` (bounded by
        their combined headroom-up). Because both legs move exactly T, the
        system-wide sum is unaffected regardless of how each side
        internally distributes it -- donors are never asked to "give back"
        to cover a recipient-side shortfall, or vice versa.
        """
        if amount < 0:
            raise ValueError("amount must be >= 0")
        from_ids = list(dict.fromkeys(from_ids))
        to_ids = list(dict.fromkeys(to_ids))
        if not from_ids or not to_ids or amount == 0:
            return 0.0

        donor_capacity = sum(self.v[i] - self.cfg.v_min for i in from_ids)
        recip_capacity = sum(self.cfg.v_max - self.v[i] for i in to_ids)
        transferable = min(amount, donor_capacity, recip_capacity)
        if transferable <= self.cfg.epsilon:
            return 0.0

        donor_weights = self._weights(from_ids, donor_policy.value, donor=True)
        recip_weights = self._weights(to_ids, recipient_policy.value, donor=False)

        take_desired = {i: -transferable * donor_weights[i] for i in from_ids}
        self._apply_conserving(take_desired, participants=from_ids)

        give_desired = {i: transferable * recip_weights[i] for i in to_ids}
        self._apply_conserving(give_desired, participants=to_ids)

        return transferable

    def _weights(self, ids: Sequence[int], policy: str, donor: bool) -> Dict[int, float]:
        n = len(ids)
        if policy in ("uniform",):
            return {i: 1.0 / n for i in ids}
        if policy == "inverse_utility":
            raw = {i: 1.0 / (abs(self.utility_ema[i]) + 1e-6) for i in ids}
        elif policy == "utility_weighted":
            shifted = {i: self.utility_ema[i] - min(self.utility_ema[j] for j in ids) + 1e-6 for i in ids}
            raw = shifted
        else:  # proportional (vale) for donors, proportional headroom for recipients
            if donor:
                raw = {i: self.v[i] for i in ids}
            else:
                raw = {i: (self.cfg.v_max - self.v[i]) for i in ids}
        total = sum(raw.values())
        if total <= self.cfg.epsilon:
            return {i: 1.0 / n for i in ids}
        return {i: raw[i] / total for i in ids}

    def promote(
        self,
        neuron_ids: Sequence[int],
        amount: float,
        donors: Optional[Sequence[int]] = None,
        donor_policy: DonorPolicy = DonorPolicy.PROPORTIONAL,
    ) -> float:
        """Raise stability of `neuron_ids`, funded by `donors` (default: everyone else)."""
        neuron_set = set(neuron_ids)
        donors = list(donors) if donors is not None else [
            i for i in range(len(self.v)) if i not in neuron_set
        ]
        if not donors:
            return 0.0
        return self.transfer(donors, list(neuron_ids), amount, donor_policy=donor_policy)

    def demote(
        self,
        neuron_ids: Sequence[int],
        amount: float,
        recipients: Optional[Sequence[int]] = None,
        recipient_policy: RecipientPolicy = RecipientPolicy.PROPORTIONAL_HEADROOM,
    ) -> float:
        """Lower stability of `neuron_ids`, releasing capital to `recipients` (default: everyone else)."""
        neuron_set = set(neuron_ids)
        recipients = list(recipients) if recipients is not None else [
            i for i in range(len(self.v)) if i not in neuron_set
        ]
        if not recipients:
            return 0.0
        return self.transfer(list(neuron_ids), recipients, amount, recipient_policy=recipient_policy)

    def protect(self, neuron_ids: Sequence[int], target: Optional[float] = None) -> float:
        """
        Convenience for memory consolidation: push neurons close to v_max
        (default target = freeze_threshold * v_max).
        """
        target = target if target is not None else self.cfg.freeze_threshold * self.cfg.v_max
        amount = sum(max(0.0, target - self.v[i]) for i in neuron_ids)
        return self.promote(list(neuron_ids), amount)

    def release(self, neuron_ids: Sequence[int]) -> float:
        """Convenience: return neurons to v_init, releasing their capital back to the pool."""
        amount = sum(max(0.0, self.v[i] - self.cfg.v_init) for i in neuron_ids)
        return self.demote(list(neuron_ids), amount)

    # -- plasticity / learning-rate interface -----------------------------------

    def plasticity(self, neuron_id: int) -> float:
        """
        Plasticity multiplier in [0, 1]: 1.0 at v_min (fully plastic), 0.0 at
        v_max (fully stable). Shape controlled by `plasticity_gamma`.
        """
        span = self.cfg.v_max - self.cfg.v_min
        if span <= 0:
            return 0.0
        frac = (self.cfg.v_max - self.v[neuron_id]) / span
        frac = min(1.0, max(0.0, frac))
        return frac ** self.cfg.plasticity_gamma

    def effective_learning_rate(self, neuron_id: int, base_lr: float) -> float:
        return base_lr * self.plasticity(neuron_id)

    def consolidation_penalty(self, neuron_id: int, weight: float, anchor: float, lam: float) -> float:
        """
        Elastic-weight-consolidation-style penalty gradient that anchors a
        weight to `anchor` (its value when the owning neuron was last
        promoted/protected) in proportion to the neuron's current vale.
        Subtract this from a weight update to resist forgetting.
        """
        return lam * self.v[neuron_id] * (weight - anchor)

    def is_frozen(self, neuron_id: int) -> bool:
        return self.v[neuron_id] >= self.cfg.freeze_threshold * self.cfg.v_max

    # -- population changes -------------------------------------------------

    def add_neurons(self, count: int, policy: str = "rescale") -> List[int]:
        """
        Grow the population by `count` neurons.

        policy="rescale" (default): existing neurons fund the new neurons'
            v_init out of the *existing* pool -- the pre-growth v_total is
            preserved exactly, it is simply re-partitioned across more
            neurons (each existing neuron ends up holding a little less).
        policy="grow": v_total increases by count * v_init; the system gains
            fresh capital rather than redistributing existing capital.
            Documented as the one deliberate exception to strict
            conservation -- use only when neurogenesis should not cost
            existing neurons anything.
        """
        if count <= 0:
            raise ValueError("count must be > 0")
        n_old = len(self.v)
        new_ids = list(range(n_old, n_old + count))
        self.utility_ema.extend([0.0] * count)
        self.activation_ema.extend([0.0] * count)
        self.age.extend([0] * count)

        if policy == "grow":
            self.cfg.v_total += count * self.cfg.v_init
            self.v.extend([self.cfg.v_init] * count)
        elif policy == "rescale":
            # New neurons must land at >= v_min immediately, which is itself
            # real capital; bump v_total to match the append so the
            # invariant holds mid-operation, then have existing neurons buy
            # the new neurons up from v_min to v_init via a normal transfer
            # (which conserves this now-current v_total exactly).
            self.cfg.v_total += count * self.cfg.v_min
            self.v.extend([self.cfg.v_min] * count)
            topup = count * (self.cfg.v_init - self.cfg.v_min)
            donors = list(range(n_old))
            if topup > 0 and donors:
                self.transfer(donors, new_ids, topup)
        else:
            raise ValueError(f"unknown policy: {policy}")

        self._validate(strict=True)
        return new_ids

    def remove_neurons(self, neuron_ids: Sequence[int]):
        """
        Remove neurons and return their vale to the remaining population
        (spread proportional to headroom). v_total shrinks by their
        contribution's worth only if headroom is insufficient to fully
        absorb it (recorded as last_shortfall); otherwise v_total is
        adjusted downward by exactly the removed neurons' vale so the
        invariant among *remaining* neurons stays exact.
        """
        remove_set = set(neuron_ids)
        keep = [i for i in range(len(self.v)) if i not in remove_set]
        if not keep:
            self.v, self.utility_ema, self.activation_ema, self.age = [], [], [], []
            self.cfg.v_total = 0.0
            return

        freed = sum(self.v[i] for i in remove_set)

        new_v = [self.v[i] for i in keep]
        new_u = [self.utility_ema[i] for i in keep]
        new_a = [self.activation_ema[i] for i in keep]
        new_age = [self.age[i] for i in keep]

        self.v, self.utility_ema, self.activation_ema, self.age = new_v, new_u, new_a, new_age

        headroom = {i: self.cfg.v_max - self.v[i] for i in range(len(self.v))}
        total_headroom = sum(headroom.values())
        if total_headroom > self.cfg.epsilon:
            distribute = min(freed, total_headroom)
            desired = [distribute * (headroom[i] / total_headroom) for i in range(len(self.v))]
            self._apply_conserving(desired)
            self.cfg.v_total = self.cfg.v_total - freed + distribute
        else:
            self.cfg.v_total -= freed

        self._validate(strict=True)

    # -- persistence ----------------------------------------------------------

    def to_dict(self) -> Dict:
        return {
            "config": {
                "n_neurons": len(self.v),
                "v_min": self.cfg.v_min,
                "v_max": self.cfg.v_max,
                "v_total": self.cfg.v_total,
                "utility_learning_rate": self.cfg.utility_learning_rate,
                "utility_ema_decay": self.cfg.utility_ema_decay,
                "plasticity_gamma": self.cfg.plasticity_gamma,
                "relax_rate": self.cfg.relax_rate,
                "freeze_threshold": self.cfg.freeze_threshold,
                "max_frozen_fraction": self.cfg.max_frozen_fraction,
                "renormalize_every": self.cfg.renormalize_every,
            },
            "v": list(self.v),
            "utility_ema": list(self.utility_ema),
            "activation_ema": list(self.activation_ema),
            "age": list(self.age),
            "tick": self.tick,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "ValeSystem":
        cfg_data = dict(data["config"])
        cfg = ValeConfig(**cfg_data)
        obj = cls.__new__(cls)
        obj.cfg = cfg
        obj._rng = random.Random()
        obj.v = list(data["v"])
        obj.utility_ema = list(data["utility_ema"])
        obj.activation_ema = list(data["activation_ema"])
        obj.age = list(data["age"])
        obj.tick = data.get("tick", 0)
        obj._history = deque(maxlen=2000)
        obj.last_shortfall = 0.0
        obj._validate(strict=True)
        return obj

    # -- diagnostics ------------------------------------------------------------

    def statistics(self) -> Dict:
        n = len(self.v)
        if n == 0:
            return {"n": 0, "tick": self.tick}
        mean = sum(self.v) / n
        variance = sum((x - mean) ** 2 for x in self.v) / n
        frozen_count = sum(1 for i in range(n) if self.is_frozen(i))
        return {
            "n": n,
            "tick": self.tick,
            "v_total": sum(self.v),
            "v_total_target": self.cfg.v_total,
            "mean": mean,
            "std": math.sqrt(variance),
            "min": min(self.v),
            "max": max(self.v),
            "frozen_count": frozen_count,
            "frozen_fraction": frozen_count / n,
            "last_shortfall": self.last_shortfall,
        }

    def history(self) -> List[Dict]:
        return list(self._history)


__all__ = [
    "ValeSystem",
    "ValeConfig",
    "DonorPolicy",
    "RecipientPolicy",
    "ValeError",
    "ValeConfigError",
    "ValeInvariantError",
]
"""
ASI Neural Core - Stage 1 Implementation

A neural mesh architecture for Artificial Superintelligence.

This implements a true all-to-all connected neural mesh with:
- Multidimensional neuron states (each neuron has a D-dimensional state vector)
- Full connectivity (every neuron connects to every other neuron)
- Zero-sum value system (vale) controlling plasticity
- Dynamic learning based on neuron state, input, and value
- Persistent internal neural state across ticks
- Support for specialized neural groups (experts)
- Compressed internal representations

Architecture follows the Prometheus design from the existing mesh.py implementation
but provides a standalone Python reference implementation for the ASI system.
"""

import math
import time
import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Set
from enum import Enum
import json


class NeuronRole(Enum):
    """Role of a neuron in the mesh."""
    INPUT = "input"       # Receives external input
    HIDDEN = "hidden"     # Internal computation
    OUTPUT = "output"     # Produces output
    EXPERT = "expert"     # Specialized expert neuron


@dataclass
class NeuronState:
    """
    Complete multidimensional state of a single neuron.
    
    Each neuron maintains a D-dimensional state vector plus metadata.
    """
    neuron_id: int
    role: NeuronRole = NeuronRole.HIDDEN
    group: int = 0  # Expert/skill group membership
    
    # Multidimensional state vector
    state_vector: List[float] = field(default_factory=lambda: [0.0])
    
    # Value system (vale) - controls plasticity resistance
    # High vale = resists change, Low vale = learns readily
    vale: float = 0.1
    
    # Input flag (dimension 0 reserved for external input indicator)
    input_flag: float = 0.0
    
    # Activation after settle
    activation: float = 0.0
    
    # Temporal tracking
    last_spike_time: float = -1.0
    total_spikes: int = 0
    consecutive_divergence: int = 0  # For live correction
    
    # Statistics
    average_activation: float = 0.0
    update_count: int = 0

    # Explicit per-neuron input bias set by the Neural Definition Language's
    # `"name"@connections="target*weight+bias"` override (see neural_dsl.py):
    # a DSL-declared connection's bias term is additive input this neuron
    # receives every settle tick, on top of whatever the all-to-all weights
    # compute, so an explicit override can express "this neuron leans toward
    # firing/not firing" independent of its incoming weights.
    dsl_bias: float = 0.0

    def initialize_state(self, dimensions: int, rng: Optional[random.Random] = None):
        """Initialize state vector with given dimensions."""
        source = rng or random
        self.state_vector = [source.gauss(0, 0.1) for _ in range(dimensions)]
        self.input_flag = 0.0
        
    def get_content_state(self) -> List[float]:
        """Get state excluding the input flag (dimension 0)."""
        return self.state_vector[1:] if len(self.state_vector) > 1 else []
    
    def set_input_driven(self, is_driven: bool):
        """Set whether this neuron is externally driven."""
        self.input_flag = 1.0 if is_driven else 0.0


@dataclass
class SynapticConnection:
    """
    Connection between two neurons in the mesh.
    
    Each connection is a D×D weight matrix allowing cross-dimensional influence.
    """
    source_id: int
    target_id: int
    
    # Weight matrix: W[target_dim][source_dim]
    weight_matrix: List[List[float]] = field(default_factory=list)
    
    # Learning parameters gated by target's vale
    base_learning_rate: float = 0.01
    
    # Eligibility trace for delayed learning
    eligibility_trace: float = 0.0
    eligibility_decay: float = 0.9
    
    def initialize_weights(self, dimensions: int, scale: float = 0.1, rng: Optional[random.Random] = None):
        """Initialize weight matrix with small random values."""
        source = rng or random
        self.weight_matrix = [
            [source.gauss(0, scale) for _ in range(dimensions)]
            for _ in range(dimensions)
        ]
    
    def apply_vale_gate(self, vale: float) -> float:
        """Get effective learning rate gated by vale."""
        # High vale = low plasticity, Low vale = high plasticity
        return self.base_learning_rate * (1.0 - vale)


class NeuralMesh:
    """
    A fully connected neural mesh with all-to-all connectivity.
    
    This implements:
    - True all-to-all density (every neuron reads every other)
    - D×D weight blocks for cross-dimensional reasoning
    - Settle dynamics through iterative propagation
    - Zero-sum vale system for plasticity control
    - Live correction for divergent settles
    - Continuous operation with state carry-over
    - Expert groups with selective activation
    """
    
    def __init__(
        self,
        n_neurons: int = 64,
        n_dimensions: int = 4,
        n_input: int = 8,
        n_groups: int = 4,
        settle_ticks: int = 4,
        vale_init: float = 0.1,
        divergence_tolerance: float = 0.5,
        sustained_divergence_ticks: int = 3,
        continuous: bool = False,
        seed: Optional[int] = None,
        auto_route: bool = False,
        group_score_decay: float = 0.9
    ):
        # Validate configuration
        assert n_dimensions >= 2, "Need dim 0 for input flag plus >=1 content dim"
        assert 1 <= n_input < n_neurons, "Input neurons must be subset of total"

        self._rng = random.Random(seed) if seed is not None else random
        self.n_neurons = n_neurons
        self.n_dimensions = n_dimensions
        self.n_input = n_input
        self.n_groups = n_groups
        self.settle_ticks = settle_ticks
        self.vale_total = vale_init * n_neurons  # Zero-sum budget
        self.divergence_tolerance = divergence_tolerance
        self.sustained_divergence_ticks = sustained_divergence_ticks
        self.continuous = continuous
        
        # Initialize neurons
        self.neurons: Dict[int, NeuronState] = {}
        self._initialize_neurons()
        
        # Initialize connections (all-to-all, no self-connections)
        self.connections: Dict[Tuple[int, int], SynapticConnection] = {}
        self._initialize_connections()
        
        # State management
        self.current_tick: int = 0
        self.global_time: float = 0.0
        self._carried_state: Optional[Dict[int, List[float]]] = None  # For continuous mode
        
        # Diagnostics
        self._live_corrections = 0
        self._divergence_events = 0
        self._settle_history: List[Dict] = []
        
        # Skill/expert routing
        self.active_groups: Set[int] = set(range(n_groups))  # All active by default
        self.skill_top_k = min(2, n_groups)

        # Optional top-k expert-group router. When disabled (default),
        # `active_groups` is purely caller-controlled, as before. When
        # enabled, `activate()` recomputes it every call from each group's
        # recent-activity score, always keeping one round-robin exploration
        # slot so a group that has never been picked is not starved forever.
        self.auto_route = auto_route
        self.group_score_decay = group_score_decay
        self.group_scores: List[float] = [0.0] * n_groups
        self._route_explore_cursor = 0

        # Spec Part 4 section 39: expert groups are given human-readable
        # names ("Coding Expert", "Language Expert", ...) instead of being
        # addressed only by numeric id. Unnamed groups get a stable default.
        self.group_names: Dict[int, str] = {i: f"expert_{i}" for i in range(n_groups)}
        
    def _initialize_neurons(self):
        """Create all neurons with appropriate roles and groups."""
        for i in range(self.n_neurons):
            # Assign roles
            if i < self.n_input:
                role = NeuronRole.INPUT
            elif i < self.n_input + 4:  # Some output neurons
                role = NeuronRole.OUTPUT
            else:
                role = NeuronRole.HIDDEN
            
            # Assign to groups (round-robin for balanced distribution)
            group = i % self.n_groups
            
            neuron = NeuronState(
                neuron_id=i,
                role=role,
                group=group,
                vale=self.vale_total / self.n_neurons  # Equal initial distribution
            )
            neuron.initialize_state(self.n_dimensions, rng=self._rng)
            self.neurons[i] = neuron
    
    def _initialize_connections(self):
        """Create all-to-all connections excluding self-connections."""
        scale = 1.0 / math.sqrt(self.n_neurons * self.n_dimensions)
        
        for source_id in range(self.n_neurons):
            for target_id in range(self.n_neurons):
                if source_id != target_id:  # No self-connections
                    conn = SynapticConnection(
                        source_id=source_id,
                        target_id=target_id,
                        base_learning_rate=0.01
                    )
                    conn.initialize_weights(self.n_dimensions, scale, rng=self._rng)
                    self.connections[(source_id, target_id)] = conn
    
    def redistribute_vale(self, changes: Dict[int, float]):
        """
        Redistribute vale values while maintaining zero-sum constraint.
        
        Args:
            changes: Dictionary mapping neuron_id to desired vale change
        """
        # Calculate total increase needed
        total_increase = sum(max(0, c) for c in changes.values())
        total_decrease = sum(abs(c) for c in changes.values() if c < 0)
        
        # Apply direct changes
        for neuron_id, change in changes.items():
            if neuron_id in self.neurons:
                new_vale = self.neurons[neuron_id].vale + change
                self.neurons[neuron_id].vale = max(0.0, min(1.0, new_vale))
        
        # Redistribute to maintain zero-sum
        current_total = sum(n.vale for n in self.neurons.values())
        if abs(current_total - self.vale_total) > 1e-6:
            # Proportionally adjust all neurons
            ratio = self.vale_total / current_total if current_total > 0 else 1.0
            for neuron in self.neurons.values():
                neuron.vale = max(0.0, min(1.0, neuron.vale * ratio))
    
    def raise_vale(self, neuron_ids: List[int], amount: float = 0.3):
        """Raise vale (stability) of specified neurons, lowering others proportionally."""
        changes = {nid: amount for nid in neuron_ids}
        self.redistribute_vale(changes)
    
    def demote_vale(self, neuron_ids: List[int], amount: float = 0.3):
        """Lower vale (plasticity) of specified neurons, raising others proportionally."""
        changes = {nid: -amount for nid in neuron_ids}
        self.redistribute_vale(changes)
    
    def clamp_input_neurons(self, input_pattern: List[float]):
        """
        Clamp external input onto input neurons.
        
        Args:
            input_pattern: Values to clamp onto input neurons (length <= n_input)
        """
        for i, value in enumerate(input_pattern[:self.n_input]):
            if i in self.neurons:
                neuron = self.neurons[i]
                neuron.set_input_driven(True)
                # Set content dimensions (skip dimension 0 which is the flag)
                for d in range(1, min(len(neuron.state_vector), len(input_pattern) + 1)):
                    if d <= len(input_pattern):
                        neuron.state_vector[d] = input_pattern[d - 1] if d - 1 < len(input_pattern) else 0
    
    def compute_neuron_input(self, neuron_id: int, active_mask: Optional[Set[int]] = None) -> List[float]:
        """
        Compute total input to a neuron from all other neurons.
        
        Args:
            neuron_id: Target neuron ID
            active_mask: Optional set of active neuron IDs (for expert routing)
            
        Returns:
            List of input values for each dimension
        """
        result = [0.0] * self.n_dimensions
        
        # Check if neuron is active (for expert routing)
        if active_mask is not None and neuron_id not in active_mask:
            return result  # Dormant neuron receives no update
        
        neuron = self.neurons.get(neuron_id)
        if not neuron:
            return result
        
        # Sum contributions from all source neurons
        for source_id in range(self.n_neurons):
            if source_id == neuron_id:
                continue  # Skip self-connection
            
            if active_mask is not None and source_id not in active_mask:
                continue  # Skip inactive sources
            
            source = self.neurons.get(source_id)
            if not source:
                continue
            
            conn = self.connections.get((source_id, neuron_id))
            if not conn:
                continue
            
            # Matrix-vector multiplication: result[d] += sum(W[d][s] * source_state[s])
            for target_d in range(self.n_dimensions):
                for source_d in range(self.n_dimensions):
                    if source_d < len(source.state_vector):
                        result[target_d] += conn.weight_matrix[target_d][source_d] * source.state_vector[source_d]
        
        # Add bias (stored as connection from a virtual bias neuron)
        # For simplicity, we add a small constant bias, plus any explicit
        # DSL-declared bias for this neuron (see NeuronState.dsl_bias).
        total_bias = 0.01 + neuron.dsl_bias
        for d in range(self.n_dimensions):
            result[d] += total_bias

        return result

    def set_connection_weight(self, source_id: int, target_id: int, weight: float) -> None:
        """
        Explicit connection override (Neural Definition Language spec:
        `"name"@connections="target*weight+bias"`). Uniformly overwrites the
        source->target weight matrix with `weight`, replacing whatever
        random/learned matrix was there -- the DSL's explicit connection
        statement is meant to pin a specific weight, not nudge it.
        """
        conn = self.connections.get((source_id, target_id))
        if conn is None:
            raise ValueError(f"no such connection: {source_id} -> {target_id}")
        conn.weight_matrix = [[weight for _ in range(self.n_dimensions)] for _ in range(self.n_dimensions)]

    def add_dsl_bias(self, target_id: int, bias: float) -> None:
        """Accumulate an explicit DSL-declared bias onto a neuron's input term."""
        if target_id in self.neurons:
            self.neurons[target_id].dsl_bias += bias
    
    def activate(self, input_vector: List[float]) -> List[float]:
        """
        Process input through the mesh and return output.
        
        Args:
            input_vector: Input values for input neurons
            
        Returns:
            Output values from output neurons
        """
        self.current_tick = 0
        
        # Reset non-input neurons if not in continuous mode
        if not self.continuous:
            # Use fixed initialization for deterministic behavior
            for neuron_id, neuron in self.neurons.items():
                if neuron.role != NeuronRole.INPUT:
                    # Reset state vector to zero (deterministic)
                    neuron.state_vector = [0.0] * self.n_dimensions
                    neuron.input_flag = 0.0
                    neuron.activation = 0.0
                    neuron.consecutive_divergence = 0
        
        # Clamp inputs
        self.clamp_input_neurons(input_vector)

        # Route to top-k expert groups before settling, using scores from
        # the previous cycle's activity (opt-in; see auto_route).
        if self.auto_route:
            self.update_group_routing()

        # Run settle loop
        settled_state = self._settle()
        
        # Read output
        output = self._read_output()
        
        return output
    
    def _settle(self) -> Dict[int, List[float]]:
        """
        Run the settle loop until convergence or max ticks.
        
        Implements live correction for divergent settles.
        """
        prev_state = {nid: list(n.state_vector) for nid, n in self.neurons.items()}
        consecutive_high_divergence = 0
        
        for tick in range(self.settle_ticks):
            self.current_tick = tick
            
            # Determine active neurons (expert routing)
            active_mask = self._get_active_neurons()
            
            # Update each neuron
            new_states: Dict[int, List[float]] = {}
            max_divergence = 0.0
            
            for neuron_id, neuron in self.neurons.items():
                if active_mask is not None and neuron_id not in active_mask:
                    # Dormant neurons maintain state
                    new_states[neuron_id] = list(neuron.state_vector)
                    continue
                
                # Compute input from all other neurons
                neuron_input = self.compute_neuron_input(neuron_id, active_mask)
                
                # Apply nonlinearity (tanh) to each dimension
                new_state = []
                for d in range(self.n_dimensions):
                    if d == 0:
                        # Dimension 0 is the input flag - maintain it
                        new_state.append(neuron.input_flag)
                    else:
                        # Content dimensions - apply tanh
                        total_input = neuron_input[d] if d < len(neuron_input) else 0
                        activated = math.tanh(total_input)
                        new_state.append(activated)
                
                new_states[neuron_id] = new_state
                
                # Calculate divergence from previous state
                divergence = sum(
                    (new_state[d] - prev_state[neuron_id][d]) ** 2
                    for d in range(min(len(new_state), len(prev_state[neuron_id])))
                ) ** 0.5
                max_divergence = max(max_divergence, divergence)
                
                # Track consecutive divergence for live correction
                if divergence > self.divergence_tolerance:
                    neuron.consecutive_divergence += 1
                else:
                    neuron.consecutive_divergence = 0
            
            # Live correction for sustained divergence
            if consecutive_high_divergence >= self.sustained_divergence_ticks:
                self._apply_divergence_correction(prev_state, new_states)
                self._live_corrections += 1
                consecutive_high_divergence = 0
                # Reset neuron-level divergence counters after correction
                for neuron in self.neurons.values():
                    neuron.consecutive_divergence = 0
            
            if max_divergence > self.divergence_tolerance:
                consecutive_high_divergence += 1
            else:
                consecutive_high_divergence = 0
            
            # Update neuron states
            for neuron_id, new_state in new_states.items():
                self.neurons[neuron_id].state_vector = new_state
                self.neurons[neuron_id].activation = sum(new_state[1:]) / max(1, len(new_state) - 1)
            
            prev_state = new_states
        
        # Store settled state for diagnostics
        self._last_settled = dict(prev_state)
        
        return prev_state
    
    def _get_active_neurons(self) -> Optional[Set[int]]:
        """
        Get set of active neurons based on expert routing.

        `active_groups` is the gate: by default every group is active, but a
        caller may restrict it manually, or `auto_route=True` can be set to
        have `activate()` recompute it every call via `update_group_routing`
        (top-k expert-group selection, see that method).
        """
        if self.n_groups <= 1:
            return None  # All neurons active

        active_neurons = set()
        for neuron_id, neuron in self.neurons.items():
            if neuron.group in self.active_groups:
                active_neurons.add(neuron_id)
        
        return active_neurons

    def update_group_routing(self) -> Set[int]:
        """
        Recompute `active_groups` as a top-k expert-group selection.

        Each group's score is an EMA of its members' mean absolute
        activation from the previous cycle, so groups that have recently
        been useful are favored (spec: "Activate experts" as part of the
        continuous tick cycle). One slot of `skill_top_k` is always
        reserved for round-robin exploration of a currently-inactive group,
        so a group with a stale low score is never starved permanently.
        """
        for group in range(self.n_groups):
            members = [n for n in self.neurons.values() if n.group == group]
            avg_activity = (
                sum(abs(n.activation) for n in members) / len(members) if members else 0.0
            )
            self.group_scores[group] = (
                self.group_score_decay * self.group_scores[group]
                + (1 - self.group_score_decay) * avg_activity
            )

        top_k = max(1, min(self.skill_top_k, self.n_groups))
        ranked = sorted(range(self.n_groups), key=lambda g: self.group_scores[g], reverse=True)

        if top_k >= self.n_groups:
            selected = set(range(self.n_groups))
        else:
            selected = set(ranked[: top_k - 1]) if top_k > 1 else set()
            remaining = [g for g in range(self.n_groups) if g not in selected]
            for _ in range(len(remaining)):
                candidate = remaining[self._route_explore_cursor % len(remaining)]
                self._route_explore_cursor += 1
                if candidate not in selected:
                    selected.add(candidate)
                    break

        self.active_groups = selected
        return selected

    def set_group_name(self, group_id: int, name: str) -> None:
        """Assign a human-readable name to an expert group (spec section 39)."""
        if not (0 <= group_id < self.n_groups):
            raise ValueError(f"no such group: {group_id}")
        self.group_names[group_id] = name

    def get_group_name(self, group_id: int) -> str:
        return self.group_names.get(group_id, f"expert_{group_id}")

    def active_expert_names(self) -> List[str]:
        """Human-readable names of the currently active expert groups."""
        return [self.get_group_name(g) for g in sorted(self.active_groups)]

    def add_expert_group(self, name: str, n_new_neurons: int) -> Tuple[int, List[int]]:
        """
        Spec Part 4 section 42 (Expert Creation): grow the mesh with a
        brand new, named expert group of freshly initialized neurons,
        wired all-to-all with every existing neuron (preserving the mesh's
        own all-to-all invariant) and with each other.

        New neurons start at vale=0.0 as a placeholder. This mesh has no
        opinion on where their real vale stake should come from — a caller
        that also owns a ValeSystem (UnifiedBrain does) should call
        vale.add_neurons() and re-sync immediately afterward, since
        ValeSystem is the single source of truth for vale.

        Returns (new_group_id, new_neuron_ids).
        """
        if n_new_neurons < 1:
            raise ValueError("n_new_neurons must be >= 1")

        existing_ids = list(self.neurons.keys())

        new_group_id = self.n_groups
        self.n_groups += 1
        self.group_scores.append(0.0)
        self.group_names[new_group_id] = name

        start_id = self.n_neurons
        new_ids = list(range(start_id, start_id + n_new_neurons))
        self.n_neurons += n_new_neurons

        for nid in new_ids:
            neuron = NeuronState(neuron_id=nid, role=NeuronRole.HIDDEN, group=new_group_id, vale=0.0)
            neuron.initialize_state(self.n_dimensions, rng=self._rng)
            self.neurons[nid] = neuron

        scale = 1.0 / math.sqrt(self.n_neurons * self.n_dimensions)

        def _wire(source_id: int, target_id: int) -> None:
            conn = SynapticConnection(source_id=source_id, target_id=target_id, base_learning_rate=0.01)
            conn.initialize_weights(self.n_dimensions, scale, rng=self._rng)
            self.connections[(source_id, target_id)] = conn

        for nid in new_ids:
            for other in existing_ids:
                _wire(nid, other)
                _wire(other, nid)
            for other in new_ids:
                if other != nid:
                    _wire(nid, other)

        self.active_groups.add(new_group_id)
        return new_group_id, new_ids

    def _apply_divergence_correction(
        self,
        prev_state: Dict[int, List[float]],
        new_states: Dict[int, List[float]],
        damping_factor: float = 0.5
    ):
        """Apply damping to correct divergent settle."""
        self._divergence_events += 1
        
        for neuron_id in new_states:
            if neuron_id in prev_state:
                # Blend toward previous state
                for d in range(len(new_states[neuron_id])):
                    new_states[neuron_id][d] = (
                        damping_factor * prev_state[neuron_id][d] +
                        (1 - damping_factor) * new_states[neuron_id][d]
                    )
    
    def _read_output(self) -> List[float]:
        """Read output from output neurons."""
        output = []
        for neuron_id, neuron in sorted(self.neurons.items()):
            if neuron.role == NeuronRole.OUTPUT:
                # Average of content dimensions
                content = neuron.get_content_state()
                if content:
                    output.append(sum(content) / len(content))
                else:
                    output.append(0.0)
        return output
    
    def apply_hebbian_learning(self, pre_activations: Dict[int, float], 
                                post_activations: Dict[int, float],
                                reward_signal: float = 1.0,
                                dt: float = 0.001):
        """
        Apply Hebbian learning rule across all connections.
        
        Learning is gated by target neuron's vale.
        """
        for (source_id, target_id), conn in self.connections.items():
            pre_act = pre_activations.get(source_id, 0.0)
            post_act = post_activations.get(target_id, 0.0)
            
            target_neuron = self.neurons.get(target_id)
            if not target_neuron:
                continue
            
            # Get effective learning rate (gated by vale)
            effective_lr = conn.apply_vale_gate(target_neuron.vale)
            
            # Three-factor learning: pre * post * reward
            delta = effective_lr * pre_act * post_act * reward_signal * dt
            
            # Update weight matrix (simplified: scale all weights uniformly)
            for d1 in range(self.n_dimensions):
                for d2 in range(self.n_dimensions):
                    conn.weight_matrix[d1][d2] += delta * 0.01  # Small per-weight adjustment
                    # Clamp weights
                    conn.weight_matrix[d1][d2] = max(-1.0, min(1.0, conn.weight_matrix[d1][d2]))
    
    def step_continuous(self, input_vector: List[float]) -> List[float]:
        """
        Step the mesh in continuous mode, carrying state forward.
        
        Args:
            input_vector: New input values
            
        Returns:
            Output values
        """
        if not self.continuous:
            return self.activate(input_vector)
        
        # Carry state from previous step
        if self._carried_state is not None:
            for neuron_id, state in self._carried_state.items():
                if neuron_id in self.neurons:
                    self.neurons[neuron_id].state_vector = list(state)
        
        # Activate with new input
        output = self.activate(input_vector)
        
        # Save state for next step
        self._carried_state = {
            nid: list(n.state_vector) 
            for nid, n in self.neurons.items()
        }
        
        return output
    
    def get_statistics(self) -> Dict:
        """Get comprehensive statistics about the mesh state."""
        stats = {
            'current_tick': self.current_tick,
            'global_time': self.global_time,
            'neurons': {
                'total': len(self.neurons),
                'by_role': {},
                'by_group': {},
                'average_vale': sum(n.vale for n in self.neurons.values()) / len(self.neurons),
                'average_activation': sum(n.activation for n in self.neurons.values()) / len(self.neurons)
            },
            'connections': len(self.connections),
            'diagnostics': {
                'live_corrections': self._live_corrections,
                'divergence_events': self._divergence_events
            }
        }
        
        # Count by role
        for neuron in self.neurons.values():
            role = neuron.role.value
            stats['neurons']['by_role'][role] = stats['neurons']['by_role'].get(role, 0) + 1
            group = neuron.group
            stats['neurons']['by_group'][group] = stats['neurons']['by_group'].get(group, 0) + 1
        
        return stats
    
    def save_state(self) -> Dict:
        """Save complete mesh state for serialization."""
        return {
            'config': {
                'n_neurons': self.n_neurons,
                'n_dimensions': self.n_dimensions,
                'n_input': self.n_input,
                'n_groups': self.n_groups,
                'settle_ticks': self.settle_ticks,
                'vale_total': self.vale_total,
                'continuous': self.continuous
            },
            'neurons': {
                nid: {
                    'role': n.role.value,
                    'group': n.group,
                    'state_vector': n.state_vector,
                    'vale': n.vale,
                    'activation': n.activation,
                    'total_spikes': n.total_spikes
                }
                for nid, n in self.neurons.items()
            },
            'connections': {
                f"{sid}->{tid}": {
                    'weight_matrix': c.weight_matrix,
                    'eligibility_trace': c.eligibility_trace
                }
                for (sid, tid), c in self.connections.items()
            },
            'diagnostics': {
                'live_corrections': self._live_corrections,
                'divergence_events': self._divergence_events
            },
            'groups': {
                'names': dict(self.group_names),
                'scores': list(self.group_scores),
                'active': sorted(self.active_groups),
            }
        }

    def load_state(self, state: Dict):
        """Load mesh state from serialization."""
        config = state.get('config', {})

        # Verify config matches
        if config.get('n_neurons') != self.n_neurons:
            raise ValueError("Neuron count mismatch")
        if config.get('n_dimensions') != self.n_dimensions:
            raise ValueError("Dimension count mismatch")
        if config.get('n_groups') != self.n_groups:
            raise ValueError("Group count mismatch")

        # Load neurons
        for nid_str, n_data in state.get('neurons', {}).items():
            nid = int(nid_str)
            if nid in self.neurons:
                neuron = self.neurons[nid]
                neuron.role = NeuronRole(n_data['role'])
                neuron.group = n_data['group']
                neuron.state_vector = n_data['state_vector']
                neuron.vale = n_data['vale']
                neuron.activation = n_data.get('activation', 0.0)
                neuron.total_spikes = n_data.get('total_spikes', 0)
        
        # Load connections
        for conn_key, c_data in state.get('connections', {}).items():
            parts = conn_key.split('->')
            if len(parts) == 2:
                sid, tid = int(parts[0]), int(parts[1])
                if (sid, tid) in self.connections:
                    conn = self.connections[(sid, tid)]
                    conn.weight_matrix = c_data['weight_matrix']
                    conn.eligibility_trace = c_data.get('eligibility_trace', 0.0)
        
        # Load diagnostics
        diag = state.get('diagnostics', {})
        self._live_corrections = diag.get('live_corrections', 0)
        self._divergence_events = diag.get('divergence_events', 0)

        # Load expert group names/scores/active selection
        groups = state.get('groups', {})
        if groups:
            self.group_names = {int(k): v for k, v in groups.get('names', {}).items()}
            saved_scores = groups.get('scores')
            if saved_scores is not None and len(saved_scores) == self.n_groups:
                self.group_scores = list(saved_scores)
            active = groups.get('active')
            if active is not None:
                self.active_groups = set(active)


# Convenience function for creating standard configurations
def create_mesh(config_type: str = "default") -> NeuralMesh:
    """
    Create a neural mesh with predefined configurations.
    
    Args:
        config_type: One of "default", "small", "large", "experimental"
        
    Returns:
        Configured NeuralMesh instance
    """
    configs = {
        "default": {
            "n_neurons": 64,
            "n_dimensions": 4,
            "n_input": 8,
            "n_groups": 4,
            "settle_ticks": 4
        },
        "small": {
            "n_neurons": 16,
            "n_dimensions": 4,
            "n_input": 4,
            "n_groups": 2,
            "settle_ticks": 3
        },
        "large": {
            "n_neurons": 128,
            "n_dimensions": 8,
            "n_input": 16,
            "n_groups": 8,
            "settle_ticks": 6
        },
        "experimental": {
            "n_neurons": 32,
            "n_dimensions": 6,
            "n_input": 6,
            "n_groups": 4,
            "settle_ticks": 8,
            "continuous": True
        }
    }
    
    cfg = configs.get(config_type, configs["default"])
    return NeuralMesh(**cfg)
