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
