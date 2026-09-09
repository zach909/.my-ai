# Neuroclaw System Architecture

## Overview

Neuroclaw is a complete AI agent running locally on macOS, Windows, and Linux. It is powered by OneBrain, the neural mesh engine underneath it — quantization, machine learning, and all-to-all neuron computation happen there. The agent itself is composed of skills, each produced by the Extension Builder and registered as a routable MoE expert, and together these layers let Neuroclaw learn new capabilities and maintain user alignment without external APIs.

## Core Architecture

### 1. Neural Mesh Engine (OneBrain)

**Location:** `src/features/mesh/mesh-engine.ts`

The foundation of computation. Every neuron connects to every other neuron in an all-to-all fully connected architecture.

**Key Features:**
- **All-to-All Connectivity:** Non-linear communication between all neurons every tick
- **Vale System:** Zero-sum plasticity resistance where high-vale neurons resist change while low-vale neurons learn readily
- **Higher-Dimensional Thinking:** Each neuron maintains multi-dimensional state vectors
- **Multidimensional Communication:** Each dimension of source neurons can influence each dimension of target neurons
- **Elastic Neuron Values:** Neural importance dynamically adjusts through learning

**Configuration:**
```typescript
{
  neuronCount: 64,        // Number of neurons
  dimensions: 4,          // Dimensions per neuron state
  totalVale: 3200,        // Total plasticity budget (zero-sum)
  settlementThreshold: 0.001,  // When to stop propagating
  maxTicks: 200,          // Maximum propagation steps
  ticksPerFrame: 4        // Ticks per update cycle
}
```

### 2. Mixture of Experts (MoE) Router

**Location:** `models && skills/core/moe-router.ts`

Routes computations to specialized experts based on input characteristics.

**Key Features:**
- Expert selection via learned routing gates
- Load balancing across experts
- Top-K expert selection (default K=2)
- Each plugin/skill becomes a specialized expert
- Automatic expert utilization tracking

**How It Works:**
1. Input is evaluated by a gate network
2. Top-K experts are selected based on gate outputs
3. Expert outputs are weighted and combined
4. Load balancing loss ensures fair expert usage

### 3. Alignment Veto System

**Location:** `models && skills/core/alignment-veto.ts`

Safety layer that validates all actions before execution.

**Capabilities:**
- **Objectionable Capability Check:** Blocks outright if a proposed action's
  capability tags match a configured blocklist
- **Irreversibility Check:** Requires human confirmation for irreversible or
  external-effect actions (unknown reversibility fails safe, treated as
  irreversible)
- **Benevolence Scoring:** Blocks actions scoring below a configurable
  threshold from a pluggable scorer function

There is no resource (memory/CPU/network), file-system-directory, or
persistent-logging model in the real implementation -- the class is a
single `evaluate()` call over these four rules, nothing more.

**Safety Policies** (the real `AlignmentVetoConfig`,
`models && skills/core/alignment-veto.ts`):
```typescript
{
  objectionableCapabilities: string[],  // Capability tags that block outright
  driftTolerance: number,               // Surprise above this escalates to confirmation
  severeDriftTolerance: number,         // Surprise above this blocks outright
  confirmIrreversible: boolean,         // Require confirmation for irreversible/external actions
  scoreThreshold: number,               // Benevolence score floor
  scorer: (action, ctx) => number,      // Pluggable benevolence scorer
}
```

### 4. Compressed I/O Loop (Zip-IO)

**Location:** `models && skills/core/zip-io.ts` and `models && skills/core/zip-io-loop.ts`

Circular buffer system for extended context and output capacity.

**Features:**
- **Circular Buffers:** Input and output run as circular buffers
- **Compression:** Gzip compression for space efficiency
- **Auto-Save:** Periodic checkpoints for persistence
- **Capacity:** Supports theoretical 200,000 GB contexts through compression
- **Chunks:** Data stored as timestamped, compressed chunks

**How It Works:**
1. Input/output compressed and split into chunks
2. Chunks added to circular buffer
3. When capacity full, oldest chunks overwritten
4. All data accessible via chunk IDs
5. Automatic or manual save to disk

### 5. Empathy Engine

**Location:** `models && skills/core/empathy.ts`

Understands user emotional state and aligns AI behavior accordingly.

**Emotional Model (VAD):**
- **Valence:** -1 (negative) to 1 (positive)
- **Arousal:** 0 (calm) to 1 (excited)
- **Dominance:** 0 (submissive) to 1 (dominant)

**Features:**
- Keyword-based emotion detection
- Punctuation and capitalization analysis
- User context tracking
- Emotional history maintenance
- Alignment score computation
- Model emotion synchronization with user

### 6. Reinforcement Learning Module (RLM)

**Location:** `models && skills/core/rlm.ts`

Evaluates multiple possible solutions before selecting actions.

