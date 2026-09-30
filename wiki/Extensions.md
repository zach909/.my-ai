# Self-Built Extensions

The AI creates extensions to store specialized memory, reasoning, and learned abilities — the design notes' "Background — Extensions for Memory and Logic": learning new capabilities without modifying the entire network. After learning to write code, the AI creates a coding extension to permanently preserve that knowledge.

## Overview

**Purpose**: Give the system a way to permanently keep something it learned, scoped to its own [[Elastic-Value-Budget]] entry, without retraining or risking the rest of the network.

An extension is one of two things, distinguished the same way [[Plugins]] and [[Skills]] are:

- A **skill extension** — a specialised network (a *net skill*) whose neurons are grafted into the one OneBrain mesh as a named region (see [[MoE]] for how regions are selected each tick).
- A **plugin extension** — a newly-configured local service connector, registered into the plugin registry.

A separate kind of skill, the *prompting skill*, is a declarative document that tells the agent loop how to carry out a step. It is not an extension of the network and installing one runs no code.

## How an extension gets created

1. **Build** ([[Builder]]): the Extension Builder (`extension-builder/builder.js`, `ExtensionBuilder`) holds the neuron graph. Contracts written in [[NeuroLang]] (`when X then Y`) are trained until their constraint loss converges.
2. **Save vs. install** ([[Builder]] / [[Quantization]]): the extension is saved exact and editable first (`saveWithoutQuantization`), then quantized on install (`installWithQuantization`) — matching "extensions are quantized before installation" from the design notes.
3. **Graft** (`models && skills/core/net-skill-graft.ts`, `graftNetSkill`): the skill's neurons join the running mesh, wired all-to-all with every neuron already there. Each new connection carries the same equation every existing connection does. Installing a skill by writing a description into long-term memory does not count: the network itself has to change, or it is a prompting skill under a net skill's name.
4. **Lock-in** ([[Elastic-Value-Budget]]): once a contract is satisfied, the stability (vale) of the neurons implementing it is raised, so later training does not overwrite the taught behaviour without freezing the whole network.
5. **Discovery**: `graftedSkills()` reports the regions actually in the mesh, and `net-skill-store.ts` can publish a description of each one to the store's "net-skills" kind. Only the description is published, not the weights, because weights are not portable between meshes of different sizes and histories.

Nothing should be registered or written for a capability that failed to converge; the graft is for behaviour that was actually learned.

## The Skill Builder and Plugin Builder skills

Both are entries in the [[Skills]] list and are the runtime-callable form of the steps above: Skill Builder trains and grafts a net skill, Plugin Builder configures and registers a plugin connector.

## Community extensions

"Users can install community skills or create new ones" (design notes, [[Platforms]]). The extension lifecycle — install, versioning, permissions, and storage — lives in `extension_system/` (`manager.ts`, `security.ts`, `semver.ts`, `store.ts`). A published net skill sits inert in the store until someone installs it on their machine; installing is always a local choice.

## The extension catalog (23 named extensions + Coding skill)

Location, Camera, Microphone, Voice Activation, Notifications, Account Info, Contacts, Calendar, Phone Calls, Call History, Email, Tasks, Messaging, Radio, Device Connectivity, App Diagnostics, File System, Screenshots & Screen Recording, Passkeys, Browser ([[Chrome-Apps]]), Self-Healing, Plugin Builder, Skill Builder, and Coding — see [[Plugins]] and [[Skills]] for the plugin/skill split across this list, and [[System-Access]] for the ones that touch the local OS directly.

## Verifying it

`npm test` runs the suites. The graft itself is covered by `test/core/net-skill-graft.test.ts` (what the graft adds to the mesh and what it must not disturb), with store publication in `test/core/net-skill-store.test.ts` and live sync in `test/core/net-skill-live-sync.test.ts`.

## History

Earlier versions of this page documented `build_skill()`, `learn_and_extend()`, `install_extension()`, and `python main.py learn-code`, which lived in the Python TinyGPT track. That track was removed, and none of those functions exist any more. The live path is the Extension Builder grafting a skill's neurons into the one network, as above.

## See Also

- [[Home]] - Main wiki page
- [[Builder]] - The save/install mechanics behind every extension
- [[Skills]] / [[Plugins]] - The two kinds of extension
- [[Elastic-Value-Budget]] - Why a learned extension doesn't get forgotten
- [[NeuroLang]] - The contract language extensions are trained from

---

*An extension is how something learned once becomes something the system keeps — locked in by vale, not by luck.*
