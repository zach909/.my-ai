# Zip I/O Loop

The AI receives compressed ("zipped") inputs and produces compressed outputs, both operating as circular buffers — when storage reaches capacity, the oldest information is overwritten, so the system runs continuously without needing unlimited memory. The design notes' theoretical example: "a 200,000 GB knowledge base processed efficiently through compression."

## Overview

**Purpose**: Extend effective context far beyond what raw token storage would allow, by compressing everything that goes in and out and wrapping it in a bounded ring buffer instead of an ever-growing list.

| Layer | File | What it is |
|---|---|---|
| TypeScript runtime backend | `models && skills/core/zip-io.ts` — `InfiniteZipLoop`, `ZipIOSystem` | Circular buffer with optional disk spill once in-memory capacity is reached |

## `ZipIOSystem` (TypeScript)

```typescript
const zip = new ZipIOSystem(contextSize, persistDir, checkpointInterval);
await zip.ingest(input);              // one input turn, compressed into the input loop
await zip.emit(output);               // the corresponding output, compressed into the output loop
zip.inputLoop.getTotalContextSize();  // total uncompressed bytes currently held in the ring buffer (per loop)
await zip.persist();                  // snapshot both loops to disk immediately
await zip.restore();                  // reload both loops from their last disk checkpoint
```

`ZipIOSystem` has no `append()`/`getTotalContextSize()` of its own — input and output are two separate `InfiniteZipLoop` ring buffers (`inputLoop`/`outputLoop`), fed independently via `ingest()`/`emit()`, and `getTotalContextSize()` is a method on each loop, not on `ZipIOSystem` itself. Each `InfiniteZipLoop` overwrites its own oldest entries in place once its capacity is reached, never growing without bound; independently of that, it also auto-checkpoints to disk every `checkpointInterval` writes (`getDiskSpillPath()` just returns that checkpoint file's path) so `restore()` can recover context beyond the live in-memory window after a restart. This is the direct implementation of "compressed input and output... circular buffers... continuous operation without requiring unlimited memory."

## `ZipLoopMemory` (Python)

`capacity` is a turn count (the ring buffer's `maxlen`), not a byte/MB size. `save()`/`load()` take no arguments — the path is fixed once, at construction, as `persist_path`. `core.py` wires this in directly via its own `--memory <path>` CLI flag (which becomes `persist_path`) and `--encrypt` / `MYAI_PASSPHRASE` — conversation memory persists across restarts, compressed, and optionally encrypted with a local stdlib cipher (no external key-management API). A real bug fixed during this project's development: `zlib` and a magic-byte constant were referenced but never imported/defined, and a leftover duplicate `save()`/`load()` code path silently discarded the compression and encryption *after* doing the real work correctly — meaning persisted memory was neither compressed nor encrypted despite the code appearing to do both. Fixed at the source; `test_memory_compression` and `test_encrypted_memory` in `test_core.py` cover it directly now.

## Verifying it

- `npm test` (`test/smoke.mjs`)'s `testZipPersistence` covers the TypeScript ring buffer's persistence.
- `python test_core.py`'s `test_memory_compression`, `test_local_encryption`, and `test_encrypted_memory` cover the Python side's compression and encryption independently and together.
- `python main.py demo` (`test_integration.py`, §5) confirms memory, the empathy state, and the reasoning ledger all persist to disk from one real `core.py` session.

## See Also

- [[Home]] - Main wiki page
- [[Privacy]] - Encryption at rest for persisted memory
- [[RLM]] - The reasoning ledger, which persists alongside memory the same way
- [[Neuron-Mesh]] - The mesh's own continuous-state carry-over between calls (§9), a related but separate mechanism

---

*The circular buffer is what makes "never idle" possible without the storage requirement growing without bound.*
