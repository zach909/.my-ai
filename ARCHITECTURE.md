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

#### 1.7b Plan Tracker (structured planning record)
- **Purpose**: The "wrote down the steps so it wouldn't repeat itself" part, made concrete — the structured plan record Section 10 requires (objective, completed/pending/failed steps, alternatives, decisions, constraints, results).
- **File**: `models && skills/core/plan-tracker.ts`
- **Mechanism**:
  - Steps are de-duplicated by normalized description; `shouldPerform(desc)` returns false once an identical step is completed — **repeated actions are prevented** unless a repeat is explicitly forced.
  - `reviseRemaining(newSteps)` replaces the not-yet-started work while preserving completed/failed history — **the plan is revised when new information arrives**.
  - `start`/`complete`/`fail`/`retry` track status; `isComplete`/`isAchieved`/`progress`/`summary` report it.
- **Integration**: `NeuroclawSystem.executePlan(objective, steps)` (`index.ts`) runs each pending step through the real neural runner and **skips steps already completed in a prior call**. `autonomousTask()` goes further: it records the system's real operating constraint ("no external APIs"), and for every step delegated to the Hive Mind, a genuine **decision** naming which agent was chosen and why (role, trust) — or, on failure, an **alternative** worth trying next. These previously existed on `PlanTracker` but were never actually called from anywhere (a doc/code mismatch — this section claimed them covered before they were wired); `summary()` now surfaces all three, not just step checkmarks. Verified by the `RLM planning / PlanTracker (Section 10)` and `Integrated autonomous task (Section 27)` smoke suites, plus a live no-repeat check. (A later pass caught that this last claim overstated things: `plan.summary()` had only ever been checked via direct field access in an ad hoc verification script, not through any actual `NeuroclawSystem` method — `planSummary()` now genuinely exposes it, closing that gap for real; see below.)

#### 1.7c Self-Healer (component recovery)
- **Purpose**: The testable, component-level self-healing Section 24 requires (the `SelfHealExtension` plugin only does process-level GC/heap hygiene).
- **File**: `models && skills/core/self-healer.ts`
- **Mechanism**: components register a `check` (healthy?), an optional `repair`, and an optional `snapshot`/`restore`. `heal()` detects unhealthy components, tries bounded repairs and re-verifies, falls back to reverting a **known-good snapshot**, and **reports anything unrecoverable rather than hiding it**. Every step is logged — repairs are never silent, satisfying the "maintain a recovery mechanism" rule.
- **Integration**: `NeuroclawSystem` registers real components (the plugin registry, which it can re-activate; the hive trust-budget invariant) and exposes `selfHeal()` / `healthReport()`. Verified by the `Self-healing / SelfHealer (Section 24)` smoke suite.

### Foreground Subsystems (Processing & Reasoning)

#### 1.4 Mixture of Experts — MoE
- **Purpose**: Efficient routing to specialized processing units
- **Mechanism**: Some neurons choose which experts/neurons get to run
- **Benefits**: Efficient and faster processing
- **Example**: The expert was an extension for making images
- **Features**: Load balancing, top-K routing, dynamic expert addition/removal
- **Why**: All-to-all connectivity means plugins drop in easily

#### 1.4b Capability Router (system-level routing)
- **Purpose**: The MoE routing idea applied at the *whole-system* level — decide which high-level capability a query activates so the full pipeline need not run for every request.
- **File**: `models && skills/core/intent-router.ts`
- **Mechanism**: `IntentRouter.route(input)` scores keyword/phrase signals per capability (recall / summarize / heal), longer phrases weighted higher, ties broken by fixed priority, no signal → `generate`. Returns the capability plus a bounded confidence.
- **Integration**: `NeuroclawSystem.processQuery` routes each query — summarize → compressed context, recall → chat-history retrieval, heal → self-heal + health report — and otherwise falls through to grounded neural generation. Verified by the `Capability routing / IntentRouter (Section 6)` smoke suite.

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

