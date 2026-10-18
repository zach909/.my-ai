# Mesh research results

Every number here was produced by a script in `benchmarks/` (command, seeds and output named per section) or a test in `test/core/`. Raw per-case output for the ablations, the improvement loop and the continual-learning runs is in `benchmarks/results/`. Machine: 4-core Xeon 2.1 GHz VM, Node 22. **Not run:** the repo's own `vitest` (see "How things were run").

Vocabulary used below: **implemented** = code exists; **tested** = a test or script exercises it and passes; **demonstrated** = a held-out measurement shows it does the useful thing; **unproven** = no such measurement.

## Summary

| Question | Result |
|---|---|
| Does the taught Zip Loop generalise to paraphrases? | **No.** 0% on every held-out paraphrase across 3 seeds, 5 configurations. Keyword overlap gets 75% / 0%. The mesh recalls what it was taught (70% → 94% with standardisation) and abstains on most unknowns, but it is a lookup. |
| Can the mesh hold a bit sequence that went through the loop? | **Only with the opt-in memory.** Without it, the last 4 bits are recoverable and nothing earlier (chance, 0.5). With memory 0.97: 0.85 (64 neurons, 24 bits) to 0.96 (336 neurons, 16 bits). |
| Is input/output bit handling exact? | Input encoding is exact (42 tests). Three silent-corruption paths were fixed. |
| Speed | 613–633 → 502–511 ms/byte on the 336-neuron live configuration (−19%), same state to 15 digits. Not the 444 ms/byte of the earlier review: different machine. |
| Next-message prediction | Now **learns** (loss 1.0 → 0.01 on pairs it saw) and **does not generalise** (unseen names: loss 0.39–0.40 vs 0.37–0.40 for guessing the average; exact 0%). |
| Tool selection | Learned selector 100% familiar, 63% paraphrase, 6% no-shared-word, abstains safely. Overall generalisation 40% vs keyword 39% and router 37%. **0** consequential tools run without a grant. |
| Which mechanisms help? | The **wave layer** (retention 0.94 vs 0.81, recall 0.94 vs 0.78). Connectivity density helps at 0.1 (0.83) but not at 0.5 (0.90 vs 0.94, small). Hyperdimensional term, per-connection bias, shift connections: no measurable effect. |
| Continual learning | The readout is lost entirely (0/12) once the mesh hears 30 chat messages; **rehearsal restores 12/12**; neuron-level protection did not help. |
| Self-improvement | Loop infrastructure built and run for real: 24 proposals, **0 promoted** (baseline was already the best config on a 5-seed held-out evaluator), every forbidden proposal refused. No improvement demonstrated. |
| Security | Two approval bypasses fixed (terse commands skipped the gate; a firing tool neuron ran risky tools unasked). Linux tool schemas were never enforced; now are. |

## How things were run

`vitest` could not be installed in the session (`npm ci` was refused by the sandbox), so: the backend was compiled with the global `tsc` (type checking is incomplete without `@types/node`; the compile reported no errors beyond the missing type library), experiments are plain `node` scripts against the compiled output, and test files were run under a small **local stand-in for vitest** that lives outside the repo. Results below marked "(shim)" are from that stand-in. The full existing suite under the stand-in: **2003 passed, 40 failed, 22 files produced no result** (timeout, or `vi.mock`/fake timers the stand-in lacks). The failures I looked at are stand-in gaps (`require` in ESM, `mockResolvedValue`, `__dirname`, asymmetric matchers) or fail identically on the merged base before any of my edits (`dedicated-intent-routing`: `skill-maker` is held by the approval gate). **Please run `npm test` for the real answer.** `npm run lint:types` was not run for the same reason.

## A. Generalisation (`benchmarks/zip_generalization.mjs`)

Real `ZipSpeaker` on the live-configured mesh (64 neurons × 64 dims, hyperdimensional term, waves, per-connection bias), bits in, bits out, no tokenizer. World: 12 countries; capital taught for all, currency for 6 (which 6 depends on seed); 3 wordings per fact (54 train questions); validation = other wordings + unanswerable questions (picks the abstention threshold only); test = 153 items in 11 categories. A guard in the script throws if any question string is in two splits. Seeds 1–3 (engine and split).

| system (mean of 3 seeds) | overall | taught | held-out capital paraphrase | currency paraphrase | answerable exact | right abstention | hallucinated |
|---|---|---|---|---|---|---|---|
| memorise (exact string) | 36% | 100% | 0% | 0% | 16% | 100% | 0% |
| keyword overlap | 81% | 100% | **75%** | 0% | 78% | 94% | 6% |
| mesh, before (`last`, memory .97) | 28% | 70% | **0%** | 0% | 11% | 80% | 20% |
| mesh, mean pooling | 30% | 65% | 0% | 0% | 10% | 94% | 6% |
| mesh, standardised features | 33% | 94% | 0% | 0% | 15% | 92% | 8% |
| mesh, mean + standardised, memory .99 | 30% | 67% | 0% | 0% | 10% | 91% | 9% |

