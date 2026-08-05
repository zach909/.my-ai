# Quick Start Guide

Get up and running with NeuroClaw / NeuroLang AI in minutes.

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

`npm run build` builds the React/Vite visual editor (`src/`) — it does **not**
build the Node/TypeScript AI backend (CLI + HTTP API). Build that separately:

```bash
# Compile the Node/TypeScript backend (CLI + HTTP API) into dist/
node scripts/build-backend.mjs
```

### 4. Run the AI

There is no `npm start` script. Run the built backend directly:

```bash
# Interactive CLI
node dist/interface/main.js cli

# HTTP API (default port 7861; pass a port number to use another)
node dist/interface/main.js web 7861
```

## Directory Structure

```
.my-ai/
├── interface/              # User interface components
│   ├── index.html         # Main UI
│   ├── cli.ts             # Command-line interface (source; compiled to dist/interface/cli.js)
│   └── server.py          # Python backend server
├── models && skills/      # Core AI models and skills
│   ├── moe.ts             # Mixture of Experts
│   ├── neuron.js          # Neuron definitions (JS-only module, no .ts source)
│   └── tokenizer.js       # Text tokenization (JS-only module, no .ts source)
├── plugins/               # System plugins
│   ├── file-system.ts    # File system access
│   ├── browser.ts        # Web browsing
│   └── camera.ts         # Camera access
├── extension-builder/     # Extension builder engine
│   ├── builder.js         # Builder logic (JS-only module, no .ts source; also
│   │                       # run directly in the browser by src/components/Desktop.tsx)
│   └── neurolang-builder.html
├── plugin_manager/        # Plugin management system
└── dist/                  # Built distribution files (backend build output)
```

## First Steps

### Verify Installation

After running `node dist/interface/main.js cli`, you should see:
- Subsystem activation log lines (plugins/skills initializing)
- The Neuroclaw banner
- LLM/pipeline/plugin counts
- The `neuroclaw>` prompt

### Basic Usage

#### Command Line Interface

```bash
# Build the backend once, then launch the interactive CLI
node scripts/build-backend.mjs
node dist/interface/main.js cli

# Example commands
> chat
  you> Hello, how are you?
  you> /exit
> help
```

`interface/cli.ts` only defines the `CLI` class — `node interface/cli.ts` on
its own does nothing visible, since nothing instantiates or starts it.
`interface/main.ts` is the actual composition root that wires the dependency
graph together and starts the CLI; always go through the built
`dist/interface/main.js` above, not the raw source file.

#### Web Interface

The HTTP API is served by the backend itself, not by `npm run dev`'s Vite
dev server: after `node dist/interface/main.js web 7861`, open
`http://localhost:7861` for the built-in chat UI, or call the JSON routes
directly (`GET /api/status`, `POST /api/chat`, etc.). The separate `src/`
React app (started with `npm run dev`, port 3000) is a different UI that
talks to this same backend through a dev-server proxy — both need to be
running for it to work end-to-end.

### Creating Your First Extension

The Extension Builder (`extension-builder/builder.js`) is a class you drive
through the CLI or the HTTP API, not a script you run standalone:

1. From the running CLI, the `neuri <code>` command takes everything after
   `neuri ` as one line of NeuriLang source, so it only fits a single
   directive per call:
   ```
   > neuri name="greeting"
     NeuriLang: 1 neurons defined
       greeting value:0
   ```
   Setting multiple properties on one neuron (`@vale=`, `@definishon=`, ...)
   needs a NeuriLang source string with real embedded newlines between
   directives — not practical to type interactively line-by-line at this
   prompt, since each Enter submits a separate top-level CLI command. Use
   the HTTP API for that instead:
   ```bash
   curl -X POST http://localhost:7861/api/extension/build \
     -H "Content-Type: application/json" \
     -d '{"name":"greeting_ext","code":"name=\"greeting\"\n\"greeting\"@vale=\"0.9\"\n\"greeting\"@definishon=\"Hello!\"","quantize":true}'
   ```

2. The API response's `savedAs` field is the extension file written under
   `extension-builder/extensions/`. Pass `"quantize": false` to save at full
   precision instead.

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
# Frontend (src/): clear cache and rebuild
rm -rf node_modules
npm install
npm run build

# Backend (CLI + HTTP API): clear dist/ and recompile
rm -rf dist
node scripts/build-backend.mjs
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
