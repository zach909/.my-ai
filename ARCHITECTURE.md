# Prometheus Elastic Core / NeuroLang AI System Architecture

## Overview

Prometheus Elastic Core (NeuroClaw) is a private, local AI system that runs entirely on your machine (Mac, Windows, or Linux). Your data stays encrypted end-to-end, always. The system is designed to be autonomous, with infinite context through all-to-all neuron connectivity, and capable of learning without forgetting through elastic value budgets.

**Project Location**: `home/zach/.my-ai`  
**Skills Repository**: `https://github.com/zach909/.my-ai/tree/skills`  
**Main Repository**: `https://github.com/zach909/.my-ai/tree/main`

**Key Principle**: NO EXTERNAL APIS - all processing happens locally. Chrome apps may connect to services for additional data when needed.

## Core Architecture

### Background Subsystems (Learning & Memory)

#### 1.1 Background Quantization
- **Purpose**: Run models efficiently after building
- **Benefits**: Faster execution, saves power
- **Example**: When an extension is built, it's quantized to save memory and logic
- **Implementation**: 4-bit quantization with symmetric/asymmetric/mixed methods
- **Zero-Sum Game**: Total neurons = total value points

#### 1.2 Self-Built Extensions for Memory & Logic
- **Purpose**: AI creates extensions to store memory and logic
- **Why**: Learns better by saving capabilities as reusable modules
- **Example**: When the model learned to code, it made an extension to save that ability
- **Builder**: NeuroLang-based with drag-and-connect interface

#### 1.3 Elastic Value Budget (ValueRangeAllocator)
- **Purpose**: Manages neuron learning rates based on importance via value ranges
- **Mechanism**: Zero-sum game - total neurons = total value points
  - Higher value neurons change less (stable knowledge)
  - Lower value neurons learn more (adaptive learning)
  - More input + less value = more change; more value + less input = less change
- **Why**: Learn but do not forget
- **Example**: The model demoted the bad neuron (lowered its value to free points)
- **NeuroLang realization**: `"<neuron>"@reward="<-1..1>"` on the elastic-mesh
  runtime (`model && skills manager/neurolang.py`). A positive reward raises a
  neuron's value (locking it in — it changes less); a negative reward lowers it
  (making it more plastic). The opposite amount is redistributed across the rest
  of the mesh, honouring the `[0, 1]` clamp, so `NeuroRuntime.total_value()` is
  invariant — the zero-sum guarantee. `neuron.plasticity()` exposes `1 - vale`
  and `neuron.expected_change(input)` predicts state movement (more input + lower
  value → greater change). Guarded by `test_value_system.py`.

#### 1.8 Empathy Engine
- **Purpose**: Keep model aligned with user feelings
- **Mechanism**: Understands how the person feels and feels the same
- **Why**: To stay on track and make decisions without user intervention
- **Example**: Model was able to make decisions without the user

#### 1.7 RLM Training & Reasoning
- **Purpose**: Training and autonomous guidance using Reinforcement Learning
- **Mechanism**: Thinks through each possibility during training
- **Why**: Keeps the autonomous part on track
- **Example**: The AI wrote down the steps so it wouldn't repeat itself
- **Features**: Loop detection, lookahead steps, experience replay

### Foreground Subsystems (Processing & Reasoning)

#### 1.4 Mixture of Experts — MoE
- **Purpose**: Efficient routing to specialized processing units
- **Mechanism**: Some neurons choose which experts/neurons get to run
- **Benefits**: Efficient and faster processing
- **Example**: The expert was an extension for making images
- **Features**: Load balancing, top-K routing, dynamic expert addition/removal
- **Why**: All-to-all connectivity means plugins drop in easily

#### 1.5 All-to-All Connectivity (NeuronMesh)
- **Purpose**: Non-linear, autonomous computation with infinite context
- **Mechanism**: Each neuron connects to every other neuron
- **Benefits**: 
  - Moves away from linear computing
  - Gives the model autonomous and effectively infinite context
  - Never forgets context as new prompts are added
- **Example**: The model never stopped, ran autonomously, and never forgot context
- **Features**: Propagation with convergence, topology statistics, dynamic connections

