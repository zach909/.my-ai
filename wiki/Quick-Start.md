# Quick Start Guide

Get up and running with Prometheus Elastic Core / NeuroLang AI in minutes.

## System Requirements

- **Operating System**: Mac, Windows, or Linux
- **Node.js**: Required for building TypeScript components
- **Python**: Required for plugin management (Python 3.x)
- **Storage**: Sufficient space for models and extensions
- **Memory**: Recommended 8GB+ for optimal performance

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/zach909/.my-ai.git
cd .my-ai
```

### 2. Install Dependencies

```bash
# Install Node.js dependencies
npm install
```

### 3. Build the Project

```bash
# Compile TypeScript and build all components
npm run build
```

### 4. Run the AI

```bash
# Start the Prometheus Elastic Core
npm start
```

## Directory Structure

```
.my-ai/
├── interface/              # User interface components
│   ├── index.html         # Main UI
│   ├── cli.ts            # Command-line interface
│   └── server.py         # Python backend server
├── models && skills/      # Core AI models and skills
│   ├── moe.ts            # Mixture of Experts
│   ├── neuron.ts         # Neuron definitions
│   └── tokenizer.ts      # Text tokenization
├── plugins/               # System plugins
│   ├── file-system.ts    # File system access
│   ├── browser.ts        # Web browsing
│   └── camera.ts         # Camera access
├── extension-builder/     # Visual extension builder
│   ├── builder.ts        # Builder logic
│   └── neurolang-builder.html
├── plugin_manager/        # Plugin management system
└── dist/                  # Built distribution files
```

## First Steps

### Verify Installation

After running `npm start`, you should see:
- Interface server starting
- Plugin manager initializing
- Model loading complete
- Ready prompt

### Basic Usage

#### Command Line Interface

```bash
# Launch the CLI
node interface/cli.ts

# Example commands
> Hello, how are you?
> Help me write some code
> Open the file browser
```

#### Web Interface

Open your browser to the local server URL (typically `http://localhost:3000`).

### Creating Your First Extension

1. Open the Extension Builder:
   ```bash
   node extension-builder/builder.ts
   ```

2. Create a simple neuron:
   ```
   name="greeting"
   vale="10"
   definishon="Hello!"
   ```

3. Save and install with quantization

### Using Plugins

Plugins provide access to system features:

- **File System**: Read/write files
- **Browser**: Web browsing capabilities
- **Camera/Microphone**: Media input
- **Terminal**: Execute shell commands

Example:
```
> List files in current directory
> Take a screenshot
> Search the web for "AI news"
```

## Configuration

### Privacy Settings

By default, all data is encrypted end-to-end and stays local. No external APIs are used.

### System Access

Configure system access permissions:
- Terminal access
- File system paths
- Multi-desktop support (GNOME)
- Multi-input devices

### Performance Tuning

Adjust these settings for your hardware:
- Quantization level (default: 4-bit)
- MoE expert count
- Neuron mesh size
- Context window size

## Troubleshooting

### Common Issues

**Build fails:**
```bash
# Clear cache and rebuild
rm -rf node_modules
npm install
npm run build
```

**Plugin not loading:**
- Check plugin syntax
- Verify dependencies installed
- Check logs for errors

**High memory usage:**
- Reduce neuron mesh size
- Lower context window
- Enable more aggressive quantization

### Logs and Debugging

Check logs in:
- `dist/` directory for built files
- Console output during runtime
- System logs for plugin issues

## Next Steps

- [[Architecture]] - Learn about system design
- [[NeuroLang]] - Study the neuron definition language
- [[Plugins]] - Explore available plugins
- [[Extensions]] - Create custom extensions
- [[Skills]] - Add new capabilities

## Resources

- [Main Repository](https://github.com/zach909/.my-ai)
- [Architecture Documentation](../ARCHITECTURE.md)
- [README](../README.md)
- [[Home]] - Return to wiki home

---

*Need help? Check the troubleshooting section or review the architecture documentation.*
