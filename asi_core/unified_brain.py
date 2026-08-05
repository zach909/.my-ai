"""
Unified Brain - Complete ASI System Integration

This module wires all asi_core subsystems into a single continuously-operating 
Artificial Superintelligence system following the architecture:

    Input -> Dynamic Neural State -> Memory -> Reasoning -> Skills -> Output -> Learning

Key integrations:
- NeuralMesh provides all-to-all connected neurons with MoE routing
- ValeSystem manages zero-sum plasticity budget (high vale = stable, low vale = plastic)
- HDThinkingSystem provides hyperdimensional memory and analogy reasoning
- LearningSystem applies multi-rule plasticity (Hebbian/Oja/BCM/homeostatic)
- ExtensionSystem manages self-created skill packages
- CircularContextSystem provides infinite context via compression to long-term memory
- MistakeTracker enables self-correction by tracking repeated errors
- ActionLog provides transparency and human approval gating
- BackgroundQuantization compresses learned extensions for efficient storage
- HiveMind enables knowledge sharing between multiple agents

NO EXTERNAL APIs - All functionality is implemented locally.
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set
from enum import Enum

# Import all subsystems
from .neural_mesh import NeuralMesh, NeuronRole, NeuronState, SynapticConnection
from .vale_system import ValeSystem, ValeConfig
from .hyperdim_thinking import (
    HDThinkingSystem, HDConfig, HDVector, MemoryKind, cosine_similarity,
    bind, unbind, bundle, permute
)
from .neural_states import StateManager, LearningSystem, LearningRule
from .extension_system import ExtensionSystem, Extension, ExtensionStage
from .circular_context import CircularContextSystem, CircularBuffer
from .mistake_tracker import MistakeTracker, MistakeRecord
from .action_log import ActionLog, ActionRecord, ApprovalStatus
from .background_quantization import Quantizer, BillingSystem
from .hive_mind import HiveMind, TrustSystem, ShareRecord
from .neural_dsl import (
    parse as parse_ndl, parse_program, to_source as ndl_to_source,
    describe_extension, execute as execute_ndl, netsearch,
    NeuronDefinition, Connection, Program as NDLProgram
)


# Type aliases
Skill = Callable[[List[float]], List[float]]


@dataclass
class SkillRecord:
    """
    Metadata for a registered skill tracking its usage and performance.
    
    Spec Part 8 section 143 (Skill Storage Format): skills accrue activation
    counts and performance scores from actual use, not predefined values.
    """
    name: str
    activation_count: int = 0
    performance_score: float = 0.0  # EMA of reward across cycles
    improvement_history: List[float] = field(default_factory=list)


@dataclass
class CycleResult:
    """Output from one full perceive-think-act-learn cycle."""
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
    One candidate reasoning path from multi-path reasoning.
    
    Spec Part 7 section 108: recall several candidates and score each
    rather than committing to a single nearest memory trace.
    """
    solution: List[float]
    expected_outcome: List[float]
    confidence: float
    supporting_trace_kind: Optional[str]