#### 1.6 Hyper-Dimensional Thinking — Multi-Ball Neuron States
- **Purpose**: Multi-state reasoning and novelty detection
- **Mechanism**: 
  - Each neuron has multi-ball states
  - Changes state based on its input AND all other neurons' input (temporarily)
  - Each neuron holds a variable for every other neuron plus complex math
  - Non-linear communication: every neuron connected to all neurons
- **Benefits**: 
  - Model understands what has already been done
  - Will not repeat actions/thoughts
  - Can read its own thoughts
- **Example**: The model was able to read its own thoughts
- **Features**: Novelty scoring, pattern recording, cross-influence, energy computation

#### 1.9 Thinking in NeuroLang
- **Purpose**: Long context processing through custom language
- **Mechanism**: 
  - Model thinks in NeuroLang because it's built in the extension builder
  - All components and words are zipped
  - Zipped version is quantized
  - Output produced per-neuron: when neuron exclusively has input, added to all neurons that fed into it
  - Done in trial; structure stays the same
  - Connections drawn from thesaurus, then defined by dictionary
- **Why**: Long context support
- **Example**: Runs more efficiently

#### 1.10 Zip I/O Loop (InfiniteZipLoop, ZipIOSystem)
- **Purpose**: Extended context and output capacity via circular compressed buffers
- **Mechanism**: 
  - AI takes inputs as zips (compressed) and emits outputs as zips
  - Both run as loops with head/tail pointers
  - When space runs out, starts again at beginning (overwrites oldest)
  - Uses gzip compression for "zipping" data
  - Dual loop system: one for input context, one for output history
- **Why**: AI can hold more context and produce more output
- **Example**: The 200,000 GB worked with the model
- **Features**:
  - `zipInput(data)`: Compress and inject into circular loop
  - `unzipAt(index)`: Retrieve and decompress specific chunk
  - `iterateContext()`: Async generator to stream entire context
  - `getTotalContextSize()`: Calculate uncompressed size of current window
  - Circular overwrite: tail moves forward when capacity reached
- **Integration**: Step 0 in NeuroPipeline - ingests input text before MoE routing

#### 1.12 Quantum Neural Net
- **Purpose**: Enable quantum conversion and超越 classical domain
- **Mechanism**: 
  - Uses quantum interference where neuron's input defines wave height
  - Wave is the neuron's signature
  - Applies when neuron exclusively has input
  - Superposition of multiple states until collapse
  - Phase evolution for interference patterns
- **Why**: Easy to convert to quantum, reaches beyond classical domain
- **Example**: Neuron 2's signature was 4.5 and its height was 10
- **Features**:
  - `addNeuron(id, input)`: Register neuron with exclusive input
  - `createSuperposition()`: Create multiple potential states
  - `interfere(neuronA, neuronB)`: Apply quantum interference between neurons
  - `collapse(neuronId)`: Collapse wave function to single state
  - `evolvePhase()`: Time-based phase evolution
- **Integration**: Runs as Step 4 in NeuroPipeline after hyper-dimensional processing

### Extension System & Runtime

#### 1.11 Plugins & Skills
- **Plugin Definition**: An API connection to another service
- **Skill Definition**: An expert added into the MoE
- **Why Easy Integration**: All-to-all connectivity means plugins drop in easily
- **Example**: The coding extension fit right in with the rest of the logic

#### 2.1 Runs on Your Machine
- **Platforms**: Mac, Windows, or Linux
- **Privacy**: Private by default — data stays encrypted end-to-end, always encrypted
- **Extensibility**: Extend with community skills or build your own; AI can write its own

#### 2.2 Full System Access
- **Terminal and File Access**: Complete system control
- **Multi-Desktop**: Multiple desktops powered by GNOME
- **Multi-Input**: Multiple mouse/keyboard inputs so AI doesn't interfere with user (no tug-of-war)

#### 3. Extension Builder Features
- **Save without Quantization**: Save extension in full precision for development
- **Install with Quantization**: Install extension with quantized weights for efficient deployment
- **Drag and Connect**: Visual interface to drag neurons and connect them with weights/bias
- **Search Neurons**: Search functionality helpful when there are many neurons
- **Drag Labels**: Add labels to neurons by dragging
- **Type Model Output**: Type out model output for case where neuron only has input
- **Add Output Layer with API**: Add output layer that exposes API endpoints
- **Net Search**: 
  - Hard search over content/options using text input
  - Trains a net via deep learning to do the same thing
