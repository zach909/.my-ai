# Net-Skill Routing (replaces the MoE)

NeuroClaw no longer has a Mixture-of-Experts router. Which parts of the network run on a tick is decided by **net-skill routing**: every skill and plugin is a named *region* of neurons inside the one mesh, and a tick switches on the regions whose meaning matches the input.

## Why the MoE went

The MoE (`MoERouter`) was a second network sitting in front of the first. It was a randomly initialised gate matrix whose top-k scores picked "experts", and each expert also carried its own weight matrix. The experts were named after skills, but nothing the skills actually *meant* went into scoring them. A net skill is already a region of the mesh, tuned to its meaning when it is grafted in (see [[Skills]]). So routing only needs to ask which regions the input is about.

## How it works

| Piece | File | What it does |
|---|---|---|
| `NetSkillRouter` | `models && skills/core/net-skill-router.ts` | Embeds each region's meaning with the same `embedText` the graft tunes neurons with. Scores the input (text or vector) against each region by cosine similarity and selects the best `topK` that are related at all. |
| `NetSkillMesh` | `models && skills/core/net-skill-mesh.ts` | Named skill regions in a shared all-to-all `NeuronMesh`, used by the plugin registry. `tick()` routes, then propagates with only the selected regions computing. Formerly `MixtureOfExperts`. |

```typescript
const router = new NetSkillRouter(2);
router.register({ id: 'email', name: 'Email', meaning: 'send and read email messages' });
router.select('check my inbox').ids;  // ['email']: its region is switched on this tick
router.getUsage();                     // how often each region has been selected
```

The selected ids become the tick's `activeGroups`. A neuron in a region nobody asked for holds its state and keeps every connection it had. Everything else stays as described in [[Neuron-Mesh]]: all-to-all, hyperdimensional, wave and quantum terms included.

Used by:
- `NeuroPipeline` (the live agent)
- `UnifiedBrain` / `NeuroclawLLM` (chat)
- the plugin registry

OneBrain is also one of these regions, with id `onebrain`.

## Verifying it

`npm test` (`test/smoke.mjs`) covers this in three suites:
- `testNetSkillRouter`: routing picks the region whose meaning matches, deterministically.
- `testNetSkillMesh`: regions are fully wired, and unselected regions do not compute.
- `testExpertRegistrationCompleteness`: every plugin and skill category is a routable region.

## See Also

- [[Home]] - Main wiki page
- [[Skills]] - How a skill is grafted into the mesh as a region
- [[Neuron-Mesh]] - What the selected regions actually run against
- [[Plugins]] - The plugin/skill distinction this routing depends on
