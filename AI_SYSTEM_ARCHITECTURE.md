# AI System Architecture

## Plugins (System Capabilities)
Plugins provide access to device hardware, system services, and external data sources.

- **Location plug in**: Access to GPS and location services
- **Camera plug in**: Access to device camera hardware
- **Microphone plug in**: Access to audio input hardware
- **Voice activation plug in**: Wake-word detection and voice triggering
- **Notifications plug in**: System notification management
- **Account info plug in**: User account and profile access
- **Contacts plug in**: Address book and contact management
- **Calendar plug in**: Schedule and event management
- **Phone calls plug in**: Telephony and call management
- **Call history plug in**: Call log access
- **Email plug in**: Email client integration
- **Tasks plug in**: Task and to-do list management
- **Messaging plug in**: SMS and messaging app integration
- **Radios plug in**: Bluetooth, NFC, and radio hardware access
- **Other devices plug in**: IoT and connected device management
- **App diagnostics plug in**: Application performance and error tracking
- **File system plug in**: Local storage and file access
- **Screenshots and screen recording plug in**: Screen capture capabilities
- **Passkeys plug in**: Authentication and passwordless login
- **Browser plug in**: Web browsing and rendering
- **Self heal plug in**: Automatic error recovery and system maintenance

## Skills (AI Mini-Models)
Skills are specialized AI mini-models that process information and execute tasks.

### Core Functional Skills
- **plug in maker skill**: Creates and configures new plugins
- **Skill maker skill**: Trains and deploys new AI mini-models
- **Coding skill**: Code generation, analysis, and debugging
- **Image skill**: Image processing, generation, and analysis
- **Video skill**: Video processing, generation, and analysis
- **Game skill**: Game logic, mechanics, and interactive experiences

### Programming Language Skills
Each programming language below represents a specialized AI mini-model trained to understand, generate, and debug code in that specific language:

#### A-G
ABAP, ActionScript, Ada, Agda, Alloy, AMPL, ANTLR, ApacheConf, Apex, API Blueprint, APL, AppleScript, Arc, Arduino, ASL, ASN.1, AspectJ, Assembly, ATS, AutoHotkey, AutoIt, Awk, Ballerina, Batchfile, Beef, Befunge, Berry, Bicep, Bison, BitBake, Blade, BlitzMax, Bluespec, Boo, Brainfuck, Brightscript, C, C#, C++, C-ObjDump, C2hs Haskell, Cap'n Proto, CartoCSS, Ceylon, Chapel, Charity, ChucK, Cirru, Clarion, Clarity, Clean, Click, Clojure, Closure Templates, Cloud Firestore Security Rules, CMake, COBOL, CodeQL, CoffeeScript, ColdFusion, Common Lisp, Component Pascal, Cool, Coq, Crystal, CSON, CSRTE, CSS, CSV, Cuda, CUE, Curry, CWeb, Cycript, Cython, D, Dafny, Darcs Patch, Dart, DataWeave, Debian Control file, DenizenScript, Dhall, Digital Command Language, Dingo, DirectWeb Remoting, DM, Dockerfile, Dogescript, DTrace, Dylan, E, Earthly, Easybuild, EBNF, eC, Ecere Projects, ECL, ECLiPSe, EditorConfig, Edje Data Collection, Eiffel, EJS, Elixir, Elm, Elvish, Emacs Lisp, Emerald, Erlang, Escher, EUC, Euphoria, Eureka, F#, F*, Factor, Fancy, Fantom, Faust, Fennel, Filebench WML, Filterscript, fish, Fluent, FLUX, Forth, Fortran, FreeMarker, Freemodbus Asm, Futhark, G-code, Game Maker Language, GAML, GAMS, GAP, GCC Machine Description, GDB, GDScript, Gedcom, Gemini, Genie, Genshi, Gentoo Ebuild, Gerber Image, Gherkin, Git Attributes, Git Config, GLSL, Glyph, Gnuplot, Go, Golo, Gosu, Grace, Gradle, Graffle, GraphQL, Graphviz (DOT), Groovy, Groovy Server Pages, GSC, Hack, Haml, Handlebars, Harbour, Haskell, Haxe, HCL, HLSL, HolyC, HTML, HTTP, Huff, Hxml, Hy, HyPhy

