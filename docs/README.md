# Documentation

This directory contains all project documentation organized by category.

## Subdirectories

- **architecture/** - System architecture documents
- **deployment/** - Deployment guides and installation instructions  
- **api/** - API documentation and references
- **self-improvement/** - Self-improvement implementation plans and progress

## Root Level Documents

### Start Here
- AI_NEURAL_NETWORK_BASICS.md - Plain-language primer on neurons, weights/biases, learning, elastic value, all-to-all connectivity, hyperdimensional thinking, and the Extension Builder, with pointers to the code and deep specs for each
- SKILL_ACQUISITION_LOOP.md - The end-to-end loop an agent runs to learn something new: check the wiki first, fall back to web research, run experiments, then push the wiki page, the skill (source + quantized binary), and the improvement algorithm that produced it

### Architecture
- ARCHITECTURE.md - Main system architecture (411KB comprehensive document)
- SYSTEM_ARCHITECTURE.md - Detailed system architecture
- asi_architecture.md - ASI (Artificial Super Intelligence) architecture
- asi_architecture_v2.md - Updated ASI architecture v2
- skill_agent_architecture.py - Skill agent architecture design
- EXTENSION_SYSTEM.md - Extension System: automatic creation, lifecycle, versioning, dependencies, permissions, storage, compression, quantization, and security for memory/logic/skill/plugin extensions (implementation: `extension_system/`)
- SHARED_WIKI_SYSTEM.md - Shared Wiki system design (automatic documentation, linking, version history, citations, knowledge graph, search, APIs, storage, testing)
- PORT_SYSTEM.md - Port System: multi-input/multi-output communication layer connecting users, external software, hardware, plugins, and extensions to the neural core (structure, states, protocols, data formats, translation, routing, scheduling, synchronization, permissions, failure recovery)

### Deployment & Installation
- DEPLOYMENT.md - Deployment instructions
- INSTALL.md - Installation guide
- QUICKSTART.md - Quick start guide

### Development & Status
- IMPLEMENTATION_STATUS.md - Current implementation status
- COMPLETION_SUMMARY.md - Summary of completed work
- SELF_IMPROVEMENT_IMPLEMENTATION_PLAN.md - Self-improvement roadmap
- SELF_IMPROVEMENT_PROGRESS.md - Progress on self-improvement features
- PERFORMANCE_OPTIMIZATION_PLAN.md - Performance optimization strategies
- DESKTOP_LAUNCHER_IMPLEMENTATION.md - Desktop launcher implementation details
- EXTENSION_BUILDER_SPEC.md - Extension Builder implementation specification (visual/graph editor, drag-and-drop, search, debugging, quantization, packaging, installation, APIs, file format, testing)
- NET_SEARCH_SPEC.md - Net Search implementation specification (indexing, semantic search, training, temporary neural networks, ranking, validation, APIs, data structures, testing)
- CODE_TO_NET_SPEC.md - Code-to-Net compiler implementation specification (compiler pipeline, parsing, intermediate representation, graph generation, optimization, validation, execution, debugging, APIs, testing)

### Configuration & Guidelines
- CLAUDE.md - Claude-specific configuration
- SECURITY.md - Security policies and guidelines
- TESTING_GUIDE.md - Testing procedures and best practices
- README.md - This file (project structure overview)