**Features:**
- Multi-step thinking for complex problems
- Experience replay for efficient learning
- Policy gradient updates
- Action-value estimation
- Thinking step tracking
- Integration with neural mesh for feedback

### 7. Quantum Neural Network

**Location:** `models && skills/core/quantum-net.ts`

Bridges classical and quantum computing paradigms.

**Features:**
- Superposition of thought candidates
- Quantum interference for decision-making
- Wave function collapse for action selection
- Deterministic collapse thresholds
- Phase tracking for interference patterns

### 8. Neural Language (NeuroLang)

**Location:** `models && skills/core/neuro-lang.ts`

Domain-specific language for defining neurons and neural patterns.

**Syntax:**
```
name="example"                                    # Create neuron
"name"@value="1.0"                               # Set value
"name"@vale="0.9"                                # Set plasticity
"name"@connections=".other"*0.5                 # Set connections
"name"@definition="expected behavior"           # Contract
code@name="converter"                            # Code-to-Net
"netsearch"@net="location"                      # Net Search
```

### 9. Plugin System

**Location:** `plugin_manager/` and `plugins/`

Extends AI with system capabilities.

**Available Plugins:**
- Location (GPS)
- Camera
- Microphone
- Voice Activation
- Notifications
- Account Information
- Contacts
- Calendar
- Phone Calls
- Call History
- Email
- Tasks
- Messaging
- Radio
- Device Connectivity
- Application Diagnostics
- File System
- Screenshots
- Passkeys
- Browser
- Self-Healing

**Architecture:**
```
BasePlugin (interface)
    ↓
PluginRegistry (manages lifecycle)
    ↓
NeuroPipeline (invokes through MoE)
    ↓
(Plugin Implementation)
```

### 10. Extension Builder

**Location:** `extension-builder/builder.js` (JS-only module; no `.ts` source has ever existed at this path)

Visual interface for creating and managing neural extensions.

**Capabilities:**
- Drag-and-connect neuron interface
- Neuron search and labeling
- Individual neuron simulation
- Code-to-Net: Import binary/source code as neural networks
- Net Search: Semantic search → trained neural network
- Output layers for API communication
- Automatic quantization on save

**Workflow:**
1. Create project
2. Add neurons, connections, labels
3. Define neuron contracts
4. Test individual neurons
5. Save (without quantization) or install (with quantization)

### 11. Value Range Allocator

**Location:** `models && skills/core/value-range.ts`

Manages plasticity budget across the system.

**Features:**
- Total value fixed (zero-sum)
- Distributes across neurons proportionally
- High-value neurons = stable, hard to change
- Low-value neurons = plastic, learn quickly
- Learning rate inversely proportional to vale
- Automatic redistribution during learning

### 12. Quantization System

**Location:** `models && skills/core/quantizer.js` (JS-only module; no `.ts` source has ever existed here)

Compresses models for deployment.

**Methods:**
- **Symmetric:** Clamps to ±absMax, scales uniformly
- **Asymmetric:** min/max scaling with zero-point offset
- **Mixed:** Chooses based on distribution symmetry

**Features:**
- Configurable bit width (4, 8, 16-bit)
- Layer-specific exclusion
- Calibration sample collection
- Serialization to JSON

### 13. Neural Pipeline

**Location:** `models && skills/core/pipeline.ts`

Orchestrates all subsystems for end-to-end processing.

**Pipeline Flow:**
```
User Input
    ↓
Tokenization & Embedding
    ↓
Mesh Input Injection
    ↓
Mesh Propagation (settling)
    ↓
MoE Expert Selection
    ↓
RLM Thinking & Action Selection
    ↓
Alignment Veto Check
    ↓
Quantum Selection
    ↓
Token Generation & Output
    ↓
ZIP-IO Emission
```

**Output Structure:**
```typescript
{
  output: number[],                  // Generated tokens
  steps: PipelineStep[],            // Execution trace
  totalDurationMs: number,          // Total time
  selectedPlugins: string[],        // MoE selections
  alignment: VetoDecision,          // Safety verdict
  liveCorrections: number,          // Corrections applied
  elasticStateDeltas: Map<number, number>  // Neuron movement
}
```

## System Integration

### Complete Flow Example

```typescript
// 1. Initialize system
const system = await getNeuroclawSystem();

// 2. User input arrives
const userInput = "Please analyze this data";

// 3. Empathy engine detects emotional state
system.empathy.updateUserContext(userInput);
const alignment = system.empathy.getAlignmentScore();

// 4. Input stored in circular buffer
await system.zipIO.write(userInput);

// 5. Neural pipeline processes
const result = await system.pipeline.run(
  embedUserInput(userInput),
  { alignment }
);

// 6. Alignment veto validates
const decision = system.veto.evaluate(
  { id: result.selectedPlugins[0], name: "analyze", capabilities: ["analysis"] }
);

// 7. If approved, execute through plugin
if (decision.allowed) {
  await system.pluginRegistry.dispatch(userInput, "analysis");
}

// 8. Output emitted to ZIP-IO
await system.zipIO.emit(result.output.toString());
```

