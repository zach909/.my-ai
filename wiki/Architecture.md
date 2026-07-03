# Architecture Overview

## System Summary

Prometheus Elastic Core (NeuroClaw) is a private, local AI system that runs entirely on your machine (Mac, Windows, or Linux). The system features autonomous operation with infinite context through all-to-all neuron connectivity.

**Key Principle**: NO EXTERNAL APIs - all processing happens locally.

## Core Subsystems

### Background Systems (Learning & Memory)

#### 1. Quantization
- **Purpose**: Run models efficiently after building
- **Method**: 4-bit quantization (symmetric/asymmetric/mixed)
- **Benefits**: Faster execution, power savings
- **Zero-Sum Game**: Total neurons = total value points

#### 2. Elastic Value Budget (ValueRangeAllocator)
- **Purpose**: Manages neuron learning rates based on importance
- **Mechanism**: 
  - Higher value neurons change less (stable knowledge)
  - Lower value neurons learn more (adaptive learning)
  - More input + less value = more change
  - More value + less input = less change
- **Why**: Learn but do not forget

#### 3. Self-Built Extensions
- **Purpose**: AI creates extensions to store memory and logic
- **Builder**: NeuroLang-based with drag-and-connect interface
- **Example**: Coding extension created when model learned to code

#### 4. RLM Training & Reasoning
- **Purpose**: Autonomous guidance using Reinforcement Learning
- **Features**: Loop detection, lookahead steps, experience replay
- **Why**: Keeps the autonomous part on track

#### 5. Empathy Engine
- **Purpose**: Keep model aligned with user feelings
- **Mechanism**: Understands and mirrors user emotions
- **Why**: Make decisions without user intervention

### Foreground Systems (Processing & Reasoning)

#### 1. Mixture of Experts (MoE)
- **Purpose**: Efficient routing to specialized processing units
- **Features**: Load balancing, top-K routing, dynamic expert management
- **Benefits**: Efficient and faster processing

#### 2. All-to-All Connectivity (NeuronMesh)
- **Purpose**: Non-linear, autonomous computation with infinite context
- **Mechanism**: Each neuron connects to every other neuron
- **Benefits**: 
  - Never forgets context as new prompts are added
  - Enables autonomous operation
  - Easy plugin integration

#### 3. Hyper-Dimensional Thinking
- **Purpose**: Multi-state reasoning and novelty detection
- **Mechanism**: 
  - Each neuron has multi-ball states
  - Changes based on its input AND all other neurons' input
  - Complex cross-influence mathematics
- **Benefits**: 
  - Model understands what has already been done
  - Will not repeat actions/thoughts
  - Can read its own thoughts

#### 4. NeuroLang Processing
- **Purpose**: Long context processing through custom language
- **Mechanism**: 
  - All components and words are zipped
  - Zipped version is quantized
  - Connections drawn from thesaurus, defined by dictionary

#### 5. Zip I/O Loop
- **Purpose**: Extended context and output capacity
- **Mechanism**: Inputs/outputs run as loops
- **Capacity**: Supports 200,000+ GB context

#### 6. Quantum Neural Net
- **Purpose**: Enable quantum conversion and超越 classical domain
- **Mechanism**: Uses quantum interference, wave signatures
- **Why**: Easy to convert to quantum architecture

## Extension System

### Plugins
- **Definition**: API connections to external services
- **Categories**: Camera, Microphone, File System, Browser, etc.
- **Integration**: Easy drop-in due to all-to-all connectivity

### Skills
- **Definition**: Experts added into the MoE
- **Categories**: Plugin-maker, Skill-maker, Coding, Image, Video, Game

### Extension Builder Features
- Save without quantization / Install with quantization
- Drag and connect neurons visually
- Search neurons across large networks
- Add API output layers
- Net Search: Deep learning-powered search
- Code-to-Net: Import binary code as neural networks

## Platform Support

- **Operating Systems**: Mac, Windows, Linux
- **Privacy**: Private by default, data encrypted end-to-end
- **System Access**: Terminal, File System, Multi-desktop (GNOME)
- **Multi-Input**: Multiple mouse/keyboard support (no tug-of-war)

## Pipeline Flow

1. **Input**: User provides text or other input (as zip loop)
2. **NeuroLang Parsing**: Parse input through custom language interpreter
3. **MoE Routing**: Routes to appropriate experts based on input
4. **Mesh Propagation**: Activations propagate through all-to-all network
5. **Hyperdimensional Processing**: Multi-state reasoning with novelty detection
6. **RLM Decision**: Reinforcement learning selects action, avoids loops
7. **Token Generation**: Combines outputs into final response (as zip loop)
8. **Extension Creation**: If new capability learned, create extension via builder

## Key Benefits

- **Autonomous**: Never stops, maintains infinite context
- **Efficient**: Quantization, MoE routing, zero-sum value allocation
- **Adaptive**: Elastic value budget protects important knowledge
- **Self-Improving**: Creates extensions to save learned capabilities
- **Private**: All local, encrypted end-to-end, no external APIs
- **Extensible**: Plugins, skills, community contributions
- **Quantum-Ready**: Quantum neural net architecture for future conversion

---

See also: [[Home]], [[NeuroLang]], [[Plugins]], [[Skills]]
