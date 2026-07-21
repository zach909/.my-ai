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
- **Integration**: `NeuroclawSystem.executePlan(objective, steps)` (`index.ts`) runs each pending step through the real neural runner and **skips steps already completed in a prior call**. `autonomousTask()` goes further: it records the system's real operating constraint ("no external APIs"), and for every step delegated to the Hive Mind, a genuine **decision** naming which agent was chosen and why (role, trust) — or, on failure, an **alternative** worth trying next. These previously existed on `PlanTracker` but were never actually called from anywhere (a doc/code mismatch — this section claimed them covered before they were wired); `summary()` now surfaces all three, not just step checkmarks. Verified by the `RLM planning / PlanTracker (Section 10)` and `Integrated autonomous task (Section 27)` smoke suites, plus a live no-repeat check and a live `plan.summary()` showing the real constraint and per-step delegation decisions.

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

While auditing §12's "use learning to create skills, use skills to solve problems," a substantially bigger finding turned up than the usual "unused method": every skill `learn()` creates is written to `~/.neuroclaw/skills/*.neuri` by the real skill-maker plugin, but **nothing anywhere in the live system ever reads those files back**. `NeuroLangInterpreter.materialize()` — the mechanism that would compile NeuroLang source into live neurons — is itself never instantiated or called from `pipeline.ts`, `runner.ts`, or `index.ts` at all, only exercised in its own isolated unit tests. Concretely: the system can teach itself a skill, but that skill can never actually be *used* to solve a later problem — it becomes a permanently write-only file the moment it's created.

Genuinely closing that gap — loading a `.neuri` file back and materializing it into the live neural mesh/pipeline so future matching queries can actually invoke it — is a real architectural integration (how materialized neurons should interact with the existing MoE/mesh/hyperdimensional pipeline is a design question in its own right, not a single call site to wire), not a same-pattern-as-everything-else-this-session fix. Attempting it in one rushed pass risked either a cosmetic no-op or a real pipeline-stability risk, so it is recorded here honestly as an identified, real, larger gap rather than forced.

What *is* implemented now, safely and honestly scoped: `NeuroclawSystem.selfAuthoredSkills()` gives the system a real, live inventory of what it has actually taught itself — each skill's name and description, read back from its own file header — closing the "which skills it has" half of §9 that had no skill-level tracking at all (only domain-level competence via `SelfModel`). It explicitly does *not* claim those skills are materialized into active use; that remains the deferred piece above. Verified live and by the `Self-authored skills inventory (Section 9/12)` suite: teaching a distinctively-marked procedure twice creates a real skill file, and the inventory grows by exactly one entry with the correct name/description/path — not just a file silently written where nothing can ever find it again.

### What this is, honestly

This is deterministic, local, token/structure-based reasoning and bookkeeping — not a claim of general intelligence or subjective understanding. It gives the system a real, testable **scaffold** for the behaviors §1–§13 describe (decompose, delegate, recall, avoid repeated mistakes, calibrate confidence, transfer structurally similar methods, improve only on measured gains) built out of the project's existing primitives (the Value System, the hive, long-term memory, the neural runner). Actual capability on any given problem is still bounded by what the underlying neural pipeline and MoE experts can do — this layer organizes and directs that capability rather than manufacturing new raw intelligence out of bookkeeping.
