# Extension Builder — Implementation Specification

Status: specification (formalizes and extends the existing prototype in
`extension-builder/`, `src/features/builder/`, `plugin_manager/`, and
`model && skills manager/tinygpt/extension_builder.py`; see `wiki/Builder.md`
for the narrative overview). This document is the build-out plan for the
gaps: file format, packaging/installation, debugging, search, and testing.

## 0. What already exists vs. what this spec adds

| Area | Exists today | This spec formalizes |
|---|---|---|
| Neuron-graph engine | `extension-builder/builder.js` (`ExtensionBuilder`) | Versioned `.extproj` / `.ext` file format, schema validation |
| Visual editor | `src/features/builder/builder-canvas.tsx` (pointer-drag, click-connect, HTML5 label drag) | Selection, undo/redo, minimap, multi-select, keyboard nav |
| Drag-and-drop | Native HTML5 DnD for labels only | Full node palette → canvas DnD (`@dnd-kit/core`, already a dependency, currently unused) |
| Graph editor | SVG curves, ad-hoc layout | Formal graph editor contract (below), layered rendering, viewport |
| Search | `NetSearchEngine` (exact/semantic/neural/structural), `searchNeurons` | Unified in-canvas command palette, cross-project search index |
| Debugging | `typeModelOutput` (single-neuron simulate) | Full debugger: breakpoints, step propagation, activation inspector, time-travel |
| Quantization | `installWithQuantization({bits})`, Python QAT mesh | Formal pipeline stages, calibration data, error budget reporting |
| Packaging | `saveWithoutQuantization` / `installWithQuantization` write JSON | `.extpkg` package format, manifest, signing, dependency resolution |
| Installation | `install_extension()` (Python round-trip) | Install targets (mesh runtime, plugin registry, MoE expert slot), rollback |
| APIs | `ExtensionBuilder` class methods (JS/Python), `ExtensionManifest` type | Stable public TS API surface + REST/IPC surface for `desktop-app` |
| File format | Ad-hoc JSON (`demo_extension.json`, `.net.json`, `.ext.json`) | One versioned JSON Schema family, documented below |
| Testing | `test/smoke.mjs`, `test_integration.py`, `test_core.py` | Full test matrix: unit, integration, golden-file, fuzz, perf |

---

## 1. Visual editor

### 1.1 Scope
`src/features/builder/builder-canvas.tsx` renders one `ProjectData` (neurons,
connections, layers, labels) against a live `ExtensionBuilder` engine
instance (`use-builder.ts`). This spec extends it into a full editor without
changing the underlying engine contract.

### 1.2 Component architecture

```
src/features/builder/
  builder-canvas.tsx        # existing: SVG canvas, pointer/DnD handlers
  use-builder.ts             # existing: engine binding + React state
  index.ts                   # existing: public export
  panels/
    node-palette.tsx         # NEW: draggable node-type list (neuron, codenet, netsearch, output)
    inspector-panel.tsx      # NEW: selected node/edge property editor
    minimap.tsx              # NEW: viewport overview + click-to-pan
    search-bar.tsx           # NEW: command palette (§4)
    debug-panel.tsx          # NEW: breakpoints, activation trace (§5)
    neurolang-panel.tsx      # NEW: text ⇄ graph sync editor (parse/export)
  hooks/
    use-selection.ts         # NEW: multi-select, marquee-select
    use-history.ts           # NEW: undo/redo command stack
    use-viewport.ts          # NEW: pan/zoom transform
  builder-layout.tsx          # NEW: composes canvas + panels into one screen
```

### 1.3 Interaction model (additions to the existing canvas)

- **Selection**: click selects one node/edge; shift-click adds; drag on empty
  canvas draws a marquee rectangle selecting all nodes it intersects.
  Selection state lives in `use-selection.ts`, keyed by `NeuronData['id']` /
  `ConnectionData['id']`.
