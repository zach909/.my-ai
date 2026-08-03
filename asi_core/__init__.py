"""
ASI Core Package

Neural mesh architecture for Artificial Superintelligence.
"""

from .neural_mesh import (
    NeuralMesh,
    NeuronRole,
    NeuronState,
    SynapticConnection,
    create_mesh
)

from .neural_core import (
    NeuralCore,
    NeuralLayer,
    Neuron,
    Synapse,
    ActivationFunction,
    NeuronType
)

from .neural_states import (
    NeuralState,
    SynapticState,
    StateManager,
    LearningSystem,
    LearningRule,
    StateType
)

from .vale_system import (
    ValeSystem,
    ValeConfig,
    DonorPolicy,
    RecipientPolicy,
    ValeError,
    ValeConfigError,
    ValeInvariantError,
)

from .hyperdim_thinking import (
    HDVector,
    bind,
    unbind,
    bundle,
    permute,
    cosine_similarity,
    NeuronPhase,
    MemoryKind,
    HDConfig,
    Message,
    MemoryTrace,
    TickResult,
    MemoryStore,
    HDNeuron,
    HDThinkingSystem
)

from .unified_brain import (
    UnifiedBrain,
    CycleResult,
    Introspection,
    ReasoningPath,
    DebugSnapshot,
    SkillRecord,
)

from .extension_system import (
    ExtensionSystem,
    Extension,
    ExtensionStage,
    ExtensionError,
)

from .circular_context import (
    CircularBuffer,
    CircularContextSystem,
)

from .neural_dsl import (
    parse as parse_ndl,
    parse_program as parse_ndl_program,
    to_source as ndl_to_source,
    describe_extension,
    execute as execute_ndl,
    netsearch,
    netsearch_train,
    code_to_net,
    wave_interference,
    claims_exclusive_input,
    literal_output,
    NeuronDefinition,
    Connection,
    NetSearchRequest,
    Program as NDLProgram,
    DSLExecutionResult,
    NDLError,
)

from .mistake_tracker import (
    MistakeTracker,
    MistakeRecord,
)

from .action_log import (
    ActionLog,
    ActionRecord,
    ApprovalStatus,
)

from .hive_mind import (
    HiveMind,
    TrustSystem,
    ShareRecord,
)

from .background_quantization import (
    Quantizer,
    BillingSystem,
)

__version__ = "0.1.0"
__all__ = [
    # Neural Mesh
    "NeuralMesh",
    "NeuronRole",
    "NeuronState",
    "SynapticConnection",
    "create_mesh",
    # Neural Core
    "NeuralCore",
    "NeuralLayer",
    "Neuron",
    "Synapse",
    "ActivationFunction",
    "NeuronType",
    # Neural States
    "NeuralState",
    "SynapticState",
    "StateManager",
    "LearningSystem",
    "LearningRule",
    "StateType",
    # Vale System
    "ValeSystem",
    "ValeConfig",
    "DonorPolicy",
    "RecipientPolicy",
    "ValeError",
    "ValeConfigError",
    "ValeInvariantError",
    # Hyper-Dimensional Thinking
    "HDVector",
    "bind",
    "unbind",
    "bundle",
    "permute",
    "cosine_similarity",
    "NeuronPhase",
    "MemoryKind",
    "HDConfig",
    "Message",
    "MemoryTrace",
    "TickResult",
    "MemoryStore",
    "HDNeuron",
    "HDThinkingSystem",
    # Unified Brain
    "UnifiedBrain",
    "CycleResult",
    "Introspection",
    "ReasoningPath",
    "DebugSnapshot",
    "SkillRecord",
    # Extension System
    "ExtensionSystem",
    "Extension",
    "ExtensionStage",
    "ExtensionError",
    # Circular Context System
    "CircularBuffer",
    "CircularContextSystem",
    # Neural Definition Language
    "parse_ndl",
    "parse_ndl_program",
    "ndl_to_source",
    "describe_extension",
    "execute_ndl",
    "netsearch",
    "netsearch_train",
    "code_to_net",
    "wave_interference",
    "claims_exclusive_input",
    "literal_output",
    "NeuronDefinition",
    "Connection",
    "NetSearchRequest",
    "NDLProgram",
    "DSLExecutionResult",
    "NDLError",
    # Mistake Tracker
    "MistakeTracker",
    "MistakeRecord",
    # Action Log
    "ActionLog",
    "ActionRecord",
    "ApprovalStatus",
    # Hive Mind
    "HiveMind",
    "TrustSystem",
    "ShareRecord",
    # Background Quantization
    "Quantizer",
    "BillingSystem",
]
