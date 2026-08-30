# MoE (Mixture of Experts)

Specialized groups of neurons determine which experts execute a task, so only the relevant ones run — the design notes' "Mixture of Experts": improved efficiency, reduced computation, increased performance.

## Overview

**Purpose**: Full density (every expert stays wired), sparse per-tick compute (only the top-k selected experts actually run).

| Layer | File | What it is |
|---|---|---|
| TypeScript runtime backend | `models && skills/core/moe-router.ts` — `MoERouter` | Top-k expert routing with load-balanced utilization tracking |

## `MoERouter` (TypeScript)

```typescript
const router = new MoERouter({ /* config */ });
const id = router.addExpert({ id: 'image-gen', name: 'Image Expert', specialization: 'images' });
const decision = router.route(input);          // which expert(s) fire for this input
const out = router.forward(input, layerIndex); // route + run in one call
router.getUtilizationStats();                   // per-expert usage, for load-balance monitoring
```

An expert can be added either as raw weights (`addExpert(weights, bias)`) or as a named specialization (`addExpert({ id, name, specialization })`) — the latter is how [[Skills]] register: "an image-generation expert is loaded only when image-related tasks are requested" is `route()` picking that expert's id for image-shaped input and leaving every other expert's weights untouched that tick.

## `MoELayer` (Python)

This is a genuine trainable sparse layer — gradients only flow through the `top_k` experts selected per token, so unselected experts are skipped computationally, not just masked to zero afterward. `skill_usage()` is how load imbalance (one expert dominating routing) gets surfaced during training.

Experts are groups of neurons inside the one network rather than models consulted beside it: `HyperDimensionalEngine.setNeuronGroup()` labels a neuron with the expert it belongs to, and a tick's `activeGroups` says which are being asked. A neuron in a group nobody asked for holds its state; it keeps every connection it had in both directions. (The Python `ExpertMoE` this section used to describe went with the TinyGPT track.)

## Verifying it

- `npm test` (`test/smoke.mjs`)'s `testMoE`, `testMoESharedMesh`, and `testExpertRegistrationCompleteness` cover routing, shared-mesh expert wiring, and that every catalogued expert actually registers.
- `python test_core.py`'s `test_skills_attach_to_mesh` confirms the Python skill registry's experts genuinely attach to and route through a real mesh.
- `python main.py demo` (`test_integration.py`, §4) builds a brand-new skill live via the Skill Builder and confirms it registers as a routable expert on the same mesh already in use.

## Foreground MoE Spec

Expert creation/deletion/merging/splitting, a trainable router-gate option,
dynamic routing knobs, capacity-based load balancing, and parallel execution
modes are specified (implementation-ready, not yet all built) in
[`docs/FOREGROUND_MOE_SPEC.md`](../docs/FOREGROUND_MOE_SPEC.md).

## See Also

- [[Home]] - Main wiki page
- [[Skills]] - How a skill becomes a routable MoE expert
- [[Neuron-Mesh]] - What the selected experts actually run against
- [[Plugins]] - The plugin/skill distinction this routing depends on

---

*MoE is why adding a new skill doesn't slow down every other query — only the neurons that specialize in it ever run for it.*
