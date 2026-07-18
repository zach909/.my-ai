# Extension Builder

The Extension Builder is where a user (or the AI itself, via the Plugin Builder / Skill Builder skills — see [[Skills]]) creates, connects, and installs new neural behaviour — the design notes' "Save projects without quantization. Install projects using quantization." plus the visual drag-and-connect editor.

## Overview

**Purpose**: Turn a declarative spec (drag-and-connect neurons, or a [[NeuroLang]] program) into trained weights, saved editable, then installed compressed.

Like the mesh itself, there are two real, connected implementations:

| Layer | File | What it is |
|---|---|---|
| TypeScript runtime backend | `extension-builder/builder.ts` — `ExtensionBuilder` | Project/neuron/connection CRUD, Net Search, Code-to-Net, save/install |
| React visual editor | `src/features/builder/builder-canvas.tsx` + `use-builder.ts` | The actual drag-and-connect canvas — pointer-drag to move, click-click to connect, HTML5-drag to attach a label, click a connection's weight to delete it |
| Python training core | `model && skills manager/tinygpt/extension_builder.py` — `ExtensionBuilder`, `Definishon` | Trains **contracts** (`when X then Y`) into a real mesh via gradient descent, then saves/installs |

## The visual editor (drag-and-connect)

`builder-canvas.tsx` implements every Extension Builder feature from the design notes directly against the real engine (not a mock):

- **Drag to arrange**: `onPointerDown`/`onPointerMove` write positions back through `engine.moveNeuron`.
- **Connect mode**: click a source neuron, then a target — installs a real weighted connection (rendered as an SVG curve labeled with its weight; click the label to delete it).
- **Drag labels between neurons**: HTML5 drag-and-drop of a label chip onto a node calls `engine.dragLabel` — the spec's literal "drag labels between neurons."
- **Search neurons**: matches are highlighted with a ring on the canvas (`searchMatches`).
- **Simulate a neuron's output**: `typeModelOutput` — feed one input value into one neuron and see what it produces, without running the whole mesh.
- **API-capable output layers**: `addOutputLayer` with an `APIOutputConfig` (endpoint/method/port/auth) turns a neuron's activation into a call to a local endpoint — gated through the alignment veto, never external.

## Save vs. install (`ExtensionBuilder`, TypeScript)

```typescript
builder.saveWithoutQuantization(projectId);      // exact weights, still editable
builder.installWithQuantization(projectId, { bits: 8, ... });  // compressed, deployment-ready
```

This is the direct implementation of "Save projects without quantization. Install projects using quantization." — a project stays full-precision and editable until you're ready to deploy it, at which point installing quantizes it (see [[Quantization]]).

## Training contracts (`ExtensionBuilder`, Python)

```python
from tinygpt.extension_builder import Definishon, ExtensionBuilder

eb = ExtensionBuilder(mesh, tokenizer, device="cpu")
contracts = [Definishon(when="greeter", then="hello there")]
eb.save_project("greeter.ext", contracts)          # exact, editable
eb.install("greeter.install.ext", contracts, bits=8)  # quantized, smaller on disk
```

`eb.train(contracts, ...)` actually trains the mesh with gradient descent until each contract's constraint loss drops below tolerance (or the epoch budget runs out); satisfied contracts are the mesh's own [[Elastic-Value-Budget]] locking in via `raise_vale()`. This is also the real mechanism behind the **Skill Builder** skill (`build_skill()`, see [[Skills]]) — building an extension and building a new skill are the same operation, just registered differently afterward.

## Net Search & Code-to-Net

- **Net Search** (`netSearch` / `netSearchGenerate` in TS, `NetSearchManager` in Python's `neurolang.py`): semantic search across neural definitions, then trains a small retrieval net and wires a new `netsearch`-type neuron to each match with a weighted edge.
- **Code-to-Net** (`importCodeToNet` in TS, `train_codenet` in Python's `neurolang.py`): imports source or binary code and converts it into an equivalent neural network — function approximation when the code defines a numeric function.

## Verifying it

- `python main.py demo` (`test_integration.py`, §3) saves a project un-quantized, installs it quantized, confirms the installed file is smaller, and reloads the installed extension into a **fresh** model object to prove the behaviour genuinely persisted rather than surviving in memory.
- `npm test` (`test/smoke.mjs`)'s "Extension Builder flow" section covers drag-connect, drag-label, simulate, output layers, Net Search (including the null-result edge cases for an empty or untokenizable query), and the save-vs-install size/behaviour distinction directly.

## See Also

- [[Home]] - Main wiki page
- [[NeuroLang]] - The DSL that can drive the builder as text instead of drag-and-connect
- [[Quantization]] - What "install" actually does to the weights
- [[Skills]] - Skill Builder / Plugin Builder, which call this machinery programmatically
- [[Code-to-Net]] - Importing existing code as a neural network
- [[Net-Search]] - Semantic search over neural definitions

---

*The Extension Builder is how a taught behaviour becomes a permanent, installable part of the mesh — save it exact, install it compressed.*
