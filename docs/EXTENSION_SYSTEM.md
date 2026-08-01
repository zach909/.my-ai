# Extension System

Design and reference implementation for a system that lets the AI **automatically
create, version, update, and remove extensions** to hold memory, logic,
reasoning traces, and reusable skills as durable, first-class artifacts —
instead of only ever holding them as ephemeral in-context state.

Implementation: [`extension_system/`](../extension_system). Tests:
[`test/core/extension-system.test.ts`](../test/core/extension-system.test.ts).

This document assumes familiarity with the existing adjacent systems it
integrates rather than replaces:

| Existing system | File | Role in the Extension System |
|---|---|---|
| Plugin runtime | `plugin_manager/{types,sdk,registry,loader}.ts` | Defines `BasePlugin`, `ExtensionPermission`, `ExtensionManifest` (v1). The Extension System's manifest is a superset; its permission vocabulary is reused as-is. |
| Neural-net extension builder | `extension-builder/builder.ts` | Builds/quantizes/exports a project's neuron graph. A "logic" extension's payload is frequently a `builder.exportToNeuroLang()` or `builder.installWithQuantization()` output. |
| Auto-creation | `plugins/extensions/index.ts` (`SkillMakerExtension`, `PluginMakerExtension`) | The generators that decide *what* to create; the Extension System is what makes the result durable, versioned, and governed instead of a bare file write. |
| Long-term memory | `models && skills/core/long-term-memory.ts` | Source of "memory" extension payloads (`LongTermMemory.serialize()`). |
| Knowledge graph | `models && skills/core/knowledge-graph.ts` | Alternate memory representation; can be packaged the same way. |
| Skill library | `models && skills/core/skill-library.ts` | Read-side index over `.neuri` skill files; the Extension System is the write-side lifecycle authority those files should eventually route through. |
| Context compression | `models && skills/core/context-compressor.ts` | Semantic compression before an extension is created (deciding *what's worth keeping*), distinct from the Extension System's own byte-level storage compression (deciding *how the kept bytes are stored*). |
| Quantization | `models && skills/core/quantizer.ts` (`BackgroundQuantizer`) | Used directly by `extension_system/store.ts` to shrink numeric "logic" payloads. |

---

## 1. Extension architecture

An **extension** is a versioned, permissioned, dependency-aware unit of
durable state. It generalizes `plugin_manager`'s `PluginDefinition` (which
only covers *executable* capabilities) to also cover *non-executable*
durable artifacts: a memory snapshot, a block of reasoning/logic, or a
reusable skill.

```
ExtensionManifest        -- identity, version, kind, deps, permissions, provenance
        │
        ▼
ExtensionRecord           -- manifest + lifecycle state + StorageEncoding + payload location
        │
        ▼
ExtensionStore             -- content-addressable bytes on disk (compressed / quantized)
        │
        ▼
ExtensionManager            -- lifecycle, dependency graph, permission enforcement, versioning
        │
        ▼
PermissionGuard               -- grants (per Section 13)
```

Five kinds (`ExtensionKind` in `extension_system/types.ts`):

- **`memory`** — a serialized `LongTermMemory` or `KnowledgeGraph` snapshot, or any other consolidated recollection.
- **`logic`** — a reasoning trace, a compiled/quantized neuron subnet (`extension-builder`), a `CodeToNet` artifact.
- **`skill`** — a `.neuri` skill source plus its wiki provenance report (what `SkillMakerExtension` already produces).
- **`plugin`** — executable code wired into `plugin_manager`'s dispatch loop (what `PluginMakerExtension` produces); `entrypoint` is required.
- **`composite`** — bundles multiple kinds together (e.g. a skill plus the memory episodes that justified it) for atomic install/rollback.

Each kind stores an opaque `Buffer` payload; the *kind* only affects how the
payload is interpreted downstream (by the plugin loader, the skill
interpreter, the memory subsystem, etc.), not how the Extension System
stores or governs it — storage, versioning, dependency resolution, and
permission enforcement are uniform across all five kinds.

---

## 2. Extension lifecycle

States (`ExtensionState`): `installed → active ⇄ inactive → removed`, with a
`disabled` state reachable from `installed`/`active` when a security check
fails.

```
        install()                activate()
(none) ─────────────► installed ─────────────► active
                          │  ▲                    │
                          │  └────deactivate()─────┘
                          │
                       remove() (if not active, no active dependents)
                          ▼
                       (gone)
```

- **`install(input)`** — validates the manifest, writes the (optionally
  compressed/quantized) payload via `ExtensionStore`, indexes the record as
  `installed`. Dependencies are *declared* here but not yet *enforced* — an
  extension may be installed before a sibling dependency exists (e.g. both
  produced in the same auto-creation batch); only `activate()` requires them
  resolved.
