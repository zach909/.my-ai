# Code-to-Net Compiler — Implementation Specification

Status: specification. Formalizes and extends the existing prototype
(`models && skills/core/code-to-net.ts`'s `CodeToNetCompiler`/`CodeNet`,
`model && skills manager/neurolang.py`'s `train_codenet`/`_probe_python`, and
`extension-builder/core/thorns.js`'s structural `CodeToNet`) under the
governing design note quoted in `wiki/Code-to-Net.md`:

> "Code-to-Net imports binary or source code and converts it into an
> equivalent neural network."

**"Equivalent" is graded, not binary, and this spec makes that explicit.**
Some code compiles to a network that is *exactly* equivalent by
construction (no training, no error). Most numeric code compiles to a
network that is *behaviorally* equivalent within a measured, tested
tolerance (trained by sampling). Code that is neither compiles to a network
that is *only identity-equivalent* — it can be recognized and referenced,
but it does not reproduce behavior, and this compiler says so rather than
pretending otherwise.

---

## 0. What already exists vs. what this spec adds

| Area | Exists today | This spec adds |
|---|---|---|
| Compiler pipeline | `CodeToNetCompiler.compile()` — parse → fit-or-embed | Named, staged pipeline (§1) with a third tier: exact symbolic compilation for affine expressions |
| Parsing | Regex-based arrow/function/bare-expression matcher + `DENY` token list (TS `buildFunction`); real `ast.parse` + `exec` + `inspect.signature` probing (Python `_probe_python`) | Formalized grammar (§2), safety-scan contract, byte-stream frontend named as a first-class parser (not just "the other file") |
| IR | None — TS goes straight from "parses safely" to "sample it as a black box"; Python the same | New `CodeIR` type family (§3): `affine` (exact), `sampled` (approximate, existing black-box), `byte-stream` (existing, structural), `embedding` (existing, identity-only) |
| Graph generation | Function-mode weights live only inside `CodeNetFunctionParams`, never materialized as `NeuronData`/`ConnectionData`; byte-mode (`thorns.js`) already emits a real neuron chain | `materializeGraph()` (§4): turns a compiled `CodeNet` (any tier) into the same structural neuron/connection shape Extension Builder already understands, so a compiled function is visible and editable, not an opaque blob |
| Optimization | None | Coefficient pruning, hidden-neuron pruning, byte-segment merging, quantization hook into `docs/EXTENSION_BUILDER_SPEC.md` §6 (§5) |
| Validation | `testAgainst()` — function-mode sampling + tolerance check, embedding-mode signature re-check | Exact-equality validation for the affine tier, byte-stream round-trip losslessness check, CI-enforced "every compile is validated" rule (§6) |
| Execution | `CodeNet.evaluate()` | Named `interpret` vs. `network` execution modes for explicit ground-truth comparison (§7) |
| Debugging | None | `explainEvaluate()`, `divergenceReport()`, fallback-reason reporting (§8) |
| APIs | `CodeToNetCompiler`, `train_codenet`, `CodeToNet.importCode` | Unified surface adding `materializeGraph`, `explainEvaluate`, `divergenceReport`, `verifyRoundTrip` (§9) |
| Testing | `test_core.py::test_code_to_net`, `test/smoke.mjs` §21 | Affine-exactness tests, graph-materialization round trip, byte-stream losslessness, pruning-safety tests (§10) |

---

## 1. Compiler

### 1.1 Pipeline stages

```
[1] Frontend select   — is the input source text or a raw byte stream? (§2.1)
[2] Parse              — produce a CodeIR (§3) via the matching parser (§2)
[3] Tier resolution     — IR kind decides what happens next:
                            affine      → §4.1 (exact, no training)
                            sampled      → §4.2 (fit, existing MLP path)
                            byte-stream   → §4.3 (existing structural chain)
                            embedding     → §4.4 (existing identity signature)
[4] Graph generation    — materialize NeuronData/ConnectionData (§4)
[5] Optimize             — tier-specific passes (§5)
[6] Validate              — tier-appropriate check, mandatory (§6)
[7] Emit                  — CodeNet (behavioral) + optional structural graph,
                            tagged with tier, validation result, and (for
                            sampled/embedding) the fallback reason if the
                            input didn't reach a higher tier (§8.3)
```

Stage 3's tier resolution is the compiler's actual novelty: today's
implementation only has two outcomes (`function` via sampling, or
`embedding`). This spec inserts `affine` above `function`/`sampled` as a
strictly-preferred, zero-training, provably-exact path, and keeps
`byte-stream` as a distinct fourth outcome for binary input rather than
folding it into `embedding`.

### 1.2 Two frontends, one compiler

`CodeToNetCompiler` (source text, TS/Python) and `CodeToNet.importCode`
(raw bytes, `thorns.js`) remain separate entry points — a source compiler
and a binary compiler — but both terminate in the same `CodeIR`/graph
representation (§3, §4) so downstream stages (optimize, validate, emit) are
shared code, not duplicated per frontend.

---

## 2. Parsing

### 2.1 Frontend selection

`compile(name, code)` — if `code` is a `string`, use the source frontend
(§2.2); if it's bytes (`Uint8Array` TS / `bytes` Python), use the binary
frontend (§2.4). This is an explicit dispatch on input type, not a
heuristic — a caller that has bytes never accidentally gets treated as
source text.

### 2.2 Source frontend grammar

Formalizes what `buildFunction` (TS, regex-based) and `_probe_python`
(Python, real AST) already each accept, as one grammar both must honor:

```
program    := arrow | namedFunction | bareExpression
arrow      := '(' params ')' '=>' body | IDENT '=>' body
namedFunction := 'function' IDENT? '(' params ')' '{' stmts '}'
bareExpression := expr                      -- params inferred (§2.3)
params     := (IDENT (',' IDENT)*)?
body       := expr | '{' stmts '}'
expr       := term (('+'|'-') term)*
term       := factor (('*'|'/') factor)*
factor     := NUMBER | IDENT | '-' factor | '(' expr ')'
             | 'Math.' FNNAME '(' expr (',' expr)* ')'
             | expr '?' expr ':' expr        -- ternary (ARITH ops only get affine tier; ternary/Math.* force sampled tier, §3.2)
             | expr COMPARE expr              -- comparisons force sampled tier
```

### 2.3 Parameter inference

When no parameter list is present (bare expression), scan for the canonical
variable set `["a","b","c","d","x","y","z","x0","x1","x2","x3"]`
(TS, existing `CANONICAL_VARS`) or use real signature introspection
(`inspect.signature`, Python — strictly more precise since Python requires
an actual named function). This spec keeps both: Python's AST-based
approach is preferred where available (it can't misfire the way a regex
could); TS's canonical-variable inference remains the fallback for bare
arithmetic expressions with no declared signature at all, which Python's
`_probe_python` doesn't accept either (it requires a `FunctionDef`).

### 2.4 Safety scan (mandatory before any evaluation)

TS: the `DENY` regex — a fixed denylist of identifiers/tokens
(`require`, `eval`, `Function`, `this`, backtick, `[`, `]`, backslash,
etc., see `code-to-net.ts` lines 116-123) checked against the raw source
*before* the `Function` constructor ever sees it. Python: `_probe_python`
doesn't need a denylist in the same way because `exec` runs inside a fresh,
throwaway namespace dict with no injected globals — but this spec adds one
anyway (mirroring the TS `DENY` set, checked via `ast.walk` for
`ast.Import`/`ast.Call` to dangerous names) as defense in depth, since a
function body can still reach `__builtins__` through the default exec
environment unless explicitly stripped. **Required Python addition**:
`exec(compile(tree, '<cn>', 'exec'), {'__builtins__': {}})` — the current
`_probe_python` passes an empty `ns` dict but does not strip
`__builtins__`, which Python auto-injects into any exec'd module namespace;
this is a real gap this spec closes, not a hypothetical one.

### 2.5 Binary frontend

`CodeToNet.importCode(bytecode, behavior)` (existing, `thorns.js`):
fixed-size (8-byte) segmentation, one neuron per segment, chained
sequentially. This spec keeps the segmentation scheme as-is (§4.3) and adds
only a documented invariant: segment `i`'s neuron stores the *exact* bytes
of that segment (`neuron.bytecode = segment`), which is what makes
lossless round-trip validation (§6.3) possible — concatenating every
neuron's `bytecode` field in chain order must reproduce the input exactly.

---

## 3. Intermediate representation

### 3.1 `CodeIR` — the shared type all frontends normalize to

```ts
type CodeIR =
  | { kind: "affine"; arity: number; paramNames: string[]; coeffs: number[]; bias: number; sourceHash: string }
  | { kind: "sampled"; arity: number; paramNames: string[]; fn: (...args: number[]) => number; sourceHash: string }
  | { kind: "byte-stream"; bytes: Uint8Array; segmentSize: number; sourceHash: string }
  | { kind: "embedding"; sourceHash: string; reason: FallbackReason };

type FallbackReason =
  | "denied-token" | "unparseable" | "nonlinear" | "not-numeric"
  | "no-function-found" | "empty-or-oversize";
```

`sourceHash` is the existing SHA-256 prefix convention
(`hash.slice(0,12)` in Python's `train_codenet`; TS gains the equivalent)
— every IR node carries the identity of the code it came from, so
`materializeGraph` output and cached compiles can be keyed by it.

### 3.2 Tier resolution: affine vs. sampled

This is the compiler's one genuinely new analysis. After the parser
produces an expression tree (§2.2) that passes the safety scan (§2.4), a
**linearity check** decides `affine` vs. `sampled`:

```
isAffine(expr):
  - NUMBER                      → affine (constant)
  - IDENT                       → affine (coefficient 1 on that variable)
  - -factor                     → affine iff factor is affine (negate coefficients)
  - a + b, a - b                → affine iff both a and b are affine (coefficients add/subtract)
  - a * b                       → affine iff exactly one side is a compile-time constant
                                    (distribute the constant into the other side's coefficients);
                                    NOT affine if both sides contain a variable
  - a / b                       → affine iff b is a compile-time constant (divide coefficients)
  - Math.*(...)                  → never affine (forces sampled tier)
  - ternary, comparisons          → never affine (forces sampled tier)
```

A successful affine reduction folds the whole expression into
`coeffs: number[]` (one per `paramNames[i]`) plus a scalar `bias` —
e.g. `(x, y) => 2*x - 3*y + 5` reduces to `coeffs=[2,-3], bias=5` exactly,
via ordinary constant folding and distribution, not sampling. Anything that
fails the check (a genuine product of two variables, any `Math.*` call, any
branch) falls through to `sampled` — the existing black-box
sample-and-fit path, unchanged.

### 3.3 Why this tier matters

An affine function compiled via §3.2 has **zero approximation error by
construction** — the "equivalent neural network" claim in
`wiki/Code-to-Net.md` is literally true for this subset, not
tolerance-bounded like the sampled tier. This also make affine-tier
`compile()` calls essentially free (no epochs, no sampling, no RNG seed
sensitivity) — a meaningful fraction of real Code-to-Net inputs (unit
conversions, weighted sums, linear scoring formulas — exactly the kind of
small numeric snippets this system imports) fall into this tier and get an
exact, instant compile instead of a 600-epoch SGD fit.

---

## 4. Graph generation

Turns a `CodeIR` (§3) into both a `CodeNet` (behavioral, existing shape)
and a structural graph (`NeuronData[]`/`ConnectionData[]`, matching
`docs/EXTENSION_BUILDER_SPEC.md` §8.2) via a new `materializeGraph(ir)`
step — today's `CodeNet` is opaque (its weights live only in
`CodeNetFunctionParams`, invisible to the visual editor); this closes that
gap so a compiled function shows up as real, inspectable, editable nodes.

### 4.1 `affine` → graph

One input neuron per parameter, one linear output neuron, one connection
per parameter with `weight = coeffs[i]` and the output neuron's own `bias`
field set to `bias` — no hidden layer, because none is needed:

```
paramNames[i] --(weight: coeffs[i])--> output   for each i
output.bias = bias
```

This is a direct, lossless rendering of the exact linear circuit — the
graph *is* the computation, not an approximation of it.

### 4.2 `sampled` → graph

The existing 1-hidden-layer tanh MLP (`fit()`, `code-to-net.ts` lines
241-315) materializes as: `arity` input neurons → `hidden` hidden neurons
(each an `NeuronData` whose connections carry `W1[j][i]` and whose own
`vale`/bias field carries `b1[j]`) → 1 output neuron (connections from each
hidden neuron carrying `W2[j]`, output bias `b2`). Input normalization
(`inMin`/`inMax`) and output de-standardization (`outMean`/`outStd`) are
stored as metadata on the input/output neurons respectively (new
`NeuronData` fields `normMin`/`normMax` on inputs, `denormMean`/`denormStd`
on the output) rather than silently baked into edge weights — keeping them
visible is what makes the debugger (§8) able to explain a prediction in
original (non-normalized) units.

### 4.3 `byte-stream` → graph

Unchanged: `CodeToNet.importCode`'s existing chain of 8-byte-segment
neurons, sequential connections weight `1.0`. Kept exactly as implemented.

### 4.4 `embedding` → graph

One `codenet`-type neuron per `docs/EXTENSION_BUILDER_SPEC.md`'s existing
`NeuronData.type` union, whose `definition` field holds the deterministic
signature vector (serialized) and whose `code` field holds the original
source — no connections, matching current behavior (`addCodeNet` in
`extension-builder/builder.js` already creates exactly this shape).

---

## 5. Optimization

Passes are tier-specific; each is optional (config flag) and must not
change the tier's validation outcome (§6) beyond its documented tolerance.

### 5.1 `affine` — algebraic simplification (exact, always safe)

- **Zero-coefficient elimination**: drop input neurons/connections whose
  `coeffs[i] == 0` — they contribute nothing, and removing them shrinks the
  graph without changing `evaluate()`'s output at all (not approximately —
  identically, since the term was `0 * x`).