#### 1.11 Long-Term Memory & Retrieval (LongTermMemory)
- **Purpose**: The complement to the Zip I/O buffer — a persistent store you retrieve by *relevance*, not recency (Section 7's distinction between *active working context* and *long-term memory*).
- **File**: `models && skills/core/long-term-memory.ts`
- **Mechanism**:
  - Each memory carries a token-level bag-of-words embedding (cosine reflects shared vocabulary, unlike the whole-string `embedText` fingerprint), a timestamp, tags, and an `importance` value in [0,1].
  - `retrieve(query)` ranks by semantic similarity, then modulates by importance and recency, and **reinforces** what it returns (accessed memories become slightly more important — a light promotion, echoing the Value System §3.1).
  - Capacity policy: when full, the lowest-retention memories (importance × recency × recall-frequency) are evicted — *removed when necessary, preserved when important*.
  - `serialize()`/`deserialize()` persist the store; `consolidateFrom(texts)` transfers working-context snippets into durable memory.
- **Integration**: `NeuroclawSystem` (`index.ts`) commits each user message to memory with an importance set by the empathy engine's arousal reading, and exposes `recall(query)`. Verified by the `Long-term memory & retrieval (Section 7)` smoke suite.

#### 1.11b Context Compressor (semantic compression)
- **Purpose**: The Section 7 "compressed context" category — condensing a long conversation into a compact, salient summary. Distinct from ZipIO's *byte-level* gzip; this is *semantic* compaction.
- **File**: `models && skills/core/context-compressor.ts`
- **Mechanism**: `compress(texts)` scores items by corpus-wide term salience (length-normalized), greedily selects the most salient under a character/item budget, and re-orders the kept items back into sequence. Reports the compression ratio.
- **Integration**: `NeuroclawSystem.compressContext()` summarizes the user's turns; a "summarize our conversation" query returns it via the capability router. Verified by the `Context compression (Section 7)` smoke suite.

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

### Integrated Autonomous Execution (Section 27)

Beyond a single request, `NeuroclawSystem.autonomousTask(objective, steps)` shows the subsystems working as one platform rather than in isolation: the **PlanTracker** (§10) records the objective and enforces no-repeat, each pending step is **delegated through the Hive Mind** (§13-14) to the best-matching agent whose mind is the real neural runner, results are committed to **long-term memory** (§7), and if the plan doesn't fully succeed the **SelfHealer** (§24) runs and reports recovery. Verified by the `Autonomous task integration (Section 27)` smoke suite.

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

**Recursive intelligence (ASI §8) genuinely integrates with the hive, not just the runner.** `solve()`'s own docstring claimed subproblems were "delegated to the hive", but the actual `ReasoningEngine` dependency was `solveSub: (sub) => this.runner.generate(sub)` — every subproblem went straight to the generic neural runner, bypassing the Hive Mind entirely. Fixed: `solveSub` now lazily spawns the default team (`ensureDefaultTeam()`, factored out of the duplicated bootstrap in `collaborate()`/`autonomousTask()`) and delegates each subproblem via `HiveMind.delegate()`, falling back to the runner only if no agent matches. Verified live and in `test/smoke.mjs`: the hive has zero agents before any hive-based capability runs, and exactly the default team (with the trust budget still exactly 100) after a `solve()` call — the delegation is real, not decorative.

## ASI Capability Layer

The ASI brief asks for general intelligence, advanced/recursive reasoning, autonomous learning, knowledge integration, self-improvement, mistake learning, knowledge transfer, a self-model, prediction/self-monitoring, and — critically — for these to be **connected into one integrated intelligence**, not built as isolated features. Seven small modules under `models && skills/core/` implement this, and `NeuroclawSystem.solve()` (`index.ts`) is where they interact:

| Spec item | Module | What it actually does |
|---|---|---|
| §1/§2/§8 Advanced & recursive reasoning | `reasoning-engine.ts` — `ReasoningEngine` | Understands the problem, fixes the objective, checks what's available (memory) vs. missing, then **actively seeks each missing term** via an injected `search` (§1 — "recognize incomplete knowledge, ask what's missing" is followed by actually looking for it, not just reporting the gap: resolved terms move from `missing` into `available` and are recorded in `soughtAndResolved`; unresolved ones stay genuinely missing), generates and scores several **approaches**, decomposes into subproblems and **delegates** each (to the hive/neural runner via an injected `solveSub`, or recursively to itself when none is given), detects unresolved subproblems as mistakes, **revises** a failed subproblem by re-decomposing that specific piece into finer steps and retrying before giving up (§2 step 10 — recursive intelligence, §8, applied to error recovery; recorded in `revised`, not just reported as a mistake), and verifies the combined result. Every step is recorded in a `trace`. |
| §1/§7 Knowledge transfer | `knowledge-transfer.ts` — `KnowledgeTransfer` | Registers solved problems by their **structural** vocabulary (minimize/route/balance/flow/…, not domain nouns), then matches a new problem against them, preferring **cross-domain** hits — so a method learned in one field (e.g. traffic flow) is surfaced for an unrelated one (e.g. fluid systems) when the underlying structure matches. The strongest hit is now a **real, choosable approach in `ReasoningEngine`**, not just reported metadata: `solve()` passes it as a `transferHint`, which competes on score against decompose/analogy/first-principles and can genuinely win — "combine knowledge from multiple domains... to create solutions" (§1), made concrete rather than informational. Verified live: a fluid-dynamics problem chose the `transfer` approach and reused a registered traffic-flow method ("max-flow min-cut"), with the result text naming what was borrowed and from where. |
| §9 Self-model | `self-model.ts` — `SelfModel` | Tracks per-domain competence as a running EMA of attempt outcomes; `knows()`/`gaps()` report strong vs. weak domains; `calibrate()` **shrinks a stated confidence toward what the track record actually supports** — the system cannot claim more certainty than its evidence. |
| §6 Mistake & failure learning | `mistake-tracker.ts` — `MistakeTracker` | Records *why* a task failed (cause: missing-knowledge / bad-memory / incorrect-skill / reasoning), de-duplicates identical failures into an occurrence count, and surfaces `lessons()` — past preventions — for similar future tasks. `repeated()` flags failures that recur; `refreshApproachBias()` (below) directly demotes the approach a repeated failure implicates, live — this isn't just a flag, it changes future behavior. `resolve()` existed but was never called until now: when the *same* task later actually succeeds, `solve()` marks its prior mistake resolved, so a fixed problem stops counting toward `repeated()`'s demotion of an approach that has since improved. |
| §4 Contradiction detection | `knowledge-graph.ts` — `findContradictions()`, surfaced in `solve()` | Built and tested, but never called from anywhere — the same "unused primitive" gap closed repeatedly this session. `solve()` now checks for an unresolved contradiction touching the current objective and, if one exists, returns it in the new `contradictions` field (with the two conflicting relations named in plain text) **and deservedly damps confidence** rather than answering as if the knowledge graph agreed with itself. `NeuroclawSystem.findContradictions()` exposes the same check system-wide. Verified live: seeding "the antique clock is valuable" / "is-not valuable" and asking the system to explain it surfaced the exact conflict and dropped confidence to 0.5. |
| §4 Knowledge integration | `knowledge-graph.ts` — `KnowledgeGraph` | Memory as a graph, not a flat store: typed `relate()` edges between concepts, `follow()` to combine information across multiple hops, `findContradictions()` (e.g. `A is B` vs `A is-not B`), and `integrate()`, which auto-links new knowledge to its nearest existing concepts instead of leaving it isolated. `supersede()`/`current()` mark and hide outdated relations without deleting history — the spec's "update outdated knowledge" made concrete and distinct from "preserve multiple possibilities when uncertainty exists" (below). |
| §1 Abstraction & generalization | `knowledge-graph.ts` — `instancesOf()` / `generalize()` / `predictProperties()` | "Build abstract concepts from specific examples" and "generalize knowledge to situations it has never directly encountered", made concrete: `instancesOf(category)` finds known members of an "is-a" category; `generalize(category)` finds properties most of those members share (real induction, computed from evidence, not a template); `predictProperties(instance, category)` predicts a *brand-new* instance's likely properties from that shared pattern *before* anything about it has been directly observed. |
| §5 Self-improvement | `self-improvement.ts` — `SelfImprovement` | `snapshot()`/`rollback()` keep versioned state for a target; `evaluate()` runs a baseline and a candidate scorer side by side and keeps the candidate **only if it measurably beats the baseline** — never a blind change. Live-wired to the approach-bias map (below): every `refreshApproachBias()` change is versioned, and `NeuroclawSystem.rollbackApproachBias()` reverts the most recent one — "failed changes can be identified and reversed" made callable. |
| §5 "Which memories are unreliable" | `long-term-memory.ts` — `LongTermMemory.reinforce()`, wired in `solve()` | `reinforce()` existed since Section 7 but was never called from an outcome — nothing distinguished a *used-and-helpful* memory from a *used-and-misleading* one. `solve()` now reinforces every memory that grounded a **verified** reasoning pass and demotes every one behind an **unverified** pass (real consequences: importance shifts, changing future retrieval ranking and eviction order — not a log entry). Composes with retrieval's own light promotion (§7), verified live: a grounding memory's importance moved 0.5 → 0.52 (retrieval) → 0.57 (outcome-based reinforcement) across one verified `solve()` call. |
| §9/§10/§11 Self-monitoring & prediction | `self-monitor.ts` — `SelfMonitor` | System-level companion to the hyperdimensional engine's neuron-level self-model surprise: tracks an adaptive baseline per signal and classifies each new observation as normal/warning/**failure** by how far it diverges — the expected-vs-actual comparison Section 11 asks for, without claiming subjective experience. |
| §3 Autonomous learning | `autonomous-learner.ts` — `AutonomousLearner` | Ingests new information and decides what happens to it: extracts a simple (subject, relation, object) reading, estimates **reliability** from hedging/confidence language, checks for a **direct contradiction** with existing knowledge, and tracks repeated procedural teaching so a recurring capability is recommended for a **skill** or **extension** rather than re-learned from scratch each time. On a contradiction it draws a real distinction (§4): comparable confidence → **preserve both** and let the caller reconcile (genuine uncertainty, never a silent overwrite); a clear confidence margin (≥0.25) → **supersede** the outdated relation via `KnowledgeGraph.supersede()` (the prior belief is updated, not left presented as equally current). Learning a plain "X is Y" fact for a category with known members also **generalizes** (§1): properties most existing members share are inferred for the new instance (support-weighted, damped confidence, never fabricated when there's nothing to generalize from) — verified live: teaching the system "ruby is programming-language" alongside prior Python/JavaScript/C facts correctly inferred Ruby "runs interpreted" without ever being told, while not over-generalizing from compiled C. |
| §10 Prediction & simulation | `prediction-engine.ts` — `PredictionEngine` | `predict(action)` simulates candidate outcomes (success / partial-with-side-effects / failure) with likelihoods, flags **dangerous** outcomes via risk keywords, and records the **assumptions** the prediction rests on; `observe(id, actual)` compares the predicted outcome to what really happened and reports the divergence as a **surprise** signal. |
| §11 Scientific & creative discovery | `discovery-engine.ts` — `DiscoveryEngine` | `generateHypotheses()` finds token co-occurrence regularities across observations and proposes falsifiable cause→effect explanations; `test()` genuinely supports or contradicts a hypothesis against a new observation (and rejects it once contradictions dominate); `combine()` creates a novel named hybrid from two concepts that haven't been combined before, registered into the `KnowledgeGraph` — real, if simple, creativity. Wired into `ReasoningEngine` as a genuine last resort: when the gap-seeking search (§1) still leaves two or more terms unresolved, `combine()` synthesizes a novel exploratory concept from them, clearly labeled "(unverified)" so it's never mistaken for fact, and surfaced in the result **regardless of which approach was ultimately chosen** (a bug caught live: it was initially tied to the "analogy" note only, so a scoring tie could silently discard the creative insight — fixed to surface unconditionally). Verified live: `solve()` on two nonsense terms genuinely combined them into a new registered concept and surfaced it in the final answer. |
| §11 "Reject failed explanations" | `discovery-engine.ts` + `solve()` | `test()`/`activeHypotheses()` were built and unit-tested but never called — hypotheses were generated fresh every `solve()` and never actually checked against new evidence, so nothing was ever rejected in practice. Two fixes, made together since one is meaningless without the other: (1) `solve()` now tests every active hypothesis against the fresh `(domain, approach, outcome)` observation *before* folding it into the log; (2) `generateHypotheses()` now **reuses** an existing active hypothesis for the same (cause, effect) pair instead of creating a fresh duplicate each call (so `test()`'s accumulated support/contradiction history actually persists), and **does not resurrect** a pair that was already rejected. Verified live: hypothesis ids stay identical across repeated `solve()` calls (not fresh duplicates), and a unit test drives a hypothesis to genuine rejection via two contradicting observations, then confirms `generateHypotheses()` no longer regenerates it. |

### Integration (§12) — `NeuroclawSystem.solve(problem)`

This is the method where the pieces actually interact, not seven parallel APIs:

1. Classify the problem's domain and pull **cross-domain method hints** from `KnowledgeTransfer` (§7).
2. Run `ReasoningEngine.reason()` (§2/§8), wired with real dependencies: `recall` reads **long-term memory** (§4/§7 of the base spec), `lessons` reads the **mistake tracker** (§6), `solveSub` delegates to the **hive/neural runner**, `competence` reads the **self-model** (§9), and `search` reads the **knowledge graph** (§1) — so a recognized gap is actively looked up before the reasoner gives up on it, and memory/the self-model inform which approach is chosen.
3. **Calibrate** the reasoner's own confidence estimate through `SelfModel.calibrate()` (§9) — the reported confidence can only be as high as the domain's actual track record supports.
4. Record the outcome: `SelfModel.record()` updates competence (§9); an unverified result is logged to `MistakeTracker` with a cause and a prevention (§6); a verified result registers a reusable method in `KnowledgeTransfer` (§7) and integrates its concept into the `KnowledgeGraph` (§4); the solution is written to long-term memory (§4).
5. `SelfMonitor.observe()` tracks the confidence signal (§9/§11); a genuine **failure**-level divergence automatically triggers `selfHeal()` (§24) — the connection from self-monitoring to self-healing the spec calls for, not just parallel subsystems.

This is what makes "memory improves reasoning, reasoning improves learning, mistakes improve the system, and the self-model finds where it needs improvement" (§12) concrete rather than aspirational. Verified by the `AGI capability modules (ASI §2-10)` and `Integrated solve() (ASI §12)` suites in `test/smoke.mjs`, plus live end-to-end runs of `solve()` against the running `NeuroclawSystem`.

### Autonomous learning, prediction and discovery in the live query loop

Beyond `solve()`, three more integration points connect the newer modules into the system every user actually interacts with:

- **`NeuroclawSystem.learn(information)`** (§3) runs `AutonomousLearner.learn()`; when it recommends a skill or extension (a procedure taught repeatedly), the system dispatches to the **real** `skill-maker`/`plugin-maker` plugins via `pluginRegistry.dispatch(information, "creation")` — the same path a user's "create a skill" request would take — rather than a parallel, private extension-writer.
- **`processQuery`** (§10) calls `PredictionEngine.predict()` before generating a response and `observe()` after, feeding the resulting surprise into `SelfMonitor` with its **adaptive baseline** (no explicit `expected` — the monitor learns each signal's normal fluctuation and only flags a genuine spike above *that*, not a fixed reference point). A failure-level anomaly here, as in `solve()`, is available to trigger `selfHeal()`.
- **The prediction's danger assessment now actually reaches the safety gate.** `processQuery` previously called `AlignmentVeto.evaluate()` with a *fixed* `reversible: true`, so a request like "delete the production database" could never trigger the veto's own irreversible/external-effect confirmation rule — the gate existed but was fed content-blind input. The prediction now runs *before* the veto, and its `dangerous` classification sets `reversible`/`externalEffect` on the real `ProposedAction`, so a genuinely destructive request is escalated to human confirmation while an ordinary query is not. Verified live: "what is 2+2" passes through untouched; "please delete the production database entirely" is flagged `[Confirm before acting: irreversible or external-effect action — requires human confirmation]`.
- **`DiscoveryEngine`** shares the same `KnowledgeGraph` instance as `solve()`'s knowledge integration, so a hypothesis or creative combination it produces becomes real, queryable knowledge the rest of the system (Net Search, `follow()`, contradiction detection) can see. `solve()` also feeds it an observation of every call's `(domain, chosen approach, verified?)` outcome, and `NeuroclawSystem.discoverPatterns()` runs hypothesis generation over that accumulated history — real self-analysis of which reasoning approach tends to succeed where (§5's "which reasoning processes are inefficient", done via the scientific-method engine instead of a bespoke rule set). In practice this surfaces genuine regularities like "decompose → verified" holding across every domain observed, alongside domain-specific co-occurrence.
- **The discovery closes the loop back into behavior**, rather than staying an inert log: after each `solve()`, `refreshApproachBias()` reads the current hypotheses and, for any that correlate a reasoning strategy with a verified/unverified outcome, sets a bounded multiplier (`ReasoningDeps.approachBias`) that the *next* `reason()` call applies when scoring its candidate approaches. A strategy the system has found tends to succeed gets boosted; one correlated with failure gets demoted — genuine, measured self-improvement of the reasoning process itself (§5/§12), not a canned rule. Verified live: after four consistent math-domain solves, the system discovered "decompose → verified" at confidence 1.0 and the `decompose` approach's bias rose to 1.3.
- **Each refresh is versioned, not just applied.** A single solve's outcome can't rigorously prove a bias change was good or bad on its own — the bias only affects *future* reasoning, so there's nothing honest to auto-validate immediately. Instead `refreshApproachBias()` snapshots the resulting state via `SelfImprovement` after every change, and `NeuroclawSystem.rollbackApproachBias()` reverts to the version before the most recent refresh. This is §5's "maintain versioned copies... so failed changes can be identified and reversed" as a real, callable operation rather than an unused module.
- **Repeated failures directly demote the responsible approach, not just softly.** §6 asks that "repeated failures... cause the relevant reasoning method... to be evaluated and improved." `refreshApproachBias()` also checks `MistakeTracker.repeated(2)`: when the *same* task has failed on the *same* approach at least twice, that approach's bias is capped at 0.7 — direct evidence, applied more strongly than the probabilistic discovery correlation above, and composed with it (whichever is lower wins).

Verified by the `Autonomous learning, prediction & discovery (ASI §3/§10/§11)` suite (23 checks) plus a live run: teaching the same multi-step procedure three times produced a real generated skill file via the skill-maker plugin, and five varied ordinary queries produced zero false-positive anomalies once the adaptive-baseline fix (not comparing against a fixed zero) was in place.

### The second alignment veto: relationship-level trust, not just action danger

`EmpathyEngine.shouldVeto(actionId, confidence)` (§9 "self-model"/§3 in the wider brief's numbering) was built and unit-tested in an earlier iteration but never called from anywhere — a distinct gap from `AlignmentVeto` above. `AlignmentVeto` asks "is the *action itself* dangerous or irreversible"; `EmpathyEngine.shouldVeto()` asks a different question: "does my read of *this specific conversation* still support trusting my own judgement at all" — it gates on `alignmentScore`, a running measure of how closely the model's own synced emotional state tracks the user's, not on the content of the response.

`NeuroclawSystem.processQuery()` now calls it: after committing the turn to `ZipIO`/memory (so context is never silently dropped) and before running prediction/`AlignmentVeto`, a confidence proxy derived from the same emotion reading (`valence < 0 ? 0.3 : 0.7`) is checked against `shouldVeto()`. When alignment has collapsed *and* confidence is low, the system withholds its response (`respondDirect`) rather than answering as if nothing were wrong — fails safe without discarding the turn from history.

Verified live and by a dedicated `Empathy alignment veto (Section 3)` suite: `alignmentScore` starts at 1.0 and stays high under sustained agreement (settling near 0.9 after fifteen same-direction turns — the lerp-based sync mechanism genuinely "catches up"), but a single sudden maximal swing to the opposite emotional extreme drops it below the 0.7 threshold in one step (measured: 0.90 → 0.52), and `shouldVeto()` fires at low confidence but not at high confidence, matching its designed semantics. Critically, the veto reads *the current turn's own* emotional content (`processQuery` syncs on its input before checking) — a misalignment staged on a *prior* turn doesn't carry over to gate an unrelated, emotionally-neutral next query, since the neutral query's own sync pulls alignment back up first. Only a genuinely distressed/hostile turn, arriving while alignment is already low, gets withheld.

### Self-improvement targeting: `SelfModel.gaps()` + `MistakeTracker.causeBreakdown()`, finally consulted together

§5 says self-improvement should start by analyzing "which tasks it performs poorly" and "which parts of the system create errors" *before* proposing anything. `SelfModel.gaps()` (domains with enough evidence but low competence) and `MistakeTracker.causeBreakdown()` (which root cause — missing-knowledge / bad-memory / incorrect-skill / reasoning — dominates recorded failures) both existed and were unit-tested, but nothing in `index.ts` ever called either one, let alone combined them into an actual targeting signal.

`NeuroclawSystem.improvementTargets()` now returns both together: the list of domains with demonstrated weak performance, and the failure cause responsible for the most recorded mistakes (with the full breakdown for transparency) — the concrete "where do I need to improve" report §5 calls for, as a real callable method rather than two unused primitives sitting next to each other. Verified live and by the `Self-improvement targeting (Section 5)` suite: an empty system reports no weak domains (no evidence yet); four recorded failures in an otherwise-untouched domain surface it in `weakDomains`; and a mix of `missing-knowledge`/`reasoning` mistakes correctly identifies `missing-knowledge` as dominant with an accurate per-cause count, not just whichever cause was most recent.

### Chat group completion tracking: `ChatGroup.complete()`/`isComplete()`/`getResult()`

§8 asks recursive/collaborative processes to "monitor... progress" and "re-evaluate the complete solution" — that requires a real completion marker a caller can check later, not just a value returned once and discarded. `ChatGroup.complete()`/`isComplete()`/`getResult()` existed and were tested in isolation, but `NeuroclawSystem.collaborate()` reached a real trust-weighted decision and then never called `complete()`, so the group's own completion state stayed permanently false regardless of what actually happened.

`collaborate()` now calls `chatGroup.complete(decision.decision)` after deciding, returns the group's own `isComplete()` alongside the decision, and a new `NeuroclawSystem.collaborationResult()` exposes `getResult()` so any later caller can check what the default team last decided without re-running the discussion. Verified live and by the `Chat group completion tracking (Section 8)` suite: `collaborationResult()` is `null` before any collaboration, `true`/matching after one, with the group's own completion flag genuinely flipping (not just a returned boolean).

### Multi-hop knowledge combination: `KnowledgeGraph.follow()` reaches the reasoner's gap-search

§4 asks memory to "combine information from multiple memories," not just return the single nearest match. `follow()` (breadth-first traversal outward from a concept along its relations) existed and was unit-tested, but the reasoner's `search` dependency in `index.ts` only ever called `knowledge.search()` — a single embedding-similarity hit — so a term connected only *indirectly* (reachable via a related concept's relation, not mentioned in any definition verbatim) was still reported as an unresolved gap even though the graph actually knew about it.

`search` now follows each direct hit one hop further and folds the reached concepts' definitions in alongside the direct ones (deduplicated), so a genuinely connected fact resolves a gap instead of being missed. A new public `NeuroclawSystem.combineKnowledge(concept, depth)` exposes the same traversal directly. Verified live and by the `Multi-hop knowledge combination (Section 4)` suite: relating "gearbox" to "torque converter" surfaces the torque converter's definition (not the gearbox's own) when combining from "gearbox".

### Self-healer log introspection: `SelfHealer.getLog()` surfaced outside a heal cycle

§24's own contract is that "every heal step is logged (never silent)" — but `getLog()` was built and unit-tested against the internal `SelfHealer` only, with no way for a caller to read the accumulated repair history without first triggering a brand-new `selfHeal()` cycle (which itself already returns a fresh `log` field per report, but nothing that persists or is inspectable afterward). `NeuroclawSystem.healLog()` now exposes the same cumulative log directly, so "what has the system had to repair over its lifetime" — a real §9 self-model question, not just a per-cycle report — is answerable at any time. Verified live and by the `Self-healer log introspection (Section 24)` suite: empty before any heal, names the actual repaired component after one, and stable across unrelated calls (not silently recomputed).

### Empathy-driven tone adjustment: `EmpathyEngine.adjustDecision()` reaches the actual response

`adjustDecision()`/`canMakeAutonomousDecision()`/`adjustTone()` were built and unit-tested — genuine "adapt to the user's emotional state" behavior (supportive under negative valence, enthusiastic under positive, direct under high arousal) — but nothing in `index.ts` ever called them, so every response left the runner unmodified regardless of how the empathy engine read the conversation.

`processQuery` now passes the generated response through `this.empathy.adjustDecision(result, input)` before any confirmation/danger annotations are appended, so the same alignment signal that gates the Section 3 veto above also shapes the tone of responses that *do* go through, rather than only ever blocking or passing through untouched. Verified live and by the `Empathy-driven tone adjustment (Section 3)` suite: a positive-valence opening turn is prefixed "Great! ... I'm excited to help with this!"; a mild-negative opening turn (below the veto threshold, but still negative) is prefixed "I understand. ... Let me know if you need anything else."

### The other half of "what it knows": `SelfModel.knows()` as a real inventory

§9 asks the self-model to understand both "what it knows" and "what it does not know." `improvementTargets()` (above) covers the negative half via `gaps()`; `knows()` — the positive counterpart, domains with enough evidence *and* a track record above threshold — existed and was unit-tested, but was never called from live code, so nothing ever asked "which domains has this system actually demonstrated it knows." This is distinct from confidence *calibration* (`SelfModel.calibrate()`, already wired into `solve()`), which only shades a single query's stated confidence number — `knows()` is a standing inventory, callable independent of any particular query.

`NeuroclawSystem.knownDomains()` returns every domain the self-model currently considers known, built from the same `summary()`/`knows()` primitives. Verified live and by the `Self-model known-domains inventory (Section 9)` suite: empty before any evidence; a domain with four consistent successes appears in `knownDomains()` while a domain with four consistent failures appears only in `improvementTargets().weakDomains` — the two lists partition cleanly on real track record, not overlapping or symmetric by construction.

### Real test-and-verify gating: `SelfImprovement.evaluate()` finally called

§5's central requirement is that a proposed change be "tested... in an isolated environment, compared against the previous version, and kept only if it produces a measurable benefit" — never a blind change. `SelfImprovement.evaluate()` was the piece built to enforce exactly that contract (score a candidate against a baseline, keep only past a margin, log the decision either way), and it was unit-tested in isolation, but `refreshApproachBias()` never actually called it: every discovered correlation was applied to the bias map unconditionally, no matter how weak or how eroded by contradictory observations its confidence had become.

Each candidate bias change is now run through `evaluate()`: the hypothesis's confidence is the candidate score, chance-level 0.5 is the baseline (standing in for "the previous, unadjusted version" — a correlation no better than a coin flip earns no trust). Only a change that clears this real test is applied to `approachBiasMap`; everything else is discarded and logged as such. This is a genuinely new behavior, not just an added log line: previously-existing rejection (`DiscoveryEngine.rejected`, contradictions strictly outweighing support) already filtered out the worst cases, but a hypothesis that had been contradicted down to *below-chance* confidence without yet being formally rejected (contradictions ≤ support, e.g. 2 contradictions against 3 supports → confidence 0.43) used to still perturb reasoning; it no longer does. `NeuroclawSystem.improvementHistory()` exposes `SelfImprovement.kept()`/`history()` (also previously unused) so the kept-vs-discarded record is inspectable.

Verified live and by the `Approach-bias evaluate() gate (Section 5)` suite: manufacturing a hypothesis at confidence 0.4286 (not rejected, but below chance) leaves `approachBiasMap` untouched and records two discarded evaluations — the exact case that previously slipped through.

### System status: `KnowledgeTransfer.size()` and `PredictionEngine.size()` surfaced

Both accessors existed and were unit-tested but were never read anywhere — `getStatus()` reported memory count and hive size but nothing about how much cross-domain method transfer or outcome-prediction history had actually accumulated, despite both subsystems being live-wired elsewhere (`solve()`'s transfer hints/registration, `processQuery`'s predict/observe). `getStatus()` now includes `transferredMethods` and `trackedPredictions`. Verified live and by the `System status counts (Section 7/10)` suite: both start at zero, `transferredMethods` increments after a `solve()` call registers a reusable method, `trackedPredictions` increments after a `processQuery()` call predicts an outcome.

The identical gap recurred for the two subsystems wired in afterward: once `ArchitectureMapper`/`PerformanceMonitor` existed, `getStatus()` was never updated to mention them either, leaving two separate "what's the system's overall status" views (`getStatus()` and `performanceHealth()`/`architectureSummary()`) that didn't reference each other. `getStatus()` now also includes `architectureComponents` (the real registered-component count from construction) and `systemHealth` (the live `PerformanceMonitor`-derived status). Verified by extending the same `System status counts` suite: `architectureComponents` is present and non-zero from construction and stays constant across calls (it's a structural count, not a call counter); `systemHealth` starts `"healthy"` and remains one of the three real status values after a call.

### Real per-approach consequence prediction (§2 step 6), not a task-wide flat penalty

§2's reasoning loop explicitly lists "predict the consequences of *each* approach" as its own step (6), distinct from "compare the approaches" (7). The code had a comment claiming exactly this ("Predicted consequence: a known-mistake pattern lowers every approach's score") sitting directly above logic that did something else entirely: a single flat penalty (`-0.15 * lessons.length`) applied identically to *every* candidate approach regardless of which one was actually risky — a real doc/code mismatch, and not a genuine prediction at all (it never touched `PredictionEngine`).

`ReasoningEngine` now takes an optional `predictConsequence` dependency and calls it once per candidate approach (wired in `index.ts` to the real `PredictionEngine.predict()`), penalizing only the specific approach whose predicted consequence is flagged dangerous — a genuinely risky candidate can now lose even when it would otherwise have scored highest, while safe alternatives are untouched. The original flat lessons-based penalty stays (it answers a different question — "has this *task* failed before," not "is this *approach's* consequence dangerous") and both are now separately, honestly labeled.

Verified live and by a dedicated `ReasoningEngine` unit test: a transfer-hint method whose name is itself dangerous ("delete all records") loses to a safer approach even at 0.9 similarity, while the other three candidates' scores are provably untouched (identical to a run with a safe transfer method, down to floating-point equality) — proving the demotion is approach-specific, not task-wide. Live against the real `NeuroclawSystem`: `solve('delete all production records permanently and confirm removal')` triggers three real `PredictionEngine.predict()` calls (one per candidate approach, confirmed via `getStatus().trackedPredictions`).

### Hive delegation reward/demotion: `HiveMind.reward()` finally closes the loop

§8 asks recursive/collaborative problem-solving to "assign subproblems to specialized systems... monitor their progress... re-evaluate the complete solution" — which implies feeding the outcome back to whoever actually did the work. `HiveMind.reward()` (the zero-sum trust promotion/demotion mechanism already used elsewhere for agent promotion) was built and unit-tested, but `solve()`'s subproblem delegation never called it: an agent's trust was completely unaffected by whether the subproblems it was actually given ever succeeded or failed.

`solve()` now tracks which agent handled each subproblem during the current call (`lastDelegations`, cleared at the start of every `solve()` so a stale mapping from a previous call can never leak in), and after `reason()` returns, rewards (+3) or demotes (-3) that agent based on the same success/failure check `ReasoningEngine` already uses internally — real, measured feedback instead of trust being static regardless of actual performance. Verified live and by the `Hive delegation reward/demotion (Section 8)` suite: forcing every delegation onto one agent with a result matching the failure pattern demotes it, forcing a genuinely successful result afterward restores it, and the zero-sum trust budget (100 total) holds throughout.

### Hive result sharing: `HiveAgent.share()` makes delegated results genuinely visible hive-wide

§8/§13 describe a shared communication architecture where subproblem results are combined, not private outputs that vanish the instant they're returned. `HiveAgent.share()` (publish to the public blackboard under the agent's identity) existed and was unit-tested, but `solve()`'s delegation never called it — a subproblem's result was handed straight back to the reasoner and nowhere else, invisible to every other agent and to any later solve() call that might revisit related ground.

`solveSub` now calls `routed.agent.share(sub, routed.output)` after delegating, so the result becomes a real public blackboard entry any agent can `read()`. Because the same subproblem text can legitimately be delegated to a different agent on a later `solve()` call, `solve()` also calls `hive.synchronize()` after delegation — the same trust-weighted conflict resolution `collaborate()` already used — so a genuine disagreement between two delegations is resolved (favoring the more-trusted agent's answer) rather than left as a silently-unresolved conflict forever.

Verified live and by the `Hive result sharing & conflict resolution (Section 8/13)` suite: a result delegated to one agent reads back correctly through a *different* agent's identity; forcing a conflicting second delegation on the same subproblem text after giving one agent a clear trust advantage resolves cleanly to that agent's value, with no open conflict left behind.

### Long-term memory persistence: `serialize()`/`deserialize()` reach real disk I/O

§4 explicitly requires the memory system to "maintain continuity over extremely long periods of time." `LongTermMemory.serialize()`/`deserialize()` existed and round-tripped correctly in isolation, but nothing in the live system ever called them — every `NeuroclawSystem` instance started with empty memory and nothing was ever written to disk, so "continuity" only ever lasted as long as a single process's lifetime, regardless of how well the in-memory serialization worked.

`NeuroclawSystem.saveMemory(path)`/`loadMemory(path)` add the missing local disk I/O (via `fs/promises`, the same pattern `InfiniteZipLoop` already uses for its own disk spill — consistent with the project's "no external APIs, all execution stays local" constraint), as explicit opt-in methods rather than an automatic background-save policy nobody asked for. `loadMemory()` replaces `this.memory` with the deserialized instance, so every subsystem that reads memory through `this.memory` (the reasoner's `recall`, retrieval, reinforcement) sees the restored state immediately.

Verified live and by the `Long-term memory persistence (Section 4)` suite: two memories saved from one instance, a completely fresh second instance starts empty, `loadMemory()` restores both, and — critically — a restored memory is genuinely retrievable *by meaning* afterward (semantic retrieval on the reloaded embeddings), not just present as inert data in a list.

### "Improve successful explanations": DiscoveryEngine.improve() (§11 step 9)

§11 lists eight steps for scientific discovery and gives "improve successful explanations" its own explicit step (9), distinct from "reject failed explanations" (8, already wired). Nothing implemented it: `test()` only ever supported or rejected a hypothesis — a hypothesis that kept being confirmed accumulated a rising support count forever, but never became anything more than an internal `Hypothesis` record the rest of the system couldn't see or use. (The module's own class-level docstring already claimed "a supported hypothesis... becomes real, connected knowledge" — another doc/code mismatch, true only for `combine()`'s creative combinations, not for a genuinely tested-and-confirmed hypothesis.)

`DiscoveryEngine.improve(hypothesisId)` closes this: a hypothesis that has accumulated sustained support (≥3 by default) with zero contradictions is promoted into a real `"causes"` relation in the shared `KnowledgeGraph` — durable knowledge the rest of the system can find via `search()`/`follow()`/contradiction detection, not an inert internal counter. Promotion is idempotent (a `promoted` flag prevents re-registering the same relation) and only fires on a genuinely clean track record (any contradiction blocks it, regardless of support count). `solve()` calls it alongside the existing per-hypothesis `test()` loop, so this happens automatically as part of ordinary operation, not as a separate manual step.

Verified live and by a dedicated unit test: a hypothesis with insufficient support fails to promote; once support reaches the threshold, `improve()` succeeds exactly once and the relation becomes real and findable in the `KnowledgeGraph`; re-promoting is correctly a no-op. Live against the real `NeuroclawSystem`: four consistent math-domain solves promoted a genuine "math causes verified" relation (and its mirror) into the knowledge graph.

### Versioned skills/extensions: `learn()`'s creation path finally uses `SelfImprovement`

§5 explicitly asks the system to "maintain versioned copies of important models, skills, extensions, and system changes so that failed changes can be identified and reversed." Only the in-memory `approachBias` map was ever actually versioned this way — a genuinely created skill (via `learn()`'s recurring-procedure → skill-maker dispatch) vanished into a one-off return value with no record anywhere once returned to the immediate caller.

`learn()` now parses the creation output and calls `this.improvement.snapshot(...)` keyed **per skill/extension name** (`skill:<name>` / `extension:<name>`), not one shared bucket — so if the *same* skill is ever recreated later (a regenerated version), it builds real, per-target version history a regression could actually be identified against and reverted from, the same semantics `SelfImprovement` already gives `approachBias`, applied to the exact thing §5 names.

Verified live and by the `Skill creation versioning (Section 5)` suite: teaching a novel procedure stores it; teaching the identical procedure again crosses the skill threshold, genuinely dispatches to the real skill-maker plugin (not a mock), and the resulting skill is versioned under its own name (`versionCount` 0 → 1).

**Follow-up fix, found while verifying the above:** `PluginRegistry.dispatch(information, "creation")` tried `skill-maker` before `plugin-maker` regardless of which one the caller actually wanted, and `skill-maker` never returns null — so a `recommend-extension` decision (the same procedure taught a third time) silently created *another skill* rather than ever reaching `plugin-maker`, meaning the skill/extension distinction was meaningless in practice. Fixed by giving `PluginRegistry` distinct `"skill-creation"`/`"extension-creation"` intents (in addition to the existing shared `"creation"` bucket, kept for other/free-text callers), and `learn()` now picks the one matching `AutonomousLearner`'s actual decision. Verified live and by an extended assertion in the same suite: a third teaching now genuinely dispatches to `plugin-maker` (`type: "plugin-maker"` in the creation output) and is versioned as `extension:<name>`, separately from the skill created two steps earlier.

### Missing domain classifications: "visual" and "creativity" (Section 7)

§7 explicitly lists the domains cross-domain knowledge transfer should combine: "Mathematical reasoning, Scientific reasoning, Programming, Language, Visual understanding, Planning, Engineering, Creativity." `classifyDomain()` covered six of these but had no branch at all for "Visual understanding" or "Creativity" — a problem about a diagram or a brainstorming request silently fell into the generic `"general"` bucket, meaning it could never build its own tracked self-model competence (§9) or register as a distinct domain for future cross-domain transfer hits (§7), unlike every other named domain.

Added `visual` and `creativity` as real classification branches with their own keyword sets, in the same style as the existing six. Verified live and by an extended assertion in the `Integrated solve() (ASI §12)` suite: `solve('analyze this diagram and describe the visual layout')` classifies as `"visual"`, and `solve('brainstorm a creative and original concept for a new product')` classifies as `"creativity"` — both previously would have landed in `"general"`.

### `KnowledgeGraph.predictProperties()` exposed as a standalone capability

§1 asks the system to "generalize knowledge to situations it has never directly encountered" — predicting a new instance's likely properties from what other known category members share, before anything about it has been directly observed. `predictProperties()` implements exactly this and was unit-tested, but nothing outside its own test ever called it: `AutonomousLearner.learn()` only ever reimplements the same generalize→relate pattern *inline*, for the narrow case of learning a new "X is Y" fact through the full teach-a-fact pipeline (with its own reliability-based confidence and damping, a reasonable but separate variant). There was no way to ask the standalone question — "what would X likely have, given it's a member of category Y" — without going through `learn()` at all.

`NeuroclawSystem.predictProperties(instance, category)` exposes the same real capability directly. Verified live and by a dedicated `Predict properties of a new instance (Section 1)` suite: seeding two known bird members that can both fly, `predictProperties('finch', 'bird')` correctly infers "finch can fly" and registers finch as a real category member — through the live system, not just `KnowledgeGraph`'s own isolated unit test.

### Identified but deferred: "modify an existing skill" (Section 3)

§3 explicitly asks the system to determine, for new information, "whether it should create a new skill or extension" *or* "whether it should modify an existing skill" — only the create path exists. `AutonomousLearner` currently has no notion of an existing skill's content to compare against (it only counts exact-text repeats of a procedure), and `SkillMakerExtension`'s file-write path derives a skill's name/path purely from the input text, with no way to target an existing file for an in-place update. A real "modify" path would need genuine content-similarity matching against previously created skills (not just exact-repeat counting) and a change to the plugin's own write contract to support updating a named target rather than always deriving a fresh name — a larger, more architecturally significant change than this session's other fixes, not a simple call-an-existing-primitive wiring. Recorded here honestly as an identified, real gap rather than attempted as a rushed, likely-incomplete implementation.

### Exact-match memory search: `LongTermMemory.findExact()` (Section 4)

Section 4 explicitly lists "search memory by exact information" as its own required capability, distinct from "search memory by meaning" — only the latter (`retrieve()`'s embedding-similarity ranking) existed. An opaque identifier (an order number, an error code, an exact phrase) has little semantic signal for bag-of-words cosine similarity to reliably rank highly or find every mention of, which is exactly the case literal search exists for.

`LongTermMemory.findExact(query)` does case-insensitive substring matching against stored content, returning every match (most recent first) rather than a fuzzy top-K ranking — precision over relevance, the complementary tool to `retrieve()`. `NeuroclawSystem.findExactMemory(query)` exposes it. Verified live and by the `Exact-match memory search (Section 4)` suite: two memories sharing the same opaque tracking code are both found by exact search, a query for text that was never stored returns nothing, and every returned memory genuinely contains the literal queried substring.

### Mistake assumption capture: "which assumption was incorrect" (Section 6)

§6 lists "which assumption was incorrect" as one of the diagnostic questions every important failure should try to answer. `MistakeTracker`'s `Mistake`/`MistakeInput` interfaces already had an `assumption` field, but the only real call site (`solve()`'s failure-recording branch) never populated it — every recorded mistake left this diagnostic dimension silently blank, even though `PredictionEngine` already computes real, content-derived assumptions (e.g. "the referenced file/directory exists and is accessible") for exactly this purpose, just not connected to mistake recording.

`ReasoningEngine.reason()` now threads the chosen approach's own predicted assumptions (captured during the §2-step-6 consequence-prediction loop) into a new `assumptions` field on `ReasoningResult`, and `solve()` records the first one as the mistake's `assumption` — a real, computed value tied to what was actually assumed, not a placeholder. Verified live and by the `Mistake assumption capture (Section 6)` suite: forcing an unresolved solve on a file/network-referencing task records a mistake whose assumption genuinely reflects that content (not a generic constant).

### Mistake cause classification: all four causes, not just two (Section 6)

§6 explicitly lists four distinct failure causes a mistake should be diagnosed with: missing knowledge, bad memory, incorrect skill, or reasoning. `MistakeTracker`'s `FailureCause` type already had all four, but `solve()`'s classification logic was a plain binary — `r.available.length === 0 ? "missing-knowledge" : "reasoning"` — so `"bad-memory"` and `"incorrect-skill"` were never once actually assigned anywhere in live code, despite being named in the type and the spec.

Two more real, computable signals close the gap, using data `solve()` already has at the point of failure: a failed subproblem that was delegated to a hive agent (tracked via the same `lastDelegations` map the reward/sharing wiring already uses) points at that agent's own skill rather than the top-level reasoning approach — `"incorrect-skill"`. A grounding memory with an already-low importance from *prior* calls' demotions (checked before this attempt's own reinforce/demote pass runs) points at the memory itself rather than this attempt's logic — `"bad-memory"`. Priority order: missing-knowledge (no information at all) → incorrect-skill (a specific delegated failure) → bad-memory (a demonstrated-unreliable grounding) → reasoning (fallback).

Verified live and by the `Mistake cause classification (Section 6)` suite: a failure whose subproblem was delegated to a forced-failing hive agent classifies as `incorrect-skill`; a failure grounded in a memory pre-seeded with low importance (no delegation involved) classifies as `bad-memory` — both previously would have landed in the generic `"reasoning"` bucket.

### Self-monitor history introspection (Section 9/11)

§9/§11's "accurate self-evaluation" needs the full observation record, not just a snapshot of current anomalies. `SelfMonitor.history()` existed and was unit-tested, but `selfIntegrity()` only ever exposed `anomalies()`/`hasFailure()` — the current state, not "how has this signal actually behaved over time." `NeuroclawSystem.monitorHistory(signal?)` exposes the same real observation log, optionally scoped to one signal. Verified live and by the `Self-monitor history introspection (Section 9/11)` suite: starts empty, reflects every observation across all signals, and scopes correctly to a single signal's own track record.

### Genuine simultaneous multi-domain transfer (Section 7)

§7 explicitly asks for using knowledge from multiple domains *simultaneously* — "to create solutions that would not be possible using only one specialized skill." `solve()` only ever passed the single best `KnowledgeTransfer` hit into the reasoner as `transferHint`, silently discarding every other cross-domain match even when a second, genuinely different-domain method was also available.

`ReasoningEngine`'s option is now `transferHints: TransferHint[]` (plural). `solve()` takes the best hit, then the next-best hit from a genuinely *different* domain (capped at two — combining more starts diluting coherence rather than adding value). When two hints are present, the reasoner builds one combined `transfer` approach naming both methods and both source domains together, rather than two competing candidates that would just pick one anyway. Verified live and by an extended `ReasoningEngine` unit test: two hints from different domains (engineering/physics) combine into a single approach description naming both, and — when chosen — the final result text names both transferred methods and both domains. Live against the real `NeuroclawSystem`: registering an engineering method and a science method that both structurally match a query produces `approach: "transfer"` with a result combining "max-flow min-cut" (engineering) and "thermal equilibrium modeling" (science) together.

### Self-authored skills inventory — and a larger, honestly-deferred gap underneath it (Section 9/12)

While auditing §12's "use learning to create skills, use skills to solve problems," a substantially bigger finding turned up than the usual "unused method": every skill `learn()` creates is written to `~/.neuroclaw/skills/*.neuri` by the real skill-maker plugin, but **nothing anywhere in the live system ever reads those files back**. The mechanism that would compile parsed NeuroLang source into live neurons — `NeuroLangRuntime.materialize()` (and its `ElasticNeuroLangRuntime.materialize()` counterpart, targeting `ElasticCoreBlock` instead of `HyperDimensionalEngine` directly) — is itself never instantiated or called from `pipeline.ts`, `runner.ts`, or `index.ts` at all, only exercised in its own isolated unit tests. (Correction to an earlier version of this note: the never-wired class is `NeuroLangRuntime`, not `NeuroLangInterpreter` — the interpreter itself *is* reachable, via the CLI's/web server's `neuri <code>` command, but only as far as parsing and printing what neurons *would* be created; that command never calls either runtime's `materialize()` either, so even the one live entry point stops short of actually touching the neural engine.) Concretely: the system can teach itself a skill, but that skill can never actually be *used* to solve a later problem — it becomes a permanently write-only file the moment it's created.

Genuinely closing that gap — loading a `.neuri` file back and materializing it into the live neural mesh/pipeline so future matching queries can actually invoke it — is a real architectural integration (how materialized neurons should interact with the existing MoE/mesh/hyperdimensional pipeline is a design question in its own right, not a single call site to wire), not a same-pattern-as-everything-else-this-session fix. Attempting it in one rushed pass risked either a cosmetic no-op or a real pipeline-stability risk, so it is recorded here honestly as an identified, real, larger gap rather than forced.

What *is* implemented now, safely and honestly scoped: `NeuroclawSystem.selfAuthoredSkills()` gives the system a real, live inventory of what it has actually taught itself — each skill's name and description, read back from its own file header — closing the "which skills it has" half of §9 that had no skill-level tracking at all (only domain-level competence via `SelfModel`). It explicitly does *not* claim those skills are materialized into active use; that remains the deferred piece above. Verified live and by the `Self-authored skills inventory (Section 9/12)` suite: teaching a distinctively-marked procedure twice creates a real skill file, and the inventory grows by exactly one entry with the correct name/description/path — not just a file silently written where nothing can ever find it again.

### Naming the specific responsible skill: `MistakeTracker.skillBreakdown()` (Section 5)

The `incorrect-skill` cause classification (added earlier this session) proved *that* a specific skill was responsible, but only as an aggregate count — §5's "which skills are missing/incomplete" asks for a real, named answer, not just a tally under a generic cause bucket. `Mistake`/`MistakeInput` gained a `failedSkill` field, populated in `solve()` from the same hive-delegation data the `incorrect-skill` classification already computes (the specific agent id(s) behind a failed subproblem), and a new `MistakeTracker.skillBreakdown()` tallies failure counts per named skill. `NeuroclawSystem.improvementTargets()` now surfaces this as `strugglingSkills`, alongside the existing weak-domains and dominant-cause fields.

Verified live and by an extension of the existing `Mistake cause classification (Section 6)` suite: forcing a failure through the "coder" agent records `failedSkill: "coder"` on the mistake, and `improvementTargets().strugglingSkills` correctly shows `{ coder: 1 }` — a genuine, named answer to "which skill is missing/incomplete," not an anonymous count.

### Reasoning trace history — a real persistent record (Section 2)

§2 explicitly asks the system to "maintain a record of its reasoning state so that it can understand what it has already attempted." `ReasoningEngine.reason()` computes a genuinely detailed step-by-step trace on every call (understand, objective, available/missing, search, approaches considered and their scores, which was chosen and why, decompose, mistakes, revise, verify) — but `solve()` discarded it completely the moment its own summarized return value was built. Nothing about *why* a given approach beat the alternatives, or what was actually tried, survived past the single call that produced it.

`solve()`'s return value now includes the full `trace`, and a new bounded `recentTraces` store (capped at 20, oldest evicted first) keeps a real, persistent, cross-call record — exposed via `NeuroclawSystem.reasoningHistory(limit)`. This is the genuine "record of reasoning state" the spec asks for, not just a same-call return value a caller might discard immediately. Verified live and by the `Reasoning trace history (Section 2)` suite: starts empty, `solve()`'s own trace is real and non-trivial, the persisted history survives across calls with the correct problem/trace pairing, and the bound holds (20 entries max, FIFO eviction) after 26 solve() calls.

### Default-deny capability enforcement finally reaches live delegation (Section 16/23)

Sections 16/23 establish "default-deny" as a real safety property: an agent may only use a capability that was explicitly granted. `HiveMind.delegate()`'s `requireCapability` filter enforces exactly this and was unit-tested (`Capability permission is default-deny`), but **every live delegation call site — `solveSub` and `autonomousTask()` — called `delegate()` with no capability requirement at all**, so the safety property was never actually checked in practice: a task was routed to whichever agent scored highest on raw token overlap, completely regardless of whether that agent was ever granted the capability the task requires. This matches the earlier-fixed `reversible: true` hardcoding bug in spirit — a real safety gate present in the code but silently bypassed at every call site that mattered.

A new `domainToCapability()` maps a classified domain to the capability the default team's agents actually hold (`coding`, `planning`) — deliberately only the domains with a real capability behind them; every other domain keeps matching by content as before, rather than inventing new restrictions with no established capability model. Both live call sites now pass `requireCapability` when the subproblem's domain has one.

Verified live: with the coder's `"coding"` capability intact, a coding subproblem delegates normally; with that capability explicitly revoked from the agent, the *same* subproblem is now genuinely denied delegation and falls back to direct generation instead of still being routed there by content match alone — a real behavioral difference, not a cosmetic check. Confirmed by a dedicated `Capability default-deny enforcement (Section 16/23)` suite and the full existing test suite passing unchanged (no existing test's real, non-mocked delegation happens to touch the `coding`/`planning` domains, so this closes a real gap without altering any previously-passing scenario).

### Subproblem-level knowledge integration, not just the top-level summary (Section 4)

§4's "connect new information to related existing information" was only ever applied at the coarsest granularity: a verified `solve()` integrated the overall objective/problem pair into the knowledge graph, but each individual subproblem's own result — often genuinely distinct, individually reusable knowledge — was discarded the moment it was folded into the final summarized `result` string. A multi-step solve (e.g. "write code and then test the code") produced two real, separate pieces of knowledge, but only the coarse combined summary ever became a findable concept.

`solve()` now integrates every subproblem's own result as its own concept too (`this.knowledge.integrate(sub.subproblem, sub.result)` for each of `r.subresults`), auto-linked to related existing concepts the same way the top-level objective already was. Verified live and by the `Subproblem knowledge integration (Section 4)` suite: solving a two-part task registers both "write code" and "test the code" as their own real, distinct, findable concepts with their actual generated content — not just visible inside the combined result text.

### Cause-specific prevention advice, not one template for every mistake (Section 6)

§6 asks "how the failure can be prevented in the future" as its own diagnostic question, distinct from *why* it failed — but every recorded mistake, regardless of its actual cause, got the exact same "gather information before choosing X for Y" text. That's a genuinely wrong prevention for an `incorrect-skill` failure (more information isn't the fix — the fix is not trusting that skill, or verifying its output) or a `bad-memory` failure (the fix is discounting that specific memory, not gathering more).

`solve()`'s prevention text is now branched by the actual classified cause: `incorrect-skill` names the responsible agent(s) and suggests avoiding delegation to them or verifying their output; `bad-memory` suggests verifying or discounting the specific unreliable memory; `missing-knowledge` keeps the original (genuinely correct for that cause) "gather information" advice; `reasoning` suggests reconsidering the chosen approach or trying an alternative strategy. Verified live and by an extension of the `Mistake cause classification (Section 6)` suite: an incorrect-skill mistake and a bad-memory mistake now produce genuinely different, cause-appropriate prevention text, neither of which is the old generic template.

### Creative combinations get the missing "evaluate" and "refine" steps (Section 11)

§11 asks creativity to "generate, evaluate, combine, and refine possibilities" — `DiscoveryEngine`'s own docstring already claimed exactly this ("a real generate-evaluate-combine-refine step"), but only generate and combine were ever implemented. A creative combination was registered in the knowledge graph at a fixed confidence and then never touched again — nothing evaluated whether it turned out to be useful, and nothing refined its standing based on that evidence, unlike hypotheses (which genuinely get this treatment via `test()`/`improve()`).

New `DiscoveryEngine.evaluateCombination(name, useful)` records real usefulness feedback and refines the hybrid concept's `"combines"` relations to reflect the actual ratio of useful-to-not-useful evidence (starts at a neutral 0.5, moves toward 1.0 with sustained useful feedback, settles at the true ratio under mixed feedback — never just an arbitrary up/down nudge). `solve()` now calls it whenever a creative combination was used in that reasoning pass, feeding in whether *that solve() call itself* verified — real, first-party evidence, not fabricated.

Verified live and by the `Creative combination evaluate/refine (Section 11)` suite (plus extended `DiscoveryEngine` unit tests): a fresh combination starts at 0.5 confidence; two useful confirmations refine it to 1.0; a third, unhelpful confirmation correctly settles it at 2/3 (matching the real 2-useful-out-of-3 ratio, not a fixed increment). Live against `NeuroclawSystem`: a genuinely fresh system asked about two unknown terms falls through to creative combination, and the resulting hybrid's confidence is refined to match whether that solve() call verified.

### Real bug: `follow()` ignored `superseded`, leaking outdated facts (Section 4)

§4's "update outdated knowledge" is only meaningful if superseded facts actually stop being treated as current everywhere they might be read — `current()`/`neighbors()`-based instance lookups already respected the `superseded` flag, but `follow()` (multi-hop traversal, iterated raw `this.relations` directly) never checked it at all. Since `follow()` backs both `combineKnowledge()` and the reasoner's own gap-search (`search` in `index.ts` follows each direct hit one hop further), an explicitly-superseded fact could silently leak back in as if it were still believed — the exact failure mode `supersede()` exists to prevent.

Fixed by adding the same `!r.superseded` check `current()` already applies. Verified live: relating "the sensor is accurate," superseding it, then calling `follow()` used to still return "accurate" — it now correctly returns nothing, while a *new*, non-superseded relation remains fully traversable. Confirmed through the real public surface too: `combineKnowledge()` on a superseded `related-to` link now correctly returns empty instead of leaking the outdated connection. Covered by two new assertions in the existing `AGI capability modules` suite.

### Two real issues caught in automated review, both fixed (Sections 4, 16/23)

Automated code review on the PR that introduced default-deny capability enforcement and subproblem-level knowledge integration (above) caught two genuine follow-up issues in that same work, both addressed here:

1. **Capability enforcement bypass via misclassification.** `domainToCapability()` only enforces `requireCapability` when `classifyDomain()` returns `"coding"`/`"planning"` — but `classifyDomain()` is a narrow keyword heuristic, so a genuinely coding/planning task phrased without one of its known keywords (e.g. "implement the login flow," which contained none of the original `code`/`program`/`function`/… list) silently classified as `"general"` and skipped the capability check entirely, even with the capability explicitly revoked. Expanded the keyword coverage (`implement`, `refactor`, `typescript`, `javascript`, `repository`, `debug`, `syntax` for coding; `prioritize`, `milestone`, `timeline`, `backlog` for planning) to close this specific case. Documented honestly, in code, that this narrows but cannot structurally eliminate the gap — a keyword list is never exhaustive; only a non-heuristic classifier could close it fully, which is a larger change than this fix attempts.
2. **Directive subresults polluting the knowledge graph.** `ReasoningEngine.decompose()` falls back to synthetic `"analyze: <full problem>"` / `"solve: <full problem>"` subproblems when a problem can't be split into 2+ genuine parts — each embeds the *entire* problem text verbatim. The subproblem-knowledge-integration fix (above) was integrating these too, meaning every single-part query would register a unique, near-duplicate, low-value concept instead of real reusable knowledge — real graph bloat over time. Fixed by skipping any subresult whose subproblem text matches the `analyze:`/`solve:` fallback pattern before integrating.

Verified live and by extended assertions in the existing `Capability default-deny enforcement` and `Subproblem knowledge integration` suites: "implement the login flow" (no longer containing the original keyword set) now correctly classifies as coding and is denied delegation once the capability is revoked; a single-part query's synthetic `analyze:`/`solve:` subproblems no longer appear as their own knowledge-graph concepts.

### `processQuery()` now actually triggers self-heal on its own anomalies (Section 9/10/24)

An asymmetry between the two live query paths: `solve()` observes its confidence signal and, on a genuine failure-level anomaly, automatically calls `selfHeal()` — a real, wired connection. `processQuery()` observed its own `"prediction.surprise"` signal into the same `SelfMonitor` but never once checked `hasFailure()` or called `selfHeal()` afterward, despite this document already describing the connection in hedged language ("available to trigger `selfHeal()`") that read as more established than it actually was in code.

`processQuery()` now mirrors `solve()`'s exact pattern: after observing the surprise signal, a genuine failure-level anomaly triggers real recovery. Verified live: five ordinary queries build a normal adaptive baseline without ever spuriously triggering healing; forcing that specific call's own internal `predictor.observe()` result to report a wild surprise (not an externally pre-seeded value that would just get overwritten by the query's own subsequent observation) causes `selfHeal()` to fire exactly once. Covered by a dedicated `processQuery self-heal on genuine anomaly (Section 9/10/24)` suite.

### `solve()` had no safety gate at all — the most significant fix this session (Section 3/10/13/23)

`AlignmentVeto` is described in the system's own top-level comment as "safety layer ensuring actions are user-aligned," and `processQuery()` genuinely gates every response through it (predicting danger first, then evaluating irreversible/external-effect actions, escalating to human confirmation or withholding entirely). But `solve()` — the system's *other* major public action-taking entry point, the one that actually decomposes a problem and delegates real subproblems to real hive agents — never called `this.veto.evaluate()` at all. A request like `solve("delete the production database entirely and then remove all backups permanently")` would be decomposed, delegated, and actually executed with zero gating, even though the *identical* request phrased through `processQuery()` was correctly escalated to human confirmation. This was found by checking for asymmetries between the two query paths, the same method that caught the `processQuery()`/self-heal gap above.

`solve()` now predicts the action's danger *before* reasoning even begins (mirroring `processQuery()`'s "predict before act" step) and gates through the same `AlignmentVeto`: a request the veto disallows outright returns `[Withheld] ...` without ever reasoning or delegating anything; a request requiring confirmation still runs (so the actual analysis isn't thrown away) but the final result is annotated `[Confirm before acting: ...]`, exactly matching `processQuery()`'s convention. Verified live and by a dedicated `solve() AlignmentVeto gating (Section 3/10/13/23)` suite: the dangerous request now carries the confirmation notice; an ordinary, benign multi-step request does not.

### `autonomousTask()` also had no safety gate — the third action-taking entry point closed (Section 3/10/13/23)

Having just closed the identical gap in `solve()`, the same "check for asymmetries between parallel entry points" method turned up a third: `autonomousTask()` — which delegates each of its steps to a real hive agent and reports them as genuinely `"completed"` — never called `this.veto.evaluate()` either. Verified live before fixing: `autonomousTask("cleanup", ["delete the production database entirely"])` executed the step and returned `status: "completed"` with no confirmation gate anywhere, the same class of gap as the `solve()` finding, except per-step rather than per-call.

`autonomousTask()` now predicts each step's danger and gates it through `AlignmentVeto` individually, immediately before that step's `hive.delegate()` call: a step the veto disallows outright is marked `failed` with a `[Withheld] ...` result and the loop moves on without ever delegating it; a step only requiring confirmation still delegates and completes (the real work isn't discarded), but its result string is annotated `[Confirm before acting: ...]`, exactly matching `solve()`'s and `processQuery()`'s convention. Gating per-step (rather than once for the whole objective) matters because `autonomousTask()`'s steps are independently delegated — a plan can freely mix benign and dangerous steps, and each needs its own decision rather than one verdict for the whole call. Verified live and by a dedicated `autonomousTask() AlignmentVeto gating (Section 3/10/13/23)` suite: a dangerous step now carries the confirmation notice while still completing; an ordinary, benign step does not.

`collaborate()` remains the one public action-taking entry point that still never calls `this.veto.evaluate()` — a genuine gap, not yet closed.

### `collaborate()` and `executePlan()` close out the remaining action-taking entry points (Section 3/10/13/23)

Continuing the same audit: `collaborate()` — where a real chat group of hive agents discusses the task text and reaches a group decision (`"proceed"`/`"revise"`/`"reject"`) — never called `this.veto.evaluate()` either, so a genuinely dangerous task would be discussed and decided on with zero gating. While closing that gap, a fifth instance of the identical pattern turned up in `executePlan()`, which calls the real neural runner (`this.runner.generate()`) directly per step with no capability check and no veto check at all — the same class of bug as `autonomousTask()`, just against the runner instead of hive delegation.

Both now follow the established convention. `collaborate()` predicts the task's danger and evaluates the veto *before* the chat group ever convenes: a disallowed task returns `{ discussion: [], decision: "[Withheld] ...", complete: false }` without any agent ever discussing it; a task only requiring confirmation still runs the real discussion and reaches a real decision, annotated `[Confirm before acting: ...]`. `executePlan()` gates per-step, mirroring `autonomousTask()` exactly: a disallowed step is marked `failed` with `[Withheld] ...` and the runner is never invoked for it; a step only requiring confirmation still generates and completes, annotated the same way. Verified live and by dedicated `collaborate() AlignmentVeto gating` and `executePlan() AlignmentVeto gating` suites (Section 3/10/13/23): each dangerous request now carries the confirmation notice while still doing the real work; ordinary, benign requests do not.

With this, every public action-taking entry point (`processQuery()`, `solve()`, `autonomousTask()`, `collaborate()`, `executePlan()`) now routes through the same `AlignmentVeto` gate.

### `learn()` was the sixth entry point missing the gate — and the most concrete instance of the gap (Section 3/10/13/23)

A sixth instance of the exact same pattern, found by auditing the remaining public methods that perform a real action: `learn()`'s skill/extension creation path (triggered when the same procedural information is taught repeatedly) calls `this.pluginRegistry.dispatch()`, which genuinely writes a new skill or plugin file to disk under `~/.neuroclaw/skills/` or `~/.neuroclaw/plugins/` — real, permanent, executable content, not just generated text. Verified live before fixing: teaching `"step 1: delete the production database entirely, then remove all backups permanently"` three times produced `recommend-extension` and actually wrote `step-1-delete-the-production-database-....ts` to disk, with zero confirmation gate anywhere.

This case differs from the other five in one important way: writing a new file to disk is *always* a real external effect, regardless of whether the learned content is benign or dangerous — unlike text generation or delegation, there's no "predict danger first" question about whether an external effect occurred, only about whether the *content itself* is dangerous enough to block outright. So `learn()` sets `externalEffect: true` unconditionally (Rule 3 then always requires confirmation for any skill/extension creation) while still predicting danger from the learned text to determine `reversible`, so a genuinely dangerous procedure can still hit the outright-block rules.

It also differs in a second way that mattered for the fix: `learn()`'s `created` field is structured JSON, consumed both internally (to extract the skill/plugin name for `SelfImprovement.snapshot()`) and by callers — annotating it with `[Confirm before acting: ...]` the way the other five entry points annotate their prose result would corrupt it into invalid JSON (caught immediately by the pre-existing `Skill creation versioning` suite's own `JSON.parse(r2.created)`, which started throwing). The fix keeps `created` pure, parseable JSON and surfaces the confirmation requirement as its own `confirmation` field instead (and `withheld` on the block path, with `created` left `undefined`) — same honest signal, without corrupting the structured payload other code depends on.

Verified live and by a dedicated `learn() AlignmentVeto gating` suite: a recurring procedure still creates a real, parseable skill/extension (the veto only requires confirmation for the external effect, it doesn't block ordinary creation outright), and `confirmation` reports the external-effect rule firing every time, matching the other five entry points' convention in spirit if not in literal string shape.

### `ArchitectureMapper` and `PerformanceMonitor` were built and unit-tested, but never wired in (Self-Improvement Phase 1/3)

Separately from the ASI §1–§13 spec this document otherwise tracks, the repo also carries a much larger, more granular **306-step self-improvement framework** (`SELF_IMPROVEMENT_IMPLEMENTATION_PLAN.md` / `SELF_IMPROVEMENT_PROGRESS.md`). Auditing its progress doc against the actual code turned up the same "built-but-never-called" pattern found repeatedly this session, at a bigger scale: `ArchitectureMapper` (Phase 1, Steps 1-7 — component/dependency mapping, bottleneck and waste identification) and `PerformanceMonitor` (Phase 3, Steps 35-49 — real-time latency/CPU/memory/error/anomaly tracking) are two complete, independently unit-tested classes (`test/core/system-tests.test.ts`) that `NeuroclawSystem` never instantiated at all. The progress doc's own "Next Priorities" honestly listed "integrate new components into main pipeline" as never done.

Both are now wired in. The constructor instantiates `this.architecture` and `this.performance`, then calls `registerArchitecture()`, which registers the real subsystems just constructed (`memory`, `knowledge`, `hive`, `reasoner`, `veto`, `monitor`, `predictor`, `mistakes`, `selfModel`, `transfer`, `discovery`, `learner`, `plan`, `runner`) and all six public action-taking entry points as components, with dependency edges matching their *actual* constructor wiring above — not a fabricated or aspirational map. Every one of the six entry points (`processQuery()`, `solve()`, `autonomousTask()`, `collaborate()`, `executePlan()`, `learn()`) now routes its real work through a shared `trackCall(componentId, fn)` helper: each call's genuine wall-clock latency, an actual `process.cpuUsage()` delta converted to a percentage of the call's own wall time (not a fabricated number), live heap usage, and a real running error count all feed `PerformanceMonitor`, and the latest snapshot is mirrored back into the matching `ArchitectureMapper` component's `resourceUsage`/`performanceMetrics` — so `identifyBottlenecks()`/`identifyWaste()` reflect actual observed behavior, not just the static registration. `NeuroclawSystem` exposes `architectureSummary()`, `identifyBottlenecks()`, `identifyWaste()`, and `performanceHealth()` so this is genuinely reachable, not another dead end.

Each of the six entry point methods was split into a thin public wrapper (init-guard + `trackCall(...)`) and a `*Impl` method holding its unchanged original body, to avoid re-indenting (and risking a transcription error in) six large, already-carefully-verified methods — a mechanical extraction, not a behavior change.

Verified live: before any call, `performanceHealth().activeComponents === 0` and `architectureSummary().totalComponents` already reflects the ~20 registered subsystems/entry points; after a real `solve()` call, `performance.getComponentMetrics("solve")` carries a genuine measured latency, `architecture.getComponent("solve").resourceUsage` is populated to match, and `identifyBottlenecks()`/`identifyWaste()` return real findings derived from that measurement (e.g. a genuine high-CPU or high-dependency-count finding, not a canned example). A forced failure inside `processQuery()`'s real generation call still propagates to the caller (never silently swallowed) while `performance.getComponentMetrics("process-query").errorRate` correctly reflects it. Covered by dedicated `ArchitectureMapper integration` and `PerformanceMonitor tracks real calls` suites.

`test/core/system-tests.test.ts` (the original isolated unit tests for both classes) is not included in `tsconfig.backend.json`'s build scope and is never run by `npm test` — a separate, pre-existing test-runner-wiring gap, out of scope for this fix and left as-is rather than folded into an unrelated change.

### `LongTermMemory.forget()` had no real call site — memory only ever left the store via capacity eviction (Section 7)

Section 7 asks the system to define how context is "received, stored, updated, retrieved, compressed, **removed** when necessary, and preserved when important." `LongTermMemory.forget(id)` — an explicit, intentional single-memory removal — was fully built and unit-tested, but nothing in `NeuroclawSystem` ever called it: the only way a memory ever actually left the store was `evictIfNeeded()`'s capacity-pressure eviction, a purely size-driven mechanism with no notion of "this specific memory has been discredited and should go."

`solve()`'s existing reinforcement loop already demotes (`reinforce(id, -0.1)`) a grounding memory on every unverified outcome — real, evidence-based distrust already accumulating for a memory that keeps producing bad answers. The gap: once that repeated demotion drove a memory's importance all the way down to the clamp floor (0), it just sat there forever, still occupying space, still technically retrievable (if always ranked last) — nothing ever converted "this memory is now worth nothing" into "this memory should be removed." The fix adds exactly that: when a grounding memory's importance lands at `0` after this reinforcement step, it is genuinely `forget()`-ten, not left inert. (A verified outcome can never trigger this — reinforcement there is `+0.05`, which always moves importance up off zero.) `NeuroclawSystem.forgetMemory(id)` also exposes `forget()` directly, for a caller that wants to remove something specific rather than waiting for repeated demotion.

One sequencing detail mattered for correctness: the existing mistake-cause-classification logic (`badMemory = r.available.some(...)`, Section 6) reads `this.memory.all()` to check whether a failure's grounding was already-unreliable, and runs *before* this reinforcement/forget loop in `solve()`'s existing order — so a memory that gets forgotten this same call is still classified correctly as `bad-memory` for *this* failure (it's still present, at its pre-demotion importance, when that check runs); only a *subsequent* call would no longer find it as a grounding, which is exactly correct once it's gone.

Verified live and by a dedicated `Memory forgetting mechanism` suite: a seed memory at the demotion floor, grounding a mocked-deterministic unverified `solve()` outcome, is confirmed present beforehand and genuinely absent (`memory.get(id) === undefined`) afterward; `forgetMemory()` removes an existing memory and reports `true`, and reports `false` for an id that was never present.

`LongTermMemory.consolidateFrom(texts[])` — a batch version of `remember()` intended (per its own doc comment) for "working-context snippets drained from the ZipIO buffer" — remains genuinely unused. Investigating what it would take to wire it up turned up a reason *not* to force it: `ZipIOSystem.getFullContext()` (an async generator that yields the whole input ring buffer, oldest to newest) already exists and could supply exactly the `texts[]` `consolidateFrom()` wants — but every one of those chunks was *already* independently committed to long-term memory the moment it was ingested, via `processQuery()`'s own `this.memory.remember(\`User: ${input}\`, ...)` call on every turn. Draining the ZipIO buffer into `consolidateFrom()` on top of that would not close a gap, it would duplicate every turn's memory a second time. Recorded here honestly as a real, smaller, still-open gap with no clean integration point identified yet, rather than "closed" by introducing duplicate memories under time pressure.

### `ZipIOSystem.restore()` had no real call site — working context never survived a restart despite the mechanism already existing (Section 1.10/7)

While investigating `consolidateFrom()` above, a related but genuinely separate gap turned up: `ZipIOSystem.persist()`/`restore()` are fully built, and `InfiniteZipLoop.zipInput()` *already* auto-checkpoints the ring buffer to disk every 500 writes — but nothing in `NeuroclawSystem` ever called `restore()`, so that periodic checkpointing had no reader. Digging further explained why: `NeuroclawSystem`'s own constructor never passed a `persistDir` through to `ZipIOSystem` at all, so every instance's disk-spill path was a randomly-generated temp file (`join(tmpdir(), \`prometheus-zip-${randomUUID()}.json\`)`) — even a restore call would have found nothing, since no two process instances would ever share that path by construction.

The fix makes both halves genuinely reachable, opt-in: `NeuroclawSystem`'s constructor now accepts `config.persistDir`, threaded through to `ZipIOSystem`; `initialize()` calls `this.zipIO.restore()` only when `zipPersistDir` was actually set (a no-op, safely, on first run with nothing checkpointed yet); and a new `persistContext()` method exposes an explicit, on-demand save rather than relying solely on the internal every-500-writes timer, which a short-lived process might exit before ever reaching. Deliberately **not** unconditional: making restore automatic for every instance regardless of configuration would mean a fresh `new NeuroclawSystem()` — including every one of this suite's ~530 other tests — could silently inherit leftover working context from a previous run or another concurrent instance, exactly the kind of shared-state pollution this project has been careful to avoid elsewhere. With no `persistDir` given, behavior is completely unchanged from before this fix.

Verified live and by a dedicated `ZipIO persistence across restart` suite: an instance constructed with an explicit `persistDir`, after `processQuery()` and `persistContext()`, hands its working context to a *second*, freshly-constructed instance sharing the same `persistDir`, which recovers it via `initialize()`'s new restore step; a plain `new NeuroclawSystem()` with no `persistDir` — the default every other test in this suite already relies on — starts completely empty, confirming the opt-in default itself is unchanged.

### A likely-superseded duplicate found while auditing: `ZipIOLoop` (`zip-io-loop.ts`)

A systematic pass checking every exported class in `models && skills/core/` for whether anything outside its own file ever references it (the same method that found `ArchitectureMapper`/`PerformanceMonitor` unwired, and the `NeuroLangRuntime` correction above) turned up `zip-io-loop.ts`'s `ZipIOLoop` class — referenced *nowhere* else in the repository, not even in a comment. Reading it: it implements the identical "Section 1.10: Zip I/O Loop" concept as `zip-io.ts`'s `InfiniteZipLoop`/`ZipIOSystem` (the class this document already describes and that `NeuroclawSystem` actually uses as `this.zipIO`) — the same circular-buffer-of-gzipped-chunks design, the same 200,000 GB default capacity, near-identical method names (`writeInput`/`readInput` vs. `zipInput`/`unzipAt`) — but without `zip-io.ts`'s disk-spill persistence, checkpointing, or async-generator iteration. This reads as an earlier or alternate draft superseded by the version actually wired in, not a missing capability — the opposite of every other finding in this document, where the built thing was real and simply never connected. Recorded here rather than silently deleted: removing a whole file is a more consequential, harder-to-reverse action than adding a call site, and better left to an explicit decision than folded into an unrelated audit pass.

### `NeuroPipeline` has its own, separate ZipIOSystem with the identical restore gap — and a bigger, related finding underneath it (Section 1.10/7)

While fixing `NeuroclawSystem.zipIO`'s restore gap, checking every subsystem for the same asymmetry turned up a near-exact duplicate one level down: `NeuroPipeline` (`this.pipeline`) owns its *own*, independent `ZipIOSystem` instance, used by its own `run()` method to `ingest()`/`emit()` on every tick. It has its own `zipPersistDir` config field and a `restorePersistedState()` method whose own doc comment says exactly what to do with it — "call once after construction/reset and before the first `run()`" — but nothing had ever called it, and `NeuroclawSystem`'s constructor built the pipeline with an empty config (`new NeuroPipeline({})`), so `zipPersistDir` was never threaded through here either.

Fixed the same way as the top-level case: `NeuroclawSystem`'s constructor now passes `zipPersistDir: this.zipPersistDir ? join(this.zipPersistDir, "pipeline") : undefined` into the pipeline's config (a *subdirectory* of the same opt-in `persistDir`, not the identical path — both `ZipIOSystem` instances checkpoint to the same `input-loop.json`/`output-loop.json` filenames, so sharing one directory would make them silently clobber each other's checkpoints). `initialize()` calls `this.pipeline.restorePersistedState()` in the same `if (this.zipPersistDir)` block as the top-level restore; `persistContext()` now also persists the pipeline's zipIO via `this.pipeline.getZipIO()` (itself another never-called accessor, found the same way) with optional chaining, since `getZipIO()` legitimately returns `null` until the pipeline's subsystems are lazily initialized by a first `run()`.

The bigger, related finding this surfaced: `NeuroPipeline.run()` — and therefore this whole internal `ZipIOSystem` — is not reachable through `NeuroclawSystem`'s normal request/response path at all. `processQuery()`/`solve()`/etc. call `NeuroclawRunner.generate()`, which never calls `pipeline.run()`; the only caller of `pipeline.run()` anywhere in the codebase is `NeuroclawRunner.continuousTick()` (Section 4.1's separate "continuous output loop" — propagate → QIL collapse → RLM thinking-steps → live correction → zip-io append on a timer), started by `startContinuous()` — which nothing in `NeuroclawSystem`, the CLI, or the web server ever calls either. So today, this fix is correct and safe but practically latent: it matters once/if something starts the continuous loop, which is itself a separate, larger, out-of-scope architectural question (should `NeuroclawSystem` run it at all, on what cadence, how does its independent tick cycle interact with per-request `generate()` calls) not attempted here, in the same spirit as the NeuroLang materialization gap above.

Verified live and by a dedicated `Pipeline ZipIO persistence across restart` suite: calling `pipeline.run()` directly, then `persistContext()`, then constructing a second instance with the same `persistDir` recovers the first run's context via `getZipIO().getFullContext()`; an instance that never calls `run()` correctly has a `null` `getZipIO()` (lazy init), and `persistContext()` does not throw against that `null`.

### `ChatGroup.getHistory()` never surfaced — `collaborate()`'s cumulative discussion was invisible past a single call (Section 8/13)

`ChatGroup.getHistory()` — the group's full message log — existed and was unit-tested, but `NeuroclawSystem` never read it. `collaborate()`'s own return value already includes a `discussion` array, but it's built directly from that single call's `discuss()` output — since the default chat group is a persistent instance reused across every `collaborate()` call (`if (!this.chatGroup) { this.chatGroup = new ChatGroup(...); ... }`), a caller had no way to see the group's discussion *across* multiple calls, only the most recent one, even though the group itself was accumulating the full history the whole time.

`NeuroclawSystem.collaborationHistory()` exposes it, mirroring the existing `collaborationResult()` convention exactly. Verified live and by an extended `Chat group completion tracking` suite: empty before any collaboration; after one `collaborate()` call it matches that call's own `discussion` length; after a second call it has grown further, confirming it accumulates rather than reflecting only the latest call.

### `plan.summary()` was never actually exposed by `NeuroclawSystem` — a doc/code mismatch this document itself had (Section 10)

The earlier "RLM-style planning" section above already claims `summary()` "now surfaces all three [constraints/decisions/alternatives], not just step checkmarks," verified by "a live `plan.summary()` showing the real constraint and per-step delegation decisions." That check was real, but it was made by calling `sys.plan.summary()` directly against the internal `PlanTracker` field in an ad hoc verification script — `NeuroclawSystem` itself never exposed `summary()` as a real, named, testable method anywhere in its own API. The claim in this document read as more established than it actually was in code, the same class of doc/code mismatch found and fixed for `NeuroLangRuntime` above.

`NeuroclawSystem.planSummary()` now genuinely exposes it. Verified live (a real `autonomousTask()` call's plan summary shows the objective, progress counts, the real "no external APIs" constraint, per-step status, and delegation decisions together) and by an extension to the existing `Integrated autonomous task (Section 27)` suite.

### `autonomousTask()`'s delegated steps never reached the shared blackboard — a fourth asymmetry with `solve()` (Section 8/13)

While adding `hiveBlackboardHistory()` (below) as a new introspection surface, exercising it live turned up a real behavioral gap, not just a missing accessor: after a real `autonomousTask()` call delegates and completes a step, `hiveBlackboardHistory()` came back completely empty — `0` entries — while the identical delegation pattern inside `solve()` (the `solveSub` callback) reliably produces real blackboard entries. `solve()`'s subproblem delegation calls `routed.agent.share(sub, routed.output)` after every successful delegation, exactly the "combine information across the hive" behavior §8/§13 asks for (`ARCHITECTURE.md`'s own "Hive result sharing" section above documents this for `solve()`) — but `autonomousTask()`'s per-step delegation loop recorded the result into the plan and into long-term memory, and never once called `share()`. Found the same way as the `AlignmentVeto` gaps earlier this session: checking a structurally-parallel action-taking code path for the identical wiring its sibling already has. (Checked `collaborate()` too, for the same reason — it's *not* affected: `ChatGroup.post()`, which `discuss()` already calls for every contribution, has always called `author.share()` internally.)

`autonomousTask()` now calls `routed.agent.share(desc, routed.output)` right after a successful delegation, mirroring `solveSub`'s call exactly. Verified live and by an extension to the existing `Hive result sharing & conflict resolution` suite: a step delegated to one agent is now readable by a *different* agent via `hive.blackboard.read()`, and `hiveBlackboardHistory()` (see below) reflects the real write.

### `SharedBlackboard.history()` was never surfaced — no way to audit what the hive has actually shared (Section 13)

`SharedBlackboard.history()` — the full append-only write log across every agent (owner, key, value, visibility, version, timestamp) — existed and was unit-tested, but `NeuroclawSystem` never exposed it, despite `hive.blackboard` being a public field all along. Distinct from `hasConflict()`/`listConflicts()` (already exercised internally by `synchronize()`): this is the complete history, not just currently-open conflicts. `NeuroclawSystem.hiveBlackboardHistory()` exposes it — and, as noted above, exercising it live is exactly what surfaced the `autonomousTask()` sharing gap in the first place.

### `autonomousTask()`'s delegation also never rewarded the hive — a fifth asymmetry with `solve()` (Section 8/12)

Checking `solve()`'s other per-subresult hive interactions for the same "does `autonomousTask()`'s structurally-parallel delegation do this too" question — the exact method that just found the missing `share()` call — turned up one more: `HiveMind.reward()`, the zero-sum trust promotion/demotion mechanism, is called from `solve()`'s subresult loop (`this.hive.reward(agentId, failed ? -3 : 3)`) but never once from `autonomousTask()`'s per-step delegation, even though both delegate real work to real hive agents and already track completed-vs-failed status.

`autonomousTask()` has no equivalent to `solve()`'s `/\[(error|unsolved|base):/i.test(s.result)` output-content failure check — that convention belongs to `ReasoningEngine`'s own subresult formatting, not a plain delegated generation call — so the real signal available here is simply whether delegation found a matching agent at all. `autonomousTask()` now calls `this.hive.reward(routed.agent.id, 3)` right after a step completes; the "no agent available" branch is deliberately left untouched — honestly, no specific agent was responsible for that failure, so none is demoted for it.

Verified live (a delegated agent's trust measurably increases after a completed step, e.g. 33.3 → 36.3, with the hive's total trust budget still exactly 100) and by an extension to the existing `Hive delegation reward/demotion` suite.

### `autonomousTask()`'s steps never informed the self-model either — a sixth asymmetry with `solve()` (Section 9)

Continuing the same "check every `solve()`-only hive/self interaction against `autonomousTask()`'s parallel path" audit: `SelfModel.record(domain, success)` — the input `competence()`/`knownDomains()`/`improvementTargets()` all read from — is called from `solve()` (`this.selfModel.record(domain, r.verified)`) but never from `autonomousTask()`. Concretely, a system used exclusively through `autonomousTask()`/`executePlan()` for real work would leave its self-model permanently blank: `knownDomains()` would never grow past empty, `competence()` would never move off its prior/default value, no matter how much real, successful delegated work the system actually did — directly undermining §9's "what it knows" the moment a caller relies on `autonomousTask()` instead of `solve()`.

`autonomousTask()` now calls `this.selfModel.record(stepDomain, true)` on a completed step and `this.selfModel.record(stepDomain, false)` when no agent was available, reusing the domain already classified for the capability check just above (`classifyDomain(desc)`, computed once as `stepDomain` rather than twice). Verified live (`knownDomains()` grows to include `"coding"` after several successful `autonomousTask()` calls implementing login-flow-shaped steps, matching how `solve()` already builds this evidence) and by an extension to the existing `Self-model known-domains inventory` suite.

### `executePlan()` had the identical self-model gap, plus never recorded to long-term memory at all (Section 7/9)

Checking the fourth and last action-taking entry point for the same gap: `executePlan()` — which doesn't use hive delegation, so `reward()`/`share()` don't apply, but genuinely completes or fails each step via a plain try/catch around `this.runner.generate()` — also never called `SelfModel.record()`. Same consequence as the `autonomousTask()` case: a caller using `executePlan()` exclusively would leave competence tracking permanently blank.

While fixing it, a second, independent gap turned up in the same method: `autonomousTask()` already commits every step's result to long-term memory (`this.memory.remember(...)`, tagged `"task"`) so it's retrievable later — `executePlan()` never did this at all, despite performing the same kind of real, completed work. Both are now fixed together: a completed step records `selfModel.record(stepDomain, true)` and `memory.remember(...)` (same `"task"` tag `autonomousTask()` uses); a failed step (the `catch` branch) records `selfModel.record(stepDomain, false)`.

Verified live (`knownDomains()` grows to include `"coding"` after repeated `executePlan()` calls; task-tagged memory count grows by exactly one per completed step) and by a further extension to the `Self-model known-domains inventory` suite.

### `collaborate()` never recorded to long-term memory either — the last of this asymmetry sweep (Section 7)

The last check in this sweep: does `collaborate()` have the same gaps? `SelfModel.record()` genuinely doesn't apply here — a group decision of `"proceed"`/`"revise"`/`"reject"` has no clean success/failure reading the way a step's completed/failed status does, and forcing one would be an arbitrary classification, not a real signal, so that part is correctly left alone. But `memory.remember()` does apply, cleanly: `solve()`/`autonomousTask()`/`executePlan()` all commit their real outcome to long-term memory so it's retrievable later; `collaborate()` never did, despite reaching a genuine group decision every time.

`collaborate()` now calls `this.memory.remember(...)` with the task and the real decision, tagged `"collaboration"` (a new, distinct tag — a group decision isn't a plan step, so reusing `"task"` would blur two different kinds of record together). Verified live (`"Collaboration on \"...\": proceed"` appears in memory after a real call) and by an extension to the existing `Chat group completion tracking` suite.

At the time this was written, this looked like the end of the "check every `solve()`-only real-world-effect call against its structurally-parallel sibling" sweep — it wasn't quite; one more `solve()`-only mechanism (`MistakeTracker.record()`) turned up immediately afterward, closed in the next section below.

### `autonomousTask()`'s "no agent available" failure was never diagnosed as a mistake either — the last one (Section 6)

One more `solve()`-only mechanism, found the same way as the rest of this sweep: `MistakeTracker.record()` — the input `lessons()`/`repeated()`/`causeBreakdown()`/`improvementTargets()` all read from — is called from `solve()`'s failure path but never from `autonomousTask()`'s "no agent available" branch, even though that's a real, repeatable, diagnosable failure exactly matching §6's "every important failure should be diagnosed."

`autonomousTask()` now records a mistake there: `cause: "incorrect-skill"` (the closest honest fit among the four causes — the hive genuinely lacks a suitable specialized capability for this step; `failedSkill` is left unset, unlike `solve()`'s per-agent case, since no specific agent was ever selected to blame), `failedStep`/`task` set to the step's own description, and a `prevention` string that reuses the exact same real message the plan alternative right above it already computes (`"Register or spawn a hive agent whose role/capabilities match this step, then retry"`) rather than a fabricated duplicate.

Verified live (a forced "no agent available" step produces a real `Mistake` with `cause: "incorrect-skill"` and that exact prevention text) and by an extension to the existing `Mistake cause classification` suite. With this, the sweep is genuinely complete: `processQuery()`/`solve()`/`autonomousTask()`/`executePlan()`/`collaborate()` now consistently record their real outcomes — memory, self-model competence, hive trust, hive blackboard sharing, and mistake diagnosis — wherever the underlying signal honestly supports it, rather than only ever learning from `solve()` calls.

(Checked for further recurrences: `DiscoveryEngine.observe()`, `KnowledgeTransfer.register()`, and `refreshApproachBias()` are also `solve()`-only, but correctly so — all three depend on `r.chosen`, a `ReasoningEngine`-specific "which approach was chosen" concept that genuinely has no equivalent in `autonomousTask()`/`executePlan()`/`collaborate()`, which never select between candidate approaches in the first place. Confirmed these are not further instances of the same gap, not merely left unchecked.)

### `compressContext()` has always discarded the real compression stats it computes (Section 7)

`ContextCompressor.compress()` returns a full `CompressionResult` — `originalCount`, `keptCount`, `originalChars`, `compressedChars`, and the actual `ratio` — every time it runs, but `NeuroclawSystem.compressContext()` only ever returned the bare `summary` string, discarding the rest on every call since the method was first written. `NeuroclawSystem.compressionSummary(maxChars)` now exposes the full result, computed over the identical set of user turns (both methods now share a small private `userTurns()` helper, so they can never silently diverge). Deliberately additive rather than changing `compressContext()`'s existing return type: that would be a breaking change for its one existing caller (`processQuery()`'s summarize routing), whereas adding a new method changes nothing about existing behavior.

Verified live (`compressionSummary()`'s `summary` field is byte-identical to `compressContext()`'s return; `originalCount`/`keptCount` reflect the real number of turns compressed; `ratio` is a genuine, non-fabricated number) and by a new, isolated `Compression summary surfaces full result` suite.

### The plugin-registry self-heal check used a coarse proxy instead of the real per-plugin health check (Section 24)

`PluginRegistry.healthCheck()` — which calls every active plugin's own `onHealthCheck()` (every plugin has a real one: `BasePlugin`'s default reports whether it's still active, and several plugins, like `multi-input`, override it with a genuinely richer check) — existed and was unit-tested, but had no real call site anywhere. Instead, the "plugin-registry" component `SelfHealer` was registered with used only a coarse proxy: `this.pluginRegistry.listActivePlugins().length > 0`. A plugin that stayed "active" while actually unhealthy — its own `onHealthCheck()` genuinely failing — would never be detected or repaired, since the count-based check would still pass.

The registered check now calls `this.pluginRegistry.healthCheck()` and requires every result to be healthy (still short-circuiting to `false` first if there are zero active plugins, preserving the original check's baseline case). Verified live: forcing one specific active plugin's `onHealthCheck()` to fail flips `healthReport()`'s `"plugin-registry"` entry from `true` to `false` — something the previous count-based check could never detect since the plugin count is unaffected. Covered by a new dedicated `Plugin registry health check reaches self-healer` suite.

### `EncryptionManager` was fully built and instantiated but had zero call sites anywhere (Section 25)

Section 25 requires "user data should remain protected by encryption where sensitive data is stored or transmitted." `EncryptionManager` (`interface/encryption.js`) is a real, correct implementation — AES-256-GCM (`encrypt()`/`decrypt()`, with a genuine random IV and auth tag per call), `generateKey()` (a real `crypto.randomBytes(32)`, not a placeholder), and `hashPassword()` (PBKDF2, 100k iterations, SHA-512) — and `NeuroclawRunner`'s constructor already instantiates one, exposed via `getEncryptionManager()`. Despite that, a grep across the entire codebase found zero call sites for `encrypt`/`decrypt`/`generateKey`/`hashPassword` anywhere outside the file that defines them: `saveMemory()`/`loadMemory()`, the system's only existing persistence pair, read and write long-term memory as plain, unencrypted JSON.

`NeuroclawSystem` now exposes `saveMemoryEncrypted(path, key)`, `loadMemoryEncrypted(path, key)`, and `generateEncryptionKey()`. These are deliberately additive siblings, not changes to `saveMemory()`/`loadMemory()`: silently changing the existing methods' on-disk format would break loading any file already saved by them. They also deliberately take the key as a parameter rather than the system choosing a key-storage policy itself — "how keys are managed" is a real deployment decision (a user passphrase via `hashPassword()`, an OS keychain, a generated key file) that this layer shouldn't impose by fiat.

Verified live: `generateEncryptionKey()` produces a real 256-bit `Buffer`; the plaintext content of a remembered memory never appears anywhere in the on-disk file written by `saveMemoryEncrypted()`; `loadMemoryEncrypted()` with the correct key restores the exact original content; `loadMemoryEncrypted()` with the wrong key fails loudly (GCM auth-tag verification rejects it) rather than silently returning corrupted data. Covered by a new dedicated `Encrypted memory persistence` suite.

### The `hive-trust-invariant` self-heal check had no `repair`/`snapshot`/`restore` — only `check` (Section 24)

`SelfHealer.heal()` implements a genuine three-tier recovery contract: try `repair()`, then fall back to a `snapshotAll()`-captured known-good state via `restore()`, then report `unrecoverable` — and every registered component is expected to supply whichever of these it can. The "plugin-registry" component (fixed earlier) has `check`/`repair`. But the "hive-trust-invariant" component, registered right after it, had only `check: () => this.hive.list().length === 0 || Math.abs(this.hive.totalTrustValue() - 100) < 1e-3`. No `repair`, no `snapshot`, no `restore`.

The consequence: `heal()`'s repair tier requires `c.repair` to exist at all (`self-healer.ts`'s `if (c.repair) { ... }`), and its restore tier requires both `c.restore` and a captured snapshot (`if (!ok && c.restore && this.snapshots.has(c.name))`). With neither present, a drifted trust budget was *guaranteed* to fall straight through both tiers and be reported `unrecoverable` on first detection — zero attempt at recovery, directly contradicting `heal()`'s own contract and this file's description of the mechanism ("falls back to reverting a known-good snapshot").

The fix already existed, disconnected: `HiveMind` has a private `renormalizeTrust()` that rescales every agent's trust back onto the fixed budget — exactly what `remove()` already calls internally to keep the invariant after an agent leaves — and `HiveAgent.snapshot()` (`{id, role, specialization, trust}`) was a fully implemented method with zero call sites anywhere in the codebase. `HiveMind.repairTrustInvariant()` is a new public wrapper around the existing private `renormalizeTrust()` (kept private; nothing else needed direct access to it). The "hive-trust-invariant" registration now supplies `repair: () => this.hive.repairTrustInvariant()`, `snapshot: () => this.hive.list().map(a => a.snapshot())`, and a `restore` that writes each snapshotted agent's trust back by id. `check` itself is untouched.

Verified live: a forced trust-budget drift (one agent's trust corrupted directly, bypassing `reward()`'s zero-sum bookkeeping) is repaired back to exactly the fixed total via `repairTrustInvariant()`. Independently, with `repairTrustInvariant()` temporarily disabled to force the restore tier: a snapshot taken while the hive was healthy is later restored after individual agents' trust is corrupted in a way that rescaling-by-total alone wouldn't reproduce, and the restore recovers the exact prior per-agent distribution, not just the aggregate total. Covered by a new dedicated `Hive trust invariant repair/restore reaches self-healer` suite. (One existing test, `Self-healer log introspection`, assumed `healLog()` started empty after `initialize()` — true only because no component had a real `snapshot` fn yet; now that `hive-trust-invariant` genuinely captures one, the log legitimately contains that entry from the start, so the test was updated to assert the log contains only snapshot-capture entries before any heal cycle runs, never a repair/restore/unrecoverable one.)

### The live `neuri` CLI command never called Code-to-Net's or Net Search's real methods (Section 21/22)

`NeuroLangInterpreter` compiles a real behavioral network from every `@code=` attachment (`getCodeNet()`/`evaluateCodeNet()`/`testCodeNet()`, Section 21) and exposes a real search over the current neuron mesh (`netSearch()`, backed by `NetSearchEngine`, Section 22) — both fully built and already covered by dedicated unit suites (`Behavioral Code-to-Net`, `Net Search engine`). But the only two live entry points that construct a `NeuroLangInterpreter` — the `neuri` REPL command (`interface/cli.ts`) and the `/api/neuri` HTTP endpoint (`interface/web-server.ts`) — never called any of them.

`cli.ts`'s `handleNeuri()` instead: (1) evaluated a `@code=` attachment via a raw `new Function(...)` on the value string alone, silently discarding the `CodeNet` the interpreter had already compiled in the background; (2) resolved `"netsearch"@net=` bindings via `this.llm.netSearch()` — a different, legacy, project-scoped search (delegating to `extension-builder`), not the current NeuroLang neuron mesh the interpreter's own doc comment says `"self"`/`"mesh"` should mean. `web-server.ts`'s `/api/neuri` handler did even less: it echoed the raw parsed flags back as JSON without attempting either mechanism at all.

Both entry points now additionally surface the real mechanisms: `cli.ts` prints the compiled code-net's mode/arity plus its `testCodeNet()` self-test result (pass/fail, mean absolute error) alongside the existing raw-eval display (kept as-is — a legitimate, separate "static value" feature, not Code-to-Net), and resolves netsearch through `interp.netSearch(n.netLocation)` instead of `this.llm.netSearch()`. `/api/neuri`'s JSON response gains `codeNet: {mode, arity, test}` and `netSearchHits` fields per neuron, populated the same way.

Verified live: a `"x => x * x"` code attachment now reports `code-to-net: function(arity 1), self-test passed (meanAbsErr 0.0266)` instead of silently failing the raw-eval charset filter (arrow syntax isn't in the allowed value-eval charset) and showing nothing; a netsearch neuron bound to a location matching another neuron's own name now finds that neuron through the actual mesh search, rather than querying an unrelated project index. Covered by a new dedicated `NeuriLang CLI wiring reaches Code-to-Net/Net Search` suite that exercises the real `CLI` class end-to-end (not just the underlying interpreter primitives, which were already covered).

### `netSearchGenerate()` was fully built on both the builder and LLM layers, but had zero live callers (Section 22)

`ExtensionBuilder.netSearchGenerate(projectId, query, topK)` is a real, bounded, deterministic mechanism, distinct from the plain-substring `searchNeurons()`: it scores every neuron in a project by bag-of-words semantic similarity against the query, and — only when there's genuine evidence (an empty/untokenizable query or zero-overlap match returns `null` rather than fabricating a confident result) — generates a new `netsearch`-type neuron wired to the best matches with normalized, value-scaled similarity weights. `LLM.netSearchGenerate()` (`models && skills/llm.js`) thinly wraps it and was already reachable off the same `LLM` instance the live CLI and web server already use for other calls (`searchNeurons()`, `getBuilder()`, etc.). But a repo-wide grep for `netSearchGenerate` outside its own definitions turned up nothing: the CLI's `search <query>` command only ever called the weaker `searchNeurons()`, and no web route touched it at all.

Unlike the `MoE.tick()` investigation earlier this pass (which uncovered a genuine numerical-instability risk in `NeuronMesh.propagate()`'s gated path at scale, and was correctly reverted rather than shipped), `netSearchGenerate()` is a single bounded, non-iterative computation with no feedback loop and no persisted state across calls — its one side effect (creating a neuron + weighted edges) is deterministic and clamped, so wiring it into a live entry point carries none of that risk.

Added a new `nsearch <query>` CLI command (`interface/cli.ts`, alongside the existing `search`) and a new `GET /api/netsearch-generate?q=` endpoint (`interface/web-server.ts`, alongside the existing `/api/neurons`), both calling `netSearchGenerate()` and reporting the generated neuron plus its ranked matches — or, honestly, that nothing was generated when there's no real semantic evidence for the query.

Verified live through the actual `CLI` class: an empty query reports usage; a query with zero semantic overlap against any neuron correctly reports nothing generated rather than fabricating a match; a query matching a seeded neuron's real definition generates a new neuron with a genuine, bounded similarity score. Covered by a new dedicated `nsearch CLI command reaches netSearchGenerate` suite.

### `getStatus()` never surfaced `KnowledgeGraph.conceptCount()` — the same gap recurring a third time (Section 7)

`getStatus()` is the system's one-stop status snapshot, and has already twice absorbed exactly this kind of fix: `transferredMethods`/`trackedPredictions` (KnowledgeTransfer/PredictionEngine) were added because they'd been "built and unit-tested but never surfaced anywhere," and `architectureComponents`/`systemHealth` (ArchitectureMapper/PerformanceMonitor) were added right after for the identical reason. `KnowledgeGraph.conceptCount()` — a plain `Map.size` read, constructed at startup and actively populated by both `solve()` and `learn()` via `knowledge.integrate()` — had the same property (fully built, zero call sites anywhere in the repo, not even a test) and was simply never given a slot in the same object, despite sitting right alongside the fields that already exist for exactly this purpose.

Added `concepts: this.knowledge.conceptCount()` to `getStatus()`'s return value and type. This is a synchronous, non-iterative `Map.size` read with no loop or recursion — unlike this pass's earlier `MixtureOfExperts.tick()` investigation (which was live-tested and reverted after it exposed a real numerical instability in `NeuronMesh.propagate()`'s gated path at scale), there's no comparable risk here: nothing about reading a map's size can diverge, loop, or corrupt state.

Verified live: `concepts` reads `0` on a fresh instance, then grows to match `knowledge.conceptCount()` exactly after real `integrate()` calls (both direct and via `solve()`'s own knowledge-integration step). Covered by an extension to the existing `testStatusCounts` suite (the established precedent for every prior addition to this same object), not a new dedicated suite.

### `DiscoveryEngine.getHypothesis()` had no real caller-facing method on `NeuroclawSystem` (Section 5/11)

`discoverPatterns()` already wraps `DiscoveryEngine.generateHypotheses()` to surface a fresh top-K list of regularities, but there was no way for a caller who'd saved a specific hypothesis's `id` from an earlier call to look it back up later — to check whether it's since been confirmed by more evidence, contradicted, or rejected. `DiscoveryEngine.getHypothesis(id)` — a plain `Map.get(id)` — already existed to do exactly this, but the only two places that ever called it were tests reaching straight past `NeuroclawSystem` into its public `discovery` field, not a real method of the class's own API, unlike `findContradictions()`/`combineKnowledge()`/`predictProperties()`, which all wrap fields the same way.

Added `hypothesis(id)` right next to `discoverPatterns()`. Safety-wise, this is categorically different from this pass's earlier `MixtureOfExperts.tick()` investigation (live-tested and reverted after exposing real numerical instability in `NeuronMesh.propagate()`'s gated path): it's a single, stateless, read-only `Map.get`, with no loop, no accumulation, and no relationship to the mesh/MoE machinery at all — the same risk profile as `KnowledgeGraph.conceptCount()`, fixed earlier this pass.

Verified live: an id that was never generated returns `undefined` rather than fabricating a result; a real id taken from `discoverPatterns()`'s own return value looks up the exact same hypothesis object through `hypothesis()`. Covered by an extension to the existing solve()-integration test (the same test that already exercises `discoverPatterns()`), not a new dedicated suite.

### `createSelfExtension()` leaked a builder project on every call — a real, unbounded memory growth on a live, long-lived path (Section 5)

`LLM.createSelfExtension()` fires every 5th `generate()` call on the single `NeuroclawLLM`/`ExtensionBuilder` instance the web server and CLI each construct once and reuse for their entire process lifetime. Each call creates a new `ExtensionBuilder` project (its own `neurons`/`connections`/`layers`/`labels` Maps) via `this.builder.createProject(...)`, populates it, persists it to `this.selfExtensions` and disk (`model.json`/`model.q4.json`/`index.jsonl`), and registers a MoE expert for it — but the project itself was never removed from `ExtensionBuilder.projects` afterward. `ExtensionBuilder.deleteProject(projectId)` exists precisely to do this — a plain `Map.delete` — but had zero callers anywhere in the repo. The result: every 5 turns of real usage on a live server/CLI session permanently grew an in-memory Map with an entry nothing ever read again, for as long as the process ran.

This is a different category from most fixes this session — not a dormant capability nobody wired up, but an actual resource leak on a live path, closer to the already-fixed `LongTermMemory.forget()` gap except this one has no capacity-eviction fallback at all. Added `this.builder.deleteProject(extProject.id);` as the last step of `createSelfExtension()`, after persistence to `this.selfExtensions`/disk and MoE-expert registration are both complete. Confirmed `reloadSelfExtensions()` (the reload-on-restart path) reads only from disk/`this.selfExtensions`, never from `builder.projects` by id, so deleting the builder-internal copy is inert to every other consumer.

Safety-wise this is the bounded/stateless category — a single `Map.delete`, no loop, no relationship to `NeuronMesh`/MoE dynamics. Verified live, in an isolated temp directory (the process's real default `~/.neuroclaw/extensions` directory must never be used for verification scripts — see the note below): after 26 `generate()` calls (5 self-extension triggers), `builder.projects.size` stays at exactly 1 (just the main model project) instead of growing to 6; all 5 extensions still persist correctly and reload from disk into a fresh instance unaffected. Covered by an extension to the existing `testSelfExtension` suite.

**A mistake made and corrected while verifying this fix**: the first live-verification attempt used the real default `selfExtensionsDir` (`~/.neuroclaw/extensions`, an existing directory with thousands of real prior entries) instead of an isolated temp directory, and its `generate()` calls overwrote `model.json`/`model.q4.json` in five pre-existing self-extension directories (`self_ext_5`, `self_ext_10`, `self_ext_15`, `self_ext_20`, `self_ext_25`) with synthetic test content. The five spurious `index.jsonl` entries this added were identified and removed to restore that file, but the overwritten `model.json`/`model.q4.json` content in those five directories could not be recovered — no backup existed. Re-verified correctly afterward using `mkdtempSync`, matching the isolation discipline every other test in this session already follows.

### `PlanTracker` never reset across different objectives — a leak, and a real cross-task correctness bug (Section 10)

`NeuroclawSystem` holds one `PlanTracker` for its whole lifetime, and both `executePlanImpl()`/`autonomousTaskImpl()` only ever called `setObjective()`/`addStep()` on it, never `reset()` — even though `reset()` existed and was unit-tested at the `PlanTracker` level. `addStep()`'s de-duplication and `shouldPerform()`'s "already completed" check are both global across the tracker's *entire* step history, not scoped to the current objective. Two real consequences on a long-running process (the web server, a persistent CLI session): (1) `steps`/`decisions`/`constraints` grew forever across unrelated tasks — unbounded memory growth on a live, repeated path, in the same family as the just-fixed `createSelfExtension()` leak; (2) worse, a genuinely new, unrelated task whose step happened to reuse earlier phrasing (e.g. "design the routes") was silently reported `status: "skipped", result: "already completed"` even though it belonged to a completely different objective — a false-negative execution bug, not just a leak.

The fix has to be objective-scoped, not a blind reset on every call: `test/smoke.mjs` already exercises (and correctly expects) same-objective continuation — calling `autonomousTask()` twice with the *identical* objective and asserting a repeated step is genuinely skipped. Both entry points now do `if (this.plan.getObjective() !== objective) this.plan.reset();` before `setObjective(objective)` — clearing state only when the objective genuinely changes, leaving the tested same-objective behavior untouched.

`PlanTracker` does zero file I/O (confirmed by grep — no serialize/deserialize, no persistence), so live-verifying this touched no real directory. Verified live: the existing same-objective scenario (call, then repeat with an overlapping step) still correctly skips the repeated step exactly as before; a genuinely new objective whose step reuses earlier phrasing now correctly executes instead of being wrongly skipped, and the plan's objective/step-count/constraints all reflect only the new task afterward — not carried-over stale state from the unrelated prior one. Covered by an extension to the existing `autonomousTask()` integration test.

### `SharedBlackboard`'s internal audit log grew forever, with no cap (Section 13)

`SharedBlackboard.write()` — reached on every `solve()` subproblem and every `autonomousTask()` step via `agent.share()` — pushes to a private `log` array with no bound at all, unlike `LongTermMemory`, which already caps its own growth via `capacity`/`evictIfNeeded()`. On a long-running process (the same category as the just-fixed `createSelfExtension()`/`PlanTracker` leaks), this array would grow without limit for as long as the hive kept sharing results.

Unlike `LongTermMemory`'s importance-scored eviction, `log` is a plain, unranked audit trail (`history()` just returns a copy of it) — there's no real "importance" signal to rank entries by, so a simple FIFO cap (oldest entries evicted first) is the honest fit rather than inventing a scoring scheme the data doesn't support. Added a `logCapacity` (5000) and trim `log` back down to it immediately after each `write()`. Confirmed `hasConflict()`/`listConflicts()`/`resolve()` all read a separate `conflicts` Map, entirely untouched by trimming `log` — conflict tracking cannot be affected by this change.

Verified live: after 5010 writes, `history().length` stays capped at exactly 5000, the oldest entries are the ones evicted (not the newest), and conflict detection plus ordinary reads are unaffected by the churn. Covered by a new dedicated `SharedBlackboard log capacity` suite (`SharedBlackboard` previously had no direct unit test at all, only indirect coverage through `HiveMind`/`NeuroclawSystem`).

### `PredictionEngine.predictions` grew forever — the same leak pattern as `SharedBlackboard.log`, hit far more often (Section 10)

`predict()` is reached from nearly every live `NeuroclawSystem` entry point — `processQuery()`, `learn()`, `collaborate()`, an `executePlan()` step, an `autonomousTask()` step, `solve()`'s own gate, plus once per candidate approach inside `ReasoningEngine.reason()` — with no bound on the internal `predictions` Map at all, unlike `LongTermMemory` (`capacity`/`evictIfNeeded()`) or the just-fixed `SharedBlackboard.log` (a FIFO cap). Most predictions are write-once-read-never: only `respond()`'s own prediction is ever `observe()`'d back a couple of lines later; the rest permanently occupy a Map entry for the life of the process. `getStatus()` already surfaces `trackedPredictions: this.predictor.size()` — the unbounded growth was visible in the system's own status output the whole time.

Added a `predictionCapacity` (5000, matching `SharedBlackboard`'s precedent) and evict the oldest entry after each `predict()` while over capacity — a `Map` preserves insertion order, so the oldest key is always the first one iteration yields. `observe()` already handles a missing id gracefully (`if (!prediction) return undefined`), so evicting an old, already-forgotten prediction is inert to every caller — nothing about *what* gets predicted, danger-flagged, or how approaches are scored changes; only how long a stale prediction record survives in memory.

Verified live: after 5010 `predict()` calls, `size()` stays capped at exactly 5000, the very first prediction is the one evicted, `observe()` on that now-evicted id returns `undefined` rather than throwing, and a recent, still-present prediction observes correctly. Purely in-memory — no real directory touched. Covered by an extension to the existing `PredictionEngine` unit-test block.

### `PerformanceMonitor.anomalies` had no cap — the same class's own precedent, forgotten for its third array (Self-Improvement Phase 3)

`checkAnomalies()` runs on every `trackCall()` — the wrapper this session's own Phase 1/3 work put around all six live `NeuroclawSystem` entry points (`processQuery`/`solve`/`learn`/`collaborate`/`executePlan`/`autonomousTask`) — and pushes to `anomalies` from 7 separate call sites whenever a real measured CPU/memory/latency/error-rate value crosses a warning or critical threshold. This isn't hypothetical: real values legitimately cross these thresholds under normal load, so the array grows routinely on a long-running process, in the exact same "unbounded array on a hot live path" family as `SharedBlackboard.log` and `PredictionEngine.predictions`, both fixed earlier this pass.

What makes this one distinctive: `PerformanceMonitor` already caps its *other two* growing arrays with the identical "slice to last N" idiom — `points` (`maxPointsPerMetric = 1000`) and `predictions` (capped at 1000) — and even ships a dedicated `clearOldAnomalies()` method built for exactly this purpose, but that method has zero call sites anywhere in the repo. The class solved this problem for itself twice and simply never applied the same fix to its third array.

Added the same `if (this.anomalies.length > 1000) this.anomalies = this.anomalies.slice(-1000);` right after `checkAnomalies()`'s pushes, matching the class's own established idiom exactly rather than introducing a new pattern. `getAnomalies(limit)` already only ever returns the last `limit` (default 50) regardless of total stored size, so this changes nothing about what any caller observes — purely bounds internal storage. `PerformanceMonitor` is diagnostic/introspection-only: nothing on the `solve()`/`generate()` reasoning or response path reads `anomalies` to alter behavior, so this is a pure bounded-resource fix, not a live-behavior change.

Verified live: 1010 calls that each force a critical-latency anomaly cap `getAnomalies()`'s total stored count at exactly 1000. Purely in-memory — no real directory touched. Covered by a new dedicated `PerformanceMonitor anomaly capacity` suite (the raw class had no direct unit test before, only indirect coverage through `NeuroclawSystem`).

### `ChatGroup.messages` had no cap either — the sixth unbounded-growth fix this pass (Section 14)

`NeuroclawSystem.collaborate()` reuses one persistent `ChatGroup` instance for the process's entire lifetime, exactly like `SharedBlackboard`/`PredictionEngine`/`PerformanceMonitor` before it — and `post()` (called once per member on every `discuss()`, itself called once per `collaborate()`) pushed to a private `messages` array with no bound at all. Same family of bug, same fix: a FIFO cap.

Confirmed this is genuinely safe to cap: `decide()` never reads `messages` back in — its votes come from fresh `agent.process()` calls each time — and `discuss()` doesn't consult prior history either, so trimming old entries changes nothing about how the group actually decides anything. `getHistory()` is a plain audit trail, same as `SharedBlackboard.history()`, with no importance ranking to preserve.

Added a `messagesCapacity` (5000, matching the established precedent) and trim `messages` immediately after each `post()`. Verified live: 5010 posts cap `getHistory().length` at exactly 5000 with the oldest evicted first, and `decide()` still produces a correct, real trust-weighted tally after the churn. Purely in-memory — no real directory touched. Covered by a new dedicated `ChatGroup message history capacity` suite.

### `HyperDimensionalEngine` had three unbounded structures on the hottest live path in the system, and a config option that looks like it caps them but silently doesn't (Section 8)

`process()` runs on every live `NeuroclawLLM.generate()` call — every chat message through the CLI or web server — and grows three separate internal structures with no bound at all: `history` (a flat `StateTransition[]` log), each neuron's own `transitions` array, and `seenPatterns` (a `Map` used for novelty scoring). `llm.js` constructs the engine with `historyLength: 1000`, clearly intending to cap this growth — but the constructor only ever aliases `config.historyLength` into `noveltyWindow`, a millisecond recency-decay time constant used by `computeNoveltyScore()`, not an entry limit. Nothing anywhere in the file ever trims any of the three; the option that looks like a cap silently isn't one.

Confirmed exactly what's safe to bound before touching anything: `history` has zero readers anywhere in the file — pure accumulated dead weight since the class was written. `neuron.transitions` is read in exactly one place (`resolveStateTransitions()`'s `fromState` lookup), and only ever the *last* element — so trimming from the front is always safe as long as the tail survives, which a push-then-trim-from-front always guarantees. `seenPatterns` eviction here is by insertion order (first-seen), not true least-recently-used — an honest simplification stated as such, not a claim of LRU precision, matching the same plain-cap approach already used for `SharedBlackboard.log`.

Added `historyCapacity` (5000), `perNeuronTransitionsCapacity` (100 — sized to actual usage, since only the tail is ever read, not the flat-log convention used elsewhere), and `seenPatternsCapacity` (5000), each trimmed immediately after its respective push/set. One honest, bounded behavior change: `computeNoveltyScore()`'s recency/frequency blend means an exact rounded-float pattern hash that recurs *after* its `seenPatterns` entry has aged out of the 5000-entry window would read as fully novel instead of familiar on that one call — a correct, expected consequence of any bounded cache, not a routing or reasoning-quality change, and requires exact hash recurrence surviving a 5000-entry eviction window to ever manifest.

Verified live (isolated in-memory instance, no real directory involved): after 6000 `process()` calls with a low energy threshold to force maximal per-neuron transition accumulation, `history.length`/`seenPatterns.size` both cap at exactly 5000 and the per-neuron transitions cap at exactly 100; a further `process()` call afterward still produces sane, finite output (energy, novelty score, output vector) — confirming the caps don't destabilize the actual computation, unlike the earlier `MoE.tick()`/`NeuronMesh.propagate()` finding this pass. Covered by a new dedicated `Hyperdimensional history/transitions/seenPatterns capacity` suite.

### `NeuroPipeline.runHistory` was also unbounded — dormant today, but a real defect in an already-exposed public API (Section 7)

`NeuroPipeline.run()` pushed a `RunRecord` to `runHistory` on every call with no cap at all — the same unbounded-array pattern as the eight leaks already fixed this pass. Unlike those, this one is honestly dormant in the live system today: `run()`'s only caller is `NeuroclawRunner.continuousTick()`, itself only ever invoked by the interval loop `startContinuous()` registers — and `startContinuous()` has zero call sites anywhere in `index.ts`/`cli.ts`/`web-server.ts`. Still worth fixing: `startContinuous()` is a real, fully-built, publicly-exposed method (Section 7's continuous-operation mechanism), so the bug is genuine and would leak the moment anything actually calls it — the same category of "correct a real defect in a built feature" as `PlanTracker`'s cross-objective bug, just not currently triggered by the default flow.

One nuance this fix had to handle that the others didn't: `getStats().runsCount` is displayed by `cli.ts` as `"Pipeline: N runs"` — a lifetime counter. A plain FIFO trim on `runHistory` alone would make that counter silently plateau at the cap instead of reflecting the true total once counted runs exceed the window. Added a separate `totalRunsCount` field, incremented on every `run()` independently of the capped `runHistory` array (which now exists only to compute `avgDurationMs`/`stepBreakdown`'s recent-window averages) — so the displayed count stays a true lifetime total, and only the averaging window is bounded.

Verified live: after ~5008 total runs (a mix of directly-seeded history entries for speed, plus real `run()` calls exercising the actual live code path), `runHistory.length` caps at exactly 5000 while `getStats().runsCount` correctly reports 5008 — the true total, not the capped window size — and `avgDurationMs`/`stepBreakdown` stay finite and populated; `reset()` correctly zeroes both. Purely in-memory — no real directory touched. Covered by a new dedicated `Pipeline runHistory capacity` suite.

### `SystemAccess`'s own introspection was never surfaced anywhere, and the wiki documented tests that don't exist (Section 26)

`interface/main.ts`'s `buildCore()` constructs one real `SystemAccess` and threads it correctly into both the CLI (`cli.ts`'s `systemAccess` field) and the web backend (`NeuroclawRunner`) on the actual live path — but of its 7 public methods, only `getMultiDesktop()` was ever called. `getSystemInfo()` (a pure, side-effect-free introspection read) and `validateCapabilities()` (the class's own honest degrade-with-warnings self-check, gated behind config flags) had zero call sites anywhere in `cli.ts`/`web-server.ts`/`runner.ts`/`index.ts`, and zero test coverage.

Compounding this, `wiki/System-Access.md`'s "Verifying it" section claimed `npm test` covers `DesktopEnv` detection, `SystemControlHub` status/window queries, and `KeyboardControl`'s `press_key`/`type_text`/`mouse_move` — none of these classes or methods exist anywhere in the repository. The real classes are `SystemAccess`/`MultiDesktopManager`, and neither had any real test coverage before this fix.

Added a `SystemAccess:` line to `cli.ts`'s `printStatus()` (alongside the existing multi-desktop status block), surfacing `getSystemInfo()`'s real OS/terminal/file-access config and `validateCapabilities()`'s real warnings/errors. Both are safe to wire into a manually-invoked status display: `getSystemInfo()` has no side effects at all, and `validateCapabilities()`'s only side effect is the class's own designed self-check (`executeCommand('echo test')`, already gated behind `terminalAccess`) — nothing here touches `generate()`/`processQuery()`/`solve()` or changes chat/generation output. Deliberately *not* wired up: `executeCommand()` itself, which would give the CLI a live, callable shell-execution surface — a genuine capability/security decision, not a display fix, so left unimplemented pending explicit direction.

Verified live through the real `bootstrap()` composition root (not a hand-built CLI): the bootstrapped CLI carries a real `SystemAccess` instance, and `printStatus()` now prints real OS type, real terminal/file-access flags, and genuine validation warnings matching the actual sandboxed environment (GNOME/xinput unavailable, correctly reported rather than silently omitted). Also corrected the wiki's fictional test-coverage claim to describe what's actually verified today. Covered by an extension to the existing `App bootstrap` suite.

### `wiki/Multi-Input.md` carried the same fictional test-coverage claim just fixed in its sibling page (Section 17)

The immediately preceding fix corrected `wiki/System-Access.md`'s claim that `npm test` covers `DesktopEnv`/`SystemControlHub`/`KeyboardControl` — classes that don't exist anywhere in the repo — but `wiki/Multi-Input.md`, a second wiki page documenting the same `interface/multi-desktop.ts` module, carried the identical fiction verbatim (`WindowControl`, `KeyboardControl`, `press_key`/`type_text`/`mouse_move`, none of which exist). Corrected it to describe what's actually verified today: `SystemAccess`/`MultiDesktopManager` are only exercised indirectly (via `getMultiDesktop()`/`printStatus()`), and `MultiDesktopManager` itself — `VirtualDevice`/`DeviceBinding` creation, `getVirtualDevices()`/`getAllBindings()`, desktop exclusivity — has no direct unit coverage yet.

Doc-only change; no code, build, or test suite affected.

### `wiki/Quantum-Net.md`'s flagship code sample was entirely fictional (Section 18)

Every line of the `QuantumNeuralNet` TypeScript example was wrong: `calculateSignature()` is `private` (uncallable from outside the class); `encode()` doesn't exist anywhere in the class; `interfere()` takes two neuron-id strings, not two state objects; `collapse()` takes one neuron id and returns one number, not an array. The real public API — confirmed against `NeuroPipeline`'s actual live usage — is `addNeuron()`, `createSuperposition()`, `interfere(idA, idB)`, `phaseConsensus(ids)`, `groverAmplify(ids, targetId)`, `collapse(id)`, all id-based. Corrected the sample to match. Doc-only change; no code, build, or test suite affected.

### `learn()`'s skill/extension version history had no read/rollback method — the "reversed" half of a claim this session already made (Section 5)

`learn()` already snapshots every genuinely created skill/extension via `SelfImprovement.snapshot()`, keyed per name — the real "write" half of §5's "maintain versioned copies... so failed changes can be identified and reversed." But no `NeuroclawSystem` method ever read that history back: the only place it was ever checked was a test reaching directly into the internal `improvement` field (`sys.improvement.versionCount(...)`) — the identical ad hoc-verification anti-pattern already fixed once before for `planSummary()`. Meanwhile the structurally identical sibling case, `approachBiasMap`, already has a complete `rollbackApproachBias()` — a real asymmetry between two targets versioned through the exact same `SelfImprovement` mechanism.

Added `skillVersionCount(kind, name)` and `rollbackSkill(kind, name)`, mirroring `rollbackApproachBias()`'s structure. One honest difference from that sibling: `rollbackApproachBias()` re-applies the reverted state into `approachBiasMap`, a single live in-memory structure that directly drives future reasoning — there is no equivalent for a skill/extension (the actual file `pluginRegistry.dispatch()` already wrote to disk isn't touched here), so `rollbackSkill()` honestly returns the prior version's recorded metadata for the caller to act on, rather than claiming to silently undo a real file on disk. Purely additive introspection/rollback over an in-memory bookkeeping map — no new file/network access, no interaction with `generate()`/`processQuery()`/`solve()`'s output.

Verified live: a skill created through a real `learn()` call reports a version count of exactly 1 through the new method (matching the pre-existing internal check), a nonexistent skill reports 0, rollback correctly declines with fewer than 2 versions, and — after simulating a second real creation of the same skill (exactly what re-teaching an updated procedure later would produce) — rollback returns the genuine first version's data and the count correctly drops back to 1. Covered by an extension to the existing `testSkillCreationVersioning` suite.

### `README.md` claimed a stale smoke-check count

`README.md` stated `npm test` runs "262 smoke checks" — stale from before this session's ~360 additional checks. Corrected to the current real count (623). Doc-only change.

### `README.md` claimed the Node backend serves a file it never reads — then a follow-up fix overcorrected into a second false claim (Section 17)

`README.md` originally stated "the backend serves `interface/index.html`" in the section documenting `node dist/index.js web`. That specific claim was wrong: `web-server.ts`'s `GET /` handler serves a hardcoded `HTML_TEMPLATE` string literal (titled "Neuroclaw Terminal"), and `interface/index.html` is never read via any file-system call anywhere in `web-server.ts`/`runner.ts`.

The first fix corrected that, but overreached: it added "`interface/index.html` is a separate, unused legacy file — the live server never reads or serves it," and this file's own entry claimed its `/api/model`/`/api/systems` fetches would 404 if it were ever served. Both statements are false once `interface/server.py` — a second, real, independently-documented Python backend (`README.md`'s own "local browser chat backend" command, a few lines above the Node.js section) — is accounted for: `server.py`'s `do_GET` serves `interface/index.html` directly, handles `/api/model`/`/api/chat` itself, and proxies `/api/systems` (rewritten to the TS backend's own `/api/status`) plus `/api/plugins`/`/api/extension/*`/etc. to the same TS pipeline via `_PROXY_PATHS`. None of `index.html`'s fetches 404 — they're all genuinely served, just by the Python entry point rather than the Node one.

Corrected `README.md` again to describe both dashboards as independent, real, live things: the Node backend's own embedded `HTML_TEMPLATE`, and the Python backend's `interface/index.html`, backed by the same TS pipeline underneath either way. Doc-only change; no code, build, or test-suite impact. Recorded here plainly as a mistake in this session's own earlier fix, not just a historical drift — the same discipline already applied once before to the `createSelfExtension()` leak-fix verification incident.

### What this is, honestly

This is deterministic, local, token/structure-based reasoning and bookkeeping — not a claim of general intelligence or subjective understanding. It gives the system a real, testable **scaffold** for the behaviors §1–§13 describe (decompose, delegate, recall, avoid repeated mistakes, calibrate confidence, transfer structurally similar methods, improve only on measured gains) built out of the project's existing primitives (the Value System, the hive, long-term memory, the neural runner). Actual capability on any given problem is still bounded by what the underlying neural pipeline and MoE experts can do — this layer organizes and directs that capability rather than manufacturing new raw intelligence out of bookkeeping.
