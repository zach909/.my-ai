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
]
