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
| E05 / E05b net-skill routing | weak | 12 of 24 right with 8 skills (chance is 3). Misroutes paraphrases and never abstains: nonsense is still routed |
| E06 learning | works (trivial task) | 5 of 5 runs pick the rewarded action |
| E07 forgetting | fails | task A's margin falls from ~2.0 to ~0.1-0.4 after a similar task B |
| E08a Zip Loop input | works | one tick per bit, most significant first |
| E08b live network speaks | fails | 64-neuron live-sized network is silent after "hi" (max energy ~0.03, reader returns nothing 4 of 4) |
| E08c dense network speaks | fails by construction | energy is capped at 1.0 but the reader needs 1.5x the mean, which is above 1.0 once the mean passes 0.67 |
| E08d taught loop answers back | **not demonstrated** (`it.fails`) | silent in every teaching setting tried. The repo has no output-training method; teacher forcing with Hebbian learning did not work |
| E09 / E09b hyperdimensional engine | works | bounded and finite over 300 learning ticks in 3 configs (bounded by tanh); different inputs give different states |
| E10 / E10b / E10c interference, Grover | works | exact 20 / 14.14 / 0 for 0 / 90 / 180 degrees; random phases cancel; amplification reaches 0.96 share then oscillates (correct Grover). This is classical phasor arithmetic |
| E11 / E11b Code-to-Net | approximate | error ~0.02 inside the sampled range, none of the exact "affine tier" the spec promises exists, and no extrapolation (2x+1 is off by 26 at x=20) |
| E12 coexistence | works | |
| E13 gate vs forgetting | fails | in `gate-forgetting.test.ts` (opt-in, `NEUROCLAW_SLOW=1`): the gate only slows learning; protecting the "important" neurons is no better than protecting random ones |

These are **falsification experiments**, not proof that the architecture is correct. Passing an experiment only means the tested property held under that test. The next step after this suite is to add quantitative baselines and repeated runs for any claim that survives the basic gate.

Run with:

`npm run test:integration -- test/core/architecture-experiments.test.ts`

Do not use these experiments as a reason to promote code to `main`. Results should be reviewed before merging.
