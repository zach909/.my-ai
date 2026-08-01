# Background Quantization System

This document is the implementation-level design for the Background
Quantization system: the subsystem that compresses trained weights for
deployment without a second, bolted-on compression pass. It expands on
[`wiki/Quantization.md`](../../wiki/Quantization.md) (the short conceptual
overview) with the full architecture, algorithms, data structures, APIs,
configuration, and edge cases needed to implement or extend it directly.

Implementation lives at:

```
models && skills/core/quantizer.ts               # core primitives + BackgroundQuantizer
models && skills/core/quantization-hardware.ts    # hardware profiling, mixed precision, memory/power/perf estimates
models && skills/core/quantization-scheduler.ts   # background job scheduler, post-build / extension hooks
models && skills/core/quantization-config.ts      # config file loading + validation
config/quantization.json                          # default configuration
test/core/quantization.test.ts                    # test suite
```

---

## 1. Purpose

Two distinct systems in this repo already touch quantization, and this
system is the thing that connects them into one coherent pipeline instead
of leaving them as separate one-off pieces:

1. **Quantization-aware training (QAT)**, in `tinygpt/mesh.py` (Python) and
   mirrored in TypeScript by `RLMTrainer` (`models && skills/core/rlm.ts`)
   and `ElasticCoreBlock` (`models && skills/core/elastic-core.ts`): the
   forward pass reads *quantized* weights during training itself (via a
   straight-through estimator so gradients still flow at full precision),
   so the network converges toward weights that are already robust to the
   precision loss quantization will introduce.
2. **Install-time / post-build quantization**, exposed today through
   `ExtensionBuilder.installWithQuantization()` and
   `saveWithoutQuantization()`: a project stays exact and editable until
   deployed, at which point its weights are compressed to a target bit
   width.

The Background Quantization system's job is to make step 2 actually
*background* work — asynchronous, chunked, non-blocking — and to give it
real algorithmic depth (dynamic vs. static calibration, per-layer mixed
precision, hardware-aware bit-width selection, real bit-packing instead of
just a same-size float32 array with rounded values) instead of the single
symmetric/asymmetric/mixed dequantize-in-place primitive that previously
lived alone in `quantizer.ts`.

Concretely, this system exists to deliver:

- **Faster execution** — narrower integer types move less data per cycle
  and (on hardware with an int8 dot-product path) skip float ALUs.
- **Lower memory** — a packed N-bit tensor is `N/32` the size of its
  float32 source.
- **Reduced power draw** — fewer bits moved per operation, fewer float ALU
  activations.
- **No workflow disruption** — quantization runs after training/build
  completes, in the background, so it never blocks the interactive session
  that triggered a build.

## 2. Architecture

```
                         ┌────────────────────────────┐
                         │   Training / Build Pipeline  │
                         │  (NeuroPipeline, RLMTrainer, │
                         │   ExtensionBuilder, tinygpt)  │
                         └───────────────┬──────────────┘
                                          │ finished weights (Record<string, Float32Array>)
                                          ▼
                    ┌──────────────────────────────────────────┐
                    │      BackgroundQuantizationScheduler       │
                    │  (quantization-scheduler.ts)                │
                    │                                              │
                    │  enqueue() → jobId, returns immediately      │
                    │  runs chunked ticks via setImmediate yields  │
                    │  emits QuantizationJobProgress events        │
                    └───────────────┬──────────────────────────────┘
                                     │ per layer, per tick
                                     ▼
        ┌───────────────────────────────────────────────────────────┐
        │                    BackgroundQuantizer                      │
        │                      (quantizer.ts)                          │
        │                                                                │
        │  quantize()/quantizeStatic()  → dequantized Float32Array       │
        │        (for QAT forward passes: same shape, rounded values)    │
        │  pack()/unpack()              → real bit-packed QuantizedTensor │
        │        (for storage/transport: N bits/element, not 32)          │
        │  calibrate()/CalibrationCollector → static-mode scale derivation │
        └───────────────┬───────────────────────────────────────────────┘
                         │ per-layer bit width from
                         ▼
        ┌───────────────────────────────────────────────────────────┐
        │              quantization-hardware.ts                       │
        │                                                                │
        │  detectHardwareProfile()      → cores, SIMD width, int8 path   │
        │  resolveLayerBits()           → MixedPrecisionPolicy application│
        │  estimateMemorySavings() / estimatePowerSavingsPercent() /       │
        │  estimatePerformanceGain()     → planning-time reports           │
        └───────────────────────────────────────────────────────────┘
```

Layering rules:

- `quantizer.ts` has **no** dependency on the scheduler or hardware module
  — it is pure math over `Float32Array`s and has no knowledge of "jobs" or
  "background." This is what `RLMTrainer`/`ElasticCoreBlock`-style QAT code
  imports directly for per-tick fake-quantization.
- `quantization-hardware.ts` depends only on Node's `os` module — no
  circular dependency on the quantizer or scheduler.
- `quantization-scheduler.ts` composes both: it owns the job queue, drives
  `BackgroundQuantizer` per layer, and calls into
  `quantization-hardware.ts` to resolve per-layer bit widths and to
  attach a hardware profile to job results.
- `quantization-config.ts` depends only on `quantizer.ts` (for
  `clampBits` and the `QuantizerConfig`/`QuantizationMethod`/
  `QuantizationMode` types) and `quantization-hardware.ts` (for
  `MixedPrecisionPolicy`) — it never imports the scheduler.