@dataclass
class DebugSnapshot:
    """Debug introspection snapshot (spec Part 8 section 153)."""
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
    The complete ASI system integrating all neural subsystems.
    
    This is the main entry point for the Artificial Superintelligence system,
    combining:
    
    1. **Neural Mesh** (Background): All-to-all connected neurons with
       multidimensional states, zero-sum vale system controlling plasticity,
       and Mixture-of-Experts routing for efficiency.
       
    2. **Hyperdimensional Thinking** (Foreground): Each neuron has multi-state
       vectors (semantic, context, value, temporary, meta) enabling complex
       reasoning, analogy solving, and associative memory.
       
    3. **Learning Systems**: Multi-rule plasticity including Hebbian learning,
       Oja's rule, BCM theory, and homeostatic regulation.
       
    4. **Memory & Context**: Circular context buffers with compression to
       long-term memory on eviction, providing effectively infinite context.
       
    5. **Self-Improvement**: Automatic promotion of successful patterns to
       permanent skills, extension creation, and quantization for efficiency.
       
    6. **Self-Correction**: Mistake tracking with signature-based detection
       of repeated errors and automatic penalty adjustment.
       
    7. **Extensions & Skills**: Pluggable expert transforms that can be
       created, tested, optimized, quantized, and shared between agents.
       
    8. **Transparency**: Full action logging with optional human approval
       gating for significant structural changes.
    
    Architecture follows the spec's core principle: "Everything connects to
    everything" - non-linear, all-to-all communication enabling autonomous,
    contextual reasoning that learns without forgetting.
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
        """
        Initialize the Unified Brain with specified configuration.
        
        Args:
            n_neurons: Total number of neurons in the mesh
            n_dimensions: Dimensionality of each neuron's state vector
            n_input: Number of input neurons (must be < n_neurons)
            n_groups: Number of expert groups for MoE routing
            hd_dimensions: Dimensionality of hyperdimensional vectors
            seed: Random seed for reproducibility
            expert_names: Optional names for expert groups (e.g., ['coding', 'language'])
            context_capacity: Size of circular context buffers
            mistake_reward_threshold: Reward level below which outcomes are logged as mistakes
            mistake_repeat_penalty: Additional vale penalty for repeated mistakes
        """
        # 1. Neural Mesh - the core computational substrate
        self.mesh = NeuralMesh(
            n_neurons=n_neurons,
            n_dimensions=n_dimensions,
            n_input=n_input,
            n_groups=n_groups,
            continuous=True,  # Persistent state between calls
            seed=seed,
            auto_route=True,  # Automatic expert group selection
        )
        
        # Name expert groups if provided
        if expert_names:
            for group_id, name in enumerate(expert_names[:n_groups]):
                self.mesh.set_group_name(group_id, name)
        
        # 2. Vale System - zero-sum plasticity budget
        # High vale neurons resist change (stable knowledge)
        # Low vale neurons learn readily (plastic capacity)
        self.vale = ValeSystem(ValeConfig(n_neurons=n_neurons), seed=seed)
        
        # 3. Hyperdimensional Thinking System - memory and reasoning
        hd_neurons = max(2, n_groups)
        self.hd = HDThinkingSystem(
            n_neurons=hd_neurons,
            dimensions=hd_dimensions,
            n_input=1,
            n_groups=n_groups,
            config=HDConfig(dimensions=hd_dimensions),
            seed=seed,
        )
        self._hd_cue_neuron = 0  # Primary cue neuron for HD operations
        
        # 4. Neural States - multi-rule learning
        self.states = StateManager()
        self.learning = LearningSystem(self.states)
        
        # Register all neurons and synapses with the state manager
        for nid in self.mesh.neurons:
            self.states.register_neuron(str(nid))
        for (source_id, target_id) in self.mesh.connections:
            self.states.register_synapse(str(source_id), str(target_id))
        
        # 5. Skills registry - pluggable expert transforms
        self.skills: Dict[str, Skill] = {}
        self.skill_records: Dict[str, SkillRecord] = {}
        self._pattern_skills: Dict[int, str] = {}  # id(trace) -> skill name
        self._pattern_counter = 0
        
        # 6. Extension System - package and version skills
        self.extensions = ExtensionSystem()
        
        # 7. Action Log - transparency and approval gating
        self.actions = ActionLog()
        
        # 8. Circular Context - infinite context via compression
        self.context = CircularContextSystem(
            capacity=context_capacity,
            on_input_evict=self._compress_evicted_context,
            on_output_evict=self._compress_evicted_context,
        )
        
        # 9. Mistake Tracker - self-correction
        self.mistakes = MistakeTracker()
        self.mistake_reward_threshold = mistake_reward_threshold
        self.mistake_repeat_penalty = mistake_repeat_penalty
        
        # 10. Background Quantization - efficient storage
        self.billing = BillingSystem()
        
        # 11. Hive Mind - multi-agent coordination (initialized on demand)
        self._hive_mind: Optional[HiveMind] = None
        
        # Sync initial vale to mesh
        self._sync_vale_to_mesh()

    # =========================================================================
    # SKILL SYSTEM - Mixture of Experts integration point
    # =========================================================================

    def register_skill(self, name: str, fn: Skill) -> None:
        """
        Register a named skill function.
        
        Skills are applied in registration order to the reasoned output
        before it is returned. This is the seam through which Mixture-of-Experts
        and extension capabilities plug into the brain.
        
        Args:
            name: Unique identifier for the skill
            fn: Callable that transforms an output vector
        """
        self.skills[name] = fn
        self.skill_records.setdefault(name, SkillRecord(name=name))

    def unregister_skill(self, name: str) -> None:
        """Remove a skill from active rotation (keeps historical record)."""
        self.skills.pop(name, None)

    def _apply_skills(self, output: List[float], reward: float) -> List[float]:
        """Apply all registered skills and update their performance records."""
        decay = 0.9  # EMA decay for performance tracking
        for name, fn in self.skills.items():
            output = fn(output)
            record = self.skill_records.setdefault(name, SkillRecord(name=name))
            record.activation_count += 1
            record.performance_score = decay * record.performance_score + (1 - decay) * reward
            record.improvement_history.append(record.performance_score)
            if len(record.improvement_history) > 50:
                record.improvement_history.pop(0)
        return output

    # =========================================================================
    # VALE <-> MESH SYNCHRONIZATION
    # =========================================================================

    def _sync_vale_to_mesh(self) -> None:
        """Mirror ValeSystem's ledger onto mesh neuron.vale fields."""
        for nid, neuron in self.mesh.neurons.items():
            if nid < len(self.vale.v):
                neuron.vale = self.vale.v[nid]

    # =========================================================================
    # HYPERDIMENSIONAL ENCODING
    # =========================================================================

    def _vector_to_hd(self, values: List[float]) -> HDVector:
        """Convert a raw vector to a hyperdimensional representation."""
        dims = self.hd.config.dimensions
        data = list(values[:dims]) + [0.0] * max(0, dims - len(values))
        return HDVector(data, HDVector._compute_bounds(dims))

    # =========================================================================
    # CIRCULAR CONTEXT HANDLERS (Spec Part 5 sections 66-69)
    # =========================================================================

    def _compress_evicted_context(self, values: List[float]) -> None:
        """
        Compress evicted context into long-term HD memory.
        
        When input or output buffer overflows, instead of losing the oldest
        entry, fold it into long-term memory. This implements "important
        information moves into memory" rather than vanishing.
        """
        vec = self._vector_to_hd(values)
        self.hd.memory.write(vec, vec, self.hd.current_tick, kind=MemoryKind.LONG_TERM.value)

    # =========================================================================
    # CORE PERCEPTION CYCLE
    # =========================================================================

    def perceive(self, input_vector: List[float], reward: float = 0.5) -> CycleResult:
        """
        Run one full perceive-think-act-learn cycle.
        
        This is the main entry point for processing input and producing output.
        Each cycle:
        1. Records input in circular context buffer
        2. Settles the neural mesh on the input (carrying state forward)
        3. Encodes settled state as hypervector and ticks HD system
        4. Recalls relevant memories and folds into output
        5. Applies registered skills (MoE transforms)
        6. Computes contributions and updates vale
        7. Applies Hebbian learning gated by vale
        8. Runs multi-rule plasticity on synapses
        9. Records output in circular context buffer
        10. Tracks mistakes if reward is low
        
        Args:
            input_vector: Input values (length should match n_input)
            reward: Feedback signal (0.0=harmful, 0.5=neutral, 1.0=helpful)
            
        Returns:
            CycleResult containing output and diagnostic information
        """
        # Step 0: Record input in circular context
        self.context.record_input(list(input_vector))
        
        # Step 1: Settle neural mesh (continuous mode carries state forward)
        raw_output = self.mesh.step_continuous(input_vector)
        settle_vector = raw_output if raw_output else input_vector
        
        # Step 2: Encode as hypervector and tick HD system
        cue = self._vector_to_hd(settle_vector)
        tick_result = self.hd.tick(inputs={self._hd_cue_neuron: cue}, reward=reward)
        
        # Step 3: Recall memories and integrate into output
        traces = self.hd.recall(cue, k=1)
        recalled_confidence = 0.0
        reasoned = list(raw_output) if raw_output else list(input_vector)
        
        if traces and raw_output:
            recalled_confidence = cosine_similarity(cue, traces[0].key)
            recalled_sem = traces[0].value.sem
            reasoned = [
                (v + recalled_sem[i % len(recalled_sem)]) / 2.0 if recalled_sem else v
                for i, v in enumerate(raw_output)
            ]
        
        # Step 4: Apply skills (MoE transforms)
        output = self._apply_skills(reasoned, reward)
        
        # Step 5-8: Learning pipeline
        activations = {nid: n.activation for nid, n in self.mesh.neurons.items()}
        signed_reward = (reward - 0.5) * 2.0  # Normalize to [-1, 1]
        
        # Check for mistakes
        mistake_signature: Optional[str] = None
        mistake_repeated = False
        if reward < self.mistake_reward_threshold:
            mistake_signature = self._mistake_signature(input_vector)
            self.mistakes.record(
                mistake_signature,
                what=f"low-reward outcome (reward={reward:.2f})",
                why=f"experts {self.mesh.active_expert_names()} produced unsatisfactory result",
                contributing_systems=self.mesh.active_expert_names(),
            )
            mistake_repeated = self.mistakes.is_repeated(mistake_signature)
        
        # Compute contributions with mistake penalty
        contributions = [
            self.mesh.neurons[i].activation * signed_reward 
            for i in range(len(self.vale.v))
        ]
        if mistake_repeated:
            for nid, neuron in self.mesh.neurons.items():
                if neuron.group in self.mesh.active_groups:
                    contributions[nid] += self.mistake_repeat_penalty * abs(neuron.activation)
        
        # Update vale system
        self.vale.step(utility=contributions)
        for nid, neuron in self.mesh.neurons.items():
            self.vale.record_activity(
                nid, neuron.activation, 
                contribution=neuron.activation * signed_reward
            )
        self._sync_vale_to_mesh()
        
        # Apply Hebbian learning gated by vale
        self.mesh.apply_hebbian_learning(activations, activations, reward_signal=reward)
        
        # Apply multi-rule plasticity
        for nid, neuron in self.mesh.neurons.items():
            state = self.states.get_neuron_state(str(nid))
            if state is not None:
                state.activation = neuron.activation
        self.learning.apply_learning()
        self.learning.apply_reinforcement(reward)
        self.states.update_time(1.0)
        
        # Record output
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
        """Create a signature for bucketing similar mistakes."""
        bucket = tuple(round(v, 1) for v in input_vector)
        return f"{sorted(self.mesh.active_groups)}:{bucket}"

    # =========================================================================
    # REASONING OPERATIONS
    # =========================================================================

    def reason(self, a: List[float], b: List[float], c: List[float]) -> List[float]:
        """
        Analogy-style reasoning: a is to b as c is to ?
        
        Uses hyperdimensional binding/unbinding to solve analogies.
        """
        result = self.hd.reason(
            self._vector_to_hd(a), 
            self._vector_to_hd(b), 
            self._vector_to_hd(c)
        )
        return list(result.sem)

    def multi_path_reason(self, input_vector: List[float], n_paths: int = 3) -> List[ReasoningPath]:
        """
        Generate multiple candidate reasoning paths.
        
        Recalls several memory traces and scores each as a potential path,
        allowing the system to consider alternatives rather than committing
        to a single interpretation.
        """
        cue = self._vector_to_hd(input_vector)
        traces = self.hd.recall(cue, k=n_paths)
        
        paths = []
        for trace in traces:
            confidence = cosine_similarity(cue, trace.key)
            # Adjust confidence based on trace kind
            if trace.kind == MemoryKind.EXPERIENCE.value:
                confidence *= -0.5  # Penalize paths matching known mistakes
            
            paths.append(ReasoningPath(
                solution=list(trace.value.data),
                expected_outcome=list(trace.key.data),
                confidence=confidence,
                supporting_trace_kind=trace.kind,
            ))
        
        return sorted(paths, key=lambda p: p.confidence, reverse=True)

    # =========================================================================
    # SELF-IMPROVEMENT AND EXTENSIONS
    # =========================================================================

    def self_improve(self, pattern_trace_ids: Optional[List[int]] = None, name: str = "auto_skill") -> str:
        """
        Promote a reinforced memory pattern to a permanent skill.
        
        This implements spec Part 3 section 36: when a pattern proves
        consistently useful (high value, low surprise), extract it and
        create a dedicated skill function for it.
        
        Args:
            pattern_trace_ids: Specific memory traces to extract (None = most recent)
            name: Name for the new skill
            
        Returns:
            Name of the created skill
        """
        # Get traces to promote
        if pattern_trace_ids is None:
            traces = self.hd.memory.recall(
                HDVector.random(self.hd.config.dimensions, seed=self._pattern_counter),
                k=1
            )
            self._pattern_counter += 1
        else:
            traces = [
                t for t in self.hd.memory.traces 
                if id(t) in pattern_trace_ids
            ]
        
        if not traces:
            return name
        
        # Create skill from pattern
        trace = traces[0]
        pattern_key = list(trace.key.data)
        
        def skill_fn(output: List[float]) -> List[float]:
            # Blend output with learned pattern
            blended = []
            for i, (o, p) in enumerate(zip(output, pattern_key)):
                blended.append(0.7 * o + 0.3 * p)
            # Pad if necessary
            while len(blended) < len(output):
                blended.append(0.0)
            return blended[:len(output)]
        
        self.register_skill(name, skill_fn)
        return name

    def create_extension(
        self,
        name: str,
        purpose: str,
        skill_names: Optional[List[str]] = None,
        permissions: Optional[List[str]] = None,
        documentation: str = ""
    ) -> Extension:
        """
        Bundle related skills into a versioned extension package.
        
        Extensions are permanent, testable, optimizable units that can be
        quantized for efficiency and shared with other agents.
        
        Args:
            name: Unique extension name
            purpose: Description of what the extension does
            skill_names: Skills to include in this extension
            permissions: Required permissions for execution
            documentation: Human-readable documentation
            
        Returns:
            Created Extension object
        """
        ext = self.extensions.create(
            name=name,
            purpose=purpose,
            skills=skill_names or list(self.skills.keys()),
            permissions=permissions or [],
            documentation=documentation,
        )
        
        # Log the creation action
        self.actions.request(
            action=f"create_extension:{name}",
            why=f"Bundling skills for {purpose}",
            system="UnifiedBrain",
        )
        
        return ext

    def test_extension(self, name: str) -> bool:
        """Run tests on an extension."""
        return self.extensions.test(name)

    def optimize_extension(self, name: str) -> Extension:
        """Remove duplicates and unnecessary parts from an extension."""
        return self.extensions.optimize(name)

    def quantize_extension(self, name: str) -> Extension:
        """
        Compress an extension to int4 quantized form.
        
        After quantization, the extension is much more efficient to store
        and load, though no longer directly editable.
        """
        # Extract weights from mesh for quantization
        weights = {
            "neurons": {
                str(nid): {
                    "state": neuron.state_vector,
                    "vale": neuron.vale,
                }
                for nid, neuron in self.mesh.neurons.items()
            },
            "connections": {
                f"{sid}->{tid}": conn.weight_matrix
                for (sid, tid), conn in list(self.mesh.connections.items())[:100]  # Limit for efficiency
            }
        }
        
        ext = self.extensions.quantize(name, weights=weights)
        
        # Also bill the extension through background quantization
        self.billing.bill_extension(
            name=name,
            raw_weights=weights,
            metadata={"purpose": ext.purpose, "skills": ext.skills}
        )
        
        return ext

    def full_extension_lifecycle(
        self,
        name: str,
        purpose: str,
        skill_names: Optional[List[str]] = None
    ) -> Extension:
        """
        Create, test, optimize, and quantize an extension in one flow.
        
        This implements the complete lifecycle from spec Part 3 section 27:
        Created -> Tested -> Optimized -> Quantized
        """
        ext = self.create_extension(name, purpose, skill_names)
        
        if not self.test_extension(name):
            raise ValueError(f"Extension {name} failed testing")
        
        ext = self.optimize_extension(name)
        ext = self.quantize_extension(name)
        
        return ext

    # =========================================================================
    # INTROSPECTION AND DEBUGGING
    # =========================================================================

    def introspect(self) -> Introspection:
        """
        Self-observation: analyze current internal state.
        
        Returns information about:
        - Most stable neurons (highest vale - consolidated knowledge)
        - Most flexible neurons (lowest vale - learning capacity)
        - Removal candidates (consistently inactive)
        - Current system metrics
        """
        # Find stable vs flexible neurons
        neuron_vales = [(nid, n.vale) for nid, n in self.mesh.neurons.items()]
        sorted_by_vale = sorted(neuron_vales, key=lambda x: x[1], reverse=True)
        
        most_stable = [nid for nid, _ in sorted_by_vale[:5]]
        most_flexible = [nid for nid, _ in sorted_by_vale[-5:]]
        
        # Find removal candidates (low activation over time)
        removal_candidates = [
            nid for nid, n in self.mesh.neurons.items()
            if n.average_activation < 0.01 and n.total_spikes == 0
        ]
        
        return Introspection(
            most_stable_neurons=most_stable,
            most_flexible_neurons=most_flexible,
            removal_candidates=removal_candidates,
            average_vale=sum(self.vale.v) / len(self.vale.v),
            average_surprise=self.hd.memory.traces and sum(
                t.strength for t in self.hd.memory.traces
            ) / len(self.hd.memory.traces) or 0.0,
            memory_size=len(self.hd.memory.traces),
            active_skills=list(self.skills.keys()),
            active_groups=sorted(self.mesh.active_groups),
            active_experts=self.mesh.active_expert_names(),
        )

    def get_debug_snapshot(self) -> DebugSnapshot:
        """Capture debug information for diagnostics."""
        return DebugSnapshot(
            active_neuron_count=sum(
                1 for n in self.mesh.neurons.values() 
                if n.activation > 0.1
            ),
            active_experts=self.mesh.active_expert_names(),
            memory_size=len(self.hd.memory.traces),
            context_input_size=len(self.context.input_buffer),
            context_output_size=len(self.context.output_buffer),
            predictions_made=self.hd.current_tick,
            recent_average_surprise=sum(
                self.hd.neurons[n].last_error 
                for n in self.hd.neurons
            ) / max(1, len(self.hd.neurons)),
            errors_detected=[
                f"Mistake '{sig}': {rec.what}"
                for sig, rec in list(self.mistakes.records.items())[-5:]
            ],
            extensions_installed=list(self.extensions.extensions.keys()),
        )

    # =========================================================================
    # HIVE MIND INTEGRATION
    # =========================================================================

    def init_hive_mind(self, agent_id: str, min_trust: float = 0.3) -> HiveMind:
        """Initialize hive mind for multi-agent collaboration."""
        self._hive_mind = HiveMind(min_trust_to_share=min_trust)
        self._hive_mind.register_agent(agent_id)
        return self._hive_mind

    def share_extension_with(
        self,
        extension_name: str,
        to_agent: str,
        to_registry: ExtensionSystem
    ) -> ShareRecord:
        """
        Share an extension with another agent.
        
        Requires hive mind to be initialized. The receiving agent will
        re-test the extension before accepting it.
        """
        if self._hive_mind is None:
            raise RuntimeError("Hive mind not initialized")
        
        ext = self.extensions.get(extension_name)
        if ext is None:
            raise ValueError(f"Extension {extension_name} not found")
        
        return self._hive_mind.share(
            extension=ext,
            from_agent="local",
            to_agent=to_agent,
            to_registry=to_registry,
        )

    def receive_extension_from(
        self,
        extension: Extension,
        from_agent: str
    ) -> ShareRecord:
        """Receive and verify an extension from another agent."""
        if self._hive_mind is None:
            raise RuntimeError("Hive mind not initialized")
        
        return self._hive_mind.share(
            extension=extension,
            from_agent=from_agent,
            to_agent="local",
            to_registry=self.extensions,
        )

    # =========================================================================
    # SERIALIZATION
    # =========================================================================

    def save_state(self) -> Dict[str, Any]:
        """Save complete system state for persistence."""
        return {
            "mesh": self.mesh.save_state(),
            "vale": self.vale.to_dict(),
            "hd": self.hd.save_state(),
            "skills": list(self.skills.keys()),
            "extensions": self.extensions.to_dict(),
            "context": {
                "input": self.context.input_buffer.items,
                "output": self.context.output_buffer.items,
            },
            "mistakes": self.mistakes.to_dict(),
            "actions": [
                {
                    "action": r.action,
                    "why": r.why,
                    "system": r.system,
                    "result": r.result,
                    "approval": r.approval.value,
                }
                for r in self.actions.records
            ],
        }

    def load_state(self, state: Dict[str, Any]) -> None:
        """Restore system state from saved snapshot."""
        if "mesh" in state:
            self.mesh.load_state(state["mesh"])
        if "vale" in state:
            self.vale.from_dict(state["vale"])
            self._sync_vale_to_mesh()
        if "hd" in state:
            self.hd.load_state(state["hd"])
        if "context" in state:
            self.context.input_buffer.load_items(state["context"].get("input", []))
            self.context.output_buffer.load_items(state["context"].get("output", []))
        if "mistakes" in state:
            self.mistakes = MistakeTracker.from_dict(state["mistakes"])
        if "extensions" in state:
            self.extensions = ExtensionSystem.from_dict(state["extensions"])

    # =========================================================================
    # NEURAL DEFINITION LANGUAGE INTERFACE
    # =========================================================================

    def define_neuron_from_ndl(self, source: str) -> Dict[str, NeuronDefinition]:
        """Parse and apply neuron definitions from NDL source."""
        program = parse_program(source)
        
        # Execute any net searches
        for req in program.netsearch_requests:
            if req.net:
                results = netsearch(req.net)
                # Could create neurons from results here
        
        return program.neurons

    def describe_current_state_as_ndl(self) -> str:
        """Export current neural state as NDL source."""
        neurons = {}
        for nid, neuron in self.mesh.neurons.items():
            name = f"neuron_{nid}"
            neurons[name] = NeuronDefinition(
                name=name,
                vale=neuron.vale,
                definition=f"Group {neuron.group} neuron",
                type=str(neuron.role.value),
            )
        return ndl_to_source(neurons)