## Key Design Principles

### 1. Zero-Sum Learning
- Total neural value conserved
- Learning is redistribution, not creation
- Prevents unbounded growth
- Encourages specialization

### 2. Safety-First
- All actions validated by veto system
- User alignment tracked continuously
- Reversible actions preferred
- High-risk actions require approval

### 3. Extreme Locality
- All computation on local machine
- No external API calls
- Complete data privacy
- End-to-end encryption support

### 4. Adaptive Specialization
- MoE routes to expert specialists
- Skills created through learning
- Extensions persist across sessions
- Automatic expert promotion

### 5. Continuous Learning
- Hebbian weight updates
- RLM policy gradient updates
- Empathy-driven behavior adaptation
- Experience replay for efficiency

## Extension Lifecycle

```
Create Project (Extension Builder)
    ↓
Design Neural Network (Visual Editor)
    ↓
Define Neuron Contracts (NeuroLang)
    ↓
Test Neurons (Simulation)
    ↓
Save Project (Unquantized)
    ↓
[Optional: Code-to-Net or Net Search Integration]
    ↓
Install Extension (Quantization + Integration)
    ↓
Extension Becomes MoE Expert
    ↓
Extension Used in Routing Decisions
    ↓
Extension Learning Updates Over Time
```

## Performance Characteristics

### Memory
- Mesh: O(n² × d²) where n=neurons, d=dimensions
- Default config: 32 neurons × 4 dims ≈ 16KB weights
- Plugins: Each loaded on-demand, ~1-10MB each
- ZIP-IO: Configurable, default 200,000GB capacity (mostly virtual)

### Speed
- Single propagation tick: ~1-5ms (32 neurons)
- Full mesh settle: 10-50ms (depending on threshold)
- MoE routing: ~2-5ms
- RLM thinking step: ~5-10ms
- Total pipeline: 50-150ms per run

### Throughput
- ~10 queries/second on modest hardware
- Parallelizable expert computation
- Quantized models run on CPU
- Optional GPU acceleration (future)

## Extension Points

### Adding a Plugin
1. Create `plugins/my-plugin.ts` extending `BasePlugin`
2. Register in `plugins/index.ts`
3. Add to plugin registry on startup
4. Implement `onMessage`, `onHealthCheck`, etc.

### Creating a Skill
1. Use Extension Builder or NeuroLang
2. Define neurons with contracts
3. Test with simulation
4. Install with quantization
5. Automatically becomes MoE expert

### Customizing Safety
1. Construct `new AlignmentVeto(config)` with a `Partial<AlignmentVetoConfig>`
   (any field you omit falls back to the class's own default)
2. Call `veto.evaluate(action, ctx)` before executing a proposed action
3. Check the returned `VetoDecision` (`{allowed, requiresConfirmation, score, reasons}`)

There is no persisted "active policy" or stored-approvals mechanism -- each
`AlignmentVeto` instance's config is fixed at construction time, and every
`evaluate()` call is independent (no logging, no history).

## Monitoring and Debugging

### Pipeline Tracing
```typescript
const result = await pipeline.run(embedding, inputText);
// result.steps: PipelineStep[] -- the real execution trace
```

### Mesh Introspection
```typescript
const topology = mesh.getTopology();
const nodeCount = mesh.getNodeCount();
const groups = mesh.getGroups();
```
`NeuronMesh` (`models && skills/core/mesh.ts`) has no `getStats()` method or
`{tickCount, activeNeurons, meanActivation, valeEntropy}` shape -- that
combination of fields only exists on an unrelated class, the frontend
visualization engine at `src/features/mesh/mesh-engine.ts`, not the backend
mesh this section is actually about.

### Empathy Tracking
`EmpathyEngine`'s (`models && skills/core/empathy.ts`) `userContext` is
`private`, with no public accessor -- there is no `getUserContext()` method.
Its effects are exposed only through the class's own public methods (e.g.
`analyzeEmotion()`, `updateUserContext()`, `getAlignmentScore()`), not a
single combined "get me the whole context" call.

## Future Enhancements

- Quantum computing integration
- Multi-GPU distributed training
- Persistent filesystem for extensions
- Web UI for extension builder
- Natural language programming
- Self-healing from failure modes
- Community skill marketplace

## References

- Valle system: Zero-sum plasticity gates
- MoE: "Switch Transformers" (Lewis et al.)
- Hebbian learning: "Fire Together Wire Together"
- VAD model: Psychology of emotion
- Quantization: Mixed-precision inference
