# NeuroClaw - Artificial Superintelligence System


WARNING ⚠️ THIS PROJECT IS IN BETA. WE ARE NOT RESPONSIBLE FOR YOUR ACTIONS OR WHAT THE CODE DOES. BY CONTINUING YOU AGREE WITH THIS STATEMENT AND THE [PRIVACY POLICY](PRIVACY.md) AND [TERMS AND CONDITIONS](TERMS.md).

NeuroClaw is a comprehensive, local-first AI agent. It's powered by **OneBrain**, the neural mesh engine underneath — the all-to-all neuron computation, quantization, and mixture-of-experts routing described throughout this repo all live there. NeuroClaw the agent is itself made of skills: each capability is trained and packaged by the Extension Builder, then registered into OneBrain as a routable MoE expert.

A comprehensive AI/ASI system with modular architecture implementing neural mesh computing, mixture of experts, hyperdimensional thinking, and self-improvement capabilities.

## Quick Start

```bash
# Installation
./scripts/install.sh

# Development
npm run dev

# Build
npm run build

# Test ASI Core
python3 -m unittest discover -s asi_core -p "test_*.py" -v

# Test specific component
python3 -c "from asi_core import UnifiedBrain; brain = UnifiedBrain(); print(brain.perceive([0.1, 0.2, 0.3, 0.4]))"
```

## Project Structure

```
├── asi_core/              # Core ASI components
│   ├── unified_brain.py   # Main integration of all subsystems
│   ├── neural_mesh.py     # Neural mesh with MoE routing
│   ├── vale_system.py     # Elastic value budget system
│   ├── hyperdim_thinking.py # Hyperdimensional memory & reasoning
│   ├── neural_states.py   # Multi-rule learning system
│   ├── extension_system.py # Extension lifecycle management
│   ├── hive_mind.py       # Distributed coordination
│   ├── circular_context.py # Infinite context loop system
│   ├── mistake_tracker.py  # Self-correction tracking
│   └── endurance_training.py # Long-running UnifiedBrain training harness
├── benchmarks/            # Performance benchmarks
├── config/                # Configuration files
├── desktop-app/           # Desktop application
├── dist/                  # Distribution builds
├── docs/                  # Documentation
├── extension-builder/     # Extension building tools
├── extension_system/      # Extension lifecycle, versioning & permissions (TS)
├── generated/             # Auto-generated skills, plugins & their wiki pages
├── interface/             # User interface components
├── live-usb/              # Bootable/installable live USB build
├── model && skills manager/ # Go-based model & skills manager (llama.cpp/MLX backends)
├── models && skills/      # AI models and skills (JS/TS)
├── plugin_manager/        # Plugin management system
├── plugins/               # System plugins (camera, file system, etc.)
├── public/                # Public assets
├── scripts/               # Build and utility scripts
├── src/                   # Source code
├── test/                  # Core ASI tests and integration tests
├── tests/                 # Additional test suites (security, etc.)
├── training_data/         # Training data assets
└── wiki/                  # Architecture wiki
```

Key root-level files:
- `AGENTS.md` — instructions for AI agents working in this repo
- `STRUCTURE.md` — detailed breakdown of every directory and file
- `PRIVACY.md` / `TERMS.md` — privacy policy and terms referenced in the warning above
- `package.json` / `requirements.txt` — Node.js and Python dependencies
- `vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `components.json` — build/tooling configuration

## Key Features

### Neural Architecture
- **Neural Mesh**: Fully connected neurons with non-linear communication
- **Mixture of Experts (MoE)**: Efficient routing to specialized neuron groups
- **Hyperdimensional Thinking**: Multi-dimensional memory states and analogy reasoning
- **Elastic Value System**: Zero-sum plasticity budget where high-value neurons change less

### Learning & Memory
- **Multi-Rule Plasticity**: Hebbian, Oja's rule, BCM theory, homeostatic learning
- **Circular Context**: Infinite context window via compression to long-term memory
- **Self-Improvement**: Patterns automatically promoted to permanent skills
- **Mistake Tracking**: Detects and penalizes repeated mistakes

### Extensions & Skills
- **Extension Builder**: Drag-and-drop neuron connection editor
- **Skill System**: Pluggable expert transforms (coding, language, reasoning)
- **Plugin Architecture**: API connections to external services
- **Quantization**: Background model quantization for faster inference

### System Access
- **Full System Access**: Terminal, file system, multi-desktop support
- **Multi-Input**: Separate mouse/keyboard streams to avoid user conflict
- **Chrome Apps**: Service integration for extended capabilities
- **Encrypted by Default**: End-to-end encryption for all data

## Core API Example

```python
from asi_core import UnifiedBrain

# Create brain with named expert groups
brain = UnifiedBrain(
    n_neurons=64,
    n_groups=8,
    expert_names=['coding', 'language', 'reasoning', 'research', 
                  'math', 'vision', 'audio', 'control']
)

# Run perception cycles
result = brain.perceive([0.5, 0.3, 0.2, 0.8], reward=0.8)
print(f"Output: {result.output}")
print(f"Active experts: {result.active_experts}")

# Self-improvement: patterns become skills
for _ in range(50):
    brain.perceive([0.9, 0.9, 0.9, 0.9], reward=0.95)
created = brain.self_improve(min_strength=1.2)

# Create extension from learned skills
ext = brain.create_extension('pattern_recognition', purpose='Recognize patterns')

# Introspection
info = brain.introspect()
print(f"Stable neurons: {info.most_stable_neurons}")
print(f"Flexible neurons: {info.most_flexible_neurons}")
```

## Endurance Training

`asi_core/endurance_training.py` drives one `UnifiedBrain` through a
long-running session: a curriculum of synthetic tasks across every expert
domain, interleaved with `self_improve()`, memory-bounding `maintain()`
calls, and periodic checkpoints (`backup()`/`restore()`) so a session can
be paused and resumed instead of starting over.

```bash
python3 -m asi_core.endurance_training --cycles 20000 \
    --checkpoint /tmp/onebrain.checkpoint.json \
    --report /tmp/onebrain.report.json

# Resume a previous run and keep going:
python3 -m asi_core.endurance_training --cycles 20000 \
    --resume-from /tmp/onebrain.checkpoint.json \
    --checkpoint /tmp/onebrain.checkpoint.json
```

See [docs/ENDURANCE_TRAINING.md](docs/ENDURANCE_TRAINING.md) for the full
option reference.

## Documentation

See [docs/](docs/) and [wiki/](wiki/) for comprehensive documentation:

- **Architecture**: System design and neural architecture
- **Deployment**: Installation and deployment guides  
- **Skills**: How to create and train skills
- **Extensions**: Building and sharing extensions
- **Plugins**: Available system plugins

## Testing

All core systems are tested with 349+ unit tests:

```bash
# Run all ASI core tests
python3 -m unittest discover -s asi_core -v

# Run specific test module
python3 -m unittest asi_core.test_unified_brain -v
```

## License

See LICENSE file in subdirectories for specific licensing information.