## 3. Algorithms

### 3.1 Symmetric quantization

Zero is exactly representable; a single scale covers the full range.

```
qMax   = floor((2^bits - 1) / 2)
qMin   = -qMax
scale  = absMax / qMax                 (absMax = max(|min|, |max|) over the tensor)
level  = clamp(round(x / scale), qMin, qMax)
x'     = level * scale                 (dequantized value)
```

Used when a tensor's distribution is roughly centered on zero (weights
initialized near zero, gradients, etc.) — no zero-point offset needed, and
the reconstruction error is symmetric.

### 3.2 Asymmetric quantization

Uses the full integer range for skewed distributions (e.g. post-ReLU
activations, which are non-negative).

```
levels    = 2^bits - 1
scale     = (max - min) / levels
zeroPoint = round(-min / scale)
level     = clamp(round(x / scale + zeroPoint), 0, levels)
x'        = (level - zeroPoint) * scale
```

### 3.3 Mixed method selection

`method: 'mixed'` picks symmetric vs. asymmetric **per tensor**, not
globally, based on how balanced the tensor's own range is:

```
absMax        = max(|min|, |max|)
symmetryRatio = min(|min|, |max|) / absMax     (0 when absMax == 0)
useSymmetric  = symmetryRatio > 0.5
```

A ratio above 0.5 means the negative and positive extremes are within 2x
of each other — close enough to zero-centered that symmetric quantization
wastes little range. Below that, the distribution is skewed enough that
asymmetric's zero-point offset earns back precision.

### 3.4 Dynamic vs. static quantization

These are **modes**, orthogonal to symmetric/asymmetric/mixed **method**:

- **Dynamic** (`quantize()` / `pack()` without a `layerKey` that has
  calibration data): the scale/zero-point is derived fresh from the
  tensor passed to *this specific call*, by scanning its min/max. No
  calibration pass needed; the cost is a per-call O(n) scan and a scale
  that can shift slightly between calls on the same logical tensor if its
  distribution drifts.
- **Static** (`quantizeStatic()` / `pack()` with a `layerKey` that has
  calibration data via `calibrate()`): the scale/zero-point is derived
  **once**, from accumulated statistics (`CalibrationCollector`) gathered
  across one or more representative calibration batches, then reused
  verbatim on every subsequent call for that layer. Cheaper per call
  (no rescan — the stats lookup is O(1)), and gives every batch a
  *consistent* scale (important when quantized outputs from different
  calls need to be numerically comparable), at the cost of a calibration
  pass up front and reduced accuracy for inputs the calibration set didn't
  represent well.

`CalibrationCollector` accumulates running `min`/`max`/`sum`/`count`
across repeated `observe()` calls (each call folds in one batch of
samples) and produces a `CalibrationStats` snapshot via `finalize()`:

```ts
interface CalibrationStats {
  min: number; max: number; absMax: number; mean: number; count: number;
}
```

This is intentionally a **running** min/max, not a percentile/histogram —
outlier robustness (e.g. clipping the 99.9th percentile instead of the
true max) is a documented future extension (§13), not implemented, since
it requires a full histogram and this system's calibration sets are small
enough that true min/max is an acceptable approximation.

### 3.5 Mixed precision (per-layer bit width)

Distinct from "mixed **method**" (§3.3) — mixed **precision** decides how
many *bits* each layer gets, not which quantization formula it uses.
Driven by a `MixedPrecisionPolicy`:

```ts
interface MixedPrecisionPolicy {
  defaultBits: number;
  rules: LayerPrecisionRule[];       // { pattern: RegExp | string; bits: number }
  sensitivityAdjust?: boolean;
}
```

`resolveLayerBits(layerKey, weights, policy)`:

1. Walk `rules` in order; the first `pattern` that matches `layerKey`
   (via `RegExp.test()`, or exact string equality for a plain string
   pattern) wins and its `bits` is used (clamped to `[2, 16]`).
2. If no rule matches and `sensitivityAdjust` is set, compute
   `computeSensitivity(weights)` — the coefficient of variation
   (`stddev / |mean|`) as a cheap proxy for how "spread out" the tensor
   is — and nudge the default:
   - sensitivity > 1 (high spread, assumed more rounding-sensitive):
     `defaultBits + 4`
   - sensitivity < 0.1 (low spread, assumed robust to coarser rounding):
     `defaultBits - 2`
   - otherwise: `defaultBits` unchanged
3. Otherwise: `defaultBits`.