- **Constant folding**: already implied by §3.2's reduction — no separate
  pass needed; the affine tier never has a "before optimization" form with
  redundant constants to fold.

### 5.2 `sampled` — magnitude-based pruning (approximate, bounded)

- **Hidden-neuron pruning**: drop hidden neuron `j` if
  `|W2[j]| < pruneEpsilon` (default `0.01 * max(|W2|)`) — its contribution
  to the output is negligible relative to the other hidden neurons. After
  pruning, re-run validation (§6.2); if the pruned network's `meanAbsError`
  exceeds the original network's by more than 10%, the pass is rejected and
  the unpruned network is kept (pruning must not silently degrade a network
  that already passed validation).
- **Quantization hook**: sampled-tier weights are exactly the kind of
  trained numeric weights `docs/EXTENSION_BUILDER_SPEC.md` §6's
  quantization pipeline operates on — a materialized `sampled`-tier graph
  (§4.2) installs through that pipeline unmodified; this spec doesn't
  duplicate it, just confirms the graph shape (§4.2) is quantization-pipeline
  compatible (plain `ConnectionData.weight`/`bias` floats).

### 5.3 `byte-stream` — segment merging

Adjacent segments that are byte-identical (common in padded or
repeated-pattern binaries) merge into one neuron carrying a `repeatCount`
field instead of `repeatCount` duplicate neurons — `verifyRoundTrip`
(§6.3) expands repeats back out when reconstructing, so losslessness is
unaffected. Off by default (`mergeRepeats: false`) since it changes neuron
IDs/count, which existing structural consumers may not expect; opt-in only.

