# The Skill Acquisition Loop

Plain-language description of the end-to-end flow an agent runs when it
needs to know how to do something it doesn't already do — from "check if
this is already documented" through "ship a trained, quantized skill".
Each step maps to an existing subsystem/spec; this doc is the glue that
ties them into one loop.

## The loop, in order

1. **Check the wiki first.** Before doing anything else, the agent looks
   at its own wiki pages for a page that already covers the topic. This is
   a Net Search–style semantic lookup over indexed wiki/skill content, not
   a plain string match — see `docs/NET_SEARCH_SPEC.md` §1 (`IndexedUnit`,
   `hard_search`/`semanticSearch`) and `docs/SHARED_WIKI_SYSTEM.md` §1
   (Source Crawlers / Fact Extractor over existing pages).
2. **If a matching page exists** — the agent states what it found ("this
   wiki page already covers X, here's what I'm going to do with it") and
   builds on it directly: reuse the documented facts/citations instead of
   re-deriving them, and skip straight to step 4 if the existing page
   already describes a working approach.
3. **If nothing matches** — the agent falls back to external research: web
   search via the same `WebFetch`-based, domain-allow-listed path described
   in `docs/SHARED_WIKI_SYSTEM.md` §2.2 ("Crawl" stage, optional web
   research scope). This is explicitly opt-in and local-first per that
   spec — it only runs when the user has enabled it.
4. **Run experiments.** Whatever was found (existing page or new research)
   is treated as a hypothesis, not a fact, until tried. The agent uses
   Net Search's temporary-network mechanism (`docs/NET_SEARCH_SPEC.md` §
   "Temporary networks" — ephemeral `TemporaryNetwork`, TTL + LRU) to
   actually build and run a small trial network against the idea, the same
   predict → compare → keep/discard loop described in
   `docs/AI_NEURAL_NETWORK_BASICS.md` — just scoped to a throwaway network
   instead of a permanent one.
5. **If the experiment confirms the approach works**, the agent pushes
   everything it produced:
   - **The wiki page** — the researched/validated facts, written up with
     citations back to their source (code, commit, or external URL), via
     the Draft Composer + Citation Binder pipeline in
     `docs/SHARED_WIKI_SYSTEM.md` §2.2 steps 3–4.
   - **The skill** — the temporary network is promoted into a permanent
     one and packaged as a skill through the Extension Builder's build
     order (gather neurons → wire connections → hyperdimensional defaults
     → specialized connections → deep learning), per
     `docs/AI_NEURAL_NETWORK_BASICS.md`'s Extension Builder section and
     `docs/EXTENSION_BUILDER_SPEC.md`.
   - **Skill source code** — the exact, un-quantized, still-editable
     project save (`saveWithoutQuantization` / `.exact.json`), so the skill
     can be re-opened and re-edited later. See `wiki/Quantization.md`,
     "Save projects without quantization."
   - **Binary skill code** — the quantized, deployment-ready package
     (`installWithQuantization` / `.ext.json`, per
     `docs/EXTENSION_BUILDER_SPEC.md` §6 Quantization pipeline), which is
     what actually gets routed to at runtime as a MoE expert.
   - **The improvement algorithm** — the specific training/perturbation
     recipe that produced a working result (which variations were kept vs.
     discarded, hyperparameters, epoch/time budget) is recorded alongside
     the skill so the same recipe can be reapplied or refined later,
     consistent with `docs/SELF_IMPROVEMENT_IMPLEMENTATION_PLAN.md`.

## Why check the wiki first

This ordering exists for the same reason the value system protects
well-tuned neurons (`docs/VALE_SYSTEM.md`): re-deriving something from
scratch when it's already documented wastes compute and risks producing a
worse, uncited answer than what's already on record. Checking first also
means the eventual wiki write is a *patch* to existing, cross-linked
content rather than an unlinked duplicate page — see
`docs/SHARED_WIKI_SYSTEM.md` §2.3 on preserving human-authored sections and
never blindly overwriting a page.

## Summary table

| Step | Subsystem | Spec |
|---|---|---|
| Check existing wiki pages | Net Search over wiki index | `NET_SEARCH_SPEC.md`, `SHARED_WIKI_SYSTEM.md` |
| Web research fallback | Wiki Source Crawlers (optional scope) | `SHARED_WIKI_SYSTEM.md` §2.2 |
| Run experiments | Net Search temporary networks | `NET_SEARCH_SPEC.md` "Temporary networks" |
| Push wiki page | Draft Composer + Citation Binder | `SHARED_WIKI_SYSTEM.md` §2.2 |
| Push skill (build) | Extension Builder | `EXTENSION_BUILDER_SPEC.md`, [[Builder]] |
| Push skill source | `saveWithoutQuantization` / `.exact.json` | `wiki/Quantization.md` |
| Push binary skill | `installWithQuantization` / `.ext.json` | `EXTENSION_BUILDER_SPEC.md` §6 |
| Record improvement algorithm | Self-improvement loop | `SELF_IMPROVEMENT_IMPLEMENTATION_PLAN.md` |