- **`activate(id, version?)`** — resolves dependencies (`resolveDependencies`),
  recursively activates required deps not already active, enforces
  permissions (`PermissionGuard.assertAll`), and — since only one version of
  a given id may be active at a time — deactivates whatever version was
  previously active first. A failed permission check flips the record to
  `disabled` rather than leaving it silently `installed`.
- **`deactivate(id)`** — refuses if another *active* extension still
  requires it (`required: true` dependency), unless `force: true`.
- **`update(id, newVersion, payload, patch)`** — see Section 8.
- **`remove(id, version)`** — refuses if the version is active or still
  required by an active dependent, unless `force: true`. Removing a
  non-active, non-latest version is always safe (the standard way to prune
  old rollback points).

---

## 3. Automatic creation

`ExtensionManager.autoCreate()` is the entrypoint the AI itself calls when it
decides something is worth keeping durably rather than letting it stay
transient context. It never guesses provenance: callers must pass
`createdBy` (e.g. `"skill-maker"`, `"long-term-memory:consolidate"`,
`"reasoning-engine:solved-problem"`) and, when applicable, `sources` — the
same "what informed this" audit trail `SkillMakerExtension`'s wiki reports
already record (`plugins/extensions/index.ts`).

```ts
await manager.autoCreate({
  name: "Debug a null-pointer crash",
  kind: "skill",
  description: "Learned technique for tracing null-pointer bugs from a stack trace",
  createdBy: "skill-maker",
  sources: ["conversation about a crash", "net-search hit on null checks"],
  payload: Buffer.from(skillSource),
});
```

Behavior:

- If `id` (derived by slugifying `name` when omitted) has no installed
  version, this is a fresh `install()` at version `1.0.0`.
- If `id` already exists, this is **not** a duplicate — it's routed through
  `update()` as a patch-version bump (`x.y.z → x.y.(z+1)`), so repeatedly
  refining the same self-authored skill accumulates as version history
  instead of overwriting or duplicating it.