### 5.4 `embedding` — none

The embedding signature is already minimal (fixed `embedDim`, default 32);
there is nothing to optimize without changing the identity it encodes, so
no pass exists for this tier.

---

## 6. Validation

**Every `compile()` call is validated before being returned** — this spec
makes that non-optional (today, `testAgainst` is a separate call a caller
may or may not make). `compile()` internally runs the tier-appropriate
check from this section and attaches the result as `CodeNet.validation`;
a network that fails validation is still returned (callers may want it for
inspection) but is tagged `validation.passed = false` and
`explainEvaluate`/callers are expected to check that flag rather than
assume a returned `CodeNet` is trustworthy.

### 6.1 `affine` — exact equality (not sampled)

Since the affine tier is exact by construction (§3.3), its validation is
not `testAgainst`'s tolerance-based sampling — it's a direct algebraic
check: evaluate the original parsed expression and the materialized
graph (§4.1) at a small fixed set of canary inputs (`0`, `1`, `-1`, and one
random point) and assert equality within floating-point epsilon (`1e-9`),
not the 20%-of-range tolerance used for the sampled tier. A failure here
indicates a bug in the affine-reduction pass (§3.2) itself, not an
approximation limitation — it should never happen for correctly-classified
affine input, and CI treats it as a hard failure (§10.2), not a tolerance
tuning issue.

