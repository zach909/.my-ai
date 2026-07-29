"""
Robotic Organism - Stage 1: Artificial Cell Architecture

This package implements a minimal artificial organism following the staged development approach:
1. Start with interconnected subsystems (not one giant machine)
2. Build small prototype first
3. Energy system (acquisition + distribution)
4. Artificial muscles (single muscle → muscle group → joint → limb)
5. Multi-fluid transport system
6. Self-repair before reproduction
7. Artificial brain (fast control + high-level AI)
8. Integration into unified organism
9. Humanoid body last
10. Reproduction as separate major project

The core principle: Build a self-contained artificial organism system, then give it a humanoid body.
"""

from .core.organism import ArtificialOrganism
from .systems.energy import EnergySystem
from .systems.transport import TransportSystem
from .systems.repair import RepairSystem
from .systems.muscle import ArtificialMuscleSystem
from .systems.sensors import SensorArray
from .systems.neural import NeuralController

__version__ = "0.1.0"
__all__ = [
    "ArtificialOrganism",
    "EnergySystem", 
    "TransportSystem",
    "RepairSystem",
    "ArtificialMuscleSystem",
    "SensorArray",
    "NeuralController"
]