- `provenance.autoCreated` is always `true` for anything created this way,
  which downstream tooling (audits, `SelfMonitor`, a future "explain what
  you know and why" query) can filter on distinctly from user-authored
  extensions.

This is intentionally a thin, generic entrypoint: `SkillMakerExtension` and
`PluginMakerExtension` keep doing what they do (generating the *content*),
and should call `autoCreate()` with their generated buffer instead of (or in
addition to) writing directly to `~/.neuroclaw/skills/*.neuri` — giving
those artifacts version history, dependency declarations, and permission
governance they don't get from a bare file write.

---

## 4. Updating

`update(id, newVersion, payload, patch)`:

1. Requires `newVersion` to be strictly greater than the current latest
   installed version (`semver.gt`); rejects same-or-older versions outright
   — there is no implicit "overwrite," only forward version history.
2. Installs the new version as a normal, separate `ExtensionRecord` — the
   old version is **not** deleted. This is what makes Section 8's rollback
   possible.
3. If the *previous* latest version was the active one, the new version is
   activated and the old one deactivated atomically from the caller's
   perspective (new activation is attempted before the old is torn down —
   see `manager.ts`'s `update()`).
4. Manifest fields not present in `patch` are carried forward from the
   previous version (name, author, kind, entrypoint default to unchanged).

---

## 5. Removal

`remove(id, version, { force? })` order of checks (deliberately: the more
informative error wins):

1. **Dependents** — any *active* extension whose manifest lists `id` as a
   `required` dependency blocks removal with `DependencyError`, naming the
   blockers.
2. **Active version** — removing the currently active version of an id
   (even with no dependents) is blocked unless `force`, so "the thing
   currently serving requests" is never silently deleted out from under the
   runtime.

`force: true` bypasses both — for administrative cleanup, not for normal
operation. Removal deletes the on-disk payload/manifest/encoding for that
one version only; sibling versions of the same id are untouched.

---

## 6. Dependencies

`DependencySpec { id, range, required }` — `range` is a semver range string
(Section 8's minimal syntax: `^`, `~`, `>=`, exact, `*`).

`resolveDependencies(manifest)` walks each declared dependency, resolves the
highest installed version satisfying `range` via `resolveBest()`, and
returns a `DependencyResolution` distinguishing:

- `resolved: { depId: version }` — every dependency that *was* resolvable
  (required or not).
- `missing: DependencySpec[]` — only the `required` ones that weren't; a
  missing *optional* dependency is not an error.

**Circular dependency detection** (`assertNoCycle`) runs a DFS over
*installed* manifests before resolution completes, so `a → b → a` throws a
`DependencyError` naming the cycle instead of infinitely recursing during
activation. Optional (`required: false`) edges are still walked for cycle
detection — a cycle is a structural problem regardless of whether either
edge would currently block activation.

**Activation order**: `activate()` recursively activates required
dependencies *before* activating the requested extension, so by the time an
extension's code/data is reachable, everything it declared as required is
already active too.

---

## 7. Permissions

Reuses the single `ExtensionPermission` union already defined in
`plugin_manager/types.ts` (`camera`, `microphone`, `file-system`, `coding`,
`skill-maker`, ... — see that file for the full list) so plugins and
extensions share one governance vocabulary instead of two.

`PermissionGuard` (`extension_system/security.ts`) splits permissions into
two tiers:

- **Sensitive** (`camera`, `microphone`, `location`, `contacts`, `email`,
  `phone-calls`, `call-history`, `messaging`, `file-system`, `browser`,
  `account-info`, `screenshots-screen-recording`, `passkeys`) — must be
  explicitly granted (`grant(id, permission, grantedBy)`) before an
  extension requesting them can activate. An ungranted sensitive permission
  fails activation loudly (`PermissionDeniedError`) and flips the record to
  `disabled` — it never silently activates with reduced capability.
- **Everything else** (`coding`, `skill-maker`, `plugin-maker`,
  `text-image-generation`, ...) — auto-granted at install time
  (`autoGrantNonSensitive`), since these are inert, local capabilities with
  no privacy/safety blast radius.

Every grant is timestamped and attributed (`grantedBy: "user" |
"auto-policy" | ...`), giving a full audit trail of who authorized what and
when — `listGrants(id)` returns it per extension.

---

## 8. Versioning

`extension_system/semver.ts` — a minimal, dependency-free semver
implementation (no external `semver` package, matching the repo-wide
convention that the core system doesn't reach for external network/npm
services — see `long-term-memory.ts`'s and `context-compressor.ts`'s header
comments). Supports:

- Exact (`"1.2.3"`)
- `"*"` (any valid version)
- `"^1.2.3"` — same major, `>= 1.2.3`
- `"~1.2.3"` — same major.minor, `>= 1.2.3`
- `">=1.2.3"`

`resolveBest(available, range)` picks the **highest** installed version
satisfying a range — dependents always get the newest compatible version,
never an arbitrary satisfying one.

All prior versions of an extension are retained on disk after `update()`
(Section 4), which is what makes **`rollback(id)`** possible: it finds the
version immediately before the currently active one (by sorted version
order) and reactivates it. Rollback is a first-class operation, not a
manual reinstall of an old payload.

---

## 9. Memory storage

A "memory" extension's payload is typically `LongTermMemory.serialize()`
(`models && skills/core/long-term-memory.ts`) — a JSON blob of `MemoryItem`s
with embeddings, importance, and access stats — or a `KnowledgeGraph`
export. The Extension System doesn't interpret the bytes; it stores them
content-addressed (SHA-256 of the *decoded* payload, so integrity survives
compression) and versions them like anything else.

Typical flow: the AI decides a cluster of working-context items (drained
from `ZipIOSystem`, Section 7 of the master spec) is worth preserving long
term → `LongTermMemory.consolidateFrom()` → periodically snapshot the whole
store → `manager.autoCreate({ kind: "memory", payload: Buffer.from(mem.serialize()), createdBy: "long-term-memory:consolidate" })`.
This gives memory snapshots the same rollback/versioning/permission story as
every other extension kind, instead of memory being the one thing that's
only ever "the current in-process state."

---

## 10. Logic storage

A "logic" extension packages reasoning/computation artifacts: a
`ReasoningEngine` trace worth reusing, a `CodeToNetCompiler` output, or a
neuron subnet exported from `extension-builder`
(`ExtensionBuilder.exportToNeuroLang()` / `installWithQuantization()`).
Numeric payloads (raw `Float32Array` weights) are the primary target for
Section 11's quantization — `write(..., { quantize: { bits, method } })`
shrinks them before storage; textual/source payloads (NeuroLang source,
reasoning traces as text) skip quantization and just get gzip'd.

---

## 11. Skill storage

A "skill" extension is the versioned home for what `SkillMakerExtension`
already generates: `.neuri` source plus the "what informed this" wiki
report. Packaging it as an extension adds three things the bare
`~/.neuroclaw/skills/*.neuri` file didn't have: **version history** (each
refinement is a new patch version, not an overwrite), **dependency
declarations** (a skill can require another skill or a logic extension it
was built on top of), and **permission gating** (a skill that shells out or
touches the filesystem carries the same permission requirements a plugin
would). `SkillLibrary` (`models && skills/core/skill-library.ts`) remains
the read-side search/index; nothing here replaces it — the Extension System
is the write-side lifecycle authority its files should be produced through.

---

## 12. Compression

Two distinct layers, deliberately not conflated:

1. **Semantic compression** (`ContextCompressor`,
   `models && skills/core/context-compressor.ts`) — happens *before*
   extension creation, deciding *what's worth keeping* (extractive
   summarization under a character budget).
2. **Byte-level storage compression** (`ExtensionStore.write`, gzip via
   Node's `zlib`, matching `ZipIOSystem`'s existing convention) — happens
   *after* the decision, shrinking whatever bytes were decided on. On by
   default (`compress: true`); `StorageEncoding.storedBytes` /
   `originalBytes` record the before/after size so callers can measure the
   ratio without decompressing.

`ExtensionStore.verify()` decompresses and re-hashes to catch silent
corruption from either layer.

---

## 13. Quantization

`ExtensionStore.write(..., { quantize: { bits, method } })` delegates to the
existing `BackgroundQuantizer` (`models && skills/core/quantizer.ts`):
reinterprets the payload as `Float32Array`, runs the
quantize-then-dequantize round trip `BackgroundQuantizer.quantize()`
already performs (so the stored bytes are directly usable — no separate
dequant step needed on read), then gzips the (now lower-entropy, more
compressible) result. `StorageEncoding.quantization` records `{ bits,
method }` so a caller reading the payload back knows the precision it was
stored at. `verify()` treats quantized payloads as lossy by design — it
checks the file exists rather than exact-hash-matching the irreversibly
lossy bytes against the pre-quantization hash.

Only numeric ("logic") payloads should opt into quantization; textual
skill/memory payloads are not meaningfully float-array-shaped and would
corrupt under reinterpretation.

---

## 14. Security

- **Permission enforcement** — Section 7, `PermissionGuard`.
- **Sandboxed activation context** — `plugin_manager/registry.ts`'s
  `createContext()` already scopes each plugin to its own `dataDir:
  ./data/<pluginId>`; the Extension System's `ExtensionStore` applies the
  same isolation at the storage layer (`<rootDir>/<id>/<version>/`), so one
  extension's payload can never collide with or overwrite another's by
  construction.
- **Content integrity** — every non-quantized payload is hashed (SHA-256)
  at write time and re-checkable at any time via `verify()`, so tampering
  or partial writes are detectable rather than silently served.
- **No implicit network access** — consistent with the master spec's
  Section 17 ("no external APIs for the core system"), nothing in
  `extension_system/` makes a network call; auto-creation sources are
  freeform strings, never fetched URLs.
- **Fail loud, not soft** — an extension that requests a sensitive
  permission it doesn't have is flipped to `disabled` on activation attempt
  rather than silently running with reduced capability (Section 7).
- **Least-privilege default** — only permissions a manifest *explicitly
  lists* are ever granted; nothing is ambiently available.

---

## 15. APIs

Primary surface is `ExtensionManager` (see `extension_system/manager.ts`
for full signatures):

```ts
new ExtensionManager({ rootDir?, store?, permissions? })

manager.load(): void                                              // rehydrate from disk after restart
manager.install(input: InstallInput): Promise<ExtensionRecord>
manager.autoCreate(input): Promise<ExtensionRecord>                // Section 3
manager.update(id, newVersion, payload, patch?): Promise<ExtensionRecord>
manager.rollback(id): Promise<ExtensionRecord>
manager.activate(id, version?): Promise<ExtensionRecord>
manager.deactivate(id, { force? }): Promise<void>
manager.remove(id, version, { force? }): Promise<void>
manager.resolveDependencies(manifest): DependencyResolution
manager.loadPayload(id, version?): Promise<Buffer>
manager.verify(id, version): Promise<boolean>
manager.getRecord(id, version?): ExtensionRecord | undefined
manager.getActiveRecord(id): ExtensionRecord | undefined
manager.installedVersions(id): string[]
manager.latestVersion(id): string | undefined
manager.listExtensions({ kind?, state? }): ExtensionRecord[]

manager.permissions: PermissionGuard
  .grant(id, permission, grantedBy?) / .revoke(id, permission)
  .isGranted(id, permission) / .listGrants(id)
```

Lower-level building blocks (`ExtensionStore`, `PermissionGuard`, the
`semver` module) are independently exported from `extension_system/index.ts`
for callers that need storage or version comparison without the full
lifecycle manager.

---

## 16. Internal data structures

All defined in `extension_system/types.ts`:

- `ExtensionManifest` — identity (`id`, `name`, `version`), `kind`,
  `description`, `author`, `permissions`, `dependencies`, `entrypoint?`,
  `capabilities`, `provenance`, `createdAt`/`updatedAt`.
- `ExtensionRecord` — `manifest` + `state` + `encoding` (`StorageEncoding`)
  + `payloadPath` + `activatedAt?`/`deactivatedAt?`.
- `StorageEncoding` — `compression`, `quantization?`, `contentHash`,
  `storedBytes`, `originalBytes`.
- `Provenance` — `autoCreated`, `createdBy`, `sources[]`.
- `DependencySpec` — `id`, `range`, `required`.
- `DependencyResolution` — `satisfied`, `resolved`, `missing`.
- `PermissionGrant` — `extensionId`, `permission`, `granted`, `grantedAt`,
  `grantedBy`.

`ExtensionManager`'s in-memory index is `Map<id, Map<version,
ExtensionRecord>>` plus a separate `Map<id, activeVersion>` — deliberately
keeping "what's installed" and "what's currently active" as distinct
indices, since Section 2's lifecycle treats them as distinct concerns (a
version can be installed without being active, and exactly one version per
id may be active at a time).

---

## 17. Runtime integration

- **Restart continuity**: `ExtensionStore` persists everything needed to
  reconstruct state — manifests, encodings, and an `active.json` pointer
  file (`{ id: version }`) at the store root. `ExtensionManager.load()`
  walks the store and rehydrates the in-memory index plus active-version
  map, so a process restart doesn't lose which extensions were active.
- **Plugin bridge**: a `kind: "plugin"` extension's `entrypoint` is the same
  concept `plugin_manager/loader.ts`'s `ExtensionManifest.entrypoint`
  already uses; the intent is for `PluginLoader` to eventually resolve
  plugin code through `ExtensionManager.loadPayload()` /
  `getActiveRecord()` instead of only scanning a flat directory for
  `manifest.json` files, giving plugins the same version/dependency/
  permission story as every other extension kind.
- **Auto-creation bridge**: `SkillMakerExtension` / `PluginMakerExtension`
  (`plugins/extensions/index.ts`) are the natural callers of
  `autoCreate()` — see Section 3.
- **Dispatch integration**: `PluginRegistry.dispatch()`
  (`plugin_manager/registry.ts`) already routes intents to active plugin
  ids; once plugins route through `ExtensionManager`, `dispatch()`'s
  `this.activePlugins.has(pluginId)` check becomes
  `manager.getActiveRecord(pluginId) !== undefined` — the Extension System
  becomes the single source of truth for "is this active," rather than
  `PluginRegistry` keeping its own parallel `Set`.

---

## 18. Testing

`test/core/extension-system.test.ts` (16 cases, run via the existing
`vitest.config.ts` — `npm run test:integration` / `npx vitest run`),
covering:

- **semver**: comparison, `^`/`~`/`*` range satisfaction, best-version
  resolution.
- **Lifecycle**: install → activate; state transitions.
- **Storage**: exact byte round-trip through gzip; hash-based `verify()`.
- **Quantization**: numeric payload round-trips through
  `BackgroundQuantizer` with `encoding.quantization` recorded correctly.
- **Dependencies**: activation blocked until a required dependency is
  installed; recursive activation of dependencies; circular-dependency
  detection.
- **Removal/deactivation guards**: blocked while an active dependent
  requires the target; `force` bypasses; unblocked after the dependent is
  deactivated.
- **Permissions**: sensitive permission blocks activation
  (`PermissionDeniedError`) until explicitly granted; non-sensitive
  permissions auto-grant on install.
- **Versioning**: `update()` bumps version, retains the old version,
  re-activates the new one if the old was active; rejects
  same-or-older-version updates; `rollback()` reactivates the prior
  version.
- **Automatic creation**: fresh `autoCreate()` installs at `1.0.0` with
  `provenance.autoCreated = true`; a second `autoCreate()` against the same
  id evolves it to the next patch version rather than duplicating it.
- **Restart continuity**: a fresh `ExtensionManager` pointed at the same
  `rootDir` recovers installed + active state via `load()`.
- **Listing/filtering**: `listExtensions({ kind, state })`.

Each test uses an isolated `mkdtempSync` root directory (matching the
convention in `test/core/skill-library.test.ts`) so tests never share or
pollute `~/.neuroclaw/extensions`, and are cleaned up in `afterEach`.
