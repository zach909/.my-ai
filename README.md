# Prometheus Elastic Core / NeuroLang AI

## Project Brief

Prometheus Elastic Core is a private, autonomous AI system that runs entirely on your machine (Mac, Windows, or Linux). It features an elastic value budget for neurons, all-to-all connectivity, hyper-dimensional thinking, and self-created extensions for memory and logic.

**Location**: `home/zach/.my-ai` | [GitHub](https://github.com/zach909/.my-ai)

## Core Features

### Background Systems (Learning & Memory)

- **Quantization**: 4-bit quantization for faster, power-efficient model execution
- **Elastic Value Budget**: Zero-sum neuron value system where higher-value neurons change less (stable) and lower-value neurons learn more (adaptive)
- **Self-Built Extensions**: AI creates extensions to store learned capabilities (e.g., coding extension)
- **RLM Training**: Reinforcement Learning Module that thinks through possibilities and avoids loops

### Foreground Systems (Processing & Reasoning)

- **Mixture of Experts (MoE)**: Neurons choose which experts run for efficient processing
- **All-to-All Connectivity**: Each neuron connects to every other neuron for infinite context
- **Hyper-Dimensional Thinking**: Multi-ball neuron states with complex cross-influence math
- **Empathy Engine**: Understands user feelings to stay aligned

### NeuroLang

The model thinks in NeuroLang - a custom neuron definition language where:
- All components are zipped and quantized
- Connections drawn from thesaurus, defined by dictionary
- Syntax: `name="example"`, `"name"@vale="number"`, `"name"@conections=".names/verable"*"bias"+"wate"`

### Zip I/O Loop

Inputs and outputs work as loops - when space runs out, it starts at the beginning until everything is consumed (supports infonit GB context).

### Plugins & Skills

- **Plugins**: API connections to services (Camera, Microphone, File System, Browser, etc.)
- **Skills**: Experts added to MoE (Coding, Image, Video, Game creation)
- **Supported Languages**: 500+ programming languages from ABAP to Zsh

## System Requirements

- Runs on Mac, Windows, or Linux
- Private by default - data encrypted end-to-end
- Full system access: Terminal, File System, Multi-desktop (GNOME)
- Multi-mouse/keyboard support (no tug-of-war with user)

## Extension Builder

- Save without quantization / Install with quantization
- Drag and connect neurons visually
- Search neurons across large networks
- Type model output definitions
- Add API output layers
- Net Search: Deep learning-powered search over neuron content
- Code-to-Net: Import binary code as neural networks

## No External APIs

All processing happens locally. Chrome apps can connect to services for additional data when needed.

## Quick Start

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run the AI
npm start
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system documentation.

## License

Private project - Zach's personal AI system