- **Code-to-Net**: 
  - Import binary code
  - Turned into a neural net that behaves as the code

#### 5.1 Plugin Categories
Location · Camera · Microphone · Voice activation · Notifications · Account info · Contacts · Calendar · Phone calls · Call history · Email · Tasks · Messaging · Radios · Other devices · App diagnostics · File system · Screenshots & screen recording · Passkeys · Browser · Self-heal

#### 5.2 Skill Categories
Plugin-maker · Skill-maker · Coding · Image · Video · Game

#### 1.13 Chrome Apps for Service Connections
- **Purpose**: Connect to services for more data
- **Background**: Uses Chrome apps as bridge to external services

## NeuroLang Syntax Reference

> Syntax preserved exactly as specified. All neurons are connected by default; if a connection field is left blank, it uses the default.

**Create and name a neuron:**
```
name="example"
```

**Set elastic-core value** (higher value → changes less):
```
"name"@vale="number"
```

**Define connections** (default all-to-all if not filled in):
```
"name"@conections=".names/verable"*"bias"+"wate"
```

**Define the output for the input-only case:**
```
"name"@definishon="definshon"
```

**Name a code-to-net import:**
```
code@name="name"
```

**Add the code net:**
```
"name"@code="code"
```

**Net search — name and location:**
```
"netsearch"@name="name"
"netsearch"@net="location"
```

## Supported Languages

