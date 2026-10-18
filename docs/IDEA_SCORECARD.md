# NeuroClaw idea scorecard

An honest score for every idea in the project, from measurements made against the real code. Every number below was measured, not taken from a doc; where something was **not** measured it says so. The experiments behind it are in `test/core/architecture-experiments.test.ts` (and the files named per row); the per-experiment detail is in `test/core/ARCHITECTURE-EXPERIMENTS.md`.

Two scores per idea, 0 to 10:

- **Idea**: is the concept sound and worth pursuing, whatever the code does today?
- **Today**: does the code deliver what the idea claims, as measured?

```
  Idea  Today   what it is
  ████████░░ ███████░░░  Elastic protection of old knowledge
  █████████░ ███████░░░  Replay against forgetting (RLM)
  ████████░░ ████████░░  Short-term context (freeze / thaw)
  ██████░░░░ ███████░░░  Yes/no questions with a probability
  ██████░░░░ ███████░░░  Code-to-Net (code into an exact circuit)
  ██████░░░░ ███████░░░  Quantization
  ██████░░░░ ██████░░░░  All-to-all neuron mesh
  ██████░░░░ █████░░░░░  Taught loop speaks answers (ZipSpeaker)
  █████░░░░░ ████░░░░░░  Bits in, bits out, no tokenizer
  ██████░░░░ ████░░░░░░  Net skills as mesh regions + routing
  ████░░░░░░ ████░░░░░░  Hyperdimensional engine + wave layer
  ████░░░░░░ ███░░░░░░░  Chat history as "the same neurons fire"
  ███░░░░░░░ ███░░░░░░░  Tool neurons choosing tools
  ███░░░░░░░ █████░░░░░  "Quantum" interference
  ███░░░░░░░ ██████░░░░  ASI layer (hive, empathy, self-model, ...) as software
  ██████░░░░ █░░░░░░░░░  Predict the next user message and learn from it
  █████░░░░░ ░░░░░░░░░░  Self-improvement / RSI (not measured)
```

## Update from the research branch: implemented / tested / demonstrated / unproven

Measured in `docs/MESH_RESEARCH_RESULTS.md` (scripts in `benchmarks/`). "Demonstrated" means a held-out measurement shows the useful effect; none of the rows below that read "unproven" should be described as working.

| Capability | Implemented | Tested | Demonstrated | Evidence / limit |
|---|---|---|---|---|
| Bit-exact input through the Zip Loop | yes | yes (42 tests) | yes (encoding) | Three silent-corruption paths fixed (`sendByte(300)` became 44; empty message re-learned; output ties decoded as 0) |
| Mesh holds what went through the loop | yes, opt-in memory | yes | yes with memory | held-out bit recovery 0.85-0.96 (memory .97) vs last 4 bits only without it |
| Faster live mesh | yes | checksum-identical | yes | 613-633 -> 502-511 ms/byte (-19%) at 336 neurons; threads/SIMD not attempted |
| Taught recall (`ZipSpeaker`) | yes | yes | yes, as lookup | 70% -> 94% of 54 taught questions with standardised features |
| **Paraphrase generalisation** | no | measured | **no** | 0% on held-out paraphrases, 3 seeds, 5 configs; keyword overlap 75% on the same items |
| Abstention on unknown questions | yes | yes | partly | 91-95% right abstention, 5-9% hallucinated |
| Next-message prediction | yes (new) | yes | learns, **does not generalise** | loss 1.0 -> 0.01 on seen pairs; unseen names no better than the average guess |
| Learned tool selection | yes (new) | yes | partly | 100% familiar, 63% paraphrase, 6% no shared words, abstains safely; same overall as keyword overlap (40% vs 39%) |
| Tool execution needs explicit authorization | yes | yes | yes | untrained selector abstains on everything; consequential tools never run without a per-call grant; two approval bypasses fixed |
| Wave layer helps | yes | ablation | yes (modestly) | retention 0.94 vs 0.81, recall 0.94 vs 0.78 without it |
| All-to-all connectivity helps | yes | ablation | weakly | 10% density loses (0.83 / 0.70); 50% barely does (0.90 / 0.91) |
| Hyperdimensional term, connection bias, shift links | yes | ablation | **no effect found** | removing each changed nothing measurable on these tasks |
| "Quantum" interference | yes | yes | no | classical complex arithmetic; no advantage measured or claimed |
| Elastic protection of the live engine | yes | yes (block) | **no** on the live engine | importance protection moved weights as much as none; readout lost 0/12 |
| Rehearsal against forgetting | yes | yes | yes | 12/12 after drift when stored pairs are replayed; unreplayed pairs lost |
| Controlled improvement loop | yes (new) | yes (15) | machinery only | 24 proposals, 0 promoted; every forbidden proposal refused; no improvement shown |
| Recursive self-improvement | no | no | **unproven** | the loop tunes two hyper-parameters; nothing edits behaviour |
| Language understanding | no | no | **unproven** | nothing measured shows it |