### 6.2 `sampled` — existing `testAgainst`, unchanged

Kept exactly as implemented: fresh samples from the same domain, mean
error compared against `tol = max(0.25, 0.2 * outputRange)`
(`code-to-net.ts` lines 186-190). This spec adds one requirement: the
samples used for validation must be drawn with a **different** RNG seed
than the samples used for fitting (already true — `testAgainst` uses
`opts.seed ?? 1234` XORed against a constant while `fit` uses the raw seed
directly at line 152 vs 247), which this spec calls out explicitly as a
required property (held-out evaluation, not train-set replay) rather than
an incidental implementation detail.

### 6.3 `byte-stream` — round-trip losslessness (NEW)

No validation exists for this tier today. New check: concatenate every
neuron's `bytecode` segment in chain order (following the `connections`
array from `inputLayer[0]` to `outputLayer[0]`) and assert byte-for-byte
equality with the original input. This is the correct notion of
"equivalent" for structural byte-chain mode — it's not claiming behavioral
equivalence (this tier never runs the code), only that the graph is a
lossless, reversible encoding of the exact bytes.

### 6.4 `embedding` — signature stability (existing, unchanged)

`testAgainst`'s embedding-mode branch already checks that re-embedding the
same code reproduces the same signature (`arraysClose(sig, net.getSignature(), 1e-9)`)
— kept as-is; this is the correct and only meaningful validation for a
tier that explicitly does not claim behavioral equivalence.