This is a heuristic, not a learned sensitivity analysis (e.g. Hessian-based
second-order sensitivity, which would need gradient information this
system doesn't have access to at quantization time) — it is deliberately
cheap (`O(n)` over one tensor, no backward pass) so it can run inline in
the background scheduler's per-layer loop.

### 3.6 Real bit-packing

`quantize()`/`quantizeStatic()` return a dequantized `Float32Array` — same
shape and byte size as the input, useful for QAT (the forward pass needs
float32 arithmetic, just with rounded values). They deliver **zero**
memory savings on their own.

`pack()` is what actually shrinks storage. It:

1. Derives (or reuses calibrated) `min`/`max` → a `QuantizationScale`
   (same derivation as `quantize()`/`quantizeStatic()`).
2. Computes each element's integer `level` via `applyScale()`.
3. For symmetric tensors, shifts levels by `+qMax` so they're representable
   as unsigned integers (the packer only ever writes unsigned bit patterns)
   — this offset is reversed in `unpack()`.
4. Bit-packs the (now unsigned) integer levels into a dense `Uint8Array`
   via `packLevels(levels, bits)`, which writes `bits`-wide values back to
   back across byte boundaries (no padding to the next byte per element —
   4-bit values pack two per byte, 3-bit values straddle byte boundaries,
   etc.).

```ts
function packLevels(levels: Uint32Array, bits: number): Uint8Array {
  // writes `levels.length * bits` bits sequentially, LSB-first per value
}
function unpackLevels(packed: Uint8Array, count: number, bits: number): Uint32Array
```

Resulting size: `ceil(count * bits / 8)` bytes, vs. `count * 4` bytes for
the float32 source — e.g. 8-bit packing is a 4x reduction, 4-bit is 8x.

## 4. Data structures

```ts
type QuantizationMethod = 'symmetric' | 'asymmetric' | 'mixed';
type QuantizationMode   = 'dynamic' | 'static';

interface QuantizerConfig {
  enabled: boolean;
  bits: number;                 // clamped to [2, 16] everywhere it's read
  method: QuantizationMethod;
  calibrationSamples: number;   // informational; actual calibration is driven by calibrate() calls
  excludeLayers: string[];      // layer keys quantizeModel()/packModel() pass through untouched
  mode?: QuantizationMode;      // default mode label; both quantize() and quantizeStatic() remain independently callable regardless
}

interface QuantizationScale {
  scale: number;
  zeroPoint: number;            // 0 for symmetric
  symmetric: boolean;
  bits: number;
}

interface CalibrationStats {
  min: number; max: number; absMax: number; mean: number; count: number;
}

interface QuantizedTensor {
  packed: Uint8Array;           // bit-packed levels
  length: number;                // element count (needed since packed.length is in bytes, not elements)
  scaleInfo: QuantizationScale;
}

interface HardwareProfile {
  name: string;
  cores: number;
  simdWidthBits: 64 | 128 | 256;
  supportsInt8Dot: boolean;
  preferredBits: number;
  preferredKernel: 'scalar' | 'simd128' | 'simd256' | 'int8-dot';
}

interface LayerPrecisionRule { pattern: RegExp | string; bits: number; }
interface MixedPrecisionPolicy {
  defaultBits: number;
  rules: LayerPrecisionRule[];
  sensitivityAdjust?: boolean;
}

interface MemoryEstimate {
  originalBytes: number; quantizedBytes: number; savedBytes: number; compressionRatio: number;
}
```

Scheduler-owned:

```ts
type QuantizationJobStatus = 'queued' | 'calibrating' | 'quantizing' | 'packing' | 'done' | 'failed';

interface QuantizationJobProgress {
  jobId: string;
  status: QuantizationJobStatus;
  layersTotal: number;
  layersDone: number;
  error?: string;
}

interface QuantizationJobResult {
  jobId: string;
  packed: Record<string, QuantizedTensor>;
  bitsByLayer: Record<string, number>;
  hardwareProfile: HardwareProfile;
}

interface ScheduleOptions {
  quantizerConfig: QuantizerConfig;
  mixedPrecisionPolicy?: MixedPrecisionPolicy;
  calibrationData?: Record<string, Float32Array>;   // activation samples keyed by layer, for static mode
  layersPerTick?: number;                             // default 4
}
```

## 5. Training pipeline (where quantization touches training)

Quantization-aware training does **not** go through
`BackgroundQuantizationScheduler` — QAT needs quantization synchronously,
inline in the forward pass, on every tick. It uses `BackgroundQuantizer`
directly:

- `RLMTrainer` (`rlm.ts`): holds a `BackgroundQuantizer` instance
  (`quantizationEnabled`/`quantizationBits` config), calls
  `refreshQuantizedForward()` once per `train()` tick to re-derive
  `quantizedWeights`/`quantizedBias` from the current full-precision
  weights **plus a carried-over residual** (the leftover rounding error
  from the previous refresh), so quantization error is corrected over time
  rather than discarded. `computeQValues()` reads the quantized snapshot
  when `quantizationEnabled`, so both action selection and TD-target
  computation "think" in the same reduced-precision representation the
  network will actually run under after export.
- `ElasticCoreBlock` (`elastic-core.ts`): the same residual-feedback
  pattern, implemented inline (`applyQuantizationInPlace()`) rather than
  via `BackgroundQuantizer`, because it operates on internal state vectors
  every forward tick rather than a weight matrix refreshed once per
  training step — the two have different residual-feedback cadences and
  aren't a good fit for sharing one code path.
- `tinygpt/mesh.py` (Python): `_fake_quant()` with a straight-through
  gradient estimator is the reference implementation this whole pattern
  traces back to.

This system doesn't change QAT's math — it keeps `BackgroundQuantizer`'s
existing `quantize()` signature and behavior exactly so `rlm.ts` needs no
changes. What it adds on top (`pack()`/`unpack()`, calibration, mixed
precision, the scheduler) is additive.

## 6. Runtime pipeline (inference-time quantization)

At inference/runtime, a quantized extension's weights are loaded already
packed (see §8). The runtime path is:

1. Load `QuantizedTensor` records from disk (deserialized via
   `BackgroundQuantizer.deserializePacked()`).
2. `unpack()` each tensor back to a `Float32Array` — this is the only
   per-inference cost quantization adds; there is no re-quantization at
   runtime (weights were already quantized once at build/install time).
3. Feed the unpacked `Float32Array` into the same forward-pass code paths
   (`NeuronMesh`, `ElasticCoreBlock`, etc.) that run against full-precision
   weights — quantization is transparent to those consumers past this
   point.

`unpack()` is O(n) over the tensor and allocates one `Float32Array` per
call; for a hot path that reloads the same extension repeatedly, callers
should unpack once at load time and cache the result rather than unpacking
per inference.

## 7. Background quantization process

`BackgroundQuantizationScheduler` is the actual "background" part: it
takes a finished model (`Record<string, Float32Array>`) and turns it into
packed tensors **without blocking the caller**.

### 7.1 Why background, not synchronous

Node/Bun/the browser runtime here is single-threaded — "background" does
not mean a separate OS thread or `worker_threads`; it means **cooperative
yielding**, the same pattern `models && skills/trainer.ts` already uses for
its own long-running loops:

```ts
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
```

`enqueue()` returns a `jobId` synchronously and starts an `async` job that
processes `layersPerTick` layers (default 4), then `await`s a
`setImmediate` yield before continuing — so a large model's quantization
pass is chopped into many small ticks, each of which lets any pending HTTP
request, CLI input, or other scheduled work run in between. The caller
either polls `getJob(jobId)`, subscribes via `onProgress()`, or `await`s
`waitFor(jobId)` if it actually needs to block until completion (e.g. a
CLI command that quantizes and then immediately writes the result to
disk).

### 7.2 Job lifecycle

```
queued → calibrating (only if calibrationData was provided) → quantizing → packing → done
                                                                                    ↘ failed (any step can throw)
```

- **queued**: job created, not yet started (this state is set before the
  async function body runs its first `await`, so `getJob()` immediately
  after `enqueue()` can observe it).
- **calibrating**: only entered when `ScheduleOptions.calibrationData` is
  supplied — feeds each layer's calibration samples into the quantizer's
  `CalibrationCollector` before any packing happens, so static-mode scale
  derivation (§3.4) is available for every layer's `pack()` call.
- **quantizing**: the main loop — iterates `layerKeys` in chunks of
  `layersPerTick`, resolving each layer's bit width (via
  `resolveLayerBits()` if a `mixedPrecisionPolicy` was given, otherwise
  the flat `quantizerConfig.bits`) and calling `quantizer.pack()`.
  `progress.layersDone` is updated after each chunk and an event is
  emitted before the tick yields.
