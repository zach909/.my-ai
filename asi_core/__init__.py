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
]