---

## 7. Execution

### 7.1 Two named execution modes

- **`interpret`**: run the original, parsed, safety-checked function
  directly (the `Function`-constructor closure in TS, the `exec`'d
  namespace function in Python). This is the ground truth used by fitting
  (§3.2's affine path doesn't need it; §sampled's `fit()` does) and by
  validation (§6.2/6.1's canary/sample comparisons).
- **`network`**: forward-pass through the compiled representation —
  the exact linear evaluation for `affine`, the tanh-MLP forward pass for
  `sampled` (`CodeNet.evaluate`, unchanged), the neuron-chain identity
  reconstruction for `byte-stream`, or the fixed signature return for
  `embedding`.

`CodeNet.evaluate(inputs)` (existing method, unchanged signature) is always
the `network` mode. This spec adds `CodeNet.evaluateReference(inputs)` —
`interpret` mode — as a companion method available whenever the original
source is retained (`CodeNet.source`, already stored), so a caller can
compare both without re-parsing.

### 7.2 Determinism

`network` mode is always deterministic (no RNG at evaluation time, for
every tier). `interpret` mode is deterministic only if the original code
is (arithmetic/`Math.*` functions are; this compiler never accepts code
with side effects or external state per the safety scan, §2.4, so
non-determinism in `interpret` mode should not occur for anything this
compiler accepted in the first place — if it does, that is itself a signal
the safety scan under-restricted, worth a §6 validation failure surfacing
it rather than silently comparing against a moving target).

---

## 8. Debugging

New capability — nothing like this exists in the prototype today beyond
the pass/fail boolean in `TestReport`.

### 8.1 `explainEvaluate(codeNet, inputs)`

Per-tier explanation of a single forward pass:

- **`affine`**: `{ terms: [{ param: "x", coeff: 2, value: 3, contribution: 6 }, ...], bias, total }` — literally the arithmetic, since the graph *is* the arithmetic (§4.1).
- **`sampled`**: `{ hiddenActivations: [{ neuron: j, preTanh, postTanh, outputWeight: W2[j], contribution }], bias: b2, normalizedInputs, denormalizedOutput }` — the MLP forward pass laid out neuron-by-neuron; reuses the same shape as `docs/EXTENSION_BUILDER_SPEC.md` §5.2's `explainConnection`, since §4.2 materializes this tier as real `NeuronData`/`ConnectionData` that method already operates on.
- **`byte-stream`**: `{ segmentsVisited: [{ neuron, offsetRange, bytesHex }] }` — which segment neurons the reconstruction walked, for inspecting a specific byte range.
- **`embedding`**: `{ signature, note: "identity-only; does not reproduce behavior" }` — deliberately blunt, so a caller can't mistake an embedding-mode explanation for a behavioral one.

### 8.2 `divergenceReport(codeNet, opts)`

For `sampled`-tier networks (the only tier where divergence is expected):
runs `testAgainst`'s sampling loop but, instead of collapsing to
`meanAbsError`/`maxAbsError`, returns every sample whose error exceeded
tolerance, sorted worst-first:

```ts
interface DivergenceEntry { input: number[]; expected: number; actual: number; absError: number }
interface DivergenceReport { tolerance: number; entries: DivergenceEntry[]; worstRegion?: { dim: number; approxRange: [number, number] } }
```

`worstRegion` is a coarse heuristic (bucket the failing samples' inputs
along each dimension into deciles, report the dimension/decile with the
most failures) — enough to tell a caller "the approximation breaks down
mainly when `x` is near its upper sampled bound," which is actionable
(widen `domain`, add samples there) without requiring a full sensitivity
analysis.

### 8.3 Fallback-reason reporting

Every `embedding`-tier or `sampled`-tier (when the caller expected
`affine`) result carries its `FallbackReason` (§3.1) forward into the
returned `CodeNet`. A debug UI (or `docs/EXTENSION_BUILDER_SPEC.md`'s
debug panel, §5 there) surfaces this directly: "this code fell back to
embedding mode because of a denied token (`while`)" is a specific,
actionable message — a strict improvement over the current
`mode: "embedding"` tag alone, which tells a caller *that* it fell back but
not *why*.

---

## 9. APIs

### 9.1 TypeScript (`CodeToNetCompiler`, extended)

```ts
class CodeToNetCompiler {
  compile(name: string, code: string, opts?: CompileOptions): CodeNet;   // existing, now tier-aware internally
  testAgainst(net: CodeNet, code: string, opts?: CompileOptions): TestReport; // existing, unchanged for sampled/embedding; NEW affine branch (§6.1)
  materializeGraph(net: CodeNet): { neurons: NeuronData[]; connections: ConnectionData[] };  // NEW (§4)
  explainEvaluate(net: CodeNet, inputs: number[]): ExplainResult;         // NEW (§8.1)
  divergenceReport(net: CodeNet, opts?: CompileOptions): DivergenceReport; // NEW (§8.2), sampled-tier only
}

class CodeNet {
  evaluate(inputs: number[]): number[];          // existing — "network" mode (§7.1)
  evaluateReference(inputs: number[]): number[];  // NEW — "interpret" mode (§7.1)
  readonly tier: "affine" | "sampled" | "embedding";  // NEW — was `mode: "function" | "embedding"`; "function" splits into "affine"/"sampled"
  readonly fallbackReason?: FallbackReason;        // NEW (§8.3)
  readonly validation: TestReport;                 // NEW — always populated (§6), not opt-in
}
```

`mode: "function" | "embedding"` (existing, TS) is superseded by `tier`
with three values; existing callers checking `mode === "function"` should
check `tier === "affine" || tier === "sampled"` instead — an additive
migration (both fields can coexist for one deprecation cycle, with `mode`
computed from `tier` for compatibility).

### 9.2 Python (`train_codenet`, extended)

```python
def train_codenet(name, code, save_dir='.', epochs=300, lr=1e-3,
                   materialize_graph: bool = False) -> dict:
    # meta gains: 'tier' ('affine'|'sampled'|'embedding'), 'fallback_reason',
    # and, if materialize_graph=True, 'graph': {'neurons': [...], 'connections': [...]}
    ...
```

`_probe_python` gains the affine-linearity check (§3.2) applied to the
`ast.FunctionDef` body before falling back to numeric sampling — for
Python's AST this is a straightforward `ast.BinOp`/`ast.Constant`/`ast.Name`
walk, arguably simpler to implement correctly than the TS regex-based
parser (§2.2) since it operates on a real parse tree already.

### 9.3 Structural (binary) — `CodeToNet`, extended

```ts
class CodeToNet {
  importCode(bytecode: Uint8Array, behavior: string): CodeTopology;  // existing, unchanged
  verifyRoundTrip(topology: CodeTopology, original: Uint8Array): boolean;  // NEW (§6.3)
}
```

### 9.4 NeuroLang directive (unchanged, now tier-aware)

```text
code@name="doubler"
"doubler"@code="return x * 2"
```

Unchanged surface syntax; `interp.getCodeNet("doubler")` now returns a
`CodeNet` whose `.tier` reflects §3's three-way split, and
`interp.evaluateCodeNet`/`interp.testCodeNet` (existing,
`wiki/Code-to-Net.md`) are unchanged calls that now benefit from affine-tier
exactness automatically whenever the imported code qualifies.

### 9.5 Bridge to Extension Builder

`ExtensionBuilder.addCodeNet` / `importCodeToNet`
(`extension-builder/builder.js`) call into this compiler and, per
§4/§9.1's `materializeGraph`, can now populate real `NeuronData`/
`ConnectionData` entries in the project graph for `affine` and `sampled`
tiers (previously only the `byte-stream` structural path produced visible
neurons; `addCodeNet` created a single opaque `codenet`-type neuron
regardless of tier). This is the concrete fix for the visual-editor gap
noted in §0's table.

---

## 10. Testing

### 10.1 Existing coverage (keep)

`test_core.py::test_code_to_net` (Python: `doubler` example lands in
`function_approximation` mode with converging loss); `test/smoke.mjs` §21
(TS: function-mode approximation, test-against-original, embedding
fallback, serialization round-trip, NeuroLang `@code` integration);
`importCodeToNet` structural neuron-chain creation (Extension Builder
section of the same suite).

### 10.2 New tests

| Area | Cases |
|---|---|
| Affine classification (§3.2) | `2*x+3*y-1` → `affine`; `x*y` → `sampled` (product of two variables); `Math.sin(x)` → `sampled`; `x>0?1:-1` → `sampled`; `x/2` → `affine`; `2/x` → `sampled` (non-constant divisor) |
| Affine exactness (§6.1) | for every case classified `affine` above, `evaluate()` matches `evaluateReference()` within `1e-9` at canary *and* 100 random points — not just the 4-point canary set, as a stronger CI-only check |
| Safety scan Python gap (§2.4) | a function body that reaches `__builtins__.__import__('os')` is rejected once the namespace fix ships; a regression test pinning the empty-`__builtins__` exec environment so this can't silently regress |
| Graph materialization round trip (§4) | for `affine` and `sampled` tiers: `materializeGraph(net)` → load into a fresh `ExtensionBuilder` project via `addNeuron`/`connectNeurons` → `typeModelOutput`/simulate → result matches `net.evaluate()` within tier-appropriate tolerance |
| Optimization safety (§5.2) | pruning a `sampled` network never increases `meanAbsError` by more than 10% relative to the unpruned network; a pruning pass that would violate this is rejected and the compiler returns the unpruned network with `optimized: false` |
| Byte-stream round trip (§6.3) | `verifyRoundTrip` passes for arbitrary byte input including empty input and non-multiple-of-8-byte-length input (last segment shorter than `segmentSize`); fails (correctly) when a neuron's `bytecode` is tampered with |
| Divergence report (§8.2) | feed `testAgainst`/`divergenceReport` a `CodeNet` deliberately trained on a *different* function than the one it's tested against; assert `entries` is non-empty, sorted worst-first, and `worstRegion` names a real dimension |
| Fallback reason (§8.3) | each `FallbackReason` value is reachable by a specific crafted input (a denied-token case, a syntactically invalid case, a non-numeric-return case, an oversized-source case) and is reported correctly, not just defaulted to one catch-all reason |

### 10.3 CI enforcement

Per §6's "every compile is validated" rule: a CI check asserts no code path
returns a `CodeNet` with `validation` unset (grep/type-check that
`compile()`'s every return statement populates it) — turning the
mandatory-validation requirement into something enforced structurally, not
just documented.

### 10.4 Non-goals for testing

No fuzzing of arbitrary JavaScript/Python syntax beyond the existing
malformed-input cases — the accepted grammar (§2.2) is deliberately small,
and anything outside it is expected to fall to `sampled` or `embedding`,
which is itself the tested, correct behavior (falling back is not a bug to
fuzz for). No performance testing of the `sampled` tier's SGD loop beyond
confirming it completes within the existing `epochs`/`samples` defaults in
CI time budgets — matches `docs/EXTENSION_BUILDER_SPEC.md` §11.5's same
reasoning for its own pipeline.