- **Undo/redo**: every mutating engine call (`addNeuron`, `connectNeurons`,
  `moveNeuron`, `deleteNeuron`, `dragLabel`, …) is wrapped in a `Command`
  object `{ do(), undo(), label }` pushed onto `use-history.ts`'s stack.
  Ctrl/Cmd+Z / Shift+Ctrl/Cmd+Z. Move commands coalesce while a drag is in
  progress (one undo step per drag, not per pointermove frame).
- **Pan/zoom**: `use-viewport.ts` holds `{x, y, scale}`; wheel = zoom
  (clamped 0.25×–3×), space+drag or middle-mouse = pan. Node screen
  coordinates = `worldToScreen(node.x, node.y, viewport)`.
- **Keyboard**: `Delete`/`Backspace` deletes selection, arrow keys nudge
  selected nodes by 1px (10px with Shift), `Escape` clears selection/cancels
  connect-mode, `Ctrl/Cmd+D` duplicates selection.
- **Minimap**: renders all node positions at fixed scale in a corner overlay;
  click/drag on it pans the main viewport.

### 1.4 Rendering contract

The canvas is a pure function of `ProjectData` + `viewport` + `selection` +
`debugState` (§5). No component reads engine internals directly except
through `BuilderApi` (`use-builder.ts`); this keeps the engine swappable
(e.g., a future WASM-compiled `builder.js`) without touching the UI layer.

---

## 2. Drag-and-drop interface

### 2.1 Two distinct DnD systems (keep them separate)

1. **Palette → canvas** (NEW): dragging a node-type chip from
   `node-palette.tsx` onto the canvas creates a node at the drop position.
   Implemented with `@dnd-kit/core` (already installed, currently unused —
   this is its first real use in the repo):
   - `DndContext` wraps `builder-layout.tsx`.
   - Each palette chip is a `useDraggable` with `data: { nodeType: 'neuron' | 'codenet' | 'netsearch' | 'output' }`.
   - The canvas SVG root is a `useDroppable`; on drop, convert the pointer
     event's screen coords through `screenToWorld(viewport)` and call
     `engine.addNeuron` / `addCodeNet` / `addNetSearch` / `addOutputLayer`
     at that position.

2. **Label → node** (EXISTING, unchanged): native HTML5
   `draggable`/`ondragover`/`ondrop` on label chips, calling
   `engine.dragLabel(projectId, neuronId, label)`. Left as-is since it
   already matches the spec's literal "drag labels between neurons."

### 2.2 Node-palette contents

| Chip | Engine call on drop |
|---|---|
| Neuron | `addNeuron(projectId, name, value, position)` |
| Code-to-Net | opens a code-paste modal, then `addCodeNet(projectId, name, code, position)` |
| Net Search | opens a query modal, then `addNetSearch(projectId, name, corpus, query, netPath, position)` |
| Output Layer (API) | opens an `APIOutputConfig` form, then `addOutputLayer(projectId, name, config, position)` |
| Layer group | `addLayer(projectId, name, type)` — visually a dashed bounding box a user can drag nodes into |

### 2.3 Connection drag

Existing click-click connect mode is retained as the primary path (works on
touch devices where drag-to-connect is unreliable). Add an optional
drag-from-port mode: pointer-down on a node's right edge starts a rubber-band
line; releasing over another node calls `connectNeurons` with a default
weight of `0.5`, opening the inspector panel to edit it immediately.

---

## 3. Neural graph editor

This is the semantic layer on top of §1/§2 — what the graph *means*, not how
it's drawn.

### 3.1 Data model (unchanged, formalized)

Already defined in `extension-builder/builder.d.ts`:
`NeuronData`, `ConnectionData`, `LayerData`, `LabelData`, `ProjectData`. This
spec does not change these types — it specifies the file format they
serialize to (§8) and the operations that mutate them (already implemented
as `ExtensionBuilder` methods).

### 3.2 Graph invariants (enforced by the engine, verified by tests §11)