# Convenience factory functions
def create_brain(
    config_type: str = "default",
    expert_names: Optional[List[str]] = None
) -> UnifiedBrain:
    """
    Create a UnifiedBrain with preset configurations.
    
    Args:
        config_type: "tiny", "small", "default", "large", or "massive"
        expert_names: Optional names for expert groups
        
    Returns:
        Configured UnifiedBrain instance
    """
    configs = {
        "tiny": {"n_neurons": 16, "n_dimensions": 2, "n_input": 4, "n_groups": 2},
        "small": {"n_neurons": 32, "n_dimensions": 4, "n_input": 8, "n_groups": 4},
        "default": {"n_neurons": 64, "n_dimensions": 4, "n_input": 8, "n_groups": 4},
        "large": {"n_neurons": 128, "n_dimensions": 8, "n_input": 16, "n_groups": 8},
        "massive": {"n_neurons": 256, "n_dimensions": 16, "n_input": 32, "n_groups": 16},
    }
    
    cfg = configs.get(config_type, configs["default"])
    return UnifiedBrain(
        **cfg,
        expert_names=expert_names,
        hd_dimensions=cfg["n_dimensions"] * 32,  # Scale HD dims with neural dims
    )


__all__ = [
    "UnifiedBrain",
    "CycleResult",
    "ReasoningPath",
    "DebugSnapshot",
    "Introspection",
    "SkillRecord",
    "create_brain",
    # Re-export subsystem types for convenience
    "NeuralMesh",
    "ValeSystem",
    "HDThinkingSystem",
    "LearningSystem",
    "ExtensionSystem",
    "CircularContextSystem",
    "MistakeTracker",
    "ActionLog",
    "Quantizer",
    "BillingSystem",
    "HiveMind",
]
