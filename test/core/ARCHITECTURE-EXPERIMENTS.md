# Architecture Experiments

These experiments test the project's architectural claims in dependency order. They are deliberately small and deterministic where possible.

1. **E01 — All-to-all topology**: verify N nodes have N-1 outgoing connections and no self edges.
2. **E02 — Mesh propagation**: verify finite, repeatable propagation.
3. **E03 — Mesh stability**: verify repeated settling does not produce unbounded values.
4. **E04 — Elastic value gate**: compare a high-value node against an ungated control to measure state resistance.
5. **E05 — Net skills**: verify semantic routing is deterministic and selects the intended region.
6. **E06 — Learning**: train a tiny deterministic reward policy and verify the learner remains operational.
7. **E07 — Continuous learning / forgetting**: train task A, then task B, and record whether task A survives.
8. **E08 — Zip Loop baseline**: verify the binary alternating tick protocol before testing I/O throughput.
9. **E09 — Hyperdimensional state**: stress repeated high-dimensional nonlinear state transforms for numerical stability.
10. **E10 — Quantum interference ablation primitive**: verify constructive and destructive phase produce different probability mass.
11. **E11 — Code-to-Net baseline**: establish an exact affine target before testing the compiler's approximation modes.
12. **E12 — OneBrain integration gate**: verify mesh + net-skill routing can operate together without invalid state.

## Results (measured; each row is a test in `architecture-experiments.test.ts`)

| | Verdict | What was measured |
|---|---|---|
| E01 all-to-all | works | N-1 connections per node, no self edges |
| E02 seeding | works (was a bug) | `NeuronMesh` ignored `seed`; now a seeded mesh is reproducible, an unseeded one is unchanged |
| E03 / E03b stability | works | finite and bounded for 4 activation functions x 3 sizes x 3 seeds |
| E04 elastic gate (state) | works | `vale=1` holds a node exactly. At 16 nodes the mesh barely reacts to input (nothing moves more than ~1e-4), so there is little to resist |
| E05 / E05b-f net-skill routing | partly fixed | 8 skills (chance 12.5%): queries that share words with a skill route 88% right (was 50%; the embedding was too small). Paraphrases with no shared words are still at chance (13%): the router matches character patterns, not meaning. It now learns from outcomes (`judge()` teaches it): one example per skill lifts unseen paraphrases to 33%. Gibberish is no longer routed anywhere (the mesh then runs ungated) |
| E06 learning | works (trivial task) | 5 of 5 runs pick the rewarded action |
| E07 / E07b / E07c forgetting | works (replay) | with replay the old task stays right in 20/20 runs at every overlap; without it, 0/20 at overlap 0.8. The limit is capacity: near-identical inputs with opposite answers cannot both be held by a linear policy, so the new task is learned 5 times in 20 |
| E08a Zip Loop input | works | one tick per bit, most significant first |
| E08b live network speaks | fails | 64-neuron live-sized network is silent after "hi" (max energy ~0.03, reader returns nothing 4 of 4) |
| E08c dense network speaks | fixed | energy is capped at 1.0 but the reader needed 1.5x the mean, above 1.0 once the mean passes 0.67; the line is now capped halfway between the mean and the maximum (a sparse mesh keeps its 0.15) |
| E08d taught loop answers back | fixed | `ZipSpeaker` (`zip-speech.ts`): with the new memory on, the mesh keeps the question and a small learned readout (ridge regression in closed form) turns it into the answer. 8 of 8 right on a sparse mesh and on the live-sized one; with memory off 1 of 4. Limits: about 16 questions, it is a lookup (no answers to unseen questions; `recall()` returns nothing for unfamiliar ones), and only the tail of a question is remembered |
| E09 / E09b hyperdimensional engine | works | bounded and finite over 300 learning ticks in 3 configs (bounded by tanh); different inputs give different states |
| E10 / E10b / E10c interference, Grover | works | exact 20 / 14.14 / 0 for 0 / 90 / 180 degrees; random phases cancel; amplification reaches 0.96 share then oscillates (correct Grover). This is classical phasor arithmetic |
| E11 Code-to-Net | exact for affine and polynomial, approximate for the rest | exactly affine functions and exact polynomials of degree 2 or 3 in up to 3 inputs (`x*x`, `x*y`, a cubic) compile to an exact circuit: no training, zero error, correct at x=1e6, survive serialization. Anything else numeric (sin, abs, floor, exp, ternaries, max) is fitted: error ~0.02 inside the sampled range and no extrapolation. Verified at 64 points in [-10, 10] before an exact tier is accepted |
| E12 coexistence | works | |
| E15 elastic block input | fixed | `ElasticCoreBlock` recomputed its driven neuron away on the first tick, so two different inputs gave the identical output and nothing could be learned as a function of input. Driven neurons are now held while it settles; it learns two tasks jointly to ~0 |
| E16 short-term context | works | `thread-context.ts`: freeze the mesh's activity (including each neuron's wave phase) when a turn stops, thaw it when the conversation returns; a resumed conversation matches an uninterrupted one exactly, on the live configuration too |
| E14 mesh memory of earlier input | fixed (opt-in) | by default the state after a 58-byte history equals the state after its last byte alone, to eight decimals. `new ZipLoopInterface(engine, ids, { memory: { vale } })` or `NEUROCLAW_ZIP_MEMORY=0.97` gives non-doorway neurons inertia, so earlier input leaves a decaying trace. The memory is about the last few bytes (0.97) to a few dozen (0.99); a replay can only stand in for that recent stretch |
| E13 elastic protection vs forgetting | fixed | the block ignored its input (two different inputs gave the identical output), so nothing could be learned as a function of input and the old experiment was invalid. Fixed (driven neurons are held while settling): the block learns two tasks jointly to ~0. Learning task B with no protection destroys task A (error 1.6, worse than untrained 0.45); protecting each parameter by how much it matters to A keeps it (error 0.02-0.45) while B is still learned; scrambled importance and a uniform slowdown protect nothing |

These are **falsification experiments**, not proof that the architecture is correct. Passing an experiment only means the tested property held under that test. The next step after this suite is to add quantitative baselines and repeated runs for any claim that survives the basic gate.

Run with:

`npm run test:integration -- test/core/architecture-experiments.test.ts`

Do not use these experiments as a reason to promote code to `main`. Results should be reviewed before merging.
