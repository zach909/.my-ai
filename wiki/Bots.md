# Automated Bots

This repository is worked on by several automated PR bots in addition to human commits and interactive Claude Code sessions. Each one has a distinct purpose, a recognizable branch-name prefix, and (except one) a commit-message emoji. This page exists mainly because of a real, recurring failure mode these bots produce when they run concurrently — see [Known failure mode](#known-failure-mode-concurrent-corruption) below — so treat it as operational documentation, not just a roster.

## The bots

### ⚡ Bolt — performance optimization

Branch prefix: `bolt-*` / `bolt/*`. Commit prefix: `⚡ Bolt:`.

Rewrites hot-path functions for speed — typically replacing `.map()`/`.filter()` closure chains with direct index loops, adding fast-path branches for small fixed sizes (e.g. 3×3/4×4 matrices), or eliminating redundant allocations. Real examples from this repo's history:

- `⚡ Bolt: Optimize matrix determinant computation in MathEngine` (`models && skills/core/math-engine.ts`)
- `⚡ Bolt: optimize NeuronMesh.propagate activation loop & buffer management`
- `⚡ Bolt: Optimize ContextCompressor tokenization and array processing`
- `⚡ Bolt: optimize HyperDimensionalEngine self-model prediction allocations`

### 🛡️ Sentinel — security hardening

Branch prefix: `sentinel-*` / `sentinel/*`. Commit prefix: `🛡️ Sentinel:`.

Finds and fixes input-validation, injection, and DoS issues, mostly in `plugins/*` (each plugin is a boundary that takes untrusted input from a chat message or another process). Real examples:

- `🛡️ Sentinel: [MEDIUM] Hardened VoiceActivationPlugin processTranscript against type confusion and DoS`
- `🛡️ Sentinel: Fix missing input validation in ContactsPlugin`
- `🛡️ Sentinel: Fix argument injection in RadiosPlugin`
- `Fix shell command execution risk in CameraPlugin` (`execSync` → `execFileSync`)
- `Fix unvalidated endpoint connection in RoboticsPlugin`

### 🎨 Palette — UX / design polish

Branch prefix: `palette-*` / `palette/*`. Commit prefix: `🎨 Palette:`.

Adds or refines interactive UI details on `src/routes/app/*` pages — search/filter, empty states, ARIA live regions, copy-to-clipboard affordances, presets. Real examples:

- `🎨 Palette: Add real-time search and filter to Chat History page`
- `🎨 Palette: Add individual subsystem removal and ARIA status updates on Architecture page`
- `🎨 Palette: Enhance Self-Improvement empty state & refresh feedback`

### Jules — general fixes and features

Branch prefix: `jules-*` (often a long numeric ID, e.g. `jules-4209792514538875050-87fc0611`; sometimes combined with another bot's focus, e.g. `jules-palette-self-improvement-ux-*`). No consistent commit emoji — commit subjects read as plain, specific descriptions rather than a branded prefix. The most prolific of the four by branch count. Scope varies: security env-var validation, feature wiring, whatever the triggering task was, sometimes handed off from/to Palette on the same branch.

## Known failure mode: concurrent corruption

**This is the reason this page exists.** When two of these bots (or two runs of the same bot) target the same file at close to the same time, their PRs sometimes land as a **literal line-by-line interleave** instead of a real merge — not a merge conflict GitHub blocks, but silently invalid code that only surfaces later as a build/type error, further down in this same section. Every confirmed instance found so far:

| File | What happened | Fixed in |
|---|---|---|
| `src/routes/app/evaluation.tsx`, `src/routes/app/knowledge.tsx` | Duplicate `applyPreset()` declarations; mismatched JSX closing tags | `be49d69c` |
| `src/routes/app/chat-history.tsx` | Two Palette search/filter implementations spliced mid-JSX-`return` (`Unexpected token`); two `return` statements; duplicated blocks | `70f15381` |
| `models && skills/core/math-engine.ts` | Two Bolt rewrites of `determinant()`'s N>4 fallback interleaved; an incomplete loop missing its closing brace ran into a duplicate `if (n === 4)` block | `70f15381` |

Evidence this isn't hypothetical: the exact commit `🎨 Palette: Add real-time search and filter to Chat History page` appears **four separate times** in this repo's history (`a351b9bc`, `bff12baf`, `5a718a6e`, `cd28af06`) — the same bot re-running on the same feature repeatedly, each attempt a candidate to collide with another in-flight PR touching the same file.

**Why `npm run build`/`npm run dev` catch it and review sometimes doesn't**: the diffs individually look plausible — each bot's own PR is syntactically valid on its own branch. The corruption only exists in the *merged* result, which is why it surfaces as a runtime `tsc`/vite build failure rather than a GitHub-flagged conflict.

**Mitigation** (not yet implemented as of this page): a CI check that runs `tsc --noEmit` (and ideally `vite build`) on every PR, and again on `main` after each merge, would catch this class of bug before — or immediately after — it lands, instead of waiting for a developer's local `npm run build` to fail. See [[Home]] for where to track this if it gets built.

## See Also

- [[Home]] - Main wiki page
- [[Extensions]] - Where AI-authored (not bot-PR-authored) code changes are scoped and packaged
- [[Privacy]] - What runs locally vs. what any of these automated systems could touch
