# NeuroClaw AI System Architecture

## Overview

NeuroClaw is a private, local AI system that runs entirely on your machine (Mac, Windows, or Linux). Your data stays encrypted end-to-end. The system is designed to be autonomous, with infinite context, and capable of learning without forgetting.

## Core Architecture

### Background Subsystems (Learning & Memory)

#### Background Quantization
- **Purpose**: Run models efficiently after building
- **Benefits**: Faster execution, saves power
- **Example**: When an extension is built, it's quantized to save memory and logic
- **Implementation**: 4-bit quantization with symmetric/asymmetric/mixed methods

#### Background Value Range (ValueRangeAllocator)
- **Purpose**: Manages neuron learning rates based on importance
- **Mechanism**: Zero-sum game - total neurons = total value points
  - Higher value neurons change less (stable knowledge)
  - Lower value neurons learn more (adaptive learning)
- **Why it learns better**: Protects important knowledge while allowing new learning
- **Example**: Model demotes bad neurons (lowers their value) to free up value points for better learning

#### Background RLM (Reinforcement Learning Module)
- **Purpose**: Training and autonomous guidance
- **Mechanism**: Thinks through each possibility during training
- **Why it helps**: Keeps autonomous behavior on track
- **Example**: AI writes down steps so it won't repeat mistakes
- **Features**: Loop detection, lookahead steps, experience replay

### Foreground Subsystems (Processing & Reasoning)

#### Foreground Mixture of Experts (MoE)
- **Purpose**: Efficient routing to specialized processing units
- **Mechanism**: Some neurons choose which experts can run
- **Benefits**: Efficient and faster processing
- **Example**: Expert was an extension for making images
- **Features**: Load balancing, top-K routing, dynamic expert addition/removal

#### Foreground Neuron Mesh (All-to-All Connections)
- **Purpose**: Non-linear, autonomous computation
- **Mechanism**: Each neuron connects to all other neurons
- **Benefits**: 
  - Moves away from linear computing
  - Autonomous and infinite context
  - Never forgets context as new prompts are added
- **Example**: Model never stopped, was autonomous, maintained context across sessions
- **Features**: Propagation with convergence, topology statistics, dynamic connections

#### Foreground Hyperdimensional Thinking
- **Purpose**: Multi-state reasoning and novelty detection
- **Mechanism**: 
  - Each neuron has multi-ball states
  - Changes state based on its input and all other neurons' input
  - Temporary state changes (non-linear communication)
  - Each neuron has a value for every other neuron (complex math)
- **Benefits**: 
  - Understands what has been done
  - Won't repeat mistakes
  - Reads its own thoughts
- **Features**: Novelty scoring, pattern recording, cross-influence, energy computation

### Extension System

#### Extensions
- **Purpose**: Save learned capabilities as reusable modules
- **Mechanism**: AI creates extensions to store memory and logic
- **Example**: When model learned to code, it made an extension to save that capability
- **Builder**: NeuroLang-based extension builder with drag-and-connect interface
- **Syntax**: Custom neuron definition language for creating connections and logic

##### Extension Builder Features
- **Save without Quantization**: Save extension in full precision for development
- **Install with Quantization**: Install extension with quantized weights for efficient deployment
- **Drag and Connect**: Visual interface to drag neurons and connect them with weights/bias
- **Search Neurons**: Search functionality helpful when there are many neurons
- **Drag Label**: Add labels to neurons by dragging
- **Type Model Output**: Type out model output when neuron has input
- **Add Output Layer with API**: Add output layer that exposes API endpoints
- **Net Search**: 
  - Hard search of neurons with deep learning training
  - Searches through neurons with text input
  - Uses deep learning to train a neural network to replicate the same behavior
  - Scripting capability allows user AI to use deep learning to make it do the same thing
- **Code to Net**: 
  - Import binary code
  - Convert to neural network that behaves as the code

#### Skills
- **Purpose**: Experts in the MoE system
- **Definition**: Skills are just experts - specialized processing units in the Mixture of Experts
- **Categories**: 
  - Coding (Python, JavaScript, Rust, Go, etc.)
  - Scripting (Shell, Lua, etc.)
  - Markup (HTML, CSS, Markdown, etc.)
  - Data (JSON, YAML, SQL, etc.)
  - System (C, C++, Rust, Assembly, etc.)
  - Functional (Haskell, OCaml, F#, etc.)
  - Esoteric (Brainfuck, Befunge, etc.)
- **Example**: Coding skill (expert) fits right in with the rest of the logic

#### Plugins
- **Purpose**: API connections to external services
- **Definition**: A plugin is an API connection to another service
- **Why easy to connect**: All components connect to all others
- **Core Plugins**:
  - Camera - Image/video capture
  - Microphone - Audio capture
  - Speaker - Audio output
  - Display - Visual output
  - Terminal - Command line access
  - Filesystem - File access
  - Network - HTTP/WebSocket communication
  - Clipboard - Clipboard access
  - Notification - System notifications
  - Multi-Desktop - Virtual desktop management (GNOME)
  - Multi-Mouse - Multiple mouse input devices
  - Multi-Keyboard - Multiple keyboard input devices

### Integration

#### Chrome Apps
- **Purpose**: Connect to external services for more data
- **Benefits**: Access to web APIs and services

#### Full System Access
- **Terminal**: Command execution
- **Filesystem**: Read/write files
- **Multi-Desktop**: Powered by GNOME, virtual desktops
- **Multi-Mouse/Keyboard**: No interference with user (no tug of war)

## Privacy & Security

- **Runs on Your Machine**: Mac, Windows, or Linux
- **Private by Default**: Your data stays on your machine
- **End-to-End Encryption**: Always encrypted
- **No External APIs**: All processing is local

## Extensibility

- **Community Skills**: Extend with community-built skills
- **Build Your Own**: Create custom skills and plugins
- **Self-Writing**: The AI can write its own extensions and skills

## Pipeline Flow

1. **Input**: User provides text or other input
2. **MoE Routing**: Routes to appropriate experts
3. **Mesh Propagation**: Activations propagate through all-to-all network
4. **Hyperdimensional Processing**: Multi-state reasoning with novelty detection
5. **RLM Decision**: Reinforcement learning selects action
6. **Token Generation**: Combines outputs into final response
7. **Extension Creation**: If new capability learned, create extension

## Key Benefits

- **Autonomous**: Never stops, maintains infinite context
- **Efficient**: Quantization, MoE routing, all-to-all connections
- **Adaptive**: Value range allocation protects important knowledge
- **Self-Improving**: Creates extensions to save learned capabilities
- **Private**: All local, encrypted, no external APIs
- **Extensible**: Plugins, skills, community contributions