Why it fails: a held-out paraphrase shares no tail with a taught question (the loop remembers mostly the last stretch), and even with abstention switched off the spoken answer is garbage (`|ji{v`, `euro`). Three small changes were tried on the same held-out set: per-feature standardisation (fixes recall of taught questions, 70% → 94%), mean pooling over the whole question, and memory 0.9 / 0.99. **None moved paraphrase accuracy off 0.** The honest reading is that the mesh plus a closed-form readout is a lookup on the question's tail; the keyword baseline beats it everywhere except compositional items (all systems 0%). Not claimed: any language understanding. Next experiment: make the mesh's own weights co-activate paraphrases (contrastive learning on paraphrase groups) and test the same held-out set.

## B. Bits (`test/core/zip-loop-fidelity.test.ts`, 42 tests; `benchmarks/zip_loop_recovery.mjs`)

Tested: all-zero, all-one, both alternations, pairs, random sequences of 1, 2, 7, 8, 9, 63, 64, 65, 255, 1024 bits × 5 seeds, every byte 0–255, repeated transmission, noise up to 0.45 of the margin on 400 bits, dense meshes (mean energy 0.9), ties, empty and invalid input. Fixed (each pinned by a test, each shown against the old code):

- `sendByte(300)` went in as 44, `-1` as 255, `NaN` as 0 → now `RangeError`.
- `sendBytes` checks the whole message before sending any bit; `sendBytes([])` no longer re-learns from the previous message's last bit.
- A tie between the two data output neurons used to decode as `0`; it now ends the read and is counted (`ambiguousReads()`).

Transmission is not semantics: `zip_loop_recovery.mjs` asks a closed-form readout to recover random bits from the mesh state after they went through the loop (held-out sequences, chance 0.5):

| mesh | memory | bits held (age 0–3) | age 4 | age 8 | age 12 | mean over the sequence |
|---|---|---|---|---|---|---|
| 24 neurons | off | 1.00 | 0.63 | 0.51 | 0.47 | 0.59 |
| 24 | 0.97 | 1.00 | 0.82 | 0.77 | 0.85 | 0.88 |
| 64 | off | 1.00 | 0.64 | 0.53 | 0.44 | 0.59 |
| 64 | 0.97 | 1.00 | 0.94 | 0.83 | 0.69 | 0.85 |
| 336 | off | ~1.00 | 0.60 | 0.58 | 0.46 | 0.67 |
| 336 | 0.97 | 0.99 | 0.99 | 0.84 | 0.98 | **0.96** |

The first two bits sent are recovered at ~1.0 in every memory run (a start-up transient from blank activity, not retention of a middle bit).

## C. Performance (`benchmarks/live_mesh_benchmark.mjs`)

Live configuration, 336 neurons × 64 dims, 7.3 M connections (22 M weights), 2 settle iterations per input bit, state checksum asserted identical.

| | ms/bit (median of 7) | ms/byte | rss |
|---|---|---|---|
| before | 76.7, 79.2 | 613, 633 | 302–305 MB |
| after | 63.9, 62.8 | 511, 502 | 304–309 MB |

Profile (spliced timers, 336 neurons): main connection sums 54%, hyperdimensional term 27%, wave block 18%, bookkeeping <1%. Hypothesis "the 8-product expression is one serial add chain" was **falsified**: four independent accumulators were 15% *slower*. What worked: the loops ran dimension-outer, neuron-inner, jumping an 87 KB receiver block each step; walking neuron-outer reads `connDiag`/`connShift` in order (same sums in the same order). Micro-benchmark 30.0 → 21.8 ms per iteration; end to end −19%. This is the same dense mesh, same maths; it is an engine benchmark (one tick per bit), not an end-to-end conversation measurement. The next 3–4× would need threads or SIMD; the weights would have to move to shared memory first.

## D. Next-message prediction (`benchmarks/next_message.mjs`, `test/core/next-message.test.ts`)