- **packing**: a final yield after all layers are packed, before the
  result is assembled — reserved as the hook point for a future
  serialization-to-disk step (§13) without needing another state.
- **done**: `QuantizationJobResult` is attached to the job record and
  returned to `waitFor()` callers.
- **failed**: any thrown error inside the job body is caught, the error
  message is attached to `progress.error`, a `'failed'` event is emitted,
  and the error is re-thrown so `waitFor()` rejects.

### 7.3 Progress subscription

```ts
const unsubscribe = scheduler.onProgress(progress => {
  console.log(`${progress.jobId}: ${progress.status} (${progress.layersDone}/${progress.layersTotal})`);
});
```

Listeners receive a **copy** of the progress object on every emit (not a
live reference), so a listener that stores the object it received won't
see it mutate out from under it as the job continues.

## 8. How quantization occurs after building

The build pipeline (`ExtensionBuilder`, `NeuroclawTrainer`, or the Python
`tinygpt` trainer) is unaware of the scheduler — it produces a finished
weight map and hands it off. The intended call sequence (matching the
existing `saveWithoutQuantization()` / `installWithQuantization()` split
documented in `wiki/Quantization.md`):

```ts
// 1. Build/train produces final weights (unquantized, full precision) —
//    this is what saveWithoutQuantization() persists, and it stays
//    editable/re-trainable.
const model: Record<string, Float32Array> = builder.exportWeights(projectId);

// 2. Hand off to the scheduler instead of quantizing synchronously on the
//    request thread — this is the "install" step becoming non-blocking.
const scheduler = new BackgroundQuantizationScheduler();
const jobId = scheduler.quantizeAfterBuild(model, {
  quantizerConfig: { enabled: true, bits: 8, method: 'mixed', calibrationSamples: 0, excludeLayers: [] },
});

// 3. Caller either awaits completion (CLI/install flow) or returns jobId
//    to a client that polls/subscribes (web UI "installing..." state).
const result = await scheduler.waitFor(jobId);
const json = quantizer.serializePacked(result.packed);
await fs.writeFile(installedPath, json);
```

`quantizeAfterBuild()` is a thin, semantically-named wrapper over
`enqueue()` — it exists so call sites read as "this runs after a build
finished" rather than a generic model dump, without adding behavior beyond
what `enqueue()` already does.

## 9. How extensions are quantized

Extensions (`.ext.json` files under `extension-builder/extensions/`) are
quantized at **install** time, not at save time — `ExtensionBuilder`
already enforces this split (`saveWithoutQuantization()` vs.
`installWithQuantization()`); this system's job is to make the
`installWithQuantization()` path route through the scheduler instead of
calling `BackgroundQuantizer.quantize()` synchronously in place.

`BackgroundQuantizationScheduler.quantizeExtension()` is the
extension-specific entry point:

```ts
quantizeExtension(
  neuronWeights: Record<string, Float32Array>,   // keyed by neuron id, matching NeuronData.trainedWeights
  quantizerConfig: QuantizerConfig,
  mixedPrecisionPolicy?: MixedPrecisionPolicy,
): string   // jobId
```

It's semantically identical to `quantizeAfterBuild()` (both call
`enqueue()`) — kept as a separate method purely so extension-builder call
sites read as intent ("quantizing this extension's neurons") rather than
a generic model dump, matching how the two concepts are already
documented separately in the wiki.

Integration point in `ExtensionBuilder.installWithQuantization()`
(`extension-builder/builder.d.ts`): the neuron map's `trainedWeights`
fields become the `neuronWeights` input; `options.bits` maps to
`quantizerConfig.bits`. The extension's on-disk `.ext.json` gains a
`quantized: true` / `bits: N` pair (already read by
`interface/web-server.ts`'s extension-listing endpoint) plus the packed
tensor payload from `serializePacked()`.

## 10. Dynamic quantization

Covered algorithmically in §3.4. Practically: dynamic mode is the default
(`mode: 'dynamic'` in `config/quantization.json`) because it needs no
calibration step — appropriate for weights, which are static per-model but
don't need a *separate* representative dataset to calibrate against (the
weights themselves, scanned once, are their own calibration data). Use
dynamic mode:

- For weight tensors in general (the common case).
- When no representative calibration dataset is available.
- When a layer's distribution is expected to shift between quantization
  calls (e.g. re-quantizing after a fine-tune) and a stale calibrated
  scale would be wrong.

## 11. Static quantization

Covered algorithmically in §3.4. Use static mode:

- For activation tensors, where the "right" range depends on runtime input
  distribution, not just the weights — a calibration pass runs a handful
  of representative inputs through the network and `calibrate()`
  accumulates their observed ranges.
- When many calls need a **consistent** scale (e.g. comparing quantized
  activations across batches) rather than each call getting its own
  slightly-different range.
- When per-call calibration cost matters (static mode's `quantizeStatic()`
  call is a stats lookup, not a full rescan).

Calibration workflow:

```ts
const quantizer = new BackgroundQuantizer(config);
for (const batch of representativeInputs) {
  const activations = runForwardPass(batch);           // collect real activation samples
  quantizer.calibrate('layer_name', activations);
}
const stats = quantizer.getCalibrationStats('layer_name')!;
// later, at actual quantization time:
const quantized = quantizer.quantizeStatic(someTensor, stats);
```

## 12. Mixed precision

Covered algorithmically in §3.5 (per-layer bit width) — distinct from the
`method: 'mixed'` symmetric/asymmetric selection in §3.3. A model can use
both simultaneously: a `MixedPrecisionPolicy` decides *how many bits* each
layer gets, and `QuantizerConfig.method` (independently) decides *which
formula* is applied within that bit budget. `config/quantization.json`'s
default policy demonstrates both axes together — `defaultBits: 8` with
`sensitivityAdjust: true`, plus explicit rules keeping embeddings at 8 bits
and any layer ending in `bias` at 16 bits (biases are low-cardinality and
disproportionately sensitive to rounding relative to their tiny memory
footprint, so the extra bits are nearly free).

## 13. Hardware optimization

`detectHardwareProfile()` (quantization-hardware.ts) is a **heuristic**
profile — JS has no real ISA/SIMD feature-detection API, so it infers a
profile from `os.cpus().length` and `os.arch()`:

| Signal | Effect |
|---|---|
| `arch === 'x64' \| 'arm64'` | `simdWidthBits` starts at 128 (assume at least SSE/NEON-class width) |
| `cores >= 4` on a 64-bit arch | `simdWidthBits = 256` (assume AVX2-class width is plausible) |
| `cores === 1` | `simdWidthBits = 64`, `preferredBits = 4` (memory-constrained heuristic: aggressive quantization matters more than throughput on a single-core box) |
| `arch64 && cores >= 2` | `supportsInt8Dot = true` (assume a modern int8 dot-product path is available) |

This profile feeds two things:

1. `estimatePerformanceGain(bits, profile)`: lane-count ratio
   (`simdWidthBits/bits` lanes at the target width vs. `simdWidthBits/32`
   lanes at fp32) times a 1.5x bonus when `bits <= 8 && supportsInt8Dot`.
2. `estimatePowerSavingsPercent(bits, profile)`: `1 - bits/32` (capped at
   90%) plus a 10-point bonus under the same int8-dot condition.

Both are **planning-time estimates for reporting**, not measured
benchmarks — they exist so a build/install flow can surface "installing at
8 bits: ~4x smaller, ~2x faster, ~75% less power" without needing an
actual profiling run. Treat them as directional, not authoritative; do not
wire them into decisions that need a real measurement (e.g. don't gate a
correctness check on the estimated performance number).

Kernel selection (`preferredKernel`) is informational metadata attached to
job results (`QuantizationJobResult.hardwareProfile`) — this system does
not currently dispatch to different actual compute kernels based on it (no
SIMD-intrinsics execution path exists in this codebase yet); it is the
extension point a future native/WASM kernel layer would read.

## 14. Memory savings

`estimateMemorySavings(elementCount, bits)`:

```
originalBytes    = elementCount * 4                        (float32)
quantizedBytes   = ceil(elementCount * bits / 8)            (bit-packed)
savedBytes       = originalBytes - quantizedBytes
compressionRatio = originalBytes / quantizedBytes
```

This is **exact**, not a heuristic — it's the literal byte accounting of
`packLevels()`'s output size, unlike the power/performance estimates in
§13. At the default 8 bits: 4x compression. At the policy's high end (16
bits, for biases): 2x. At the aggressive low end (4 bits, single-core
profile default): 8x.

## 15. Power savings

Heuristic, covered in §13 — `estimatePowerSavingsPercent()`.

## 16. Performance improvements

Heuristic, covered in §13 — `estimatePerformanceGain()`. The **real**,
measured performance win in this codebase today is orthogonal to bit width
and already implemented: QAT (§5) means the quantized-forward-pass numbers
are what the network actually trained against, so there's no
train/deploy distribution shift to recover from at inference time — the
network doesn't need extra capacity "wasted" compensating for quantization
noise it didn't see during training.

## 17. File layout

```
models && skills/core/
├── quantizer.ts                  # BackgroundQuantizer, CalibrationCollector, pack/unpack, types
├── quantization-hardware.ts      # HardwareProfile, MixedPrecisionPolicy, estimators
├── quantization-scheduler.ts     # BackgroundQuantizationScheduler, job types
├── quantization-config.ts        # config file loading/validation
└── index.ts                      # barrel re-exports (all of the above)

config/
└── quantization.json             # default QuantizationSystemConfig

test/core/
└── quantization.test.ts          # unit tests for all four modules

docs/architecture/
└── BACKGROUND_QUANTIZATION.md    # this document

wiki/
└── Quantization.md                # short conceptual overview, links here
```

Consumers (unchanged by this system, still compatible):

```
models && skills/core/rlm.ts            # imports BackgroundQuantizer directly for QAT
models && skills/core/elastic-core.ts   # own inline fake-quant, same residual pattern
extension-builder/builder.d.ts           # installWithQuantization()/saveWithoutQuantization()
interface/web-server.ts                  # /api/extension/build, extension listing
src/features/builder/use-builder.ts      # web UI hook calling builder.install()
```

## 18. APIs

### `quantizer.ts`

```ts
class BackgroundQuantizer {
  constructor(config: QuantizerConfig);

  // Dynamic-mode fake-quant (dequantized Float32Array, same shape as input).
  quantize(weights: Float32Array, bits?: number): Float32Array;

  // Static-mode fake-quant using precomputed calibration stats.
  quantizeStatic(weights: Float32Array, stats: CalibrationStats, bits?: number): Float32Array;

  // Calibration accumulation, keyed by an arbitrary layer/tensor name.
  calibrate(layerKey: string, samples: Float32Array): void;
  getCalibrationStats(layerKey: string): CalibrationStats | undefined;
  clearCalibration(layerKey?: string): void;

  // Real bit-packing (memory-reducing) path.
  pack(weights: Float32Array, layerKey?: string, bits?: number): QuantizedTensor;
  unpack(tensor: QuantizedTensor): Float32Array;

  // Whole-model convenience wrappers (respect config.excludeLayers).
  quantizeModel(model: Record<string, Float32Array>): Record<string, Float32Array>;
  packModel(model: Record<string, Float32Array>, bits?: number): Record<string, QuantizedTensor>;

  // Serialization.
  serializeQuantized(model: Record<string, Float32Array>): string;         // float32-shaped, JSON
  serializePacked(packedModel: Record<string, QuantizedTensor>): string;   // base64-packed, JSON
  deserializePacked(json: string): Record<string, QuantizedTensor>;

  getConfig(): QuantizerConfig;
}

class CalibrationCollector {
  observe(samples: Float32Array | number[]): void;
  reset(): void;
  hasSamples(): boolean;
  finalize(): CalibrationStats;
}

function clampBits(bits: unknown, fallback?: number): number;
function packLevels(levels: Uint32Array, bits: number): Uint8Array;
function unpackLevels(packed: Uint8Array, count: number, bits: number): Uint32Array;
```

### `quantization-hardware.ts`

```ts
function detectHardwareProfile(): HardwareProfile;
function computeSensitivity(weights: Float32Array): number;
function resolveLayerBits(layerKey: string, weights: Float32Array, policy: MixedPrecisionPolicy): number;
function estimateMemorySavings(elementCount: number, bits: number): MemoryEstimate;
function estimatePowerSavingsPercent(bits: number, profile: HardwareProfile): number;
function estimatePerformanceGain(bits: number, profile: HardwareProfile): number;
```

### `quantization-scheduler.ts`

```ts
class BackgroundQuantizationScheduler {
  constructor(hardwareProfile?: HardwareProfile);   // defaults to detectHardwareProfile()

  onProgress(listener: (progress: QuantizationJobProgress) => void): () => void;  // returns unsubscribe
  getJob(jobId: string): QuantizationJobProgress | undefined;
  waitFor(jobId: string): Promise<QuantizationJobResult>;

  enqueue(model: Record<string, Float32Array>, options: ScheduleOptions): string;      // jobId
  quantizeAfterBuild(model: Record<string, Float32Array>, options: ScheduleOptions): string;
  quantizeExtension(
    neuronWeights: Record<string, Float32Array>,
    quantizerConfig: QuantizerConfig,
    mixedPrecisionPolicy?: MixedPrecisionPolicy,
  ): string;

  getHardwareProfile(): HardwareProfile;
}
```

