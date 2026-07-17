# Self-Built Extensions

The AI creates extensions to store specialized memory, reasoning, and learned abilities — the design notes' "Background — Extensions for Memory and Logic": learning new capabilities without modifying the entire network. After learning to write code, the AI creates a coding extension to permanently preserve that knowledge.

## Overview

**Purpose**: Give the system a way to permanently keep something it learned, scoped to its own [[Elastic-Value-Budget]] entry, without retraining or risking the rest of the network.

An extension is one of two things, distinguished the same way [[Plugins]] and [[Skills]] are:

- A **skill extension** — a trained [[NeuroLang]] contract (`when X then Y`), saved via the [[Builder]] and registered as a new MoE expert (see [[MoE]]).
- A **plugin extension** — a newly-configured local service connector, registered into the plugin registry.

## How an extension gets created

1. **Definishon contracts** ([[NeuroLang]] / [[Builder]]): a `when`/`then` pair is trained into the mesh with gradient descent until its constraint loss converges.
2. **Vale lock-in** ([[Elastic-Value-Budget]]): once a contract is satisfied, `raise_vale()` raises the stability of the neurons that implement it — the taught behaviour is now resistant to being overwritten by further training, without freezing the whole network.
3. **Save vs. install** ([[Builder]] / [[Quantization]]): the extension is saved exact and editable first, then quantized on install — matching "extensions are quantized before installation" from the design notes.
4. **Registration**: `register_skill()` (Python) / the equivalent registry call (TypeScript) makes the new capability permanently discoverable and routable, exactly like a built-in skill.

## The Skill Builder and Plugin Builder skills

Both are themselves entries in the [[Skills]] extension list, and both are the literal mechanism this page describes, made callable at runtime:

```python
from tinygpt.extension_builder import build_skill
from tinygpt.plugins import build_plugin

build_skill(registry, model, tokenizer, "new-skill-id", contracts, ...)   # Skill Builder
build_plugin(registry, "new-plugin-id", "os.service", name="...")         # Plugin Builder
```

This is what "the AI creates a coding extension to permanently preserve that knowledge" looks like concretely: the same `build_skill()` call the AI would make to preserve *any* newly-learned behaviour, called on a coding-flavoured set of contracts specifically.

### `learn_and_extend()` — the autonomous flagship flow

`build_skill()` trains and registers; `tinygpt.extension_builder.learn_and_extend()` is the fully autonomous version of the design notes' flagship example — "after learning to code it creates a coding extension." In one call the AI:

1. trains the capability into the mesh (real gradient descent),
2. locks the satisfied neurons in with raised vale ([[Elastic-Value-Budget]], §2 — no forgetting),
3. **only if it actually learned it** (the contracts converged) registers it as a live MoE skill, and
4. installs it to disk in quantized form ([[Quantization]], §8 — "extensions are quantized before installation"), so the ability survives restarts.

Crucially, nothing is registered or written for a capability the AI *failed* to learn — it never fabricates a coding extension for a skill it hasn't acquired. Run it live and narrated with `python main.py learn-code`, or see it asserted end to end in `test_integration.py` §4b and `test_core.py`'s `test_learn_and_extend`.

## The extension catalog (23 named extensions + Coding skill)

Location, Camera, Microphone, Voice Activation, Notifications, Account Info, Contacts, Calendar, Phone Calls, Call History, Email, Tasks, Messaging, Radio, Device Connectivity, App Diagnostics, File System, Screenshots & Screen Recording, Passkeys, Browser ([[Chrome-Apps]]), Self-Healing, Plugin Builder, Skill Builder, and Coding — see [[Plugins]] and [[Skills]] for the plugin/skill split across this list, and [[System-Access]] for the ones that touch the local OS directly.

## Verifying it

`python main.py demo` (`test_integration.py`) is the concrete, end-to-end proof. §4 builds a brand-new plugin live, dispatches it immediately, then builds a brand-new skill live and trains it into the *same* mesh already in use. §4b runs the full flagship narrative: the AI starts with no coding extension, learns a coding behaviour, and — because it actually learned it — autonomously registers the coding skill and installs the quantized extension to disk, while a deliberately unlearnable contract produces *no* extension at all. `python main.py learn-code` runs that flagship flow on its own with live narration.

## See Also

- [[Home]] - Main wiki page
- [[Builder]] - The save/install mechanics behind every extension
- [[Skills]] / [[Plugins]] - The two kinds of extension
- [[Elastic-Value-Budget]] - Why a learned extension doesn't get forgotten
- [[NeuroLang]] - The contract language extensions are trained from

---

*An extension is how something learned once becomes something the system keeps — locked in by vale, not by luck.*