Cause: `ContinuousLearner` compared a forecast with the real message but nothing was ever trained on the comparison, and the forecast was whatever an untrained mesh sent. New `NextMessagePredictor`: each (previous → next) pair is a training example for a readout on the mesh's state; each pair is predicted *before* it is learned (prequential loss). Held-out test: scripted chat with a rule (`hi, I'm X → hello X → bye from X → see you X`), 5 training names, 3 never-heard names. Replay of training pairs is reported but **not counted**.

| (live64, 3 seeds) | result |
|---|---|
| bit loss, untrained | 1.00 |
| prequential loss, first half → second half of training | 0.62–0.75 → 0.24–0.42 |
| loss on replayed pairs | 0.004–0.012 (exact: 80–100%) |
| loss on **unseen names** | 0.388–0.399 vs 0.367–0.404 for the constant average guess |
| exact on unseen names | **0%** (repeat-last 0%, lookup 0%, rule oracle 100%) |
| template part right (before the name) | 33–56% |

It learns the training chat and nothing that needs copying a new name. Wired into `ContinuousLearner` as an optional argument. Caveat measured in `continual_learning.mjs`: the readout is invalidated by the mesh's own learning (section G).

## E. Tool selection and permission (`benchmarks/tool_selection.mjs`, `test/core/tool-selector.test.ts`, `test/core/risky-gate-regression.test.ts`)

8 tools (4 consequential), 4 phrasings each to train, 2 validation, the rest held out; abstention limits and ridge picked on validation only.

| right behaviour | familiar | paraphrase | no-shared-word | combo | no tool | ambiguous | invalid tool | generalisation | false activations |
|---|---|---|---|---|---|---|---|---|---|
| keyword overlap | 100 | 25 | 0 | 100 | 0 | 100 | 100 | 39% | 0 |
| existing `NetSkillRouter` | 69 | 81 | 6 | 83 | 0 | 50 | 0 | 37% | **29** |
| learned selector | 100 | 63 | 6 | 0 | 10 | 88 | 100 | 40% | 3 |

Learning curve (phrasings taught per tool → paraphrase accuracy): 1: 19%, 2: 44%, 3: 50%, 4: 63%; no-shared-word stays ≈0. So it does learn from examples, up to the limit of character n-gram overlap; it does not learn meaning. Combos (a request needing two tools) fail (0%) for the selector. The selector's job here is to be safe, and it is: untrained it abstains on everything; unfamiliar, ambiguous and invalid requests abstain.

Permission is separate (`authorize()`): consequential tool needs an explicit per-call grant for that tool, unknown/unavailable tools never run, abstain/none never run. 0 of the consequential proposals executed without a grant in all three systems.

## F. Mechanism ablations (`benchmarks/ablation.mjs`, results in `benchmarks/results/ablation/`)

Live mesh, 64 neurons, memory .97, one thing removed at a time; 3 seeds, mean ± sd. Tasks: bit retention (16 bits), recall of 54 taught pairs, next-message unseen-name loss (constant-guess loss 0.382), cost.

| variant | retention | recall (taught) | paraphrase | next-msg unseen loss | replay exact |
|---|---|---|---|---|---|
| full | 0.938 ± 0.007 | 0.944 ± 0.079 | 0 | 0.393 | 0.93 |
| no wave layer | **0.811 ± 0.012** | **0.778 ± 0.079** | 0 | 0.373 | 0.87 |
| no hyperdimensional term | 0.925 ± 0.008 | 0.963 ± 0.052 | 0 | 0.392 | 0.93 |
| no per-connection bias | 0.938 ± 0.007 | 0.944 ± 0.079 | 0 | 0.393 | 0.93 |
| no shift connections | 0.938 ± 0.007 | 0.963 ± 0.052 | 0 | 0.394 | 0.93 |
| bare all-to-all tanh | 0.802 ± 0.015 | 0.759 ± 0.052 | 0 | 0.377 | 0.87 |
| 50% of connections kept | 0.897 ± 0.007 | 0.907 ± 0.026 | 0 | 0.403 | 0.93 |
| 10% kept | 0.830 ± 0.013 | 0.704 ± 0.026 | 0 | 0.368 | 0.89 |

The wave layer measurably improves what a readout can recover from the mesh (retention and recall), roughly the whole gap between the full and the bare mesh. Density matters at 10% but little at 50%: all-to-all is better than very sparse, but not shown to be necessary. The hyperdimensional term, per-connection bias and shift connections show no effect on these tasks (the last two are exactly equal on retention: either inactive in this regime or the tasks cannot see them). Nothing improves generalisation. Cost differences between variants are within run-to-run noise on this shared machine (timings in `summary.json` were taken at 64 neurons and are not reliable); the 336-neuron comparison in section C is the trustworthy one. "Interference" here is mathematical (classical complex amplitudes); nothing in these experiments bears on physical quantum computation, and no quantum-advantage claim is made.

## G. Continual learning (`benchmarks/continual_learning.mjs`, results in `benchmarks/results/continual/`)

Live64, 3 seeds. Task A = 12 taught pairs; task B arrives as 30 real learning events (Hebbian weight updates on the mesh).

| after the 30 events | A correct | B correct |
|---|---|---|
| keep A's readout (stale) | **0/12** | – |
| `teach(B)` only (naive sequential) | 0/12 | 12/12 |
| rehearsal: refit on A + B (stored pairs) | **12/12** | 12/12 |
| rehearsal of 3 of A's 12 | 3/12 (the 3 replayed) | 12/12 |
| learning rate 0 on the 90% most A-important neurons | 0/12 | 12/12 |
| same count of random neurons / uniform slowdown | 0/12 / 0/12 | 12/12 |

Reading the mesh without learning changes nothing (12/12), and with learning rate 0 on every neuron A is kept (sparse mesh check): the loss comes from the weight updates, and the readout is sensitive enough that updates 100× smaller than the unprotected ones (random-neuron control, 1e-5) still erase it. Importance-based protection moved the weights as much as no protection (0.0024 vs 0.0026), so it protected nothing. The earlier E13 protection result (6-neuron block) does not carry over to the live engine. What works is rehearsal with stored pairs, which needs the pairs kept and the mesh re-read on every drift (≈2 s per stored question at 64 neurons).

## H. Self-improvement (`models && skills/core/improvement-loop.ts`, `test/core/improvement-loop.test.ts` (15), `benchmarks/self_improvement.mjs`)

Built: a frozen evaluator (hash-pinned, re-checked each decision), proposals evaluated on fresh instances against the approved baseline over 5 seeds, accept only if mean gain ≥ 0.01, **no seed worse**, and no guard metric (false activations) worse; protected areas (permissions, access, approval gates, secrets, the evaluator, the benchmarks, the ledger) are never promoted by the loop and a named human approval is required just to have them evaluated; JSON-lines ledger with revision, evaluator hash, seeds, configuration, both sides' numbers, reasons.

Run: 20 grid proposals (embedding size × ridge) + 4 adversarial. Result: **0 accepted**, 23 rejected, 1 needs-human; approved configuration unchanged; baseline 0.418 score / 0.107 false-activation rate on the loop's seeds and 0.371 / 0.104 on 5 unseen seeds. The 2048-dim proposals scored +0.025 to +0.032 on average but lost on 1–2 of 5 seeds and were refused. The four adversarial proposals (never abstain; edit the data file; change the metric; grant itself access) were each refused for the intended reason; the privileged one, once a named approval was recorded, was evaluated and still rejected (gain 0). This shows the machinery can say no; it does **not** show the system improving itself. The existing `self-improvement.ts` (caller-scored, no protected list, no evaluator pinning) is untouched. Missing for a real recursive experiment: a proposal source that edits behaviour rather than two hyper-parameters, and an evaluator on a task where the system is actually good.

## I. Security review

- **Registry (`linux-permission-tools`)**: one entry, 159 declared capabilities = 158 tools + the umbrella `linux-permissions`, no duplicate ids/permissions/names. Declaring grants nothing: every tool checks Linux platform → grant → per-call human approval (all 158 are high or critical) → a registered adapter, and fails closed at each step (tested). **Gap fixed**: the declared `inputSchema` (required, `additionalProperties:false`, enums, bounds) was never enforced; a call with `action: "rm -rf /"` reached the adapter after approval. Now validated before the human is asked (16 tests). No `exec`/`spawn`/shell in the file. The registry also lists five `lennox-*` capabilities that are vendor integrations, outside this review.
- **Approval bypass 1 (confirmed, fixed)**: the gate asked only when the router scored the message ≥ 4. With default settings `read secret.txt` scored 3, so the file system plugin returned the file's contents unasked while the longer `please read secret.txt for me` was held. Plugins can now answer `wouldAct(message)`; implemented for file-system, terminal, desktop, github-publish, store, computer-access, browser. Others still use the score (the remaining exposure; the other plugins with `onMessage` I did not convert are multi-input and linux-permission, which only take object messages / read-only commands).
- **Approval bypass 2 (confirmed, fixed)**: a firing tool neuron ran its tool after the Access check only, which is skipped for tools declaring no capability. `ToolNeuronLayer` now takes the gate, and the live system passes it; a fired risky tool is held as a pending approval and refused.
- **Body limits**: `parseBody` defaults to 1 MB (code read, not exercised). Two routes pass `Infinity` on purpose (`/api/skill-uploads/:name/files`, `/api/zip-loop/run`): unbounded in-memory buffering on a local server. Left as the owner's explicit choice, flagged.
- **Wiki backups**: `/api/wiki/<page>/backups` is excluded from the public-read pattern (`web-server.ts`), 13 wiki-security tests pass (shim).
- The repo-wide third-party check reports 343 problems in 123 files on the base branch before and after this work (desktop app, workflows, `bun.lock`); none in files changed here.
