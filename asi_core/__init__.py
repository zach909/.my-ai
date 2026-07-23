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

__version__ = "0.1.0"
__all__ = [
    "NeuralMesh",
    "NeuronRole", 
    "NeuronState",
    "SynapticConnection",
    "create_mesh"
"""ASI Core Package - Neural Architecture for Artificial Superintelligence"""

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

__all__ = [
    # Neural Core
    'NeuralCore',
    'NeuralLayer',
    'Neuron',
    'Synapse',
    'ActivationFunction',
    'NeuronType',
    # Neural States
    'NeuralState',
    'SynapticState',
    'StateManager',
    'LearningSystem',
    'LearningRule',
    'StateType'
]