ABAP, ActionScript, Ada, Agda, Alloy, AMPL, ANTLR, ApacheConf, Apex, API Blueprint, APL, AppleScript, Arc, Arduino, ASL, ASN.1, AspectJ, Assembly, ATS, AutoHotkey, AutoIt, Awk, Ballerina, Batchfile, Beef, Befunge, Berry, Bicep, Bison, BitBake, Blade, BlitzMax, Bluespec, Boo, Brainfuck, Brightscript, C, C#, C++, C-ObjDump, C2hs Haskell, Cap'n Proto, CartoCSS, Ceylon, Chapel, Charity, ChucK, Cirru, Clarion, Clarity, Clean, Click, Clojure, Closure Templates, Cloud Firestore Security Rules, CMake, COBOL, CodeQL, CoffeeScript, ColdFusion, Common Lisp, Component Pascal, Cool, Coq, Crystal, CSON, CSRTE, CSS, CSV, Cuda, CUE, Curry, CWeb, Cycript, Cython, D, Dafny, Darcs Patch, Dart, DataWeave, Debian Control file, DenizenScript, Dhall, Digital Command Language, Dingo, DirectWeb Remoting, DM, Dockerfile, Dogescript, DTrace, Dylan, E, Earthly, Easybuild, EBNF, eC, Ecere Projects, ECL, ECLiPSe, EditorConfig, Edje Data Collection, Eiffel, EJS, Elixir, Elm, Elvish, Emacs Lisp, Emerald, Erlang, Escher, EUC, Euphoria, Eureka, F#, F*, Factor, Fancy, Fantom, Faust, Fennel, Filebench WML, Filterscript, fish, Fluent, FLUX, Forth, Fortran, FreeMarker, Freemodbus Asm, Futhark, G-code, Game Maker Language, GAML, GAMS, GAP, GCC Machine Description, GDB, GDScript, Gedcom, Gemini, Genie, Genshi, Gentoo Ebuild, Gerber Image, Gherkin, Git Attributes, Git Config, GLSL, Glyph, Gnuplot, Go, Golo, Gosu, Grace, Gradle, Graffle, GraphQL, Graphviz (DOT), Groovy, Groovy Server Pages, GSC, Hack, Haml, Handlebars, Harbour, Haskell, Haxe, HCL, HLSL, HolyC, HTML, HTTP, Huff, Hxml, Hy, HyPhy, IDL, Idris, Ignore List, Igor Pro, ImageJ Macro, Inform 7, INI, Inno Setup, Io, Ioke, IRC log, Isabelle, J, JANET, JAR Manifest, Jasmine, Java, Java Properties, Java Server Pages, JavaScript, JFlex, Jinja, Jison, Jison Lex, Jolie, JSON, JSON with Comments, JSON5, JSONLD, JSONiq, Jsonnet, Julia, Jupyter Notebook, Just, KRL, Kaitai Struct, KakouneScript, Kerboscript, KiCad Layout, KiCad Legacy Schematic, KiCad Schematic, Kit, Kotlin, Kusto, LFE, LabVIEW, Lark, Lasso, Latte, Lean, Less, Lex, LHE, LilyPond, Limbo, Linker Script, Linux Kernel Module, Liquid, Literate Agda, Literate CoffeeScript, Literate Haskell, LiveScript, LLVM, Logos, Logtalk, LOLCODE, LookML, LoomScript, LSL, Lua, Luau, M, M4, M4Sugar, Macaulay2, Makefile, Mako, Markdown, Marko, Mask, Mathematica, MATLAB, Max, MAXScript, MCFunction, MDX, Mercury, Mermaid, Meson, Metal, Microsoft Developer Studio Project, MiniD, MiniYAML, Mint, Mirah, mIRC Script, MLIR, Modelica, Modula-2, Modula-3, Module Management System, Monkey, Monkey C, Moocode, MoonScript, Motoko, Motorola 68K Assembly, Move, MQL4, MQL5, MTML, MUF, mupad, Mustache, Myghty, nanorc, Nasal, NASL, NCL, Nearley, Nemerle, neon, nesa, NetLinx, NetLinx+ERB, NetLogo, NewLisp, Nextflow, Nginx, Nim, Ninja, Nit, Nix, NL, NPM Config, NSIS, Nu, NumPy, Nunjucks, NWScript, Oatmeal, ObjDump, Object Data Instance Text, Objective-C, Objective-C++, Objective-J, ObjectScript, OCaml, Odin, Omgrofl, ooc, Opa, Opal, Open Policy Agent, OpenAPI Specification v2, OpenAPI Specification v3, OpenCL, OpenEdge ABL, OpenRC runscript, OpenSCAD, OpenStep Property List, OpenType Feature File, Option List, Org, Ox, Oxygene, Oz, P4, PACT Compiler, Pan, Papyrus, Parrot, Parrot Assembly, Parrot Internal Representation, Pascal, Pawn, PDDL, PEG.js, Pep8, Perl, PHP, Pic, Pickle, PicoLisp, PigLatin, Pike, PINS, PLSQL, PLpatch, Ploy, Pod, Pod Markdown, PogoScript, Polar Code, Pony, Portfile, PostCSS, PostScript, POV-Ray SDL, PowerBuilder, PowerShell, Prisma, Processing, Procfile, Product Spec, Proguard Ruleset, Prolog, Promela, Propeller Spin, Protocol Buffer, Public Key, Pug, Puppet, Pure Data, PureBasic, PureScript, Pyret, Python, Python traceback, q, QMake, QML, Qt Script, Quake, R, Racket, Ragel, Raku, RAML, Rascal, Raw token data, RDoc, READ_ME, RealBasic, Reason, ReasonLIGO, Rebol, Record Jar, Red, Redcode, Regular Expression, Ren'Py, RenderScript, ReScript, reStructuredText, REXX, Ring, Riot, RMarkdown, RobotFramework, Roff, Roff Manpage, Rouge, Router Log, RPC, RPM Spec, Ruby, RUNOFF, Rust, Sage, SaltStack, SAS, Sass, Scala, Scaml, Scenic, Scheme, Scilab, SCSS, sed, Self, SEPlib, ShaderLab, Shell, ShellCheck Config, Shen, Sharlight, Sieve, Signal Processing, Singularity, SketchUp Ruby, Slang, Slice, Slim, Smali, Smalltalk, Smarty, SMT, Smithy, SmPL, SML, Solidity, Soong, SourcePawn, SPARQL, SPHINX, Spline Font Database, SQF, SQL, SQLPL, Scribe, Ssh Config, Stan, Standard ML, Starlark, Stata, STC, Stonescript, Stylus, SubRip Text, SugarSS, SuperCollider, Svelte, SVG, Sway, Sweave, Swift, SWIG, SystemVerilog, TADS, TAL, Tcl, Tcsh, Tea, Terra, TeX, Texinfo, Text, TextMate Properties, Textproto, Thritt, Tichu, TI Program, TLA, Toit, TOML, TSX, Turing, Turtle, Twig, Type Language, TypeScript, Unified Parallel C, Unity3D Asset, Unix Assembly, Uno, UnrealScript, UrWeb, V, Vala, Valve Data Format, VBA, VBScript, VCL, Velocity, Verilog, VHDL, Vim Help File, Vim Script, Vim Snippet, Visual Basic .NET, Visual Basic 6, Volt, Vue, Vyper, Wavefront Material, Wavefront Object, WDTE, Web Ontology Language, WebAssembly, WebIDL, WebVTT, Wenyan, Whitespace, WGSL, Whois Response, Wiki, Witch Hazel, Wizzardo-HTTP, Workflow, Wren, WSIL, WXWidgets, X10, xBase, XBitMap, XC, XCompose, XFontish, XGettext, XHTML, XML, XML Property List, Xojo, Xonsh, XPages, XPixMap, XProc, XQuery, XS, XSLT, Xtend, Yacc, YAML, YANG, YARA, YASnippet, Yul, ZAP, Zeek, ZenScript, Zephir, Zig, Zil, Zimpl, Zsh

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