Revised per-idea "Today" scores for the rows this branch measured: predict-next-message 1 -> 3 (it now learns, still no generalisation); net-skill routing / tool choice 3-4 -> 4 (selection learns and abstains; no-shared-word is still chance); self-improvement "not measured" -> 2 (infrastructure and a null result); wave layer 4 -> 5 (a measured benefit); elastic protection 7 -> 5 (does not transfer to the live engine); the rest unchanged.

## The verdict

**Good where it is plain, well-understood machinery done carefully; not yet good at the thing the project is for.**

The central thesis is a mesh of neurons that takes text as raw bits with no tokenizer and does the thinking itself, with no outside model. Today that is **not demonstrated**. The mesh can hear bits. With the memory switched on and a small learned readout it can speak back about 16 taught question-and-answer pairs exactly, but only those: it is a lookup, it answers nothing it was not taught, it remembers only the last stretch of a question, and every bit costs milliseconds of settling (a 100-character message is about 3 s on a 64-neuron mesh and about 44 s on the live-sized 336-neuron mesh). Nothing measured shows language understanding or generation, or generalising to a paraphrase.

What is real and good: protecting old knowledge while learning new (it works, with controls that prove it is the right parameters that are protected), replay against forgetting, freezing and thawing a conversation's neuron activity exactly, a calibrated yes/no classifier that learns 80 examples in 24 ms, exact Code-to-Net for affine and polynomial code, and correct quantization. Those are sound ideas that now have working, tested code.

## Per idea

### Works, and the idea is sound