### `quantization-config.ts`

```ts
const DEFAULT_QUANTIZATION_CONFIG: QuantizationSystemConfig;
function normalizeQuantizationConfig(raw: unknown): QuantizationSystemConfig;
function loadQuantizationConfig(repoRoot?: string): Promise<QuantizationSystemConfig>;
```

## 19. Internal classes

- **`BackgroundQuantizer`** — stateful only in its `calibration` map
  (`Map<string, CalibrationCollector>`); otherwise a pure-function wrapper
  around the module-level `deriveScale()`/`applyScale()` helpers. Safe to
  share one instance across many layers of the same model (calibration is
  keyed per layer), but **not** safe to share across unrelated models with
  overlapping layer names unless calibration is cleared between them
  (`clearCalibration()`).
- **`CalibrationCollector`** — single-tensor running-stats accumulator, no
  history retained beyond min/max/sum/count (constant memory regardless of
  how many samples are observed).
- **`BackgroundQuantizationScheduler`** — owns a `Map<string, JobRecord>`
  for the lifetime of the process; jobs are never evicted automatically
  (see §20 edge cases). Each `enqueue()` call constructs its own
  `BackgroundQuantizer` internally (not shared across jobs), so concurrent
  jobs never contend over one instance's calibration map.
- Module-private helpers not exported: `symmetricScale()`,
  `asymmetricScale()`, `isRoughlySymmetric()`, `deriveScale()`,
  `applyScale()` (quantizer.ts); `matchesRule()`, `clampToValidBits()`
  (quantization-hardware.ts); `yieldToEventLoop()` (quantization-scheduler.ts).

## 20. Configuration

`config/quantization.json`:

```json
{
  "enabled": true,
  "bits": 8,
  "method": "mixed",
  "mode": "dynamic",
  "calibrationSamples": 256,
  "excludeLayers": [],
  "layersPerTick": 4,
  "mixedPrecisionPolicy": {
    "defaultBits": 8,
    "sensitivityAdjust": true,
    "rules": [
      { "pattern": "^embedding", "bits": 8 },
      { "pattern": "bias$", "bits": 16 }
    ]
  }
}
```

`loadQuantizationConfig(repoRoot?)` reads this file, JSON-parses it, and
passes the result through `normalizeQuantizationConfig()`, which validates
every field independently and falls back to
`DEFAULT_QUANTIZATION_CONFIG`'s value for anything missing or malformed —
a bad `bits` value doesn't invalidate the whole file, it just falls back
for that one field. A missing file or JSON parse error falls back to the
full default config rather than throwing: this is a background subsystem,
and a broken config file must never take down startup.