- **Autonomous**: Never stops, maintains infinite context through all-to-all connectivity
- **Efficient**: Quantization, MoE routing, zero-sum value allocation
- **Adaptive**: Elastic value budget protects important knowledge while allowing new learning
- **Self-Improving**: Creates extensions to save learned capabilities
- **Private**: All local, encrypted end-to-end, no external APIs
- **Extensible**: Plugins, skills, community contributions, self-writing capabilities
- **Quantum-Ready**: Quantum neural net architecture for future conversion

## Hive Mind Architecture

A hive mind is a **distributed intelligence**. Instead of one central brain controlling everything, many individual units communicate, share information, and influence one another. Each unit may have limited knowledge or a specialized role. Through communication, feedback and cooperation the network reaches a collective decision no single unit could reach alone. The intelligence belongs to the **network as a whole**.

### Implementation

The hive mind is implemented (not just described) by two core modules and is wired into the live system:

- **`models && skills/core/hive-mind.ts`** — `HiveMind` owns the agents, a shared blackboard, and a **zero-sum trust budget**. This deliberately reuses the neuron **Value System** (§3.1) at the agent level: `spawn()` takes each new agent's trust share proportionally from the existing members, and `reward()` (promotion/demotion, §3.2) transfers trust between agents while `totalTrustValue()` stays invariant. Each agent (`HiveAgent`) has a role, a specialization, a **default-deny** capability set (permissions), private working memory, and a pluggable *mind* (think-function). In the running system that mind is the real `NeuroclawRunner.generate` — so multi-agent work flows through the same neural pipeline as a single query. `delegate()` routes a task to the best-matching agent (token overlap on role/specialization/capabilities, tie-broken by trust — an MoE-style gate); `collaborate()` fans a task out to many agents.
- **`SharedBlackboard`** (same file) — shared memory with **public/private namespaces**, permissioned reads (private entries are visible only to their owner), versioned writes, and **conflict tracking**: when two agents write the same public key with different values a conflict is raised, and `HiveMind.synchronize()` resolves it in favour of the **higher-trust** owner.
- **`models && skills/core/chat-group.ts`** — `ChatGroup` composes a subset of hive agents into a collaborating group: membership, message routing (targeted or broadcast), shared context (via the blackboard), message history, **trust-weighted `decide()`** (each member votes; votes are tallied by the member's trust; ties broken deterministically — the group's conflict-resolution rule), and task completion.

The system exposes this through **`NeuroclawSystem.collaborate(task)`** (`index.ts`), which spins up a default `planner`/`coder`/`reviewer` team, runs a discussion and a trust-weighted decision through the real pipeline, then synchronizes shared-memory conflicts. All of the above is verified end-to-end by the `Hive Mind & Chat Groups (Section 13-14)` suite in `test/smoke.mjs` (zero-sum invariant, promotion/demotion, permission default-deny, delegation routing, private-memory isolation, conflict resolution, and the group decision).
