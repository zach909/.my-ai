# Foreground Mixture of Experts — Implementation Spec

Status: implementation-ready. Extends the existing Foreground MoE subsystem
(`docs/ARCHITECTURE.md` §1.4/§1.4b) rather than replacing it. Every data
structure and API below is additive to `models && skills/core/moe-router.ts`,
`models && skills/moe.ts`, and `tinygpt/moe.py` — nothing here requires
breaking an existing call site. Section numbers are local to this document
(cited as "FG-MoE §N"), distinct from the design-notes section numbers used
elsewhere in `docs/ARCHITECTURE.md`.

## 0. Invariant carried over from the existing system

**An expert is a routing label over the shared, fully-wired substrate — never
an isolated sub-network.** `NeuronMesh`/`ElasticCoreBlock` stay all-to-all;
`activeGroups` gates *compute per tick*, not wiring. Every operation below
(create/delete/merge/split) must preserve this: it always ends by adjusting
router state and neuron-group membership, never by tearing out or duplicating
wiring outside the mesh's own `addNode`/`removeNode`.

---

## 1. Data structures

### 1.1 Expert record (extends `moe.ts`'s `Expert`)

```typescript
interface ExpertRecord {
  id: number;                    // dense 0..n-1, owned by MoERouter
  name: string;
  kind: 'skill' | 'extension';   // FG-MoE §6
  specialization: string;
  neuronIds: number[];           // mesh nodes this expert's group owns
  parentIds?: number[];          // set by merge (2+ parents) or split (1 parent)
  activationThreshold: number;
  lastUsed: number;
  usageCount: number;
  createdAt: number;
  lineage: 'created' | 'merged' | 'split';
}
```

### 1.2 Router network state (extends `MoEConfig`/`MoERouter`)

```typescript
interface RouterNetworkState {
  routerWeights: Float32Array;   // [inputDim x expertCount], row-major
  routerBias: Float32Array;      // [expertCount]
  routerHiddenWeights?: Float32Array; // optional 2-layer gate, FG-MoE §3.2
  temperature: number;           // softmax temperature, adaptive (FG-MoE §9)
  noiseStd: number;              // exploration noise, decayed over iteration count
}
```

### 1.3 New decision/report types

```typescript
interface CapacityReport {
  expertId: number;
  capacity: number;              // floor(tokensThisBatch/expertCount * capacityFactor)
  assigned: number;
  overflowed: number;            // tokens dropped/rerouted to next-best expert
}

interface MergeRequest { sourceIds: [number, number]; strategy: 'weight-average' | 'distill'; }
interface SplitRequest { sourceId: number; count: number; strategy: 'clone-perturb' | 'cluster'; }

interface MergeResult { newExpertId: number; retiredIds: number[]; similarityScore: number; }
interface SplitResult { newExpertIds: number[]; retiredId: number; clusterAssignments?: Int32Array; }
```

These slot directly into the existing `Map<number, {weights, bias}>` expert
table in `MoERouter` — no change to its shape, only new methods that produce
and consume it (FG-MoE §4–§7).

---

## 2. Expert routing (algorithm)

Per forward call, for input vector `x`:

1. `scores = routerWeights · x + routerBias` (or two-layer gate, §3.2).
2. If `noiseStd > 0` and in exploration mode: `scores += N(0, noiseStd)` per
   expert (load-balancing exploration, Shazeer et al. noisy top-k — new,
   config-gated, default off to preserve today's deterministic behavior).
3. `topK = argtopk(scores, config.topK)`.
4. `weights = softmax(scores[topK] / temperature)`.
5. For each `i in topK` (parallel — FG-MoE §10): `out_i = expert_i.forward(x)`.
6. `combinedOutput = Σ weights[i] * out_i`.
7. Update `utilization[i]` for every selected expert (existing behavior).
8. Record `CapacityReport` if `capacityFactor` enforcement is enabled (§9.2 —
   this is what finally makes the currently-dead `capacityFactor` field live).

This is exactly today's `MoERouter.route()`/`forward()` shape with three
additive, config-gated hooks (noise, capacity enforcement, parallel dispatch).
Existing callers that never touch the new config fields see identical output.

---

## 3. Router network

### 3.1 Baseline (already implemented, keep as-is)
Single linear layer `inputDim -> expertCount`, softmax over top-k, randomly
initialized, never trained in TS (matches survey: TS router is inference-only
today). This spec does not change that default.

### 3.2 Trainable gate (new, opt-in via `MoEConfig.routerHiddenDim > 0`)
Two-layer gate `inputDim -> routerHiddenDim -> expertCount` (GELU hidden),
mirroring `tinygpt/moe.py`'s trainable `MoELayer` gate. Exposes
`getRouterParameters()`/`applyRouterGradients(grads)` following the same
pattern as `ElasticCoreBlock.getParameters()`/`applyGradients()` — the one
place in the TS codebase that already has a working param/gradient contract
to copy. This closes the survey gap "no trainable TS router."

### 3.3 Python gate
No change — `MoELayer`'s gate is already a real trainable `nn.Linear`. This
spec's `RouterNetworkState` is documented so a TS↔Python weight import/export
path (`exportRouterWeights()`/`loadRouterWeights()`, plain `Float32Array` ↔
`.npy`) can move a trained Python gate into the TS runtime for inference.

---

## 4. Expert creation

```typescript
addExpert(spec: {
  name: string;
  kind: 'skill' | 'extension';
  specialization: string;
  neuronCount: number;
  weights?: Float32Array;   // omit -> Xavier-init like today's addExpert
  bias?: Float32Array;
}): ExpertRecord
```

Steps: allocate `neuronCount` mesh nodes under a new group label
(`mesh.addNode(layer, group)` — existing method), register the group+weights
with `MoERouter.addExpert` (existing overload), stamp `lineage: 'created'`,
`createdAt: Date.now()`. Two creation paths funnel into this one API:

- **Skill path** (FG-MoE §6.1): `PluginRegistry.registerSkill()` /
  `ExtensionBuilder.build_skill()` (Python) call this after training
  converges, exactly as `wiki/MoE.md` documents today for
  `build_expert_moe()`.
- **DSL path** (FG-MoE §6.3): a NeuroLang `<name>@` declaration
  (`example_experts.nl` pattern) compiles to this same call.

No new neuron-wiring mechanism — reuses `mesh.addNode`.

---

## 5. Expert deletion

```typescript
removeExpert(id: number, opts?: { freeNeurons?: boolean }): void
```

Extends `MoERouter.removeExpert` (exists) up to `MixtureOfExperts` (missing
today per survey — this is the fix). Steps:

1. Refuse if `id` is the sole expert for a `PluginDefinition` still marked
   active in `PluginRegistry` (call `unregisterSkill` first) — prevents
   orphaning a live skill, extending `testExpertRegistrationCompleteness`'s
   invariant to also hold on deletion.
2. `MoERouter.removeExpert(id)` — rebuilds the dense 0..n-1 id space
   (existing logic, unchanged).
3. If `opts.freeNeurons` (default `true`): `mesh.removeNode` for every id in
   `neuronIds` (existing method) so freed neurons return to the shared value
   pool per the zero-sum elastic budget (§1.3 of `docs/ARCHITECTURE.md`).
4. Emit a deletion record to the audit log used by `SelfHealer` snapshots
   (existing pattern in `self-healer.ts`) so deletion is revertible if it
   turns out to have been a mistake — matches the "repairs are never silent"
   principle already established for that subsystem.

---

## 6. Expert merging

```typescript
mergeExperts(req: MergeRequest): MergeResult
```

Motivation: two experts whose `getUtilizationStats()` show heavily
overlapping input distributions (cosine similarity of their router weight
columns above a threshold) waste routing capacity and dilute both experts'
training signal.

Algorithm:

1. Compute `similarityScore = cosineSim(routerWeights[:, a], routerWeights[:, b])`.
   Refuse (throw) below `config.mergeSimilarityThreshold` (default `0.6`) —
   merging dissimilar experts silently corrupts routing, so this is a hard
   gate, not a warning.
2. `strategy: 'weight-average'` — new expert's `{weights, bias}` = usage-
   weighted average of the two source experts' weights (weight = each
   expert's `totalCalls` from `ExpertUtilizationStats`, so the
   more-exercised expert dominates the merge).