#### H-R
IDL, Idris, Ignore List, Igor Pro, ImageJ Macro, Inform 7, INI, Inno Setup, Io, Ioke, IRC log, Isabelle, J, JANET, JAR Manifest, Jasmine, Java, Java Properties, Java Server Pages, JavaScript, JFlex, Jinja, Jison, Jison Lex, Jolie, JSON, JSON with Comments, JSON5, JSONLD, JSONiq, Jsonnet, Julia, Jupyter Notebook, Just, KRL, Kaitai Struct, KakouneScript, Kerboscript, KiCad Layout, KiCad Legacy Schematic, KiCad Schematic, Kit, Kotlin, Kusto, LFE, LabVIEW, Lark, Lasso, Latte, Lean, Less, Lex, LHE, LilyPond, Limbo, Linker Script, Linux Kernel Module, Liquid, Literate Agda, Literate CoffeeScript, Literate Haskell, LiveScript, LLVM, Logos, Logtalk, LOLCODE, LookML, LoomScript, LSL, Lua, Luau, M, M4, M4Sugar, Macaulay2, Makefile, Mako, Markdown, Marko, Mask, Mathematica, MATLAB, Max, MAXScript, MCFunction, MDX, Mercury, Mermaid, Meson, Metal, Microsoft Developer Studio Project, MiniD, MiniYAML, Mint, Mirah, mIRC Script, MLIR, Modelica, Modula-2, Modula-3, Module Management System, Monkey, Monkey C, Moocode, MoonScript, Motoko, Motorola 68K Assembly, Move, MQL4, MQL5, MTML, MUF, mupad, Mustache, Myghty, nanorc, Nasal, NASL, NCL, Nearley, Nemerle, neon, nesa, NetLinx, NetLinx+ERB, NetLogo, NewLisp, Nextflow, Nginx, Nim, Ninja, Nit, Nix, NL, NPM Config, NSIS, Nu, NumPy, Nunjucks, NWScript, Oatmeal, ObjDump, Object Data Instance Text, Objective-C, Objective-C++, Objective-J, ObjectScript, OCaml, Odin, Omgrofl, ooc, Opa, Opal, Open Policy Agent, OpenAPI Specification v2, OpenAPI Specification v3, OpenCL, OpenEdge ABL, OpenRC runscript, OpenSCAD, OpenStep Property List, OpenType Feature File, Option List, Org, Ox, Oxygene, Oz, P4, PACT Compiler, Pan, Papyrus, Parrot, Parrot Assembly, Parrot Internal Representation, Pascal, Pawn, PDDL, PEG.js, Pep8, Perl, PHP, Pic, Pickle, PicoLisp, PigLatin, Pike, PINS, PLSQL, PLpatch, Ploy, Pod, Pod Markdown, PogoScript, Polar Code, Pony, Portfile, PostCSS, PostScript, POV-Ray SDL, PowerBuilder, PowerShell, Prisma, Processing, Procfile, Product Spec, Proguard Ruleset, Prolog, Promela, Propeller Spin, Protocol Buffer, Public Key, Pug, Puppet, Pure Data, PureBasic, PureScript, Pyret, Python, Python traceback, q, QMake, QML, Qt Script, Quake, R, Racket, Ragel, Raku, RAML, Rascal, Raw token data, RDoc, READ_ME, RealBasic, Reason, ReasonLIGO, Rebol, Record Jar, Red, Redcode, Regular Expression, Ren'Py, RenderScript, ReScript, reStructuredText, REXX, Ring, Riot, RMarkdown, RobotFramework, Roff, Roff Manpage, Rouge, Router Log, RPC, RPM Spec, Ruby, RUNOFF, Rust

#### S-Z
Sage, SaltStack, SAS, Sass, Scala, Scaml, Scenic, Scheme, Scilab, SCSS, sed, Self, SEPlib, ShaderLab, Shell, ShellCheck Config, Shen, Sharlight, Sieve, Signal Processing, Singularity, SketchUp Ruby, Slang, Slice, Slim, Smali, Smalltalk, Smarty, SMT, Smithy, SmPL, SML, Solidity, Soong, SourcePawn, SPARQL, SPHINX, Spline Font Database, SQF, SQL, SQLPL, Scribe, Ssh Config, Stan, Standard ML, Starlark, Stata, STC, Stonescript, Stylus, SubRip Text, SugarSS, SuperCollider, Svelte, SVG, Sway, Sweave, Swift, SWIG, SystemVerilog, TADS, TAL, Tcl, Tcsh, Tea, Terra, TeX, Texinfo, Text, TextMate Properties, Textproto, Thritt, Tichu, TI Program, TLA, Toit, TOML, TSX, Turing, Turtle, Twig, Type Language, TypeScript, Unified Parallel C, Unity3D Asset, Unix Assembly, Uno, UnrealScript, UrWeb, V, Vala, Valve Data Format, VBA, VBScript, VCL, Velocity, Verilog, VHDL, Vim Help File, Vim Script, Vim Snippet, Visual Basic .NET, Visual Basic 6, Volt, Vue, Vyper, Wavefront Material, Wavefront Object, WDTE, Web Ontology Language, WebAssembly, WebIDL, WebVTT, Wenyan, Whitespace, WGSL, Whois Response, Wiki, Witch Hazel, Wizzardo-HTTP, Workflow, Wren, WSIL, WXWidgets, X10, xBase, XBitMap, XC, XCompose, XFontish, XGettext, XHTML, XML, XML Property List, Xojo, Xonsh, XPages, XPixMap, XProc, XQuery, XS, XSLT, Xtend, Yacc, YAML, YANG, YARA, YASnippet, Yul, ZAP, Zeek, ZenScript, Zephir, Zig, Zil, Zimpl, Zsh

## System Overview
This architecture separates **capabilities** (Plugins) from **intelligence** (Skills). Plugins provide the tools and data access, while Skills are the AI mini-models that decide how to use those tools to accomplish tasks.