- Every `ConnectionData.fromId`/`toId` must reference an existing `NeuronData.id` in the same project — `connectNeurons` returns `false` and does not mutate state otherwise.
- `NeuronData.id` is unique within a project; `neuronCounter` guarantees monotonic, collision-free IDs within one engine instance.
- Deleting a neuron (`deleteNeuron`) cascades to delete every connection referencing it — no dangling edges.
- A `netsearch`-type neuron's `netSearchGenerate` wiring is additive-only: it never removes existing edges, only adds new weighted ones to matches.
- Layers (`LayerData.neurons: string[]`) are a display/organizational grouping, not a topology constraint — a neuron may belong to zero or one layer; deleting a layer does not delete its neurons.

### 3.3 NeuroLang round-trip

`parseNeuroLang` / `exportToNeuroLang` must be inverses up to formatting:
`exportToNeuroLang(parseNeuroLang(exportToNeuroLang(p)))` reproduces the same
graph (node names, values, vale, connections, definitions) as
`exportToNeuroLang(p)` for any project `p`. This is the mechanism that keeps
the visual editor and the `neurolang-panel.tsx` text view in sync — edits in
either one flow through the same engine state, never a separate text buffer.

### 3.4 Simulation vs. full propagation

`typeModelOutput(projectId, neuronId, inputValue)` (existing) is a *local*
simulation: one input into one neuron, ignoring the rest of the mesh. This
spec adds a *graph-level* propagation mode for the debugger (§5): given a set
of input values on input-layer neurons, propagate activations edge-by-edge
in topological order and report every neuron's resulting value — this is
read-only against the visual project (it does not require the Python mesh)
and exists purely to let a builder preview behavior before training/install.

---

## 4. Search

Two layers, matching what exists (`wiki/Net-Search.md`) plus a UI layer that
doesn't yet exist.

### 4.1 In-project structural search (existing, keep)

`searchNeurons(projectId, query)` / `NetSearchEngine`'s four modes
(exact/semantic/neural/structural) are unchanged. The canvas already
highlights matches with a ring (`searchMatches`).

### 4.2 Command palette (NEW — `search-bar.tsx`)

`Ctrl/Cmd+K` opens a single search box over the canvas that fans out to:
- **Node search** — `searchNeurons`, jumps the viewport to the match and selects it.
- **Command search** — fuzzy-matched actions ("Add Neuron", "Install with Quantization", "Export NeuroLang", "Open Debugger").
- **Cross-project search** — searches saved `.extproj` files on disk (via the installation/packaging layer, §7) by name/description, opens the match as a new project tab.

### 4.3 Net Search as a graph operation (existing, keep)

`netSearchGenerate(projectId, query, topK)` remains the mechanism for
turning a search into a permanent `netsearch`-type neuron wired to its
matches — this is a *content* operation on the graph, distinct from the UI
search in §4.2 which only navigates/filters the existing view.

---

## 5. Debugging

New capability — nothing like this exists in the prototype yet beyond
single-neuron `typeModelOutput`.

### 5.1 Debug panel (`debug-panel.tsx`)

- **Breakpoints**: toggle on any neuron; during propagation (§3.4) or a live
  install-time forward pass, execution pauses when a breakpointed neuron's
  value is about to be written, and the panel shows the incoming edges, each
  contributing `(fromValue * weight + bias)` term, and the running sum.
- **Step propagation**: advance the topological-order propagation one neuron
  at a time (`Step Into`) or one full layer at a time (`Step Over`), with the
  canvas highlighting the "current" neuron.
- **Activation inspector**: hovering/selecting any neuron shows its current
  `value`, `vale` (stability), `trained`/`trainedWeights` status, and (once
  quantized) its quantization error contribution (§6.4).