3. `strategy: 'distill'` — new expert is a freshly Xavier-initialized network
   trained for `config.distillSteps` (Python-side only, via `ExtensionBuilder`
   contract training against the union of both sources' training data) —
   this is the only merge path with real accuracy recovery; `weight-average`
   is a fast, TS-only approximation for the foreground path.
4. Union `neuronIds` from both parents into the new expert's group
   (`mesh.addNode` for any that aren't already shared, per FG-MoE §0 — most
   will already be shared since the substrate is dense).
5. `addExpert` the result with `lineage: 'merged'`, `parentIds: [a, b]`.
6. `removeExpert` on both sources (§5), routing all their router-weight
   column mass onto the new expert's column via `1 - "average, not append"`:
   the merge **replaces** two router columns with one, keeping `expertCount`
   from growing unboundedly.

---

## 7. Expert splitting

```typescript
splitExpert(req: SplitRequest): SplitResult
```

Motivation: one expert dominating utilization (`utilization > config.
splitUtilizationThreshold`, default `0.4` of total traffic across all
experts) is a load-balancing signal (§9) that it has learned two or more
distinct sub-specializations worth routing separately.

Algorithm:

1. `strategy: 'clone-perturb'` (TS, fast, default): create `req.count` clones
   of the source expert's `{weights, bias}`, each perturbed with small
   Gaussian noise (`σ = config.splitPerturbStd`, default `0.02`) so they
   start near-identical but diverge under subsequent routing/training —
   standard "duplicate and let gradient descent differentiate" split used in
   expert-growth MoE literature. `neuronIds` are duplicated in full (each
   split child gets its own copy of the group so subsequent per-child
   fine-tuning doesn't collide) — cost is bounded because splitting a
   `usageCount`-hot expert is expected to be rare.
2. `strategy: 'cluster'` (Python, offline/background, slower but principled):
   cluster the source expert's recent activation inputs (k-means,
   `k = req.count`, over a rolling buffer analogous to
   `RoutingStabilityMonitor`'s window) and initialize each child by
   fine-tuning on only its cluster's inputs via `ExtensionBuilder.train()`'s
   existing contract-loss + don't-forget machinery. Produces
   `clusterAssignments` for inspection.
3. `addExpert` each child with `lineage: 'split'`, `parentIds: [sourceId]`.
4. `removeExpert(sourceId)` (§5) — the parent's router column is replaced by
   `req.count` new columns, same "no unbounded growth from replace" rule as
   merge, applied in reverse.

---

## 8. Skill experts vs. extension experts

Carrying forward the distinction already established in `plugin_manager/
types.ts` and `wiki/Skills.md`/`wiki/Extensions.md` — this spec does not
invent a new taxonomy, it gives it a routing-level home:

| | Skill expert | Extension expert |
|---|---|---|
| Origin | Self-authored, trained in-process (`ExtensionBuilder.build_skill`) | Installed from a `.ext`/`.neuri` artifact (`install_extension`) |
| `ExpertRecord.kind` | `'skill'` | `'extension'` |
| `SkillDefinition.expertIndex` | Set at registration (existing field) | Set at install time, same field |
| Deletable via §5 | Yes, cascades to `unregisterSkill` | Yes, cascades to plugin deactivation |
| Mergeable/splittable (§6/§7) | Yes | Only via `weight-average`/`clone-perturb` — `distill`/`cluster` require training data extension experts may not ship with |

`route()` (§2) does not branch on `kind` — routing is uniform. `kind` only
gates which lifecycle operations are safe (a `distill` merge needs training
data a bare installed extension may lack, so `mergeExperts` on two
`'extension'`-kind experts silently falls back to `weight-average` regardless
of requested strategy, with a note in `MergeResult`... actually surfaced as
a thrown error if `distill` is explicitly requested on extension-kind experts
without attached training data, per the "report anything unrecoverable
rather than hiding it" principle from `self-healer.ts`).

---

## 9. Dynamic routing & load balancing

### 9.1 Dynamic routing (closes the `adaptive_routing.py` gap)
`AdaptiveExpertRouter`'s decision logic (`switch`/`explore`/`tighten`/`none`)
is real; only `apply_routing_decision`'s re-routing is stubbed. This spec
completes it:

- `switch` → call `MoERouter`'s existing `setExpertWeights` is *not* right
  (that mutates weights); dynamic routing should instead adjust
  **`config.topK`** and **`temperature`** (§3.1's `RouterNetworkState`) live,
  not expert weights. Add `router.setDynamicParams({ topK?, temperature? })`.
- `explore` → temporarily raise `noiseStd` (§2 step 2) for
  `config.exploreWindow` iterations, then decay back to 0.
- `tighten` → lower `temperature` (sharper softmax, more confident routing).
- `none` → no-op.

This gives `apply_routing_decision` concrete TS-side or Python-gate knobs to
call instead of the placeholder comment, closing the survey's "explicitly
marked simplified" gap.

### 9.2 Load balancing
Two mechanisms, reconciled (survey found TS has only a read-only metric,
Python has a real trained-in aux loss):

- **TS (inference-time, non-differentiable)**: keep
  `computeLoadBalanceLoss` as the *signal*, but make it actionable — when it
  exceeds `config.loadBalanceThreshold`, trigger §7 (split the dominant
  expert) or §6 (merge underutilized ones, `utilization < config.
  mergeUtilizationThreshold`, default `0.02`). This is the load-balancing
  loop for the foreground/inference path, where there's no gradient to push.
- **Python (training-time, differentiable)**: unchanged — `moe.py`'s
  Switch-style `n_experts * Σ f_i·P_i` aux loss already does real
  gradient-based balancing during training. No changes needed; §9.1/§9.2's
  TS mechanisms are the foreground analogue for the deployed system, where
  retraining isn't an option per-request.
- **Capacity factor** (closes the "dead config field" gap): implement token
  dropping. When routing a batch, if `assigned > capacity` for an expert
  (`capacity = floor(batchSize / expertCount * capacityFactor)`), overflow
  tokens re-route to their next-best-scoring expert in `topK+1..`; if still
  over capacity there too, they get `combinedOutput` from the un-selected
  residual (zero contribution) rather than blocking — matches standard MoE
  capacity-drop semantics and finally uses `MoEConfig.capacityFactor`.

---

## 10. Parallel execution

Survey finding: TS `route()`'s top-k expert forward passes run synchronously
in a loop; the only real concurrency pattern in the codebase is
`HiveMind.collaborate()`'s `Promise.all`.

Spec: give `MoERouter.route()` an execution-mode config,
`parallelism: 'sync' | 'promise-all' | 'worker-pool'` (default `'sync'`,
preserving today's behavior exactly):

- `'promise-all'`: wrap each selected expert's `forward()` in a resolved-or-
  async function and `await Promise.all(...)` — free win when experts are
  I/O-bound (e.g. an extension expert that calls a plugin/tool), no win for
  CPU-bound matmuls on a single thread (documented limitation, not solved
  here — Node's single-threaded JS can't parallelize CPU-bound work without
  Workers).
- `'worker-pool'`: dispatch each selected expert's forward pass to a
  `worker_threads` pool (new, small: `MoEWorkerPool` wrapping
  `node:worker_threads`, sized `min(topK, os.cpus().length - 1)`) — real
  compute parallelism for CPU-bound expert MLPs on large `expertHiddenDim`.
  Falls back to `'sync'` if pool creation fails (never throws mid-route).
- Python: `ExpertMoE`'s per-token routing is already vectorized/batched by
  PyTorch; no new parallelism needed there — batched tensor ops are the
  correct unit, not per-expert threads.

Benchmark hook: `benchmarks/moe_benchmark.ts` gets a new `parallelism` axis
alongside its existing expert-count/top-k axes (closes the survey gap that
today's benchmark never varies concurrency).

---

## 11. Memory interaction

- **NeuronMesh** (`mesh.ts`): unchanged contract — experts' `neuronIds` are
  mesh groups, `tick()`/`propagate(..., activeGroups)` is how routing
  becomes compute, per FG-MoE §0. Create/delete/merge/split all go through
  `addNode`/`removeNode`, never direct neuron mutation.
- **Elastic value budget**: deleting/merging experts frees neurons back into
  the zero-sum value pool (§1.3, `docs/ARCHITECTURE.md`); creating/splitting
  draws from it. `MergeResult`/`SplitResult` should be logged alongside
  `ValueRangeAllocator` events so `total_value()`'s invariant stays
  auditable across MoE topology changes, not just per-neuron reward events.
- **Hive Mind blackboard**: unaffected directly, but `HiveAgent.delegate()`'s
  "lightweight analogue of MoE gating" (per its own comment) should log
  which real MoE expert (if any) backs the chosen agent, so the two routing
  layers (system-level `IntentRouter`, mesh-level `MoERouter`, agent-level
  `HiveMind.delegate`) stay traceable end-to-end for a single query — add an
  optional `expertId?: number` field to `HiveAgent`'s existing decision
  record, no structural change to trust/delegation logic itself.

---

## 12. Public API surface (summary)

```typescript
// models && skills/core/moe-router.ts — MoERouter, additive methods
class MoERouter {
  // existing: addExpert, removeExpert, setExpertWeights, route, forward, getUtilizationStats
  setDynamicParams(params: { topK?: number; temperature?: number; noiseStd?: number }): void;
  mergeExperts(req: MergeRequest): MergeResult;
  splitExpert(req: SplitRequest): SplitResult;
  getCapacityReport(): CapacityReport[];
  getRouterParameters(): Float32Array[];      // §3.2, opt-in trainable gate
  applyRouterGradients(grads: Float32Array[]): void;
}

// models && skills/moe.ts — MixtureOfExperts, additive methods
class MixtureOfExperts {
  // existing: addExpert, addNeuronsToExpert, tick
  removeExpert(id: number, opts?: { freeNeurons?: boolean }): void;   // FG-MoE §5, closes wrapper gap
  mergeExperts(req: MergeRequest): MergeResult;                        // delegates to router + mesh union
  splitExpert(req: SplitRequest): SplitResult;                         // delegates to router + mesh duplication
}
```

```python
# tinygpt/adaptive_routing.py — AdaptiveExpertRouter, completes the stub
class AdaptiveExpertRouter:
    def apply_routing_decision(self, decision) -> None:
        # switch  -> self.gate.set_dynamic_params(top_k=..., temperature=...)
        # explore -> self.gate.set_noise_std(eps, window=self.explore_window)
        # tighten -> self.gate.set_dynamic_params(temperature=lower)
        # none    -> no-op
        ...
```

---

## 13. Algorithms (pseudocode reference)

```
ROUTE(x, config, state):
    scores = state.routerWeights · x + state.routerBias
    if state.noiseStd > 0: scores += gaussian(0, state.noiseStd, len(scores))
    topK_idx = argtopk(scores, config.topK)
    w = softmax(scores[topK_idx] / state.temperature)
    if config.capacityFactor enabled: topK_idx, w = ENFORCE_CAPACITY(topK_idx, w, config)
    outs = PARALLEL_MAP(topK_idx, id -> experts[id].forward(x), config.parallelism)
    return combine(w, outs)

ENFORCE_CAPACITY(idx, w, config):
    for each expert e in idx where assigned[e] > capacity(e, config):
        overflow = assigned[e] - capacity(e, config)
        reroute overflow tokens to next-best-scoring expert not already at capacity
        tokens still over capacity after all experts saturated -> zero contribution
    return idx', w'

MERGE(a, b, config):
    assert cosineSim(routerCol(a), routerCol(b)) >= config.mergeSimilarityThreshold
    newWeights = weightedAverage(a.weights, b.weights, by=usageCount)
    newExpert  = addExpert(newWeights, neuronIds=union(a.neuronIds, b.neuronIds), lineage='merged')
    removeExpert(a); removeExpert(b)
    return newExpert

SPLIT(source, count, config):
    children = [perturb(source.weights, sigma=config.splitPerturbStd) for _ in range(count)]
    newExperts = [addExpert(w, neuronIds=copy(source.neuronIds), lineage='split') for w in children]
    removeExpert(source)
    return newExperts

LOAD_BALANCE_TICK(router, config):
    loss = computeLoadBalanceLoss(router.getUtilizationStats())
    if loss > config.loadBalanceThreshold:
        dominant = argmax(utilization)
        if utilization[dominant] > config.splitUtilizationThreshold: SPLIT(dominant, 2, config)
        underused = [e for e in experts if utilization[e] < config.mergeUtilizationThreshold]
        for pair in similarPairs(underused, config.mergeSimilarityThreshold): MERGE(*pair, config)
```

---

## 14. Testing plan

Extends `test/smoke.mjs`'s existing `check()`-based suite (no new test
framework — matches repo convention) and `test_core.py`.

New TS smoke sections (mirroring existing naming, e.g.
`Foreground MoE lifecycle (Section FG-1..FG-6)`):

1. `testExpertMerge` — merge two experts with forced-similar router columns;
   assert `expertCount` decreases by 1, `neuronIds` union preserved, mesh
   still fully wired (density 1.0, per `testMoESharedMesh`'s existing check),
   old ids no longer routable, `mergeExperts` throws below similarity
   threshold.
2. `testExpertSplit` — split a dominant expert into 2; assert `expertCount`
   increases by 1 net, children start near-identical (`cosineSim` above
   `0.9` immediately post-split), diverge after simulated distinct-input
   ticks, `parentIds` traceable.
3. `testExpertDeletionCascade` — `MixtureOfExperts.removeExpert` on an
   active skill's sole expert must fail until `unregisterSkill` runs first;
   after cascade, `mesh.getGroupNodeIds` returns empty for the freed group,
   `total_value()`-equivalent neuron count is conserved (freed, not lost).
4. `testCapacityDropping` — overload one expert past `capacityFactor`;
   assert overflow reroutes to next-best, and `CapacityReport.overflowed`
   is nonzero and accounted for (no silently dropped tokens — `combinedOutput`
   dimension stays correct even with a zero-contribution residual).
5. `testDynamicRoutingParams` — `setDynamicParams` changes `topK`/
   `temperature` live and `route()` reflects it same-tick, no restart needed.
6. `testParallelismModes` — same input routed under `'sync'` and
   `'promise-all'` produces bit-identical `combinedOutput` (parallelism must
   not change results, only wall time) — add `'worker-pool'` once
   `MoEWorkerPool` lands, same identity check.
7. `testLoadBalanceAutoTuning` — synthetic utilization skew triggers
   `LOAD_BALANCE_TICK` to split the dominant / merge underused experts
   automatically; assert `computeLoadBalanceLoss` decreases after the tick.

New Python tests (`test_core.py`):

8. `test_adaptive_routing_apply_decision` — each of `switch/explore/
   tighten/none` actually mutates `MoELayer`'s live `top_k`/`temperature`/
   noise, replacing the current no-op path; assert `skill_usage()` shifts
   accordingly under a synthetic skewed-input stream.
9. `test_expert_merge_distill` — Python-only `distill` strategy merge
   recovers accuracy within a tolerance on a held-out synthetic task versus
   the two source experts individually, using `ExtensionBuilder`'s existing
   contract-loss training.
10. `test_expert_split_cluster` — k-means `cluster` strategy split produces
    `clusterAssignments` consistent with a synthetic two-mode input
    distribution (children specialize on separable clusters).

Benchmark addition (`benchmarks/moe_benchmark.ts`): parallelism-mode axis
(§10) reported alongside existing expert-count/top-k throughput numbers.

Existing suites that must keep passing unchanged, as a regression gate:
`testMoE`, `testMoESharedMesh`, `testExpertRegistrationCompleteness`,
`test_moe`, `test_experts`, `test_mesh_with_experts`, `test_skills_attach_to_mesh`.

---

## 15. Non-goals / explicitly out of scope

- Cross-process/distributed expert placement (this spec assumes a single
  local process, matching the "no external APIs, runs on your machine"
  principle in `docs/ARCHITECTURE.md`).
- Changing `IntentRouter`'s system-level capability routing (§1.4b) — that
  stays a separate, simpler keyword classifier; this spec only touches the
  mesh-level `MoERouter`/`MixtureOfExperts`.
- Replacing `HiveMind.delegate()`'s trust-based agent routing — §11 only
  adds traceability, not a behavior change.