Rule `pattern` strings in the JSON file are compiled to `RegExp` via `new
RegExp(pattern)` — a malformed regex string throws inside
`normalizeQuantizationConfig()`, which is **not** caught internally (only
`loadQuantizationConfig()`'s file-read/JSON-parse step has a catch-all);
callers constructing config from untrusted input should validate regex
patterns before calling `normalizeQuantizationConfig()` directly, or call
`loadQuantizationConfig()` instead, which only ever reads the checked-in
file.

## 21. Edge cases

- **Degenerate tensor (all values equal)**: `quantize()`/`quantizeStatic()`
  detect `wMax === wMin` (or `stats.max === stats.min`) and return an
  unchanged copy rather than dividing by a zero-width range. `pack()`
  instead widens a zero-width range to `max = min + 1` (it cannot return
  an "unchanged" packed tensor — packing must always produce a valid
  `QuantizationScale` with a non-zero scale) — the packed output round-trips
  back to the constant value exactly regardless, since every level maps to
  the same dequantized value when scale is well-defined and every input
  value is identical.
- **`bits <= 1`**: `clampBits()` floors every entry point at 2 — at
  `bits === 1`, symmetric's `qMax = floor((2^1-1)/2) = 0`, so `scale =
  absMax / 0 = Infinity`, and every dequantized weight becomes `0 *
  Infinity = NaN`. This is why the clamp exists and why every public
  method routes bit width through `clampBits()` rather than trusting a
  caller-supplied value directly.
- **Non-finite `bits` input** (`NaN`, `undefined`, a non-numeric string
  forwarded from an unvalidated request body): `clampBits()` falls back to
  8 rather than propagating `NaN` through `Math.max`/`Math.min` (which
  don't clamp `NaN`, they propagate it silently).
- **Empty calibration** (`quantizeStatic()` called with a `CalibrationStats`
  from a `CalibrationCollector` that never observed anything): `count ===
  0` is checked explicitly and returns an unchanged copy, same as the
  degenerate-tensor case — this also covers `finalize()`'s own zeroed
  return value (`{min:0,max:0,absMax:0,mean:0,count:0}`) for an empty
  collector.
- **`pack()` without prior calibration for a given `layerKey`**: falls
  through to scanning `weights` directly (the dynamic-mode path) — calling
  `pack()` with a `layerKey` is opportunistic, not a hard requirement to
  calibrate first.
- **Unknown job ID**: `waitFor()` throws synchronously (before returning a
  promise, since the lookup happens before any `await`) rather than
  hanging or resolving `undefined`.
- **Scheduler job accumulation**: `jobs` is a plain `Map` with no eviction
  — a long-running process that calls `enqueue()` repeatedly without ever
  clearing finished jobs will grow this map unboundedly. This system does
  not implement an eviction policy (no LRU/TTL); a caller embedding the
  scheduler in a long-lived server process should track and periodically
  clear job IDs it no longer needs (there is currently no `clearJob()`
  API — see §22 for what a test-driven addition would need to cover before
  landing).
- **Concurrent jobs on overlapping layer names**: safe — each `enqueue()`
  call gets its own `BackgroundQuantizer` instance (own calibration map),
  so two jobs quantizing a layer both named `"embedding"` from two
  different models never share calibration state.
- **`packLevels`/`unpackLevels` bit-width boundary values**: tested at 2,
  3, 4, 8, 12, and 16 bits — 3-bit and 12-bit widths exercise the
  byte-straddling path (values that don't divide evenly into 8-bit
  boundaries), which is where an off-by-one in the bit-index math would
  first surface.
- **`method: 'mixed'` on a fully symmetric or fully asymmetric tensor**:
  `isRoughlySymmetric()` degrades gracefully at the boundary — `absMax ===
  0` (all-zero tensor, which would also hit the degenerate-tensor path
  first) returns `true` (treated as symmetric) rather than dividing by
  zero.
- **`excludeLayers` naming a layer that doesn't exist in the model**: silently
  a no-op — `quantizeModel()`/`packModel()` only iterate `Object.keys(model)`,
  so an exclude entry with no matching key has no effect (not an error).

## 22. Testing

`test/core/quantization.test.ts` (32 tests, run via `bun test` — this repo
has no `node_modules` installed in this environment, so `vitest` cannot run
without `npm install` first; `bun test` runs the same Jest-compatible
`describe`/`test`/`expect` API directly against the TypeScript source with
no build step, and is what was used to validate this implementation):

- **`clampBits`**: in-range passthrough, over/under-range clamping,
  non-finite fallback (including a custom fallback value).
- **`BackgroundQuantizer.quantize` (dynamic mode)**: symmetric round-trip
  accuracy, degenerate all-equal tensors, asymmetric skewed-range handling,
  per-call `bits` override producing better accuracy at higher bit widths,
  and a sweep across `[2,3,4,8,12,16]` bits asserting no `NaN` ever
  appears in the output.
- **`CalibrationCollector` + `quantizeStatic`**: multi-batch accumulation,
  empty-collector safety, static quantization actually using the
  *calibrated* range rather than the call-time tensor's own range (the
  test's core assertion: a narrow `[40,50,60]` tensor quantized against a
  wide `[0,100]` calibrated range still round-trips within tolerance,
  proving the calibrated scale — not a rescan of the narrow input — was
  applied), and empty-stats fallback.
- **Bit packing**: exact round-trip for `packLevels`/`unpackLevels` across
  the same bit-width sweep, `BackgroundQuantizer.pack()`/`unpack()`
  round-trip including an exact expected byte count
  (`7 elements * 8 bits / 8 = 7 bytes`, vs. 28 bytes as float32 — this is
  the test that actually proves memory reduction, not just round-trip
  correctness), and `pack()` preferring calibration stats over the
  call-time tensor when both are available.
- **Model-level + serialization**: `quantizeModel()` passthrough for
  excluded layers, `serializeQuantized()`/JSON round trip, and
  `serializePacked()`/`deserializePacked()`/`unpack()` full round trip.
- **Hardware/mixed-precision/estimates**: `detectHardwareProfile()`
  internal consistency (valid SIMD width enum, positive core count),
  `computeSensitivity()` zero-for-constant / positive-for-spread,
  `resolveLayerBits()` rule-match vs. default-fallback, exact
  `estimateMemorySavings()` byte math, and monotonicity checks
  (`estimatePowerSavingsPercent`/`estimatePerformanceGain` both higher at
  8 bits than at 16 bits, for the same hardware profile).
- **`BackgroundQuantizationScheduler`**: full enqueue→waitFor flow
  producing packed tensors for every non-excluded layer, progress events
  reaching `'done'` with `layersDone` matching the model's layer count,
  mixed-precision policy actually producing different `bitsByLayer`
  entries per layer, `waitFor()` rejecting on an unknown job ID, and
  calibration data flowing through to the packed result's derived scale
  (asserts the scale on the packed tensor matches the *calibrated* range,
  not the model's own weight range — the scheduler-level version of the
  `quantizeStatic` calibration test above).
- **`quantization-config` normalization**: empty-input defaults,
  invalid method/mode string fallback, out-of-range `bits` clamping, and
  string-pattern-to-`RegExp` compilation for mixed-precision rules loaded
  from JSON.

Not covered by the current suite (documented gaps, not silent ones):

- `loadQuantizationConfig()`'s actual file-read path (only
  `normalizeQuantizationConfig()`, its pure validation core, is tested
  directly — the file I/O wrapper is a thin, easily-inspected pass-through).
- End-to-end integration through `ExtensionBuilder.installWithQuantization()`
  — that class's source (`builder.ts`) does not exist in this repository
  (only its compiled `builder.js`/`builder.d.ts` are checked in), so
  wiring the scheduler into it is a follow-up change against that
  compiled artifact, not something this system's own test suite can cover
  in isolation.
- Real hardware feature detection — `detectHardwareProfile()` is
  explicitly a heuristic (§13); there is no test asserting it matches
  actual CPU capabilities, only that its own internal derivation is
  self-consistent.