| Idea | Idea | Today | Measured | Where it fails |
|---|---|---|---|---|
| **Elastic protection of old knowledge** (value gate, per-parameter importance) | 8 | 7 | Learning task B with no protection destroys task A (error 1.6, worse than untrained 0.45). Protecting each parameter by how much it matters to A keeps it (0.02 to 0.45) while B is still learned. Scrambled importance (1.7) and a uniform slowdown (1.6) protect nothing, so it is *which* parameters, not just slower learning. | Tested on a 6-neuron block with two tasks. The block ignored its input until this was fixed (see below), so the original gate experiment was invalid. Not shown at live scale. |
| **Replay against forgetting** (RLM) | 9 | 7 | With replay the old task stays right in 20 of 20 runs at every overlap; without it, 0 of 20 at overlap 0.8. | Capacity: two nearly identical inputs with opposite answers cannot both be held by a linear policy (the new task is learned 5 times in 20 at overlap 0.95). |
| **Short-term context** (freeze the mesh's activity when a turn stops, thaw it when the chat returns) | 8 | 8 | A resumed conversation matches an uninterrupted one exactly, on the live configuration too; it never rolls back what the shared mesh learned in between; bounded (15 min, 8 chats). | In memory only, so it does not survive a restart. Only as rich as what the mesh holds (see "chat history"). |
| **Yes/no questions with a probability** | 6 | 7 | 92% on a fresh 120-message set (naive Bayes on character 3-grams: 100%, but the data is template-made); on 16 hard cases 69% vs 56%. Calibrated: when it says 80-100% spam it is right 94% of the time. Learns 80 examples in 24 ms. | No better than a simple baseline on easy data; the hard-case sample is small (16). |
| **Code-to-Net** | 6 | 7 | Exactly affine functions and exact polynomials (degree 2 or 3, up to 3 inputs: `x*x`, `x*y`, a cubic) compile to an exact circuit with zero error, correct at x = 1e6, surviving serialization. Non-polynomials (sin, abs, floor, exp, ternaries, max) are never mistaken for one. | Everything else is a fitted network: about 0.02 error inside the sampled range, no extrapolation (sin is off by more than 0.3 at x = 20). Arbitrary software is not converted to behaviour, and the docs say so. |
| **Quantization** | 6 | 7 | Matches uniform-quantizer theory (8-bit: 1.08% error vs 1.08% predicted, 4x smaller; 4-bit: 18.3% vs 18.3% asymmetric). | Standard technique, not new. 3-bit and below is too lossy. |

### Works as a mechanism, but the claim is bigger than the evidence

| Idea | Idea | Today | Measured | Where it fails |
|---|---|---|---|---|
| **All-to-all neuron mesh** | 6 | 6 | Fully connected, finite and bounded for 4 activation functions x 3 sizes x 3 seeds. Seeding works (it was ignored before). | Cost grows with the square of the neurons: 0.3 ms per bit at 24 neurons, 3.7 ms at 64, 6.9 at 128, 55 ms at 336 (444 ms per byte). By default it forgets: a flipped input bit has no effect after about 6 ticks. |
| **Taught loop speaks answers** (`ZipSpeaker`) | 6 | 5 | With the memory on, 8 of 8 taught answers spoken exactly on a sparse mesh and on the live-sized one; with memory off 1 of 4. Reading never changes the mesh. | It is a lookup: about 16 questions (6 of 64 at 64), no answer to anything not taught, only the tail of a question is remembered, and it must be refitted when the mesh's weights change (so it cannot sit on a mesh that keeps learning). |
| **Bits in, bits out, no tokenizer** | 5 | 4 | The input path works (one tick per bit, most significant first). The reader had an unreachable activity line in dense meshes (fixed). | An untrained mesh is silent. Nothing here shows understanding or generating language, or generalising: a taught question with one appended character already returns garbage. |
| **Net skills as mesh regions, and routing** | 6 | 4 | 8 skills (chance 12.5%): queries sharing words with a skill route 88% right (was 50%). One judged example per skill lifts unseen paraphrases from 13% to 33%. Gibberish is no longer routed (the mesh then runs ungated). | Paraphrases with no shared words are at chance: it matches character patterns, not meaning. |

### Weak, or unproven

| Idea | Idea | Today | Measured | Where it fails |
|---|---|---|---|---|
| **Hyperdimensional engine + wave layer** | 4 | 4 | Bounded and finite over 300 learning ticks in 3 configurations; different inputs give different states; waves cancel and reinforce as designed. | Boundedness comes from `tanh`. Nothing measured shows the wave layer or the hyperdimensional term improves any outcome. |
| **Chat history as "the same neurons fire"** (replay) | 4 | 3 | Default mesh: a 58-byte history leaves the same state as its last byte alone, to eight decimals, so the old 1.000 match was meaningless (now reported as `blind`). With the opt-in memory, replays are found and match their own history in 4 of 5 cases. | The memory covers only the recent stretch (a few bytes at 0.97, a few dozen at 0.99). A replay can stand in for the last part of a chat, not the whole of it. Off by default. |
| **Tool neurons choosing tools** | 3 | 3 | The wiring is correct and access-checked (tests): a message naming a tool call becomes a neuron event, results flow back. | Nothing trains a neuron to fire for a prompt, so no tool is ever *chosen* by the network; on an untrained mesh they spike at random (0.29 on an ordinary question). |
| **"Quantum" interference** | 3 | 5 | The arithmetic is exact (constructive 20, quadrature 14.14, destructive 0; Grover reaches 0.96 on the target). | It is classical complex-number arithmetic, not quantum computation, and no benefit to the system was measured. The name over-promises. |
| **ASI layer** (hive mind, knowledge graph, empathy engine, self-model, mistake tracker, ...) | 3 | 6 | Real software with tests (the whole suite passes). | Conventional bookkeeping. The project's own audit (`docs/ARCHITECTURE.md`) records over a dozen pieces that were "built and unit-tested but never wired in". Nothing supports the "superintelligence" framing. |

### Does nothing today, or not measured

| Idea | Idea | Today | Measured | Where it fails |
|---|---|---|---|---|
| **Predict the next user message and learn from the gap** | 6 | 1 | On a perfectly repeating chat (A B A B ...) every prediction is empty and similarity is 0.00. "Repeat what was said two turns ago" would score 1.00. | The learning step was removed (its own comment says so) and an untrained mesh predicts nothing. A `ZipSpeaker` could supply the prediction, but it cannot live on a mesh that learns after every message. |
| **Self-improvement / RSI** | 5 | not measured | Not measured by me. | Cannot be judged from here; the tests cover mechanics, not whether the system gets better. |
| **OneBrain unified memory, Extension Builder grafting, Phone brain, NeuroLang, Store** | 5 | not measured | Their tests pass. Phone brain speed follows from the mesh numbers above (about 3 s for 100 characters at 64 neurons). | Whether they help was not measured. |

## Bugs found and fixed while measuring

These are why some earlier numbers in this project were wrong:

- **The elastic block ignored its input.** It wrote the input into a neuron once, then recomputed it away on the first tick, so two different inputs gave the identical output and nothing could be learned as a function of input. Fixed; it now learns two tasks jointly to about zero error.
- **The Zip Loop could never read a bit in a dense mesh.** The "active" line (1.5x the mean energy) was above the maximum possible energy (1.0). Fixed.
- **`NeuronMesh` ignored its `seed`.** Fixed (unseeded meshes are unchanged).
- **A thawed mesh ran at the wrong wave phase** on the live configuration, so two identical runs differed by 1e-2. Fixed (wave phase is frozen with the activity).
- **A merge left a duplicated import** that made every test that loads the system fail to compile (27 failing tests; now 0). It also meant `main` did not build, so `npm run test:smoke` (which builds first) could not run at all.
- **Every ordinary endpoint accepted a request body of any size.** `parseBody()`'s default limit had been changed from 1 MB to unlimited by a commit that only meant to lift the skill-upload cap (already passed explicitly there). Default restored; routes that need more pass their own limit.
- **Teaching a procedure about files twice created no skill.** The plugin router scored every plugin against the message, and `file-system` outranked `skill-maker` for any text mentioning files; `file-system` answers with text instead of declining. For the dedicated creation intents the caller's order is now binding.
- **The file search starved later directories.** It read one directory completely before the next, so a first sibling with more files than the budget left the rest unsearched, against its own comment. It now takes one entry from each directory in turn. (Its smoke test had never run: its fixture was outside the working directory, which the path-traversal guard rejects.)
- **A random tool neuron could replace the answer.** An untrained mesh makes tool neurons spike during an ordinary turn (one reached 0.29 while answering a question about France), and the refusal text replaced the reply. A network-fired call that was refused or failed no longer replaces the answer; it is still reported.
- **Wiki security: a page's backup history was publicly readable** (`/api/wiki/<page>/backups` matched the nested-page pattern), and the backups route was unreachable behind the page read. Both fixed.
- **The plugin registry defined `linux-permission-tools` twice**; the later entry silently won and the registry declared 17 of its 158 capabilities. Merged to one entry. (Declaring a capability grants nothing; every call still needs a grant and, for high-impact ones, approval.)

## What would move the verdict

1. Make a mesh that keeps what it hears for a conversation's length (turn the memory on for the whole process with `NEUROCLAW_ZIP_MEMORY`, then lengthen it). Everything about chat history depends on it.
2. Show **generalisation**: answer a paraphrase of a taught question, not only the exact one. That is the line between a lookup table and understanding, and nothing here crosses it yet.
3. Cut the cost per bit. At 444 ms per byte on the live mesh, bit-level text is too slow to be the main path.
4. Wire a trainable choice into tool neurons and next-message prediction, or drop those claims.
