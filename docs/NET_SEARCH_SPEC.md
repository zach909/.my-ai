# Net Search — Implementation Specification

Status: specification. Formalizes and extends the existing prototype
(`models && skills/core/net-search.ts`'s `NetSearchEngine`, `model && skills
manager/neurolang.py`'s `NetSearchManager`/`SkillExpert`, and
`extension-builder/builder.js`'s `netSearch`/`netSearchGenerate`) under the
governing design note quoted in `wiki/Net-Search.md`:

> "Net Search performs semantic searches across neural definitions, then uses
> deep learning to generate a neural network that performs the requested
> behavior."

**The central change this spec makes concrete**: Net Search's primary output
is not a ranked list of documents/passages. It is a small, purpose-trained
**temporary neural network** — synthesized from whatever matched — that
*performs* the requested behavior when run. Ranking still happens, but only
as an internal step that selects what feeds training; it is no longer the
deliverable. This is additive to the existing engines below, not a rewrite —
`hard_search`/`exactSearch`/`semanticSearch` remain as the deterministic,
always-available fallback and as the ranking signal that training draws on.

---

## 0. What already exists vs. what this spec adds

| Area | Exists today | This spec adds |
|---|---|---|
| Indexing | `_TFIndex` (Python, TF-IDF over passages), `NetSearchEngine.index` (TS, in-memory structure map) | Unified `SearchIndex` contract, incremental vs. full-rebuild policy, multi-corpus registry formalized |
| Semantic search | `semanticSearch` (TS bag-of-words cosine), `_TFIndex.search` (Python TF-IDF) | Kept as-is; renamed conceptually to "hard search" — deterministic ranking signal, not the final answer |
| Training | `NetSearchEngine.train(pairs)` (TS, additive association table), `NetSearchManager.train()` (Python, real `_RetrievalNet` gradient descent) | Query-scoped **temporary** training pipeline (§3), bounded epoch/time budget, hard-negative sampling |
| Temporary networks | `netSearchGenerate` creates a *permanent* `netsearch` neuron | New: ephemeral `TemporaryNetwork` object, TTL + LRU lifecycle, `promote()` path into the existing permanent-neuron mechanism |
| Ranking | Score sort + `topK` slice in both engines | Formalized `RankedCandidate`, combination formula, threshold gate before training |
| Validation | None beyond `if not trained: return []` | Training-quality gate, degraded-fallback path, hard-search cross-check |
| APIs | `NetSearchEngine.search()`, `NetSearchManager.neural_search()/hard_search()`, `builder.netSearch()/netSearchGenerate()` | Unified `NetSearchService` surface (§7), NeuroLang `@mode=` directive |
| Data structures | `SearchableStructure`, `SearchResult` (TS); ad-hoc dicts (Python) | Formal type family (§8) shared by both runtimes |
| Testing | `test/smoke.mjs` §22, `test_core.py::test_net_search` | Temp-network lifecycle, validation-gate, and memory-bound tests (§9) |

---

## 1. Search indexing

### 1.1 Indexed unit

A single formal shape for what gets indexed, regardless of source language:

```ts
interface IndexedUnit {
  id: string;                 // stable — neuron name (TS) or passage index (Python)
  text: string;                // the searchable text: name+definition, or a corpus passage
  tokens: string[];            // tokenize(text) — cached, not recomputed per query
  tfidf: Record<string, number>;
  source: "structure" | "passage";
  // structure-only fields (present when source === "structure")
  connections?: string[];
  flags?: string[];
  value?: number;
}
```

This is a superset of the existing `SearchableStructure` (TS) and the
implicit passage record inside `_TFIndex` (Python `docs[i]`/`tokens[i]`/
`tfidf[i]`, three parallel arrays indexed by position) — the Python side
keeps its existing parallel-array storage internally for performance but
exposes/serializes through this shape (§8) so both runtimes agree on the
wire format.

### 1.2 `SearchIndex` contract

```ts
interface SearchIndex {
  add(unit: Omit<IndexedUnit, "tokens" | "tfidf">): void;
  addMany(units: Omit<IndexedUnit, "tokens" | "tfidf">[]): void;
  build(): void;              // (re)computes tokens/idf/tfidf for all units
  get(id: string): IndexedUnit | undefined;
  size(): number;
  clear(): void;
}
```

`NetSearchEngine.index` (TS) and `_TFIndex` (Python) both already implement
this shape informally; this is the formal contract new corpora backends
(§1.4) must satisfy.

### 1.3 Build strategy

- **Full rebuild (default, unchanged)**: `build()` recomputes IDF and every
  unit's TF-IDF vector from scratch, as Python's `_TFIndex.build()` already
  does deliberately (its own comment: rebuilding avoids stale rows
  accumulating past `len(self.docs)`). Correct, O(corpus size) per build,
  acceptable at the corpus sizes this system indexes (in-project neuron
  counts, per-skill knowledge passages).
- **Incremental (opt-in, new)**: for corpora that grow past ~5,000 units,
  `addMany` may defer IDF recompute and only update the affected units'
  TF vectors, with a `dirty` flag that forces a full rebuild before the next
  search if IDF stats would be more than 10% stale (tracked as
  `unitsAddedSinceRebuild / totalUnits`). Off by default — only engaged via
  `index.build({ incremental: true })` — so existing callers see no behavior
  change.

### 1.4 Multi-corpus registry (existing, formalized)

`registerCorpus(location, structures)` / `loadCorpus(location)` (TS) and
`add_corpus(text)` (Python, single active corpus) are unified under one
concept: a `NetSearchService` (§7) owns zero or more named `SearchIndex`
instances, keyed by `location`. The reserved locations `"self"`/`"mesh"`
continue to mean "the current NeuroLang neuron map," matching
`wiki/Net-Search.md` and the existing `NeuroLangInterpreter.netSearch`
binding — no change there.

---

## 2. Semantic search ("hard search" — the ranking substrate)

Kept exactly as implemented, reframed as infrastructure rather than the
end product:

- **exact** — substring/token match (`exactSearch`, TS only; Python has no
  direct equivalent, `hard_search`'s TF-IDF dot product serves the same
  deterministic-fallback role).
- **semantic** — bag-of-words cosine over tokens (`semanticSearch` TS,
  `_TFIndex.search`/`hard_search` Python — TF-IDF dot product is a weighted
  variant of the same idea).
- **structural** — graph queries (`connects:`, `flag:`, `degree:`, seed
  neighborhood) — TS-only, no Python equivalent needed since Python's corpus
  is text passages, not a connection graph.

These three remain **always available with no training required** — this is
the fallback tier (§5.2) and the signal that seeds temporary-network training
data (§3.2). "neural" as a fourth *mode name* is retired as a user-facing
mode in favor of always returning a temporary network (§3); the embedding
+ association-table machinery that powered `neuralSearch` becomes an
internal training-signal source instead (§3.2, hard-negative embeddings).

---

## 3. Training

### 3.1 Two training regimes, kept distinct

1. **Persistent corpus training** (existing, unchanged): `NetSearchManager.train(epochs=200, lr=1e-3)`
   (Python) trains a full `_RetrievalNet` dual-encoder over the *entire*
   indexed corpus, called explicitly, producing a long-lived model
   (`self.trained = True`, save/load-able). This is what `SkillExpert.learn()`
   uses to build a durable, reusable retrieval model for a skill's whole
   knowledge base — nothing here changes.
2. **Query-scoped temporary training** (NEW, §3.2): triggered by every
   `search()` call by default, trains a small network *only* over the
   current query's top-ranked candidates, bounded to finish in well under a
   user-perceived delay. This is what backs the temporary network (§4).

The two share model architecture (a scaled-down `_RetrievalNet`/dual-encoder,
§3.3) but not lifecycle: regime 1 persists to disk (`save`/`load`, existing);
regime 2 lives in memory only and is disposed per §4.4.

### 3.2 Temporary training pipeline

```
[1] Rank        — run hard search (§2) at generous topK (default 20)
[2] Threshold    — drop candidates below minScore (default 0.05); if zero
                     candidates remain, no temporary network is trained —
                     return null (§4.5), matching netSearchGenerate's
                     existing null-result convention rather than fabricating
                     one from noise
[3] Positives     — top-K (default 5, config: temporaryTopK) candidates
                      after thresholding become positive (query, unit) pairs
[4] Hard negatives — candidates ranked just below the positive cutoff
                      (positions K+1..K+5) become negative pairs — a
                      strictly harder negative set than Python's current
                      cyclic-shift negative (`self.idx.tfidf[(i+1)%len(docs)]`),
                      which this pipeline replaces for the temporary path
                      only; the persistent-training path (§3.1) is untouched
[5] Train         — small dual-encoder, epoch/time-boxed (§3.3)
[6] Validate       — training-quality gate (§6) before the network is handed
                      back to the caller
```

### 3.3 Temporary-network architecture and budget

Reuses `_RetrievalNet`'s shape (`qe`/`de` encoder towers + sigmoid score
head) at a reduced hidden width, since the training set is at most
~10 pairs (5 positive + 5 negative) rather than a whole corpus:

```python
class _TempRetrievalNet(nn.Module):
    def __init__(self, V, h=32):   # h=32 vs. the persistent model's h=128
        ...
```

Budget, enforced by the training loop itself (not just documentation):

- `maxEpochs = 60`
- `maxWallMs = 400` — loop checks elapsed time every 10 epochs and stops
  early if exceeded, returning whatever the model has converged to so far
  (the validation gate, §6, is what decides if that's good enough to serve).
- Adam, `lr = 5e-3` (higher than the persistent path's `1e-3` — small data,
  needs to converge fast within the epoch budget, and overfitting to 10
  pairs is the explicit goal here, not a bug).

TS side: same budget/shape applied to a small MLP built the same way
`CodeToNetCompiler` already fits function-approximation nets in
`models && skills/core/code-to-net.ts` — this spec reuses that fitting
routine rather than writing a second SGD loop, parameterized down to the
temporary network's tiny training set.

---

## 4. Temporary networks

The core new concept. A `TemporaryNetwork` is what `search()` returns
instead of a document list.

### 4.1 Shape

```ts
interface TemporaryNetwork {
  id: string;                        // uuid, scoped to this engine instance
  query: string;
  sourceLocation: string;            // which corpus/index it was trained from
  createdAt: number;
  expiresAt: number;                  // createdAt + ttlMs
  trainingUnits: { id: string; role: "positive" | "negative"; score: number }[];
  quality: TrainingQualityReport;     // §6
  degraded: boolean;                  // true if it fell back to §5.2 raw ranking
  run(input: string | number[]): NetworkOutput;   // the actual "performs the behavior" call
  explain(): RankedCandidate[];       // debug-only: the ranking that produced it
  promote(projectId: string): NeuronData | null;   // §4.3
  dispose(): void;
}

interface NetworkOutput {
  value: number;                      // score/activation
  bestMatchId: string | null;         // which training unit it most agrees with, for callers that still want a pointer back to source content
  confidence: number;                  // quality.heldOutAccuracy carried through
}
```

`run()` is the behavior-performing call: for Python, `qe`/`de` forward pass
against the query re-embedded at call time; for TS, the fitted MLP's
`.evaluate()`. `bestMatchId` exists so callers can still cite *where an
answer came from* when needed (debugging, attribution) without that being
the primary return shape.

### 4.2 Lifecycle

```
created (search() call) → usable (run()/explain() callable)
   → [promote() → detached from TTL, now owned by the permanent graph, §4.3]
   → [ttl expiry OR LRU eviction OR explicit dispose() → disposed, run() throws]
```

- **TTL**: `ttlMs` default 10 minutes from `createdAt`. Configurable per
  `NetSearchService` instance (§7), not per call — keeps eviction reasoning
  uniform.
- **LRU cap**: `maxConcurrent` default 32 temporary networks per
  `NetSearchService` instance. A reaper (interval timer, default every 60s,
  also run inline on every `search()` call as a cheap sweep) evicts expired
  entries first, then LRU-evicts by `createdAt` if still over the cap after
  a new one is created — bounds memory under high query volume without
  requiring the caller to manage cleanup.
- **Disposal**: `dispose()` drops the network's weights and removes it from
  the service's live-network map; `run()`/`explain()` on a disposed network
  throw `TemporaryNetworkDisposedError` rather than silently returning stale
  data.

### 4.3 Promotion — bridging to the existing permanent mechanism

`promote(projectId)` is the link to the already-implemented
`netSearchGenerate` (`extension-builder/builder.js`): instead of retraining
from scratch, promotion:

1. Creates the `netsearch`-type `NeuronData` exactly as `netSearchGenerate`
   does today (same neuron shape, same weighted wiring to each match in
   `trainingUnits`).
2. **Warm-starts** the new neuron's connection weights from the temporary
   network's own converged association strengths (its positive pairs'
   trained scores) instead of the default uniform weighting
   `netSearchGenerate` currently uses — a strictly additive improvement to
   an existing call, not a new code path.
3. Removes the temporary network from the TTL/LRU tracking (it now lives as
   long as the project does, per the extension-builder's own lifecycle) and
   marks it `promoted: true` so a stray reaper sweep never disposes it.

Promotion is opt-in and explicit — search never auto-promotes. This keeps
"temporary by default" true: a query trains a network to *answer this one
question*, and only becomes a permanent part of a project's graph if a
caller (visual editor action, `Ctrl/Cmd+K` result, or programmatic call)
deliberately asks for that, same as today's `netSearchGenerate` being a
distinct call from `netSearch`.

### 4.4 Concurrency

Training (§3.2) is synchronous per call in the reference implementation
(training sets are ≤10 pairs, budgeted to ≤400ms, §3.3) — no background
worker needed. `NetSearchService.search()` is `async` regardless, so a
future implementation can move training onto a worker thread (TS
`Worker`)/subprocess (Python) without changing the public contract.

### 4.5 Empty / degenerate results

If ranking (§2) or thresholding (§3.2 step 2) leaves zero candidates,
`search()` resolves to `null` — no `TemporaryNetwork` is fabricated from
nothing. This matches the existing, already-tested convention in
`netSearchGenerate` ("returns `null` for an empty or untokenizable query,
and `null` when there are zero semantic matches, rather than fabricating a
result" — `wiki/Net-Search.md`).

---

## 5. Ranking

### 5.1 `RankedCandidate` and the combination formula

```ts
interface RankedCandidate {
  id: string;
  score: number;
  source: "exact" | "semantic" | "structural" | "association";
  matchedOn: string;
}
```

Default combination (configurable weights, these are the defaults —
chosen to match the existing `neuralSearch`'s `0.3 * embSim + assocBoost`
so behavior doesn't silently shift for existing callers):

```
score(unit, query) =
    1.0 * exactScore(unit, query)          // 1.0 or 0.8, as today, dominates when present
  + 0.3 * semanticScore(unit, query)        // cosine, existing weight
  + 1.0 * associationBoost(unit, query)     // learned, from persistent training (§3.1) if available
  + structuralBonus(unit, query)            // 1.0 for an explicit connects:/flag:/degree: query, 0 otherwise
```

### 5.2 Ranking's two consumers

1. **Training-set selection** (§3.2) — the primary consumer now. Ranking
   output never reaches the caller directly in this role.
2. **Fallback / degraded mode** — if training-quality validation (§6) fails,
   `search()` still returns *something* usable: a `TemporaryNetwork` with
   `degraded: true` whose `run()` doesn't do a forward pass at all but
   returns the top `RankedCandidate`'s score/id directly. This is the "still
   return documents" safety net, scoped narrowly to genuine training
   failure rather than being the normal path.

### 5.3 Threshold and topK are explicit, not magic numbers

`minScore` (default 0.05) and `temporaryTopK` (default 5) are fields on
`NetSearchOptions` (§8), not hardcoded — corpora with very sparse token
overlap (e.g., single-word neuron names) can lower `minScore` per call.

---

## 6. Validation

Formal gate between "a network trained" and "a network is returned as
usable" — nothing like this exists in the prototype today (Python only
checks `if not self.idx.vocab` / `if not self.trained`; TS has no
post-training check at all).

### 6.1 `TrainingQualityReport`

```ts
interface TrainingQualityReport {
  heldOutAccuracy: number;     // §6.2
  meanPositiveScore: number;    // avg run() score over the network's own positive pairs
  meanNegativeScore: number;    // avg run() score over its own negative pairs
  separation: number;           // meanPositiveScore - meanNegativeScore
  epochsRun: number;
  stoppedEarly: boolean;        // hit maxWallMs before maxEpochs (§3.3)
}
```

### 6.2 Held-out check

Training pairs (§3.2) are split 80/20 (minimum 1 pair held out; with only
5 positive/5 negative pairs this means at least one of each class is never
trained on). `heldOutAccuracy` = fraction of held-out pairs the trained
network scores on the correct side of 0.5. This is cheap (≤10 pairs total)
and catches a network that memorized rather than generalized even slightly
— relevant here because the training set is so small that memorization is
the default outcome; the gate isn't asking for strong generalization, only
that `separation` (§6.1) is real and not an artifact of the loss simply not
having moved.

### 6.3 The gate

A `TemporaryNetwork` is returned as `degraded: false` only if **all** hold:

- `separation >= 0.15` (positives score meaningfully above negatives)
- `heldOutAccuracy >= 0.5` when there were held-out pairs to check (with a
  single held-out pair per class this is necessarily coarse — treated as a
  sanity floor, not a strong statistical claim)

Otherwise: `degraded: true`, and `run()` falls back to raw ranking (§5.2.2).
The caller is never left silently trusting an undertrained forward pass —
`degraded` is a required field on the returned object, not something that
has to be separately queried.

### 6.4 Cross-check against hard search

As a regression guard (exercised in tests, §9.3, not run on every query for
performance): a non-degraded temporary network's `run(query).bestMatchId`
should equal or closely rank with `hardSearch(query)[0].id` for the same
query on the same index — if a temporary network's top answer diverges
wildly from the deterministic ranking that trained it, that is itself a bug
signal (training pipeline regression), not a feature of "the network learned
something hard search couldn't see" — at this training-set size (≤10 pairs)
there isn't enough signal for that claim to be credible.

---

## 7. APIs

### 7.1 `NetSearchService` — the unified surface (TS)

```ts
interface NetSearchOptions {
  location?: string;          // default "self"
  minScore?: number;          // default 0.05
  temporaryTopK?: number;      // default 5
  ttlMs?: number;               // default 600_000 (10 min)
}

class NetSearchService {
  registerCorpus(location: string, units: IndexedUnit[]): void;
  loadCorpus(location: string): boolean;

  // Persistent training (§3.1) — explicit, long-lived.
  trainPersistent(location: string, pairs: { query: string; id: string }[]): void;

  // The default entry point — always returns a temporary network or null.
  search(query: string, opts?: NetSearchOptions): Promise<TemporaryNetwork | null>;

  // Escape hatch to the deterministic substrate (§2) directly, for callers
  // that explicitly want candidates rather than a network (e.g. the
  // command-palette search from docs/EXTENSION_BUILDER_SPEC.md §4.2).
  rankOnly(query: string, opts?: NetSearchOptions): RankedCandidate[];

  getNetwork(id: string): TemporaryNetwork | undefined;
  listActiveNetworks(): TemporaryNetwork[];
  disposeNetwork(id: string): void;
  stats(): { indexedUnits: number; activeTemporaryNetworks: number; persistentModelsLoaded: number };
}
```

`NetSearchEngine` (existing) becomes the `rankOnly`/indexing implementation
underneath this service rather than being replaced — `search()` on the new
service is: rank via the existing engine → train temporary (§3) → validate
(§6) → return.

### 7.2 Python surface

`NetSearchManager` keeps `add_corpus`, `train` (→ persistent, §3.1),
`hard_search` (→ `rankOnly`), `save`/`load` unchanged. New method:

```python
def temp_search(self, query, top_k=5, min_score=0.05, ttl_s=600) -> TemporaryNetwork | None:
    ...
```

implementing §3.2's pipeline with `_TempRetrievalNet` (§3.3). `SkillExpert`
gains `answer(question)` which calls `temp_search` when no persistent model
is trained yet, and falls back to the existing persistent `neural_search`
when one is (mirrors the "persistent if available, temporary otherwise"
relationship already implicit in `SkillExpert.query`'s
`trained`-flag branch).

### 7.3 NeuroLang directive

```text
"netsearch"@name="my-search"
"netsearch"@net="location"
"netsearch"@mode="temporary"     # NEW, default — matches this spec
"netsearch"@mode="permanent"     # NEW — equivalent to calling promote() immediately
```

`@mode` is optional; omitting it defaults to `"temporary"`, matching this
spec's "instead of returning documents" default. `@mode="permanent"` is
sugar for the existing `netSearchGenerate` behavior, now expressed as
promotion-on-creation rather than a separate code path — it calls `search()`
then immediately `promote()`s the result, still going through the
validation gate (§6) first (a permanent neuron built from a
`degraded: true` network is exactly the failure case §6 exists to catch —
`@mode="permanent"` does not bypass it).

### 7.4 Relationship to `docs/EXTENSION_BUILDER_SPEC.md`

That spec's §4.3 ("Net Search as a graph operation") and §7.4's promotion
flow are unchanged in shape — this document is what §4.1/§4.3 there was
deferring to. The command palette (§4.2 there) uses `rankOnly` (§7.1 here),
not `search`, since a UI search-as-you-type box wants instant candidates,
not a 400ms training pass per keystroke.

---

## 8. Data structures

Canonical type family, shared conceptually by both runtimes (TS types
below; Python uses equivalent dict/dataclass shapes — `IndexedUnit` →
a dataclass mirroring `_TFIndex`'s parallel arrays, `TemporaryNetwork` →
a dataclass wrapping a `_TempRetrievalNet` + metadata):

```ts
// Indexing (§1)
interface IndexedUnit { id, text, tokens, tfidf, source, connections?, flags?, value? }
interface SearchIndex { add, addMany, build, get, size, clear }

// Ranking (§5)
interface RankedCandidate { id, score, source, matchedOn }
interface NetSearchOptions { location?, minScore?, temporaryTopK?, ttlMs? }

// Training (§3)
interface TrainingPair { query: string; unitId: string; label: 0 | 1 }
interface TrainingQualityReport { heldOutAccuracy, meanPositiveScore, meanNegativeScore, separation, epochsRun, stoppedEarly }

// Temporary networks (§4)
interface TemporaryNetwork {
  id, query, sourceLocation, createdAt, expiresAt,
  trainingUnits: { id, role, score }[],
  quality: TrainingQualityReport,
  degraded: boolean,
  run(input): NetworkOutput,
  explain(): RankedCandidate[],
  promote(projectId): NeuronData | null,
  dispose(): void,
}
interface NetworkOutput { value, bestMatchId, confidence }
```

### 8.1 Serialization

Only `promote()`d networks are ever persisted (as the existing
`netsearch`-type `NeuronData`, per `docs/EXTENSION_BUILDER_SPEC.md` §8.2's
`project`/`installed-extension` schema — no new file format needed). A pure
temporary network is never written to disk; it exists only for the duration
of its TTL. `save()`/`load()` (Python, existing) remain the persistent-model
(§3.1) serialization path, untouched.

---

## 9. Testing

### 9.1 Existing coverage (keep)

`test/smoke.mjs` §22 (all four `NetSearchEngine` modes, `@net="self"`
binding); `test_core.py::test_net_search` (Python indexing/training/both
search modes); the Extension Builder's `netSearchGenerate` null-result and
weighted-wiring cases (`test/smoke.mjs`, Extension Builder section) —
unchanged, since `rankOnly`/`registerCorpus`/persistent training are
additive wrappers, not replacements.

### 9.2 New unit tests

| Area | Cases |
|---|---|
| Indexing (§1) | incremental vs. full-rebuild produce identical `tfidf` for the same final unit set; `dirty` threshold triggers forced rebuild |
| Training pipeline (§3.2) | thresholding drops low-score candidates before training; hard-negative selection picks positions K+1..K+5, not random |
| Temporary network lifecycle (§4.2) | TTL expiry disposes; LRU evicts oldest when `maxConcurrent` exceeded by a new `search()`; `run()`/`explain()` throw after `dispose()` |
| Promotion (§4.3) | promoted network's neuron connection weights match the temp network's trained association strengths, not a uniform default; promoted network survives a TTL sweep that would have expired it |
| Validation gate (§6) | a corpus with no real signal (random tokens) yields `degraded: true`, never a `separation >= 0.15` false positive; a corpus with clear signal (repeated exact phrase) yields `degraded: false` |
| Empty/degenerate (§4.5) | empty query, untokenizable query, and a query with zero candidates above `minScore` all resolve `search()` to `null` |

### 9.3 Integration tests

- End-to-end: index a small corpus → `search(query)` → assert non-degraded
  `TemporaryNetwork` → `run()` output's `bestMatchId` matches
  `rankOnly(query)[0].id` (the §6.4 cross-check, made concrete).
- Cross-language parity: the same corpus indexed by both the TS and Python
  engines produces temporary networks whose `degraded` flag and top
  `bestMatchId` agree — not bit-identical weights (different training
  runs/architectures), but the same *answer*.
- `@mode="permanent"` NeuroLang directive: parses, trains, validates, and
  promotes in one pass, producing a `netsearch`-type neuron identical in
  shape to one built via direct `netSearchGenerate` call.

### 9.4 Memory-bound / soak test

Issue `maxConcurrent + 20` distinct queries against one `NetSearchService`
in a loop; assert `listActiveNetworks().length <= maxConcurrent` throughout
and that total tracked weight memory (`activeTemporaryNetworks * per-network
param count`) stays bounded — the concrete guard against the "trains a
network per query" design turning into an unbounded memory leak under load.

### 9.5 Non-goals for testing

No adversarial/fuzz testing of query text beyond existing malformed/empty
cases — queries are local, not untrusted network input (same boundary
reasoning as `docs/EXTENSION_BUILDER_SPEC.md` §11.5). No benchmarking beyond
confirming the `maxWallMs` budget (§3.3) is actually respected under a
realistic corpus size in CI.
