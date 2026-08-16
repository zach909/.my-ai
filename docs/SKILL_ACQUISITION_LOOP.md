# The Skill Acquisition Loop

Plain-language description of the end-to-end flow an agent runs when it
needs to know how to do something it doesn't already do — from "check if
this is already documented" through "ship a trained, quantized skill".
Each step maps to an existing subsystem/spec; this doc is the glue that
ties them into one loop.

## It's autonomous, not a manual checklist

Nothing here waits on a human to kick off the next step. The loop is
self-triggered by the same Research Scheduler triggers already defined in
`docs/SHARED_WIKI_SYSTEM.md` §2.1 (file save/commit, a new skill/plugin
being registered, a chat session ending, or a scheduled sweep) — any of
those can start the loop on its own, the same way the "autonomous training
loop" in `docs/SELF_IMPROVEMENT_IMPLEMENTATION_PLAN.md` runs unattended.
"Autonomous" here specifically means *self-triggered*, not
*unsupervised-forever*: the risk-scoring/review gate in
`docs/SHARED_WIKI_SYSTEM.md` §2.2 step 5 still routes medium/high-risk
wiki diffs to human review before they land, and any external web-research
step stays opt-in per that spec — autonomy governs *when the loop starts
and how it moves between steps*, not whether every output auto-merges.

## It's non-linear — a loop with branches, not a pipeline

The numbering below is for reference, not a strict 1→2→3→4→5 waterfall.
Steps route back to earlier ones on failure instead of dead-ending:

- A **failed experiment** (step 4) doesn't stop the loop — it routes back
  to step 3 for broader/different web research, or back to step 1 with a
  refined query if the first wiki check was too narrow. Only after
  research options are exhausted does the loop give up and report why.
- **Partial success** is pushed as-is (step 5) while the loop keeps
  iterating on the rest — e.g. the wiki page documenting what was learned
  ships even if the trained skill's quality gate hasn't passed yet, rather
  than holding everything back for a single all-or-nothing finish.
- A wiki check (step 1) that finds a *related but incomplete* page routes
  to step 3 for the missing part specifically, not a full restart —
  existing citations are kept, only the gap is researched.

## The loop's steps

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
3. **If nothing matches (or step 4 fails)** — the agent falls back to
   external research: web search via the same `WebFetch`-based,
   domain-allow-listed path described in `docs/SHARED_WIKI_SYSTEM.md` §2.2
   ("Crawl" stage, optional web research scope). This is explicitly opt-in
   and local-first per that spec — it only runs when the user has enabled
   it. A retry from a failed step 4 broadens the query rather than
   repeating the same search.
4. **Run experiments.** Whatever was found (existing page or new research)
   is treated as a hypothesis, not a fact, until tried. The agent uses
   Net Search's temporary-network mechanism (`docs/NET_SEARCH_SPEC.md` §
   "Temporary networks" — ephemeral `TemporaryNetwork`, TTL + LRU) to
   actually build and run a small trial network against the idea, the same
   predict → compare → keep/discard loop described in
   `docs/AI_NEURAL_NETWORK_BASICS.md` — just scoped to a throwaway network
   instead of a permanent one. A failed experiment loops back to step 3,
   not to a dead stop.
5. **As soon as any part of the approach is confirmed working**, the agent
   pushes what it has — the loop doesn't wait for every piece to be done:
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

| Step | Subsystem | Spec | On failure/gap |
|---|---|---|---|
| Self-trigger | Research Scheduler | `SHARED_WIKI_SYSTEM.md` §2.1 | — |
| Check existing wiki pages | Net Search over wiki index | `NET_SEARCH_SPEC.md`, `SHARED_WIKI_SYSTEM.md` | Partial match → step 3 for the gap only |
| Web research fallback | Wiki Source Crawlers (optional scope) | `SHARED_WIKI_SYSTEM.md` §2.2 | Exhausted → report why, stop |
| Run experiments | Net Search temporary networks | `NET_SEARCH_SPEC.md` "Temporary networks" | Fails → back to step 3, broader query |
| Push wiki page | Draft Composer + Citation Binder | `SHARED_WIKI_SYSTEM.md` §2.2 | Risk-scored; medium/high → human review |
| Push skill (build) | Extension Builder | `EXTENSION_BUILDER_SPEC.md`, [[Builder]] | Can ship after wiki page even if not done |
| Push skill source | `saveWithoutQuantization` / `.exact.json` | `wiki/Quantization.md` | — |
| Push binary skill | `installWithQuantization` / `.ext.json` | `EXTENSION_BUILDER_SPEC.md` §6 | — |
| Record improvement algorithm | Self-improvement loop | `SELF_IMPROVEMENT_IMPLEMENTATION_PLAN.md` | — |
