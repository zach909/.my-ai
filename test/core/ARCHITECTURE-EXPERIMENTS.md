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

These are **falsification experiments**, not proof that the architecture is correct. Passing an experiment only means the tested property held under that test. The next step after this suite is to add quantitative baselines and repeated runs for any claim that survives the basic gate.

Run with:

`npm run test:integration -- test/core/architecture-experiments.test.ts`

Do not use these experiments as a reason to promote code to `main`. Results should be reviewed before merging.