- **Time-travel**: every propagation step and every undo/redo-tracked graph
  edit is recorded in `use-history.ts`; the debug panel can scrub backward
  through either stream independently (graph-structure history vs.
  activation-trace history are separate timelines — editing the graph mid
  debug session doesn't discard the trace, it just marks it stale).

### 5.2 Non-visual debugging (engine-level, for CI and Python side)

- `ExtensionBuilder.getStats(projectId)` (existing) — cheap sanity counts, asserted in tests after every mutating sequence.
- New `explainConnection(projectId, connectionId)`: returns `{from, to, weight, bias, contribution}` given the current neuron values — the programmatic form of the inspector, usable from `test/smoke.mjs` without a browser.
- Python side (`tinygpt/extension_builder.py`): `eb.train(..., verbose=True)` already narrates loss per epoch (per `wiki/Builder.md` §"Training contracts"); this spec adds `eb.train(..., trace=True)` returning the full per-epoch loss/quantization-error series for offline plotting, rather than only printing it.

### 5.3 Error surfacing

`parseNeuroLang` already returns `{success, errors}` — the NeuroLang panel
renders `errors` as inline gutter markers keyed to source line/column
(NeuroLang's line-oriented syntax makes this a direct line-number mapping,
no separate source-map layer needed).

---

## 6. Quantization pipeline

Formalizes what `installWithQuantization` / Python `eb.install(bits=)` /
the QAT mesh (`wiki/Quantization.md`) already do, as a named pipeline with
explicit stages so packaging (§7) has a stable contract to call into.

### 6.1 Stages

```
 [1] Validate      — project has ≥1 neuron, no dangling connections (§3.2)
 [2] Snapshot       — saveWithoutQuantization(projectId) → exact JSON, untouched afterward
 [3] Calibrate       — (Python) run the trained mesh forward over representative
                        inputs to measure per-layer activation ranges; (TS structural
                        path) skipped — TS graphs quantize weights directly, no activation calibration needed since there's no trained forward pass at that layer
 [4] Quantize        — fake-quant → real quant: weights mapped to `bits`-width
                        integers with a symmetric scale factor per tensor
                        (existing `_fake_quant` in `tinygpt/mesh.py`; TS side
                        rounds `ConnectionData.weight`/`bias` to the requested
                        precision)
 [5] Error report    — quantization_error() (Python, existing) / new TS
                        `quantizationErrorReport(projectId)` — mean abs
                        difference between original and quantized weights,
                        surfaced to the user before finalizing install
 [6] Package         — wrap the quantized weights + manifest into the file
                        format (§8) / package format (§7)
```

### 6.2 Bit-width options

`{bits: 4 | 8 | 16}`. 4-bit matches NeuroLang's documented default ("Zipped
version is quantized (4-bit)" — `wiki/NeuroLang.md`); 8-bit is the
`ExtensionBuilder.installWithQuantization` default used in existing demos;
16-bit is a "mostly full precision, still smaller" option for
quantization-sensitive extensions. The pipeline rejects any other value with
a clear error rather than silently clamping.

### 6.3 QAT vs. post-hoc quantization

Per `wiki/Quantization.md`, the Python mesh trains *with* fake-quantization
already in the loop (`_fake_quant`, straight-through estimator), so install-time
quantization (`eb.install(bits=)`) is compressing weights the model already
learned to be robust to — this spec does not change that design, it only
requires stage 5 (error report) to be surfaced back to the caller/UI instead
of only asserted in tests, so a builder can see the actual cost of a given
bit width before committing to `install()`.

### 6.4 Reporting contract

```ts
interface QuantizationReport {
  bits: 4 | 8 | 16;
  meanAbsWeightError: number;
  maxAbsWeightError: number;
  originalSizeBytes: number;
  quantizedSizeBytes: number;
  compressionRatio: number;   // originalSizeBytes / quantizedSizeBytes
}
```

`installWithQuantization` returns this alongside the installed path (a
breaking-but-additive change: existing callers using the string return value
keep working if the method resolves to `{path, report}` and truthy checks
switch to checking `.path`; see §9 API versioning note).

---

## 7. Packaging

New — the prototype writes loose JSON files (`demo_extension.json`,
`*.ext.json`) with no package boundary, dependency list, or signature.

### 7.1 Package format: `.extpkg`

A `.extpkg` file is a **zip archive** (matching NeuroLang's own "all
components and words are zipped" design note) containing:

```
mypackage.extpkg
├── manifest.json          # ExtensionManifest (§9.1) — required
├── project.ext.json        # quantized ProjectData (§8.2) — required
├── project.exact.json      # optional: the un-quantized save, if the author
│                            #   chooses to ship editable source alongside
├── neurolang.nl             # optional: exportToNeuroLang() text form, for
│                            #   human review without a graph viewer
├── assets/                  # optional: icons, README, screenshots
└── SIGNATURE                # optional: detached signature over the above (§7.4)
```

### 7.2 Build step (`extension-builder/package.ts` — NEW)

```ts
async function packageExtension(
  projectId: string,
  builder: ExtensionBuilder,
  opts: { bits: number; manifest: Omit<ExtensionManifest, 'id'>; includeExact?: boolean; sign?: KeyPair },
): Promise<{ path: string; manifest: ExtensionManifest; report: QuantizationReport }>
```

Steps: run the quantization pipeline (§6) → write `project.ext.json` →
optionally copy the exact save → write `manifest.json` (id derived from a
content hash of the quantized project, per `wiki/Code-to-Net.md`'s existing
convention of SHA-256-prefixed identity) → zip → optionally sign (§7.4).

### 7.3 Dependency resolution

`ExtensionManifest` gains an optional field:

```ts
dependencies?: { id: string; versionRange: string }[];  // semver range, e.g. "^1.2.0"
```

At install time (§ below), each dependency is resolved against already
installed extensions in the plugin registry; a missing or version-mismatched
dependency fails installation with a specific error rather than partially
installing. No transitive network fetch — dependencies must already be
present or bundled in a `deps/` folder inside the `.extpkg` (offline-first,
matching "no external APIs" elsewhere in this system per `wiki/Net-Search.md`).

### 7.4 Signing (optional, off by default)

Ed25519 detached signature over the SHA-256 of every file in the archive
except `SIGNATURE` itself. Verifying a signature is required before
installing an extension whose manifest declares `permissions` beyond a safe
default set (anything touching `camera`, `microphone`, `file-system`,
`coding`, etc. from `ExtensionPermission`); unsigned packages requesting
those permissions install only behind an explicit user confirmation, never
silently.

---

## 8. File format

One versioned JSON Schema family. All existing ad-hoc formats
(`demo_extension.json`, `*.net.json`, `*.ext.json`) map onto this cleanly —
this is a formalization, not a breaking rewrite of on-disk data.

### 8.1 Common envelope

Every top-level file (project save, installed extension, manifest) starts with:

```json
{
  "$schema": "https://internal/schemas/extension-builder/v1/<kind>.json",
  "formatVersion": 1,
  "kind": "project" | "installed-extension" | "manifest",
  ...
}
```

`formatVersion` is an integer, bumped on any breaking change to that kind's
shape; readers reject unknown `formatVersion` values with a clear "upgrade
your builder" error rather than guessing.

### 8.2 `project` (exact / editable — `saveWithoutQuantization` output)

```json
{
  "$schema": "…/v1/project.json",
  "formatVersion": 1,
  "kind": "project",
  "id": "string",
  "name": "string",
  "description": "string",
  "dims": 0,
  "createdAt": 0,
  "updatedAt": 0,
  "neurons": [ { "id": "…", "name": "…", "type": "neuron|codenet|netsearch|output", "value": 0, "dims": 0, "definition": "…", "code": "…", "corpus": "…", "netPath": "…", "query": "…", "x": 0, "y": 0, "vale": 0, "endpoint": "…", "method": "…", "external": [], "trained": false } ],
  "connections": [ { "id": "…", "fromId": "…", "toId": "…", "weight": 0, "bias": 0 } ],
  "layers": [ { "id": "…", "name": "…", "type": "input|hidden|output", "neurons": ["…"] } ],
  "labels": [ { "id": "…", "text": "…", "x": 0, "y": 0 } ]
}
```

Maps in `ProjectData` (`Map<string, NeuronData>` etc.) serialize as arrays —
`Map` isn't JSON-native; the loader rebuilds the `Map` keyed by each item's
`id`. `trainedWeights?: Float32Array` is omitted from `project` (exact saves
are pre-training-lock topology/config, not weights) and only appears in
`installed-extension`.

### 8.3 `installed-extension` (quantized — `installWithQuantization` output)

Same shape as `project`, plus:

```json
{
  "quantization": { "bits": 8, "report": { "meanAbsWeightError": 0, "maxAbsWeightError": 0, "originalSizeBytes": 0, "quantizedSizeBytes": 0, "compressionRatio": 0 } },
  "neurons": [ { "...": "as above", "trainedWeights": "base64(Float32Array-of-quantized-values)" } ]
}
```

`trainedWeights` is base64-encoded rather than a raw JSON number array to
keep quantized installs measurably smaller than exact saves (the concrete,
already-tested property from `wiki/Quantization.md`: "confirms the installed
file is measurably smaller on disk").

### 8.4 `manifest` (package metadata — `ExtensionManifest`, extended)

```json
{
  "$schema": "…/v1/manifest.json",
  "formatVersion": 1,
  "kind": "manifest",
  "id": "string (content-hash-derived)",
  "name": "string",
  "version": "semver string",
  "description": "string",
  "permissions": ["camera", "…"],
  "author": "string",
  "homepage": "string?",
  "entrypoint": "string (path inside package to project.ext.json)",
  "apiEndpoints": [ { "path": "…", "method": "GET|POST|PUT|DELETE|PATCH", "description": "…", "inputSchema": {}, "outputSchema": {} } ],
  "dependencies": [ { "id": "…", "versionRange": "…" } ]
}
```

This is `plugin_manager/types.ts`'s existing `ExtensionManifest` plus
`dependencies` (§7.3) and the common envelope fields — additive, no field
renamed or removed.

### 8.5 Schema files

Add `docs/schemas/extension-builder/v1/{project,installed-extension,manifest}.schema.json`
(JSON Schema draft 2020-12). Both the TS engine (via `ajv` at save/load time
in dev/test builds) and the Python core (via `jsonschema`) validate against
the same files — one schema, two runtimes, checked in CI (§11.4).

---

## 9. APIs

### 9.1 TypeScript public surface (stable, versioned)

`ExtensionBuilder` (`extension-builder/builder.d.ts`, already the de facto
public API) is the contract. This spec:
- Freezes its existing method signatures as v1 (already exercised by
  `test/smoke.mjs` and `use-builder.ts`; no changes needed there).
- Adds the new methods introduced above as additive v1.x members:
  `explainConnection`, `quantizationErrorReport`, `packageExtension` (may
  live in a sibling module `extension-builder/package.ts` rather than on the
  class itself, to keep `ExtensionBuilder` focused on graph CRUD).
- Publishes `extension-builder/builder.d.ts` as the package's type entry so
  `desktop-app` and any future external consumer gets full typing without
  reaching into internals.

### 9.2 Python public surface

`tinygpt/extension_builder.py`'s `ExtensionBuilder`/`Definishon`,
`build_skill`, `build_plugin`, `learn_and_extend`, `install_extension`
(all existing, per `wiki/Extensions.md`) remain the Python-side contract
unchanged. This spec adds a `trace=True` kwarg to `train()` (§5.2) as the
only Python API addition.

### 9.3 Plugin/skill registration API (bridge to `plugin_manager/`)

Installing an extension (§10) must produce exactly one of:
- a `PluginDefinition` registered via `PluginRegistry.register()` (plugin extensions), or
- a `SkillDefinition` registered via `PluginRegistry.registerSkill()` (skill extensions),

per the existing split documented in `wiki/Extensions.md` §"An extension is
one of two things." The installer (§10.2) decides which based on
`manifest.permissions` containing `plugin-maker`/being a service connector
vs. carrying trained NeuroLang contracts.

### 9.4 HTTP/IPC surface (for `desktop-app`)

`desktop-app` (Electron) currently has no wiring to `extension-builder/`
(confirmed: no cross-references exist today). This spec adds a thin IPC
bridge, not a network API (everything stays local, matching the "no external
APIs" constraint elsewhere):

```
ipcMain.handle('extension-builder:createProject', (e, name, desc) => …)
ipcMain.handle('extension-builder:save', (e, projectId) => …)
ipcMain.handle('extension-builder:install', (e, projectId, opts) => …)
ipcMain.handle('extension-builder:package', (e, projectId, opts) => …)
ipcMain.handle('extension-builder:listInstalled', () => …)
```

Renderer calls these via `preload.js`'s existing `contextBridge` pattern; the
`ExtensionBuilder` engine instance itself continues running in the renderer
(it's plain browser-safe ESM per `use-builder.ts`'s doc comment) — the IPC
surface here is only for filesystem operations (save/install/package write
to disk) that the renderer sandbox shouldn't do directly.

### 9.5 `APIOutputConfig` — extensions calling out

Existing `addOutputLayer`/`APIOutputConfig` (`endpoint`, `method`, `port`,
`authRequired`) lets a neuron's activation trigger a local HTTP call. Per
`wiki/Builder.md`, this is "gated through the alignment veto, never
external" — this spec keeps that constraint explicit and non-optional: the
installer (§10) refuses to install an extension whose `APIOutputConfig`
target host resolves outside `localhost`/loopback.

---

## 10. Installation

### 10.1 Install targets

An installed extension lands in exactly one of:
1. **MoE expert slot** (skill extension) — `register_skill()` wires the
   trained contract in as a routable expert (`wiki/Extensions.md`,
   `wiki/MoE.md`).
2. **Plugin registry** (plugin extension) — `PluginRegistry.register()` +
   `activate()`.
3. **Both**, for extensions that are a service connector *and* ship a
   trained routing behavior (e.g., a "smart calendar" extension) — installer
   registers the plugin first, then the skill, and links them via the
   existing `skillPluginMap`.

### 10.2 Install procedure

```
1. Open .extpkg (§7.1), verify SIGNATURE if present (§7.4)
2. Validate manifest against schema (§8.5)
3. Resolve dependencies (§7.3) against already-installed extensions
4. Permission check: any permission beyond the safe default set (§7.4)
   requires explicit user confirmation before proceeding
5. Load project.ext.json, rebuild Maps (§8.2)
6. Route by kind (§9.3): register as plugin, skill, or both
7. Activate (plugin path) — PluginRegistry.activate(pluginId)
8. Persist install record: { manifestId, installedAt, sourcePackagePath }
   appended to an install ledger (new: extension-builder/installed.json)
9. Return an InstallResult; on any failure at steps 2-6, no partial state
   is left registered (steps are transactional — failure before step 6
   registers nothing; failure at step 7 unregisters what step 6 added)
```

### 10.3 Uninstall / rollback

`uninstallExtension(manifestId)`: reverse of steps 6-8 — deactivate +
unregister from `PluginRegistry`, remove from the MoE expert table (existing
`unregisterSkill`), remove the install ledger entry. Does not delete the
original `.extpkg`, so reinstalling is just re-running §10.2.

### 10.4 Community install path

Matches `wiki/Extensions.md`'s already-implemented `install_extension()`
round-trip (author system creates + shares, fresh model/registry installs).
This spec's `.extpkg` format (§7) is the file that travels between systems
for that flow — `install_extension()`'s Python implementation gains an
`.extpkg`-aware loader (currently it loads bare `.ext` files; extending it
to also accept `.extpkg` and unzip first is additive, existing bare-`.ext`
inputs keep working).

---

## 11. Testing

### 11.1 Existing coverage (keep, don't duplicate)

- `test/smoke.mjs` — TS engine: drag-connect, drag-label, simulate, output
  layers, Net Search (incl. null-result edge cases), save-vs-install
  size/behavior distinction, Code-to-Net (structural + behavioral,
  §"Section 21"), NeuroLang parse/interp (§"Section 20").
- `test_integration.py` §3/4/4b — Python: save-unquantized → install-quantized
  → smaller-on-disk → fresh-model reload round trip; live plugin+skill build
  and dispatch; the `learn_and_extend()` flagship flow including the
  deliberately-unlearnable-contract negative case.
- `test_core.py` — `test_net_search`, `test_code_to_net`,
  `test_install_community_extension`, `test_learn_and_extend`.

### 11.2 New unit tests

| Area | File | Cases |
|---|---|---|
| Undo/redo | `src/features/builder/hooks/use-history.test.ts` | do/undo/redo for each command type; coalesced drag moves = 1 undo step |
| DnD palette | `src/features/builder/panels/node-palette.test.tsx` | drop at (x,y) creates correctly-typed, correctly-positioned node for all 4 node types |
| Quantization report | `extension-builder/quantization-report.test.ts` | bits ∈ {4,8,16} produce monotonically non-increasing `quantizedSizeBytes`; invalid bits value rejected |
| Package build | `extension-builder/package.test.ts` | round-trip: package → unzip → manifest validates against schema §8.5 → project reloads to an equivalent graph |
| Install transactionality | `extension-builder/install.test.ts` | failure injected at each step 2-7 (§10.2) leaves zero partial registry state |
| Debugger | `src/features/builder/panels/debug-panel.test.tsx` | breakpoint pauses propagation at the right neuron; `explainConnection` contribution math matches manual calc |

### 11.3 Integration tests

- End-to-end: build a project via simulated palette drops → connect nodes →
  export NeuroLang → re-parse → assert graph equivalence (§3.3 round-trip
  property) → install at 8 bits → package → uninstall → reinstall from the
  `.extpkg` → assert behavior (`typeModelOutput`) unchanged.
- Cross-language: a project quantized and packaged by the TS engine can be
  loaded by the Python `install_extension()` loader and vice versa (shared
  schema, §8.5, is what makes this checkable — assert both produce
  schema-valid `installed-extension` JSON).

### 11.4 CI additions

- Schema validation step: every checked-in sample file
  (`extension-builder/extensions/*.json`, `*.net.json`, `*.ext.json`) is
  validated against the §8.5 schemas as a CI gate — catches format drift
  between the engine and the spec automatically.
- `npm test` and `python main.py demo` both continue to be the canonical
  entry points; this spec adds `npm run test:extension-builder` as a
  filtered subset for fast local iteration on just this feature.

### 11.5 Non-goals for testing

No fuzz-testing of NeuroLang parsing beyond existing malformed-input cases
(the language is intentionally small and hand-parsed, not security-critical
input from untrusted network sources — packages are local files, gated by
§7.4 signing for anything requesting sensitive permissions). No load/perf
testing beyond the existing benchmarks in `/benchmarks/`.

---

## 12. Build sequencing (suggested order)

1. File format schemas (§8) — everything else validates against these.
2. Packaging (§7) + quantization report (§6.4) — needed before installation can be tested end-to-end.
3. Installation (§10) — depends on 1-2.
4. APIs (§9) — mostly already exist; formalize + add the IPC bridge once 1-3 are stable.
5. Visual editor additions (§1) + DnD (§2) — independent of 1-4, can proceed in parallel.
6. Debugging (§5) — depends on §1 (canvas) for the visual panel, independent for the engine-level pieces (§5.2).
7. Search UI (§4.2) — depends on §1 for the command palette shell.
8. Testing (§11) — written alongside each stage above, not deferred to the end.
