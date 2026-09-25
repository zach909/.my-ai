# NeuroClaw - Artificial Superintelligence System


WARNING ⚠️ THIS PROJECT IS IN BETA. WE ARE NOT RESPONSIBLE FOR YOUR ACTIONS OR WHAT THE CODE DOES. BY CONTINUING YOU AGREE WITH THIS STATEMENT AND THE [PRIVACY POLICY](PRIVACY.md) AND [TERMS AND CONDITIONS](TERMS.md).

NeuroClaw is a comprehensive, local-first AI agent. It's powered by **OneBrain**, the neural mesh engine underneath — the all-to-all neuron computation, quantization, and mixture-of-experts routing described throughout this repo all live there. NeuroClaw the agent is itself made of skills: each capability is trained and packaged by the Extension Builder, then registered into OneBrain as a routable MoE expert.

A comprehensive AI/ASI system with modular architecture implementing neural mesh computing, mixture of experts, hyperdimensional thinking, and self-improvement capabilities.

## Quick Start

```bash
git clone https://github.com/zach909/.my-ai.git
cd .my-ai

# Installation
./scripts/install.sh

# Development
npm run dev

# Build
npm run build

# Test ASI Core
python3 -m unittest discover -s asi_core -p "test_*.py" -v

# Test specific component
python3 -c "from asi_core import UnifiedBrain; brain = UnifiedBrain(); print(brain.perceive([0.1, 0.2, 0.3, 0.4]))"
```

## Project Structure

### Top-level overview

```
├── .bin/                    # Symlinks to the TypeScript compiler (tsc, tsserver) in node_modules
├── .claude/                 # Claude Code local permission settings
├── asi_core/                # Python reference implementation of the brain (stdlib only) + its unit tests
├── benchmarks/              # Bun/TS performance benchmarks for the OneBrain engine
├── config/                  # Runtime config: access grants, quantization, routing, optimization baselines
├── desktop-app/             # Electron desktop wrapper (macOS / Windows / Debian)
├── dist/                    # Compiled JavaScript output of the TypeScript backend (tsc → dist/)
├── docs/                    # Design specs, guides, and status documents
├── extension-builder/       # Extension Builder engine, network build/training scripts, and trained artifacts
├── extension_system/        # TypeScript extension lifecycle, versioning, permissions, and storage
├── generated/               # Skills and plugins the AI wrote for itself, plus their wiki pages
├── interface/               # Backend entry point, HTTP API server, CLI, and OS-access layer
├── live-usb/                # Debian live-build config for a bootable NeuroClaw USB image
├── model && skills manager/ # Python NeuroLang DSL/runtime and legacy TinyGPT-era files
├── models && skills/        # The TypeScript AI engine (OneBrain) and every core subsystem
├── plugin_manager/          # Plugin registry, loader, SDK, and capability router (TS + Python)
├── plugins/                 # Every plugin (camera, email, terminal, store, …) in TS and Python
├── public/                  # Static files served as-is by Vite (icons, robots.txt, sitemap)
├── scripts/                 # Dev/server launchers, autonomous agents, exams, build helpers
├── src/                     # React frontend (TanStack Start + Vite) plus a few backend-shared libs
├── test/                    # Vitest suites for the TypeScript stack, plus smoke + install tests
├── tests/                   # Python security test suite for the Python plugins
├── training_data/           # Scientific-database catalog and its loader
└── wiki/                    # Architecture wiki (source of the GitHub wiki)
```

### Every subfolder

| Folder | What it holds |
|---|---|
| `desktop-app/assets/` | App icons for each OS. |
| `desktop-app/scripts/` | Preflight `doctor.mjs`, run before Electron starts. |
| `desktop-app/src/main/` | Electron main process and local app server. |
| `desktop-app/src/preload/` | Secure preload bridge. |
| `desktop-app/src/renderer/` | Boot screen and fallback renderer HTML. |
| `desktop-app/test/` | Desktop app tests. |
| `dist/extension-builder/` | Compiled `extension-builder/`. |
| `dist/extension_system/` | Compiled `extension_system/`. |
| `dist/interface/` | Compiled `interface/`. Contains the backend entry point `main.js`. |
| `dist/models && skills/` | Compiled top-level `models && skills/` modules. |
| `dist/models && skills/core/` | Compiled OneBrain engine and core subsystems. |
| `dist/plugin_manager/` | Compiled `plugin_manager/`. |
| `dist/plugins/` | Compiled plugins. |
| `dist/plugins/extensions/` | Compiled built-in extensions. |
| `dist/src/` | Compiled backend-shared `src/index.ts`. |
| `dist/src/lib/` | Compiled backend-shared `src/lib/` helpers. |
| `dist/src/server/` | Compiled `bot-service.ts`. |
| `docs/architecture/` | Implementation-level architecture docs (background quantization). |
| `extension-builder/checkpoints/` | Saved network checkpoints. |
| `extension-builder/extensions/` | Extension records (mostly leftovers from tests). Built `.ext.json` files land here but are gitignored. |
| `extension-builder/installed/skills/` | Installed-skills location. It currently holds only a path-traversal test fixture. |
| `generated/plugins/` | Plugins the AI generated (`.ts` + manifest). |
| `generated/plugins-wiki/` | Wiki pages for the generated plugins. |
| `generated/skills/` | Skills the AI generated (`.neuri` NeuroLang). |
| `generated/skills-wiki/` | Wiki pages for the generated skills. |
| `live-usb/config/` | Debian live-build configuration tree. |
| `live-usb/config/hooks/live/` | Build-time chroot hooks. |
| `live-usb/config/includes.chroot/` | Files copied verbatim into the live filesystem. |
| `live-usb/config/includes.chroot/etc/skel/` | Home-directory dotfiles for the live user (kiosk autostart). |
| `live-usb/config/includes.chroot/etc/skel/.config/openbox/` | Openbox autostart that launches the kiosk browser. |
| `live-usb/config/includes.chroot/etc/systemd/system/` | systemd unit that runs NeuroClaw. |
| `live-usb/config/includes.chroot/etc/systemd/system/multi-user.target.wants/` | Symlink that enables the unit at boot. |
| `live-usb/config/package-lists/` | Debian packages installed into the image. |
| `model && skills manager/data/` | Sample data from the TinyGPT era. |
| `model && skills manager/data/pretrain/` | Sample pretraining corpus. |
| `model && skills manager/data/sft/` | Sample fine-tuning chats. |
| `model && skills manager/interface/` | Legacy TinyGPT chat server. |
| `models && skills/core/` | OneBrain engine and every core subsystem (memory, reasoning, store, access, …). |
| `models && skills/self_ext_*/` | 14 self-authored memory-extension snapshots (generations 5–70). |
| `plugins/extensions/` | Built-in extensions (Coding, SkillMaker, PluginMaker, …). |
| `scripts/drill-generators/` | Problem generators for the skill-drill agent. |
| `scripts/exam-generators/` | Question generators for the capability exam. |
| `scripts/patches/` | Old one-off source patch scripts. Most target files that no longer exist. |
| `src/assets/` | Images bundled into the frontend. |
| `src/components/` | Shared React components. |
| `src/components/charts/` | Hand-written chart component. |
| `src/components/ui/` | shadcn/ui primitives. |
| `src/features/` | Feature modules. |
| `src/features/builder/` | Extension Builder UI. |
| `src/features/mesh/` | In-browser mesh engine and 3D visualization. |
| `src/hooks/` | React hooks. |
| `src/layouts/` | Layout components. |
| `src/lib/` | Frontend utilities, some of them shared with the backend. |
| `src/routes/` | File-based TanStack routes. |
| `src/routes/app/` | Pages under `/app` (chat, store, settings, …). |
| `src/server/` | Chat bot service. |
| `test/core/` | Vitest suites for each subsystem and plugin. |
| `tests/` | Python test root. |
| `tests/security/` | Python plugin security tests. |
| `wiki/bot/` | Wiki pages published through the API. |

### Every file and folder, explained

Every tracked file in the repository is listed below, grouped by folder. Paths are relative to the repo root.

#### Root files

| File | What it does |
|---|---|
| `.gitattributes` | Routes binary media (images, video, audio, fonts, PDFs) through Git LFS. |
| `.gitconfig` | Marks `/home/user` as a git `safe.directory` so git works inside containers. |
| `.gitignore` | Ignores build output, `node_modules`, logs, env files, archives, and runtime-generated state. |
| `.stylelintrc.json` | Stylelint rules for `src/**/*.css`. It allows Tailwind v4 at-rules such as `@theme`, `@apply`, and `@utility`. |
| `AGENTS.md` | Instructions for AI coding agents: how to run the Docker dev environment and how to check that it works. |
| `PRIVACY.md` | Short pointer to the full privacy policy in `wiki/Privacy-Policy.md` and `wiki/Privacy.md`. |
| `README.md` | This file: project overview, quick start, and the complete file map. |
| `STRUCTURE.md` | Older folder-level structure document and naming conventions. |
| `TERMS.md` | Short pointer to the full terms of use in `wiki/Terms.md`. |
| `bun.lock` | Bun lockfile for Node dependencies. |
| `components.json` | shadcn/ui config: style, Tailwind CSS path, and the `@/` import aliases. |
| `docker-compose.dev.yml` | One-service Docker Compose dev setup (`node:22-slim`). It runs `npm install && npm run dev` on ports 3000 and 7861. |
| `eslint.config.js` | ESLint flat config, scoped to `src/` (React hooks and react-refresh rules). |
| `package.json` | Node package manifest. It defines the scripts (`dev`, `server`, `build`, `lint`, `test`, `bench:*`) and the dependencies. |
| `package-lock.json` | npm lockfile. |
| `pnpm-lock.yaml` | pnpm lockfile. |
| `requirements.txt` | Top-level Python requirements. It is deliberately empty because the Python mesh uses only the standard library, and the file explains why. |
| `tsconfig.json` | TypeScript config for the React frontend (`src/`). |
| `tsconfig.backend.json` | TypeScript config for the Node backend. It compiles `models && skills/`, `interface/`, `plugins/`, `plugin_manager/`, `extension_system/`, and a few `src/` files into `dist/`. |
| `tsconfig.node.json` | TypeScript config for Node-side tooling files such as `vite.config.ts`. |
| `twisted_metal_strip.obj` | Wavefront 3D mesh of the twisted-metal-strip logo. |
| `twisted_metal_strip_3pt_profile.html` | Standalone Three.js page that renders the twisted-strip logo. It is the origin of `src/components/twisted-strip-geometry.ts`. |
| `vite.config.ts` | Vite + TanStack Start config: dev server on port 3000, `/api` proxy to the backend on 7861, a plugin that keeps global CSS imported, and build settings. |
| `vitest.config.ts` | Vitest config for the backend test suites in `test/`. It is kept separate from `vite.config.ts` on purpose. |

#### `.bin/`

| File | What it does |
|---|---|
| `.bin/tsc` | Symlink to `node_modules/typescript/bin/tsc`, used by the backend build. It only works after `npm install`. |
| `.bin/tsserver` | Symlink to `node_modules/typescript/bin/tsserver` (the TypeScript language server). |

#### `.claude/`

| File | What it does |
|---|---|
| `.claude/settings.local.json` | Claude Code permission allowlist for commands used while developing, such as `npx tsx index.ts cli`. |

#### `asi_core/` — Python reference brain

Pure-Python, stdlib-only implementation of the brain. Run the tests with `python3 -m unittest discover -s asi_core -v`. It is not part of the web runtime.

| File | What it does |
|---|---|
| `asi_core/__init__.py` | Package entry point. It re-exports the public API (`NeuralMesh`, `UnifiedBrain`, `create_brain`, …). |
| `asi_core/action_log.py` | Action log and human-approval gate. It records what the AI did, why, and which system did it, and holds actions that match approval rules. |
| `asi_core/background_quantization.py` | Pure-Python quantizer (float → int4 with scale and zero-point) plus a "billing" step that quantizes finished extensions. |
| `asi_core/circular_context.py` | Circular context buffers. Items evicted from the buffer are compressed into memory instead of being dropped. |
| `asi_core/endurance_training.py` | Long-running training harness for `UnifiedBrain`: a curriculum across all expert domains, with checkpointing and resume. |
| `asi_core/extension_system.py` | Versioned extensions that bundle learned skills. Each one goes through the lifecycle created → tested → optimized → quantized. |
| `asi_core/hive_mind.py` | Multi-agent sharing of extensions between brains. Shared extensions are re-verified before they are accepted, and each agent has a trust score. |
| `asi_core/hyperdim_thinking.py` | Hyperdimensional thinking: HD vector algebra (bind, bundle, permute), per-neuron state, surprise-gated memory, and analogy reasoning. |
| `asi_core/mistake_tracker.py` | Records why each mistake happened and lowers the value of patterns that keep repeating mistakes. |
| `asi_core/neural_core.py` | Stage-1 neural core: neurons, layers, synapses, Hebbian learning, and STDP. |
| `asi_core/neural_dsl.py` | Neural Definition Language (NDL): parses and executes text neuron definitions (`name=`, `@vale=`, `@definition=`, connections). |
| `asi_core/neural_mesh.py` | The all-to-all neural mesh: D-dimensional neuron states, zero-sum vale, expert groups, and optional multi-process parallel settle. |
| `asi_core/neural_states.py` | Neural state vectors and plasticity rules (Hebbian, STDP, homeostatic), plus state persistence. |
| `asi_core/unified_brain.py` | `UnifiedBrain`: connects the mesh, vale, HD thinking, and learning into one pipeline (input → state → memory → reasoning → skills → output → learning). |
| `asi_core/vale_system.py` | Background Value (vale) system: a strictly zero-sum stability budget in which high-vale neurons change slowly. |
| `asi_core/test_action_log.py` | Tests for `action_log.py`. |
| `asi_core/test_background_quantization.py` | Tests for `background_quantization.py`. |
| `asi_core/test_circular_context.py` | Tests for `circular_context.py`. |
| `asi_core/test_endurance_training.py` | Tests for `endurance_training.py`. |
| `asi_core/test_extension_system.py` | Tests for `extension_system.py`. |
| `asi_core/test_hive_mind.py` | Tests for `hive_mind.py`. |
| `asi_core/test_hyperdim_thinking.py` | Tests for `hyperdim_thinking.py`, organized section by section to match `docs/HYPERDIMENSIONAL_THINKING.md`. |
| `asi_core/test_mistake_tracker.py` | Tests for `mistake_tracker.py`. |
| `asi_core/test_neural_core.py` | Tests for `neural_core.py` and `neural_states.py`. |
| `asi_core/test_neural_dsl.py` | Tests for the NDL parser and executor. |
| `asi_core/test_neural_mesh.py` | Tests for `neural_mesh.py`: connectivity, vale, settle, learning, persistence, and parallel equivalence. |
| `asi_core/test_unified_brain.py` | Tests for `unified_brain.py`. |
| `asi_core/test_vale_system.py` | Tests for `vale_system.py`: conservation, bounds, plasticity, and serialization. |

#### `benchmarks/`

| File | What it does |
|---|---|
| `benchmarks/README.md` | How to run each benchmark (`bun run bench`, `bench:*`). |
| `benchmarks/hyper_benchmark.ts` | Times `HyperDimensionalEngine` propagation. |
| `benchmarks/memory_benchmark.ts` | Times `LongTermMemory` recall over 1,000 stored items. |
| `benchmarks/mesh_benchmark.ts` | Times serial `NeuronMesh.propagate()` on a 200-node mesh. |
| `benchmarks/mesh_parallel_benchmark.ts` | Compares serial and `MeshWorkerPool` (worker_threads) propagation on a mesh large enough for parallelism to pay off. |
| `benchmarks/moe_benchmark.ts` | Times `MoERouter` expert routing. |
| `benchmarks/quantizer_benchmark.ts` | Times bit-packing and unpacking (`packLevels`/`unpackLevels`) at different bit widths. |
| `benchmarks/rlm_benchmark.ts` | Times `RLMTrainer` experience replay and training. |

#### `config/`

| File | What it does |
|---|---|
| `config/Icon.obj` | 3D model of the app icon. It is a byte-for-byte duplicate of the root `twisted_metal_strip.obj`. |
| `config/access.json` | Saved computer-access kill switches and capability grants (read by `access-settings.ts`). |
| `config/encryption.salt` | Binary salt for deriving encryption keys for encrypted local data. |
| `config/optimization-baseline.json` | Baseline metric values that the optimization agent (`scripts/optimize-agent.mjs`) compares against. |
| `config/optimization-report.json` | Latest report from the optimization agent: each check's value and what it removed or flagged. |
| `config/quantization.json` | Background quantization settings: bit width, method, mode, and mixed-precision rules. |
| `config/routing.json` | Learned routing evidence: per-token weights that map words to plugins, used by the capability router. |

#### `desktop-app/` — Electron wrapper

| File | What it does |
|---|---|
| `desktop-app/.gitignore` | Ignores `.staged-dist/`, the web build copied in before packaging. |
| `desktop-app/README.md` | Desktop app docs: structure, system requirements (Debian 12+), build commands, and IPC API. |
| `desktop-app/assets/.gitkeep` | Placeholder note that lists the required icon files. |
| `desktop-app/assets/icon.icns` | macOS app icon. |
| `desktop-app/assets/icon.ico` | Windows app icon. |
| `desktop-app/assets/icon.png` | Linux app icon. |
| `desktop-app/package.json` | Electron app manifest and electron-builder packaging config (Windows, macOS, Linux targets). |
| `desktop-app/package-lock.json` | npm lockfile for the desktop app. |
| `desktop-app/scripts/doctor.mjs` | Preflight check before `electron .`. It looks for a display server, required shared libraries, the sandbox helper, and the Debian version, so Electron doesn't fail silently. |
| `desktop-app/src/main/app-server.js` | Local static-file server plus `/api` reverse proxy that serves the built web app inside the desktop window. |
| `desktop-app/src/main/main.js` | Electron main process: starts the NeuroClaw backend, creates the window, and handles IPC (files, shell, blocked-command denylist). |
| `desktop-app/src/preload/preload.js` | Preload bridge. It exposes a restricted `window.electronAPI` to the renderer. |
| `desktop-app/src/renderer/index.html` | Fallback renderer page from the original cross-platform template. |
| `desktop-app/src/renderer/loading.html` | Boot screen shown immediately while the backend starts. |
| `desktop-app/test/doctor.test.mjs` | Tests the Debian-version check in `doctor.mjs`. |
| `desktop-app/test/ipc-handlers.test.js` | Checks that every `ipcMain.handle()` handler takes `event` as its first parameter. |
| `desktop-app/test/run-all.mjs` | Runs every desktop test file and fails if any of them fail. |

#### `dist/` — compiled backend output

`dist/` is the JavaScript that `scripts/build-backend.mjs` / `tsc -p tsconfig.backend.json` emits. Every file is the compiled version of the source file at the same path without the `dist/` prefix. Don't edit these by hand: change the source and rebuild. `dist/` is listed in `.gitignore`, but these 163 files are still tracked.

<details>
<summary>All 163 files in <code>dist/</code></summary>

| File | Compiled from |
|---|---|
| `dist/extension-builder/builder.js` | `extension-builder/builder.js` |
| `dist/extension_system/index.js` | `extension_system/index.ts` |
| `dist/extension_system/manager.js` | `extension_system/manager.ts` |
| `dist/extension_system/security.js` | `extension_system/security.ts` |
| `dist/extension_system/semver.js` | `extension_system/semver.ts` |
| `dist/extension_system/store.js` | `extension_system/store.ts` |
| `dist/extension_system/types.js` | `extension_system/types.ts` |
| `dist/interface/app-launcher.js` | `interface/app-launcher.js` |
| `dist/interface/capabilities.js` | `interface/capabilities.js` |
| `dist/interface/cli.js` | `interface/cli.ts` |
| `dist/interface/encryption.js` | `interface/encryption.js` |
| `dist/interface/index.js` | `interface/index.js` |
| `dist/interface/main.js` | `interface/main.ts` |
| `dist/interface/multi-desktop.js` | `interface/multi-desktop.ts` |
| `dist/interface/persistent-shell.js` | `interface/persistent-shell.js` |
| `dist/interface/runner.js` | `interface/runner.ts` |
| `dist/interface/system-access.js` | `interface/system-access.js` |
| `dist/interface/types.js` | `interface/types.js` |
| `dist/interface/web-server.js` | `interface/web-server.ts` |
| `dist/models && skills/core/access-manager.js` | `models && skills/core/access-manager.ts` |
| `dist/models && skills/core/access-settings.js` | `models && skills/core/access-settings.ts` |
| `dist/models && skills/core/agent-capabilities.js` | `models && skills/core/agent-capabilities.ts` |
| `dist/models && skills/core/agent-loop.js` | `models && skills/core/agent-loop.ts` |
| `dist/models && skills/core/agent-skill.js` | `models && skills/core/agent-skill.ts` |
| `dist/models && skills/core/agent-workspace.js` | `models && skills/core/agent-workspace.ts` |
| `dist/models && skills/core/alignment-veto.js` | `models && skills/core/alignment-veto.ts` |
| `dist/models && skills/core/architecture-mapper.js` | `models && skills/core/architecture-mapper.ts` |
| `dist/models && skills/core/atomic-write.js` | `models && skills/core/atomic-write.ts` |
| `dist/models && skills/core/auto-update.js` | `models && skills/core/auto-update.ts` |
| `dist/models && skills/core/autonomous-learner.js` | `models && skills/core/autonomous-learner.ts` |
| `dist/models && skills/core/chat-attachments.js` | `models && skills/core/chat-attachments.ts` |
| `dist/models && skills/core/chat-group.js` | `models && skills/core/chat-group.ts` |
| `dist/models && skills/core/chat-history-store.js` | `models && skills/core/chat-history-store.ts` |
| `dist/models && skills/core/chat-organizer.js` | `models && skills/core/chat-organizer.ts` |
| `dist/models && skills/core/code-iteration.js` | `models && skills/core/code-iteration.ts` |
| `dist/models && skills/core/code-to-net.js` | `models && skills/core/code-to-net.ts` |
| `dist/models && skills/core/complex.js` | `models && skills/core/complex.ts` |
| `dist/models && skills/core/context-compressor.js` | `models && skills/core/context-compressor.ts` |
| `dist/models && skills/core/continuous-learning.js` | `models && skills/core/continuous-learning.ts` |
| `dist/models && skills/core/critic.js` | `models && skills/core/critic.ts` |
| `dist/models && skills/core/desktop-control.js` | `models && skills/core/desktop-control.ts` |
| `dist/models && skills/core/discovery-engine.js` | `models && skills/core/discovery-engine.ts` |
| `dist/models && skills/core/domain-skills.js` | `models && skills/core/domain-skills.ts` |
| `dist/models && skills/core/doorway-lock.js` | `models && skills/core/doorway-lock.ts` |
| `dist/models && skills/core/dual.js` | `models && skills/core/dual.ts` |
| `dist/models && skills/core/elastic-core.js` | `models && skills/core/elastic-core.ts` |
| `dist/models && skills/core/empathy.js` | `models && skills/core/empathy.ts` |
| `dist/models && skills/core/equation.js` | `models && skills/core/equation.ts` |
| `dist/models && skills/core/expert.js` | `models && skills/core/expert.js` |
| `dist/models && skills/core/github-link.js` | `models && skills/core/github-link.ts` |
| `dist/models && skills/core/hive-mind.js` | `models && skills/core/hive-mind.ts` |
| `dist/models && skills/core/index.js` | `models && skills/core/index.ts` |
| `dist/models && skills/core/intent-router.js` | `models && skills/core/intent-router.ts` |
| `dist/models && skills/core/knowledge-graph.js` | `models && skills/core/knowledge-graph.ts` |
| `dist/models && skills/core/knowledge-transfer.js` | `models && skills/core/knowledge-transfer.ts` |
| `dist/models && skills/core/long-term-memory.js` | `models && skills/core/long-term-memory.ts` |
| `dist/models && skills/core/math-engine.js` | `models && skills/core/math-engine.ts` |
| `dist/models && skills/core/mistake-tracker.js` | `models && skills/core/mistake-tracker.ts` |
| `dist/models && skills/core/mod-apply.js` | `models && skills/core/mod-apply.ts` |
| `dist/models && skills/core/net-search.js` | `models && skills/core/net-search.ts` |
| `dist/models && skills/core/net-skill-graft.js` | `models && skills/core/net-skill-graft.ts` |
| `dist/models && skills/core/net-skill-store.js` | `models && skills/core/net-skill-store.ts` |
| `dist/models && skills/core/neuro-lang.js` | `models && skills/core/neuro-lang.ts` |
| `dist/models && skills/core/onebrain.js` | `models && skills/core/onebrain.ts` |
| `dist/models && skills/core/performance-monitor.js` | `models && skills/core/performance-monitor.ts` |
| `dist/models && skills/core/pipeline.js` | `models && skills/core/pipeline.ts` |
| `dist/models && skills/core/plan-tracker.js` | `models && skills/core/plan-tracker.ts` |
| `dist/models && skills/core/plugin-library.js` | `models && skills/core/plugin-library.ts` |
| `dist/models && skills/core/prediction-engine.js` | `models && skills/core/prediction-engine.ts` |
| `dist/models && skills/core/prompt-library.js` | `models && skills/core/prompt-library.ts` |
| `dist/models && skills/core/prompting-skill-store.js` | `models && skills/core/prompting-skill-store.ts` |
| `dist/models && skills/core/prompting-skill.js` | `models && skills/core/prompting-skill.ts` |
| `dist/models && skills/core/prompting-skills.js` | `models && skills/core/prompting-skills.ts` |
| `dist/models && skills/core/quantization-config.js` | `models && skills/core/quantization-config.ts` |
| `dist/models && skills/core/quantization-hardware.js` | `models && skills/core/quantization-hardware.ts` |
| `dist/models && skills/core/quantization-scheduler.js` | `models && skills/core/quantization-scheduler.ts` |
| `dist/models && skills/core/quantizer.js` | `models && skills/core/quantizer.ts` |
| `dist/models && skills/core/reasoning-engine.js` | `models && skills/core/reasoning-engine.ts` |
| `dist/models && skills/core/remote-access.js` | `models && skills/core/remote-access.ts` |
| `dist/models && skills/core/requirement-planner.js` | `models && skills/core/requirement-planner.ts` |
| `dist/models && skills/core/rlm.js` | `models && skills/core/rlm.ts` |
| `dist/models && skills/core/self-healer.js` | `models && skills/core/self-healer.ts` |
| `dist/models && skills/core/self-improvement.js` | `models && skills/core/self-improvement.ts` |
| `dist/models && skills/core/self-model.js` | `models && skills/core/self-model.ts` |
| `dist/models && skills/core/self-monitor.js` | `models && skills/core/self-monitor.ts` |
| `dist/models && skills/core/shared-chat-store.js` | `models && skills/core/shared-chat-store.ts` |
| `dist/models && skills/core/skill-freeze.js` | `models && skills/core/skill-freeze.ts` |
| `dist/models && skills/core/skill-library.js` | `models && skills/core/skill-library.ts` |
| `dist/models && skills/core/skill-upload-store.js` | `models && skills/core/skill-upload-store.ts` |
| `dist/models && skills/core/store-autonomy.js` | `models && skills/core/store-autonomy.ts` |
| `dist/models && skills/core/store-fetch.js` | `models && skills/core/store-fetch.ts` |
| `dist/models && skills/core/store-install.js` | `models && skills/core/store-install.ts` |
| `dist/models && skills/core/store-sync.js` | `models && skills/core/store-sync.ts` |
| `dist/models && skills/core/store.js` | `models && skills/core/store.ts` |
| `dist/models && skills/core/thorns.js` | `models && skills/core/thorns.js` |
| `dist/models && skills/core/unified-brain.js` | `models && skills/core/unified-brain.ts` |
| `dist/models && skills/core/value-range.js` | `models && skills/core/value-range.ts` |
| `dist/models && skills/core/wiki-remote.js` | `models && skills/core/wiki-remote.ts` |
| `dist/models && skills/core/wiki-store.js` | `models && skills/core/wiki-store.ts` |
| `dist/models && skills/core/working-memory.js` | `models && skills/core/working-memory.ts` |
| `dist/models && skills/core/world-model.js` | `models && skills/core/world-model.ts` |
| `dist/models && skills/core/zip-halt.js` | `models && skills/core/zip-halt.ts` |
| `dist/models && skills/core/zip-io-loop.js` | `models && skills/core/zip-io-loop.ts` |
| `dist/models && skills/core/zip-io.js` | `models && skills/core/zip-io.ts` |
| `dist/models && skills/hyperdimensional.js` | `models && skills/hyperdimensional.js` |
| `dist/models && skills/index.js` | `models && skills/index.js` |
| `dist/models && skills/llm.js` | `models && skills/llm.js` |
| `dist/models && skills/model-manager.js` | `models && skills/model-manager.js` |
| `dist/models && skills/neuron.js` | `models && skills/neuron.js` |
| `dist/models && skills/plugin-manager.js` | `models && skills/plugin-manager.js` |
| `dist/models && skills/programming-skills.js` | `models && skills/programming-skills.js` |
| `dist/models && skills/rlm.js` | `models && skills/rlm.js` |
| `dist/models && skills/simulation.js` | `models && skills/simulation.js` |
| `dist/models && skills/skills-manager.js` | `models && skills/skills-manager.js` |
| `dist/models && skills/tokenizer.js` | `models && skills/tokenizer.js` |
| `dist/models && skills/trainer.js` | `models && skills/trainer.ts` |
| `dist/plugin_manager/capability-router.js` | `plugin_manager/capability-router.ts` |
| `dist/plugin_manager/index.js` | `plugin_manager/index.ts` |
| `dist/plugin_manager/loader.js` | `plugin_manager/loader.ts` |
| `dist/plugin_manager/registry-data.js` | `plugin_manager/registry-data.ts` |
| `dist/plugin_manager/registry.js` | `plugin_manager/registry.ts` |
| `dist/plugin_manager/sdk.js` | `plugin_manager/sdk.ts` |
| `dist/plugin_manager/types.js` | `plugin_manager/types.ts` |
| `dist/plugins/account-info.js` | `plugins/account-info.ts` |
| `dist/plugins/app-diagnostics.js` | `plugins/app-diagnostics.ts` |
| `dist/plugins/browser.js` | `plugins/browser.ts` |
| `dist/plugins/calendar.js` | `plugins/calendar.ts` |
| `dist/plugins/call-history.js` | `plugins/call-history.ts` |
| `dist/plugins/camera.js` | `plugins/camera.ts` |
| `dist/plugins/computer-access.js` | `plugins/computer-access.ts` |
| `dist/plugins/contacts.js` | `plugins/contacts.ts` |
| `dist/plugins/email.js` | `plugins/email.ts` |
| `dist/plugins/extensions/coding.js` | `plugins/extensions/coding.ts` |
| `dist/plugins/extensions/index.js` | `plugins/extensions/index.ts` |
| `dist/plugins/file-system.js` | `plugins/file-system.ts` |
| `dist/plugins/github-publish.js` | `plugins/github-publish.ts` |
| `dist/plugins/hive.js` | `plugins/hive.ts` |
| `dist/plugins/index.js` | `plugins/index.ts` |
| `dist/plugins/location.js` | `plugins/location.ts` |
| `dist/plugins/messaging.js` | `plugins/messaging.ts` |
| `dist/plugins/microphone.js` | `plugins/microphone.ts` |
| `dist/plugins/multi-input.js` | `plugins/multi-input.ts` |
| `dist/plugins/notifications.js` | `plugins/notifications.ts` |
| `dist/plugins/other-devices.js` | `plugins/other-devices.ts` |
| `dist/plugins/passkeys.js` | `plugins/passkeys.ts` |
| `dist/plugins/phone-calls.js` | `plugins/phone-calls.ts` |
| `dist/plugins/radios.js` | `plugins/radios.ts` |
| `dist/plugins/research.js` | `plugins/research.ts` |
| `dist/plugins/robotics.js` | `plugins/robotics.ts` |
| `dist/plugins/screenshots.js` | `plugins/screenshots.ts` |
| `dist/plugins/self_replicate.js` | `plugins/self_replicate.ts` |
| `dist/plugins/store.js` | `plugins/store.ts` |
| `dist/plugins/tasks.js` | `plugins/tasks.ts` |
| `dist/plugins/terminal.js` | `plugins/terminal.ts` |
| `dist/plugins/tools.js` | `plugins/tools.ts` |
| `dist/plugins/voice-activation.js` | `plugins/voice-activation.ts` |
| `dist/plugins/wiki.js` | `plugins/wiki.ts` |
| `dist/src/index.js` | `src/index.ts` |
| `dist/src/lib/conversation-learning-trigger.js` | `src/lib/conversation-learning-trigger.ts` |
| `dist/src/lib/conversation-log.js` | `src/lib/conversation-log.ts` |
| `dist/src/lib/error-log.js` | `src/lib/error-log.ts` |
| `dist/src/lib/skill-mesh-metrics.js` | `src/lib/skill-mesh-metrics.ts` |
| `dist/src/server/bot-service.js` | `src/server/bot-service.ts` |

</details>

#### `docs/`

| File | What it does |
|---|---|
| `docs/README.md` | Index of the documentation folder. Some subfolders it mentions (`api/`, `deployment/`, `self-improvement/`) don't exist. |
| `docs/AI_NEURAL_NETWORK_BASICS.md` | Plain-language primer on neural networks, with each idea mapped to the file that implements it. |
| `docs/ARCHITECTURE.md` | Main NeuroClaw / NeuroLang architecture document (≈1,700 lines). |
| `docs/ASI_REQUIREMENTS.md` | List of the capabilities an ASI would need. |
| `docs/CLAUDE.md` | Git workflow policy: `main` only, one branch per PR, no direct pushes. |
| `docs/CODE_TO_NET_SPEC.md` | Spec for the Code-to-Net compiler, which turns code into an equivalent neural net. |
| `docs/COMPLETION_SUMMARY.md` | Phase-1 completion summary (historical status report). |
| `docs/CONVERSATION_TRAINING_LOG.md` | Log of a real train-by-conversation session: what was tested, what broke, and what was fixed. |
| `docs/DEPLOYMENT.md` | Deployment guide, including GPU (RTX 5070) training and multi-desktop setup. |
| `docs/DESKTOP_LAUNCHER_IMPLEMENTATION.md` | How the `/desktop` app-launcher UI and backend were built. |
| `docs/ENDURANCE_TRAINING.md` | Option reference for `asi_core/endurance_training.py`. |
| `docs/EXTENSION_BUILDER_SPEC.md` | Spec for the Extension Builder: file format, packaging, debugging, search, and testing. |
| `docs/EXTENSION_SYSTEM.md` | Design of `extension_system/`: lifecycle, versioning, dependencies, permissions, and storage. |
| `docs/FOREGROUND_MOE_SPEC.md` | Spec for extending foreground Mixture-of-Experts routing. |
| `docs/HYPERDIMENSIONAL_THINKING.md` | Full spec of the hyperdimensional thinking layer (math, prediction, memory, reasoning). |
| `docs/IMPLEMENTATION_STATUS.md` | Per-component implementation status report. |
| `docs/INSTALL.md` | Installation guide (one-click `scripts/install.sh` and manual steps). |
| `docs/NET_SEARCH_SPEC.md` | Spec for Net Search, which searches neural definitions and trains a network that performs the result. |
| `docs/NEURAL_MESH_DESIGN.md` | Full design of the all-to-all mesh: math, scaling, memory layout, parallelism, and testing. |
| `docs/PERFORMANCE_OPTIMIZATION_PLAN.md` | Benchmark numbers before and after optimizations, and the optimizations applied. |
| `docs/PORT_SYSTEM.md` | Design for the Port System, a many-stream I/O layer between the world and the neural core. |
| `docs/QUICKSTART.md` | One-minute install-and-run guide. |
| `docs/SECURITY.md` | Security policy and how to report vulnerabilities. |
| `docs/SELF_IMPROVEMENT_IMPLEMENTATION_PLAN.md` | Maps a 306-step self-improvement framework onto the codebase. |
| `docs/SELF_IMPROVEMENT_PROGRESS.md` | Progress tracker for that 306-step plan. |
| `docs/SHARED_WIKI_SYSTEM.md` | Design for an auto-maintained, versioned, cross-linked shared wiki. |
| `docs/SKILL_ACQUISITION_LOOP.md` | End-to-end loop an agent follows to learn a new skill, from research to a trained, quantized skill. |
| `docs/SYSTEM_ARCHITECTURE.md` | Shorter system-architecture overview (OneBrain, skills, alignment). |
| `docs/TESTING_GUIDE.md` | How to test each component (unit, integration, safety, performance). |
| `docs/VALE_SYSTEM.md` | Full spec for the zero-sum vale system that `asi_core/vale_system.py` implements. |
| `docs/agi test.py` | 11-line scratch script that runs the external `arc_agi` ARC-AGI game environment. It needs packages that aren't installed. |
| `docs/architecture/BACKGROUND_QUANTIZATION.md` | Implementation-level design of the background quantization system. |
| `docs/asi_architecture.md` | ASI architecture specification (v1). |
| `docs/asi_architecture_v2.md` | ASI architecture specification (v2, incremental build-out). |
| `docs/skill_agent_architecture.py` | Python prototype showing skills as dynamic plugins in an agent. |

#### `extension-builder/`

| File | What it does |
|---|---|
| `extension-builder/.gitignore` | Ignores regenerable build output (`extensions/*.ext.json`, weight files, `peers.txt`, logs). |
| `extension-builder/builder.js` | `ExtensionBuilder` engine: neuron graph editing, Code-to-Net import, Net Search, training, and quantized export. It runs in both Node and the browser. |
| `extension-builder/builder.d.ts` | TypeScript type declarations for `builder.js`. |
| `extension-builder/build-capability-exam-network.mjs` | Trains the network that answers `scripts/capability-exam.mjs` questions, using the hyperdimensional engine. |
| `extension-builder/build-debian-iso-network.mjs` | Code-to-Net demo that runs a Debian installer ISO's bytes forward into neurons and back again, with a byte-for-byte check. |
| `extension-builder/build-debian-network.mjs` | Code-to-Net forward/reverse proof over a sample of this repo's own config and build files. |
| `extension-builder/build-final-network.mjs` | Combines Main Network and Coding Skills Network into the final network using the merged weights. |
| `extension-builder/build-main-network.mjs` | Builds "Main Network" from Code-to-Net of the project source plus derived pronunciations. |
| `extension-builder/build-physics-chemistry-network.mjs` | Trains a physics/chemistry concept network (quantum, atoms, moles, relativity). |
| `extension-builder/build-self-knowledge-network.mjs` | Trains a network on the project's own wiki pages and recent code. |
| `extension-builder/grapheme-to-phoneme.mjs` | Rule-based English spelling-to-pronunciation (ARPAbet) converter. |
| `extension-builder/merge-networks.mjs` | Averages the weights of two trained networks ("model soup") and then fine-tunes the result. |
| `extension-builder/pytorch_trainer.py` | Long-lived PyTorch worker that trains weights sent as JSON over stdin/stdout. |
| `extension-builder/train-coding-skills.mjs` | Training for coding skills, where the targets are real interpreter output from running JS, Python, Shell, and NeuroLang. |
| `extension-builder/checkpoints/checkpoint_latest.json` | Saved network checkpoint (neurons, values, and quantization metadata). |
| `extension-builder/checkpoints/checkpoint_latest.npz` | NumPy array archive that goes with the JSON checkpoint. |
| `extension-builder/coding_skill_20260612_210257.ext.json` | Exported "coding_skill" MoE extension (8→8 dims, 4 experts). |
| `extension-builder/extensions/demo_extension.json` | Demo extension record produced by a system test. |
| `extension-builder/extensions/integ_test.json` | Leftover extension record from an integration test. |
| `extension-builder/extensions/integration_test.json` | Leftover extension record from an integration test. |
| `extension-builder/extensions/it.json` | Leftover extension record from a test. |
| `extension-builder/extensions/test_ext.json` | Leftover extension record from a test. |
| `extension-builder/extensions/verify2.json` | Leftover self-extension verification record. |
| `extension-builder/extensions/verify_ext.json` | Leftover self-extension verification record. |
| `extension-builder/installed/skills/secret.txt` | Fixture file for path-traversal tests. Its only content is "not yours". |
| `extension-builder/neuroclaw.net.json` | Saved NeuroLang network: neurons and edges. |
| `extension-builder/neuroclaw.net.q8.json` | 8-bit quantized binary form of `neuroclaw.net.json`. Despite the `.json` extension it isn't JSON. |
| `extension-builder/neuron_live_state.json` | Snapshot of live neuron values from the Python NeuroLang runtime. |
| `extension-builder/self-improvement-scoreboard.json` | Best hyperparameters and score history for each self-improvement target. |
| `extension-builder/unified_model.net.json` | Empty placeholder unified-model network. |

#### `extension_system/` — TypeScript extension system

| File | What it does |
|---|---|
| `extension_system/index.ts` | Barrel export for the module. |
| `extension_system/manager.ts` | `ExtensionManager`: install, activate, update, roll back, and remove extensions, with dependency resolution. |
| `extension_system/security.ts` | `PermissionGuard`: local, auditable permission grants and revocations for extensions. |
| `extension_system/semver.ts` | Minimal semantic versioning (`^`, `~`, `>=`, `*`) with no external package. |
| `extension_system/store.ts` | Content-addressable on-disk storage for extension payloads, with optional gzip and quantization. |
| `extension_system/types.ts` | Core types: extension kinds, states, manifests, and dependencies. |

#### `generated/` — AI-authored output

Files the Skill Maker and Plugin Maker extensions wrote on their own. The long file names are the prompt each item was generated from.

| File | What it does |
|---|---|
| `generated/plugins/cats-are-mammals.ts` | Auto-generated stub plugin for the fact "Cats are mammals". |
| `generated/plugins/cats-are-mammals.manifest.json` | Manifest (id, version, permissions, entrypoint) for that plugin. |
| `generated/plugins/paris-is-in-france.ts` | Auto-generated stub plugin for "Paris is in France". |
| `generated/plugins/paris-is-in-france.manifest.json` | Manifest for that plugin. |
| `generated/plugins/to-convert-a-heic-photo-…-as-png.ts` | Auto-generated stub plugin for a HEIC → PNG conversion procedure. |
| `generated/plugins/to-convert-a-heic-photo-…-as-png.manifest.json` | Manifest for that plugin. |
| `generated/plugins-wiki/cats-are-mammals.md` | Wiki page for the cats-are-mammals plugin. |
| `generated/plugins-wiki/paris-is-in-france.md` | Wiki page for the paris-is-in-france plugin. |
| `generated/plugins-wiki/to-convert-a-heic-photo-…-as-png.md` | Wiki page for the HEIC → PNG plugin. |
| `generated/skills/solve-what-does-the-boot-load-probe-token-…-decode-to.neuri` | NeuroLang skill (perceive → analyze → respond neurons) generated from a boot-load probe test prompt. |
| `generated/skills/to-convert-a-heic-photo-…-as-png.neuri` | NeuroLang skill for the HEIC → PNG procedure. |
| `generated/skills-wiki/solve-what-does-the-boot-load-probe-token-…-decode-to.md` | Wiki page for the boot-load probe skill. |
| `generated/skills-wiki/to-convert-a-heic-photo-…-as-png.md` | Wiki page for the HEIC → PNG skill. |

In the table, `…` shortens the full name `to-convert-a-heic-photo-first-read-the-container-header-then-extract-the-hevc-payload-next-decode-each-tile-finally-write-the-rgb-rows-out-as-png` and `solve-what-does-the-boot-load-probe-token-autoload_probe_1787519900191_q2a2zyugwpk-decode-to`.

#### `interface/` — backend entry point, API server, OS access

Hand-written `.js` + `.d.ts` pairs are compiled or authored JavaScript with matching type declarations. `.ts` files are compiled into `dist/interface/`.

| File | What it does |
|---|---|
| `interface/main.ts` | Backend entry point (`node dist/interface/main.js [cli\|web <port>]`). It wires up the LLM, pipeline, plugins, and system access, then starts the CLI or web server. |
| `interface/web-server.ts` | The HTTP API server (≈4,900 lines) behind every `/api/*` route: chat, store, wiki, builder, self-improvement, access, remote login, and more. |
| `interface/cli.ts` | Interactive terminal interface to the agent. |
| `interface/runner.ts` | `NeuroclawRunner`: runs one chat turn through the pipeline with encryption, system access, and plugins. |
| `interface/multi-desktop.ts` | `MultiDesktopManager`: a separate GNOME workspace plus virtual mouse and keyboard for the AI, with a simulated fallback. |
| `interface/app-launcher.js` | `AppLauncher`: launches, tracks, and stops desktop applications. |
| `interface/app-launcher.d.ts` | Types for `app-launcher.js`. |
| `interface/app-launcher.html` | Standalone app-launcher web page. |
| `interface/capabilities.js` | `CapabilitiesRegistry`: detects what the host machine can do (apps, browser, mic, camera, …). |
| `interface/capabilities.d.ts` | Types for `capabilities.js`. |
| `interface/encryption.js` | `EncryptionManager`: AES-256-GCM encryption and scrypt password hashing. |
| `interface/encryption.d.ts` | Types for `encryption.js`. |
| `interface/index.js` | Barrel export of the interface classes. |
| `interface/index.d.ts` | Types for `index.js`. |
| `interface/index.html` | Fallback terminal-style web UI, served at the backend's own `/`. The real app is the React frontend. |
| `interface/persistent-shell.js` | `PersistentShell`: long-lived bash/cmd sessions the agent can send commands to. |
| `interface/persistent-shell.d.ts` | Types for `persistent-shell.js`. |
| `interface/system-access.js` | `SystemAccess`: terminal, file, and multi-desktop access switches for each OS. |
| `interface/system-access.d.ts` | Types for `system-access.js`. |
| `interface/types.js` | Empty runtime module that pairs with `types.d.ts`. |
| `interface/types.d.ts` | Shared interface types (neuron state, model, quantization, encryption config). |
| `interface/server.py` | Python browser backend on port 7860 that forwards chat to the TypeScript mesh backend. |
| `interface/seed_skills.py` | Seeds a starter set of trigger → response skills for the dashboard. |

#### `live-usb/` — bootable USB image

| File | What it does |
|---|---|
| `live-usb/README.md` | How to build and use the NeuroClaw live USB, including the "install to disk" option with LUKS encryption. |
| `live-usb/build.sh` | Builds the `.iso` with Debian live-build. It must run as root on a real Debian/Ubuntu machine. |
| `live-usb/config/hooks/live/0100-neuroclaw-setup.hook.chroot` | Build-time hook that runs `npm install` and builds the backend inside the image. |
| `live-usb/config/includes.chroot/etc/skel/.bash_profile` | Auto-runs `startx` on tty1, so the kiosk starts at login. |
| `live-usb/config/includes.chroot/etc/skel/.xinitrc` | Starts an `openbox-session`. |
| `live-usb/config/includes.chroot/etc/skel/.config/openbox/autostart` | Waits for port 3000, then opens Chromium fullscreen on the app. |
| `live-usb/config/includes.chroot/etc/systemd/system/neuroclaw-dev.service` | systemd unit that runs `npm run dev` from `/opt/neuroclaw`. |
| `live-usb/config/includes.chroot/etc/systemd/system/multi-user.target.wants/neuroclaw-dev.service` | Symlink that enables that unit at boot. |
| `live-usb/config/package-lists/neuroclaw.list.chroot` | Debian packages baked into the image (Xorg, openbox, Chromium, Node, installer, …). |

#### `model && skills manager/` — Python NeuroLang stack

Several files here still describe or import the retired `tinygpt/` package, which is no longer in the repo.

| File | What it does |
|---|---|
| `model && skills manager/AGENTS.md` | Agent instructions for the old `tinygpt/` Python training stack. The commands it lists refer to files that were removed. |
| `model && skills manager/CLAUDE.md` | One-line pointer to `AGENTS.md`. |
| `model && skills manager/README.md` | README for the former TinyGPT/mesh Python model stack (mostly historical). |
| `model && skills manager/main.py` | CLI entry point: `build` a NeuroLang program, `code2net`, or `netsearch`. |
| `model && skills manager/neurolang.py` | The PyTorch-backed NeuroLang interpreter: elastic neurons, zero-sum value, skills, Code-to-Net, and Net Search. |
| `model && skills manager/example_experts.nl` | Sample NeuroLang program that declares code-analysis, search, and skill experts. |
| `model && skills manager/test_value_system.py` | Tests for the zero-sum value-system invariants in `neurolang.py`. |
| `model && skills manager/unifid_brain.py` | A misspelled, ≈3,500-line concatenation of several `asi_core` modules. It uses relative imports, so it doesn't run on its own. `asi_core/unified_brain.py` is the maintained version. |
| `model && skills manager/requirements.txt` | PyTorch and NumPy requirements for this Python track only. The main mesh doesn't need them. |
| `model && skills manager/interface/server.py` | Browser chat server for a TinyGPT checkpoint. It imports `tinygpt`, which no longer exists. |
| `model && skills manager/data/contracts.json` | Fixed "when X, reply Y" response contracts from the TinyGPT era. |
| `model && skills manager/data/pretrain/sample.md` | Tiny sample pretraining corpus. |
| `model && skills manager/data/sft/chat.jsonl` | Tiny sample fine-tuning chat dataset. |

#### `models && skills/` — the TypeScript AI engine

The top-level `.js` + `.d.ts` pairs are hand-maintained JavaScript modules with type declarations. `core/` holds the engine itself.

| File | What it does |
|---|---|
| `models && skills/index.js` | `ModelFileLoader`: loads and validates model JSON files from disk. |
| `models && skills/index.d.ts` | Types for `index.js`. |
| `models && skills/index.jsonl` | Log of self-authored memory extensions (one JSON record per `self_ext_*` save). |
| `models && skills/llm.js` | `NeuroclawLLM`: the chat language model built on the OneBrain mesh (embedding, experts, think steps). |
| `models && skills/llm.d.ts` | Types for `llm.js`. |
| `models && skills/hyperdimensional.js` | Older `HyperDimensionalNetwork` wrapper with per-neuron dimensional vectors and a context window. |
| `models && skills/hyperdimensional.d.ts` | Types for `hyperdimensional.js`. |
| `models && skills/model-manager.js` | `ModelManager`: registers, loads, quantizes, and auto-saves models. |
| `models && skills/model-manager.d.ts` | Types for `model-manager.js`. |
| `models && skills/neuron.js` | Basic `Neuron` class (value, learning rate, states, connections). |
| `models && skills/neuron.d.ts` | Types for `neuron.js`. |
| `models && skills/plugin-manager.js` | Maps short action verbs to real plugin methods and dispatches them. |
| `models && skills/plugin-manager.d.ts` | Types for `plugin-manager.js`. |
| `models && skills/programming-skills.js` | Catalog of 500+ programming languages (id, extensions, keywords) behind the Coding skill. |
| `models && skills/programming-skills.d.ts` | Types for `programming-skills.js`. |
| `models && skills/rlm.js` | `RLMAgent`: a thin wrapper over the core RLM trainer for choosing actions. |
| `models && skills/rlm.d.ts` | Types for `rlm.js`. |
| `models && skills/simulation.js` | Synonym and WH-question expansion used for intent simulation. |
| `models && skills/simulation.d.ts` | Types for `simulation.js`. |
| `models && skills/skills-manager.js` | `SkillsManager`: activates skills through MoE routing and tracks usage. |
| `models && skills/skills-manager.d.ts` | Types for `skills-manager.js`. |
| `models && skills/tokenizer.js` | Character-level tokenizer with special tokens. |
| `models && skills/tokenizer.d.ts` | Types for `tokenizer.js`. |
| `models && skills/trainer.ts` | N-gram / hidden-layer text trainer that yields cooperatively during long training loops. |

##### `models && skills/self_ext_*/` — self-authored memory snapshots

Each `self_ext_N` folder is a memory extension the agent saved at generation N. `meta.json` holds its name and size, `model.json` holds the full-precision neuron graph, and `model.q4.json` holds the 4-bit quantized copy.

| File | What it does |
|---|---|
| `models && skills/self_ext_5/meta.json` | Metadata for generation-5 memory extension “Memory: test” (16 neurons, 60 connections). |
| `models && skills/self_ext_5/model.json` | Full-precision neuron graph for generation 5. |
| `models && skills/self_ext_5/model.q4.json` | 4-bit quantized copy of the generation-5 graph. |
| `models && skills/self_ext_10/meta.json` | Metadata for generation-10 memory extension “Memory: test” (16 neurons, 60 connections). |
| `models && skills/self_ext_10/model.json` | Full-precision neuron graph for generation 10. |
| `models && skills/self_ext_10/model.q4.json` | 4-bit quantized copy of the generation-10 graph. |
| `models && skills/self_ext_15/meta.json` | Metadata for generation-15 memory extension “Memory: The pattern shows” (20 neurons, 100 connections). |
| `models && skills/self_ext_15/model.json` | Full-precision neuron graph for generation 15. |
| `models && skills/self_ext_15/model.q4.json` | 4-bit quantized copy of the generation-15 graph. |
| `models && skills/self_ext_20/meta.json` | Metadata for generation-20 memory extension “Memory: Thinking about this,” (20 neurons, 100 connections). |
| `models && skills/self_ext_20/model.json` | Full-precision neuron graph for generation 20. |
| `models && skills/self_ext_20/model.q4.json` | 4-bit quantized copy of the generation-20 graph. |
| `models && skills/self_ext_25/meta.json` | Metadata for generation-25 memory extension “Memory: The system is discovering” (20 neurons, 100 connections). |
| `models && skills/self_ext_25/model.json` | Full-precision neuron graph for generation 25. |
| `models && skills/self_ext_25/model.q4.json` | 4-bit quantized copy of the generation-25 graph. |
| `models && skills/self_ext_30/meta.json` | Metadata for generation-30 memory extension “Memory: I am learning that” (20 neurons, 100 connections). |
| `models && skills/self_ext_30/model.json` | Full-precision neuron graph for generation 30. |
| `models && skills/self_ext_30/model.q4.json` | 4-bit quantized copy of the generation-30 graph. |
| `models && skills/self_ext_35/meta.json` | Metadata for generation-35 memory extension “Memory: The system is discovering” (20 neurons, 100 connections). |
| `models && skills/self_ext_35/model.json` | Full-precision neuron graph for generation 35. |
| `models && skills/self_ext_35/model.q4.json` | 4-bit quantized copy of the generation-35 graph. |
| `models && skills/self_ext_40/meta.json` | Metadata for generation-40 memory extension “Memory: The connection between” (20 neurons, 100 connections). |
| `models && skills/self_ext_40/model.json` | Full-precision neuron graph for generation 40. |
| `models && skills/self_ext_40/model.q4.json` | 4-bit quantized copy of the generation-40 graph. |
| `models && skills/self_ext_45/meta.json` | Metadata for generation-45 memory extension “Memory: I am learning that” (20 neurons, 100 connections). |
| `models && skills/self_ext_45/model.json` | Full-precision neuron graph for generation 45. |
| `models && skills/self_ext_45/model.q4.json` | 4-bit quantized copy of the generation-45 graph. |
| `models && skills/self_ext_50/meta.json` | Metadata for generation-50 memory extension “Memory: I am learning that” (20 neurons, 100 connections). |
| `models && skills/self_ext_50/model.json` | Full-precision neuron graph for generation 50. |
| `models && skills/self_ext_50/model.q4.json` | 4-bit quantized copy of the generation-50 graph. |
| `models && skills/self_ext_55/meta.json` | Metadata for generation-55 memory extension “Memory: The system is discovering” (20 neurons, 100 connections). |
| `models && skills/self_ext_55/model.json` | Full-precision neuron graph for generation 55. |
| `models && skills/self_ext_55/model.q4.json` | 4-bit quantized copy of the generation-55 graph. |
| `models && skills/self_ext_60/meta.json` | Metadata for generation-60 memory extension “Memory: One thing I notice is” (20 neurons, 100 connections). |
| `models && skills/self_ext_60/model.json` | Full-precision neuron graph for generation 60. |
| `models && skills/self_ext_60/model.q4.json` | 4-bit quantized copy of the generation-60 graph. |
| `models && skills/self_ext_65/meta.json` | Metadata for generation-65 memory extension “Memory: I find it interesting that” (20 neurons, 100 connections). |
| `models && skills/self_ext_65/model.json` | Full-precision neuron graph for generation 65. |
| `models && skills/self_ext_65/model.q4.json` | 4-bit quantized copy of the generation-65 graph. |
| `models && skills/self_ext_70/meta.json` | Metadata for generation-70 memory extension “Memory: I observe that” (20 neurons, 100 connections). |
| `models && skills/self_ext_70/model.json` | Full-precision neuron graph for generation 70. |
| `models && skills/self_ext_70/model.q4.json` | 4-bit quantized copy of the generation-70 graph. |

##### `models && skills/core/` — OneBrain and every core subsystem

| File | What it does |
|---|---|
| `models && skills/core/onebrain.ts` | **OneBrain**, the engine in a single file: quantization math, the elastic zero-sum value budget, the all-to-all `NeuronMesh`, the MoE router, the hyperdimensional engine, and complex and dual numbers. |
| `models && skills/core/equation.ts` | "The equation": the single update rule shared by every neuron, the unified brain, and the hyperdimensional term. |
| `models && skills/core/unified-brain.ts` | `UnifiedBrain`: combines the value system, MoE, mesh, and hyperdimensional state into one model. |
| `models && skills/core/pipeline.ts` | `NeuroPipeline`: the timed, stage-by-stage path every input takes through the runtime. |
| `models && skills/core/index.ts` | Barrel export for the core module. |
| `models && skills/core/complex.ts` | Compatibility re-export of the complex-number helpers from `onebrain.ts`. |
| `models && skills/core/dual.ts` | Compatibility re-export of the dual-number (autodiff) helpers from `onebrain.ts`. |
| `models && skills/core/elastic-core.ts` | Compatibility re-export of `onebrain.ts` under its old name. |
| `models && skills/core/quantizer.ts` | Compatibility re-export of `onebrain.ts` (quantizer import path). |
| `models && skills/core/value-range.ts` | Compatibility re-export of `onebrain.ts` (value-range import path). |
| `models && skills/core/expert.js` | `ExpertNetwork`: a two-layer MLP expert, with weights allocated on first use. |
| `models && skills/core/expert.d.ts` | Types for `expert.js`. |
| `models && skills/core/thorns.js` | THORNS engine (Thinking, Hypothesis, Observation, Reasoning, Novelty, Synthesis) for question analysis, plus structural Code-to-Net. |
| `models && skills/core/thorns.d.ts` | Types for `thorns.js`. |
| `models && skills/core/mesh-worker-pool.ts` | `MeshWorkerPool`: multi-core parallel mesh propagation using worker_threads, SharedArrayBuffer, and Atomics. |
| `models && skills/core/mesh-worker-thread.ts` | Worker-thread entry point that computes one shard of mesh rows. |
| `models && skills/core/neuro-lang.ts` | NeuriLang/NeuroLang interpreter and runtime, plus text embedding helpers. |
| `models && skills/core/zip-io.ts` | Infinite Zip I/O loop: a compressed ring buffer for input and output context. |
| `models && skills/core/zip-io-loop.ts` | Zip I/O loop module: circular-buffer extended context and output. |
| `models && skills/core/zip-halt.ts` | Decides when an all-connected network has settled and should stop (the halting rule). |
| `models && skills/core/doorway-lock.ts` | Ensures only one caller drives an engine's `settle()` loop at a time. |
| `models && skills/core/rlm.ts` | RLM (reinforcement learning module): think steps and a replay buffer. |
| `models && skills/core/quantization-config.ts` | Loads and validates `config/quantization.json`. |
| `models && skills/core/quantization-hardware.ts` | Hardware profiling, mixed-precision policy, and memory/power/performance estimates. |
| `models && skills/core/quantization-scheduler.ts` | Runs quantization in the background in small, yielding chunks. |
| `models && skills/core/agent-loop.ts` | The perceive → think → act cycle that calls prompting skills. |
| `models && skills/core/agent-capabilities.ts` | Connects the agent loop to real memory, wiki, store, plugins, and reasoner. |
| `models && skills/core/agent-skill.ts` | Supports Agent Skills (a `SKILL.md` plus the files next to it). |
| `models && skills/core/agent-workspace.ts` | The agent's own terminals and files, kept separate from the user's. |
| `models && skills/core/access-manager.ts` | Access control: what the agent is allowed to do to the computer, deny-by-default. |
| `models && skills/core/access-settings.ts` | Saves access kill switches and grants to disk so they survive restarts. |
| `models && skills/core/desktop-control.ts` | The graphical access layer: windows, input, screenshots, and app launching, all gated by `AccessManager`. |
| `models && skills/core/remote-access.ts` | Remote-access password and login sessions for reaching the instance from another machine. |
| `models && skills/core/alignment-veto.ts` | Deterministic alignment veto gate. It is not a learned objective. |
| `models && skills/core/empathy.ts` | Empathy engine: tracks the user's feelings and intent to keep the agent aligned. |
| `models && skills/core/architecture-mapper.ts` | Maps the system's own components, dependencies, and information flow. |
| `models && skills/core/performance-monitor.ts` | Real-time self-performance monitoring. |
| `models && skills/core/self-monitor.ts` | Compares expected and actual behavior and flags anomalies. |
| `models && skills/core/self-model.ts` | Per-domain model of the system's own competence and confidence. |
| `models && skills/core/self-improvement.ts` | Controlled self-improvement: keeps a change only if it measurably helps, with versioned rollback. |
| `models && skills/core/self-healer.ts` | Detects failed components, reverts, rebuilds, or reinitializes them. |
| `models && skills/core/autonomous-learner.ts` | Decides what new information means, whether it is reliable, and whether it conflicts with what's known before storing it. |
| `models && skills/core/continuous-learning.ts` | Predicts the user's next message through the Zip Loop and reports how surprising the real message was. |
| `models && skills/core/critic.ts` | Separate critic that verifies answers instead of trusting the process that produced them. |
| `models && skills/core/reasoning-engine.ts` | Multi-step recursive reasoning across memory, math, and critic. |
| `models && skills/core/prediction-engine.ts` | Simulates an action's consequences beforehand and compares them with the outcome afterward. |
| `models && skills/core/discovery-engine.ts` | Hypothesis generation and testing, plus creative concept combination. |
| `models && skills/core/knowledge-graph.ts` | Semantic knowledge graph of concepts joined by typed relations. |
| `models && skills/core/knowledge-transfer.ts` | Finds structurally similar problems across domains so methods can be reused. |
| `models && skills/core/world-model.ts` | Entity, causal, and temporal vocabulary layered over the knowledge graph. |
| `models && skills/core/long-term-memory.ts` | Long-term episodic memory with relevance-based retrieval. |
| `models && skills/core/working-memory.ts` | Task-scoped scratch memory. |
| `models && skills/core/context-compressor.ts` | Semantic (not byte-level) compression of context. |
| `models && skills/core/mistake-tracker.ts` | Records failures with a root cause (missing knowledge, bad memory, wrong skill, bad reasoning). |
| `models && skills/core/plan-tracker.ts` | Structured plans: objective, step status, alternatives, goals, and constraints. |
| `models && skills/core/requirement-planner.ts` | Turns a list of requirements into the quickest plan to satisfy them all. |
| `models && skills/core/intent-router.ts` | Capability routing: decides which experts or capabilities handle an input. |
| `models && skills/core/math-engine.ts` | Deterministic math toolkit (safe evaluator, calculus, statistics, linear algebra) for checking reasoning. |
| `models && skills/core/code-iteration.ts` | Write → run in a sandbox → read the error → fix loop for code. |
| `models && skills/core/code-to-net.ts` | Behavioral Code-to-Net: builds a network that reproduces what a piece of code does. |
| `models && skills/core/net-search.ts` | Net Search over neurons, definitions, and connections. |
| `models && skills/core/net-skill-graft.ts` | Grafts a specialized net skill neuron-to-neuron into the main mesh. |
| `models && skills/core/net-skill-store.ts` | Publishes live net skills to the store's "net-skills" catalog. |
| `models && skills/core/skill-freeze.ts` | Freezes the main model while a net skill is trained on top of it. |
| `models && skills/core/skill-library.ts` | Searches and loads the `.neuri` skills the AI wrote for itself. |
| `models && skills/core/plugin-library.ts` | Searches and loads the plugins the AI wrote for itself. |
| `models && skills/core/skill-upload-store.ts` | Uploads a skill's five artifacts (plugin, network, wiki, tests, drill) as one package. |
| `models && skills/core/domain-skills.ts` | Gives each of the eight training domains its own region of neurons in the mesh. |
| `models && skills/core/prompting-skill.ts` | Prompting skill: understands and improves prompts themselves. |
| `models && skills/core/prompting-skills.ts` | Registry of the perception, reasoning, and action prompting skills the loop calls. |
| `models && skills/core/prompting-skill-store.ts` | Publishes, installs, and edits prompting skills. |
| `models && skills/core/prompt-library.ts` | Saved, reusable prompt templates. |
| `models && skills/core/hive-mind.ts` | Hive Mind: shared and private memory, permissions, messaging, and trust between agents. |
| `models && skills/core/chat-group.ts` | Groups of specialized hive agents that collaborate on one task. |
| `models && skills/core/chat-history-store.ts` | Saves chat threads to disk and matches new chats to earlier ones. |
| `models && skills/core/chat-organizer.ts` | Automatically files chat threads into topic folders. |
| `models && skills/core/chat-attachments.ts` | Lets a chat reply hand the browser a real file to download. |
| `models && skills/core/shared-chat-store.ts` | Multi-user named chat rooms, with the bot as one participant. |
| `models && skills/core/store.ts` | The public store: published items go in `store/`, get committed, and get pushed. |
| `models && skills/core/store-sync.ts` | Commits and pushes published items to the `store` branch. |
| `models && skills/core/store-fetch.ts` | Downloads a published payload on demand; only the catalog index travels with the repo. |
| `models && skills/core/store-install.ts` | Installs downloaded store items onto this device. |
| `models && skills/core/store-autonomy.ts` | The agent publishing its own work to the store without being asked. |
| `models && skills/core/mod-apply.ts` | Applies a "mod" item's files directly onto this device's working copy of the repo. |
| `models && skills/core/github-link.ts` | Turns "committed and pushed" into a clickable GitHub URL. |
| `models && skills/core/wiki-store.ts` | Reads and writes wiki pages. It is the one owner of the page format and the naming rules. |
| `models && skills/core/wiki-remote.ts` | Shows wiki pages the bot published from other devices without downloading them. |
| `models && skills/core/auto-update.ts` | Keeps the code and the downloaded store items up to date from the repository. |
| `models && skills/core/atomic-write.ts` | Crash-safe file writes (write to a temp file, then rename). |

#### `plugin_manager/`

| File | What it does |
|---|---|
| `plugin_manager/index.ts` | Barrel export. |
| `plugin_manager/types.ts` | Plugin, skill, manifest, and permission types, shared with `extension_system/`. |
| `plugin_manager/sdk.ts` | `BasePlugin` class and logger that every TS plugin extends. |
| `plugin_manager/registry.ts` | `PluginRegistry`: registers plugins and dispatches a message to the top-ranked plugins. |
| `plugin_manager/registry-data.ts` | Master list of built-in plugin names. |
| `plugin_manager/loader.ts` | Loads a plugin from a folder that contains a `manifest.json`. |
| `plugin_manager/capability-router.ts` | Scores which plugin should handle a message without running any of them. |
| `plugin_manager/__init__.py` | Python package marker. It exports `PluginManager`. |
| `plugin_manager/manager.py` | Python `PluginManager`: discovers `plugins/plugin_*.py`, manages their lifecycle, and exposes their tools. |

#### `plugins/`

TypeScript plugins (`*.ts`) run in the Node backend. Python plugins (`plugin_*.py`) are the Python-side equivalents used by `plugin_manager/manager.py`.

| File | What it does |
|---|---|
| `plugins/index.ts` | Plugin factory (`createPluginInstance`) and the full catalog of plugin extensions. |
| `plugins/SELF_REPLICATION_GUIDE.md` | Guide to the self-replication plugin: cloning the AI with custom prompts and roles. |
| `plugins/__init__.py` | Python plugin auto-discovery and registry. |
| `plugins/plugin_base.py` | Python `Plugin` base class. Each plugin exposes a `tools` dict. |
| `plugins/account-info.ts` | Reports the current OS user account (username, home directory, shell). It refuses to read environment variables whose names look like secrets. |
| `plugins/app-diagnostics.ts` | CPU, memory, uptime, and process diagnostics. |
| `plugins/browser.ts` | Browser history, bookmarks, and page fetching, with SSRF protection. |
| `plugins/calendar.ts` | Local calendar events, stored in the same file the Python calendar plugin uses. |
| `plugins/call-history.ts` | Call-history view over the phone-calls plugin. |
| `plugins/camera.ts` | Webcam capture and streaming. |
| `plugins/computer-access.ts` | Plugin that exposes the GNOME desktop layer and the terminal/file workspace to the agent. |
| `plugins/contacts.ts` | Local contacts. |
| `plugins/email.ts` | Local email read/send, with protection against MIME header injection. |
| `plugins/extensions/index.ts` | Built-in extensions: Image, Video, Game, SelfHeal, SkillMaker, PluginMaker, and UniversalLanguage. The makers write their output to `generated/`. |
| `plugins/extensions/coding.ts` | Coding extension: write, run, verify, and iterate on code. |
| `plugins/file-system.ts` | File read/write/list, plus opening files with the OS default app. |
| `plugins/github-publish.ts` | Publishes content to GitHub through the store, with no sign-in needed from the user. |
| `plugins/hive.ts` | Chat commands to summon Hive Mind teammates or sub-teams. |
| `plugins/location.ts` | Device geolocation. |
| `plugins/messaging.ts` | Local text messaging. |
| `plugins/microphone.ts` | Microphone recording. |
| `plugins/multi-input.ts` | Virtual pointer and keyboard for the AI, so it never takes over the user's input. |
| `plugins/notifications.ts` | Desktop notifications. |
| `plugins/other-devices.ts` | Tracks other connected devices. |
| `plugins/passkeys.ts` | Local passkey (key-pair) storage. |
| `plugins/phone-calls.ts` | Phone call records and actions. |
| `plugins/radios.ts` | Wi-Fi, Bluetooth, cellular, and NFC radio status and control. |
| `plugins/research.ts` | Multi-source research that cross-checks claims and reports what is corroborated. |
| `plugins/robotics.ts` | Robot actuators, sensors, and state. |
| `plugins/screenshots.ts` | Screen capture. |
| `plugins/self_replicate.ts` | Spawns cloned agents with custom prompts and roles. |
| `plugins/store.ts` | Lets the agent publish, edit, and install store items itself. |
| `plugins/tasks.ts` | To-do and task list. |
| `plugins/terminal.ts` | Runs shell commands with a best-effort destructive-command blocklist. The file itself says the blocklist is not a security boundary. |
| `plugins/tools.ts` | Exact local utilities: arithmetic, hashing, encoding, unit conversion, and date math. |
| `plugins/voice-activation.ts` | Wake-word voice commands. |
| `plugins/wiki.ts` | Lets the agent list, read, publish, and delete wiki pages. |
| `plugins/plugin_browser.py` | Python: controls local Chrome through the DevTools Protocol. |
| `plugins/plugin_calendar.py` | Python: JSON-backed calendar. |
| `plugins/plugin_camera.py` | Python: webcam capture through v4l2 or fswebcam. |
| `plugins/plugin_contacts.py` | Python: local vCard/JSON contacts. |
| `plugins/plugin_email.py` | Python: IMAP/SMTP email. |
| `plugins/plugin_filesystem.py` | Python: file read, write, list, search, copy, and move. |
| `plugins/plugin_gnome.py` | Python: a separate GNOME workspace and input isolation for the AI. |
| `plugins/plugin_location.py` | Python: location through GeoClue2. |
| `plugins/plugin_microphone.py` | Python: ALSA/PulseAudio recording. |
| `plugins/plugin_notifications.py` | Python: libnotify/DBus notifications. |
| `plugins/plugin_robotics.py` | Python: robotics control. |
| `plugins/plugin_screenshot.py` | Python: screenshots and screen recording. |
| `plugins/plugin_self_replicate.py` | Python: spawns clone agents. |
| `plugins/plugin_selfheal.py` | Python: watches components and restarts any that fail. |
| `plugins/plugin_terminal.py` | Python: shell commands with the destructive-command blocklist. |
| `plugins/plugin_voice.py` | Python: wake-word listening. |
| `plugins/test_plugin_gnome.py` | Tests `plugin_gnome.py` input isolation and restore. |
| `plugins/test_plugin_selfheal.py` | Tests the `plugin_selfheal.py` watch/check/restart cycle. |
| `plugins/test_plugin_terminal.py` | Tests the `plugin_terminal.py` blocklist. |

#### `public/` — static assets

| File | What it does |
|---|---|
| `public/_redirects` | SPA fallback rule (`/* → /index.html`) for static hosts such as Netlify. |
| `public/favicon.svg` | Browser tab icon (the wavy ring mark). |
| `public/icon.png` | PNG app icon. |
| `public/icon.svg` | SVG app icon. |
| `public/icons.svg` | SVG sprite of social and brand icons. |
| `public/robots.txt` | Crawler rules. |
| `public/sitemap.xml` | Starter sitemap. |
| `public/welcome.html` | Static welcome page. |

#### `scripts/`

| File | What it does |
|---|---|
| `scripts/dev.mjs` | `npm run dev`: builds the backend, starts it on 7861, and starts Vite on 3000. |
| `scripts/server.mjs` | `npm run server`: production backend plus diagnostics, an update check, and the five autonomous agents. |
| `scripts/launcher.mjs` | `npm run launch`: starts the server automatically when you open the web app, or shows a page with the command to run. |
| `scripts/build-backend.mjs` | Compiles the TypeScript backend into `dist/` and copies the hand-written `.js` files. |
| `scripts/finalize-static-build.mjs` | Flattens the TanStack Start build into a static `dist/` for any static host. |
| `scripts/stage-desktop-dist.mjs` | Builds the web app and stages it into `desktop-app/.staged-dist` for Electron packaging. |
| `scripts/install.sh` | One-click installer: dependencies, build, and desktop shortcut. |
| `scripts/check-css-classes.js` | Flags misspelled Tailwind design-token classes. |
| `scripts/check-css-variables.js` | Checks that every `var(--token)` used in `src/` is defined in `src/index.css`. |
| `scripts/spawn-utils.mjs` | Promise wrapper around `child_process.spawn`. |
| `scripts/git-worktree-utils.mjs` | Shared git sandbox and publish helpers for the autonomous agents. |
| `scripts/update-check.mjs` | Checks for updates at startup and pulls automatically when it is safe. |
| `scripts/system-diagnostics.mjs` | Read-only startup report of memory pressure and the heaviest processes. |
| `scripts/process-tuning.mjs` | Tunes the server's own Node processes (libuv thread pool and so on), never the host. |
| `scripts/find-unreachable.mjs` | Finds working, tested code that nothing calls. |
| `scripts/self-improve.mjs` | Autonomous self-improvement loop: tunes the hyperparameters of training scripts and keeps the winners. |
| `scripts/self-improve-targets.mjs` | Whitelist of the training scripts self-improvement may tune, and how to score each one. |
| `scripts/skill-agent.mjs` | Autonomous skill agent: research → wiki → compiled skill → tests → drill. |
| `scripts/skill-drill-agent.mjs` | Drills each skill continuously with generated problems. |
| `scripts/conversation-learning-agent.mjs` | Trains OneBrain on real logged conversations. |
| `scripts/optimize-agent.mjs` | Optimization agent: watches repo-health metrics and removes test leftovers. |
| `scripts/peer-sync.mjs` | Shares self-improvement results directly between running instances over TCP. |
| `scripts/peer-sync-server.mjs` | Standalone entry point for the peer-sync listener. |
| `scripts/capability-exam.mjs` | Randomly generated exam that can't be memorized, across science, math, and computing. |
| `scripts/agent-exam.mjs` | Scores how well the agent operates (tool use, planning), as opposed to what it knows. |
| `scripts/exam-generators/astrophysics.mjs` | Exam questions: Schwarzschild radius and escape velocity. |
| `scripts/exam-generators/chemistry.mjs` | Exam questions: molar mass. |
| `scripts/exam-generators/digital-logic.mjs` | Exam questions: base conversion and boolean logic. |
| `scripts/exam-generators/optics.mjs` | Exam questions: photon energy and thin lenses. |
| `scripts/exam-generators/quantum-computing.mjs` | Exam questions: qubit states and Grover search. |
| `scripts/drill-generators/index.mjs` | Registry of every drill domain. |
| `scripts/drill-generators/arithmetic.mjs` | Drills: arithmetic. |
| `scripts/drill-generators/building-ai.mjs` | Drills: forward passes, losses, gradients, and tensor shapes. |
| `scripts/drill-generators/building-apps.mjs` | Drills: pagination, backoff, caching, and debounce math. |
| `scripts/drill-generators/classical-computers.mjs` | Drills: computer-architecture arithmetic. |
| `scripts/drill-generators/coding.mjs` | Drills: small programs whose answers come from actually running them. |
| `scripts/drill-generators/logic.mjs` | Drills: propositional logic checked by truth table. |
| `scripts/drill-generators/operating-systems.mjs` | Drills: scheduling, paging, and address translation, answered by simulation. |
| `scripts/patches/fix_final_brace.cjs` | One-off patch script for `models && skills/core/hyperdimensional.ts`, which no longer exists, so it is obsolete. |
| `scripts/patches/fix_final_brace2.cjs` | Obsolete one-off patch for the removed `hyperdimensional.ts`. |
| `scripts/patches/fix_init.cjs` | Obsolete one-off patch for the removed `hyperdimensional.ts`. |
| `scripts/patches/fix_init2.cjs` | Obsolete one-off patch for the removed `hyperdimensional.ts`. |
| `scripts/patches/fix_loop.cjs` | Obsolete one-off patch for the removed `hyperdimensional.ts`. |
| `scripts/patches/patch_hyper_input.cjs` | Obsolete one-off patch for the removed `hyperdimensional.ts`. |
| `scripts/patches/patch_hyper_weights.cjs` | Obsolete one-off patch for the removed `hyperdimensional.ts`. |
| `scripts/patches/patch_mesh.cjs` | Obsolete one-off patch for the removed `models && skills/core/mesh.ts`. |
| `scripts/patches/patch_qat.cjs` | Obsolete one-off patch (quantization-aware training) for the removed `mesh.ts`. |
| `scripts/patches/patch_symbolic.cjs` | Obsolete one-off patch for the removed `mesh.ts`. |
| `scripts/patches/patch_pipeline.cjs` | One-off patch that added `CompressedSelfModel` to `pipeline.ts`. |
| `scripts/patches/patch_pipeline_live.cjs` | One-off patch to `pipeline.ts`. |
| `scripts/patches/patch_veto.cjs` | One-off patch that wired the alignment veto into `pipeline.ts`. |
| `scripts/patches/patch_sys.cjs` | One-off patch to `zip-io.ts`. |
| `scripts/patches/patch_zip.cjs` | One-off patch to `zip-io.ts`. |
| `scripts/patches/patch_zip.js` | Duplicate of `patch_zip.cjs` with a `.js` extension. |

#### `src/` — React frontend

TanStack Start + Vite + Tailwind v4. A few files (`index.ts`, `lib/error-log.ts`, `lib/conversation-*.ts`, `lib/skill-mesh-metrics.ts`, `server/bot-service.ts`) are also compiled into the backend.

| File | What it does |
|---|---|
| `src/index.ts` | Backend-side `NeuroclawSystem` bootstrap: instantiates the LLM, the pipeline, and every plugin. |
| `src/index.css` | The only design-token file: fonts, Tailwind import, theme colors, and global styles. |
| `src/router.tsx` | TanStack router factory. |
| `src/routeTree.gen.ts` | Route tree auto-generated by the TanStack plugin. Don't edit it. |
| `src/Shell.tsx` | Mobile-responsive sidebar and main layout shell. |
| `src/assets/hero.png` | Hero image. |
| `src/assets/typescript.svg` | TypeScript logo (template asset). |
| `src/assets/vite.svg` | Vite logo (template asset). |
| `src/components/AppSidebarShell.tsx` | The app's sidebar navigation chrome. |
| `src/components/AppTour.tsx` | Guided tour that explains how every page connects to the one network. |
| `src/components/AttachFile.tsx` | Attach button that stages a file into the Zip Loop archive. |
| `src/components/ClientOnlyBoundary.tsx` | SSR-safe wrapper for components that only work in the browser. |
| `src/components/Desktop.tsx` | Desktop-style app launcher UI (icons, windows, workspaces). |
| `src/components/EditMessage.tsx` | Pen button to correct an assistant reply. The correction becomes a training signal. |
| `src/components/LiveUsbInstallButton.tsx` | "Install NeuroClaw" button, shown only when running from the live USB. |
| `src/components/LoadingScreen.tsx` | Full-screen loader with the spinning twisted strip. |
| `src/components/NeuroclawMark.tsx` | The wavy six-lobed ring logo. |
| `src/components/RingSpinner.tsx` | Lightweight spinner that doesn't need three.js. |
| `src/components/StoreItemMark.tsx` | Generated cover graphic for each store item. |
| `src/components/TwistedStripLogo.tsx` | 3D twisted-strip logo (react-three-fiber). |
| `src/components/TwistedStripSpinner.tsx` | Spinning 3D twisted strip used as a loader. |
| `src/components/VoiceRecorder.tsx` | Audio recorder that stages recordings as files. It doesn't transcribe. |
| `src/components/agent-pulse.tsx` | Animated "agent is running" ring indicator. |
| `src/components/charts/line-chart.tsx` | Small hand-written line chart used instead of recharts. |
| `src/components/icons.tsx` | Inline SVG icon set. |
| `src/components/twisted-strip-geometry.ts` | Shared geometry for the twisted strip. |
| `src/components/ui/avatar.tsx` | shadcn Avatar. |
| `src/components/ui/button.tsx` | shadcn Button with variants. |
| `src/components/ui/card.tsx` | shadcn Card. |
| `src/components/ui/input.tsx` | shadcn Input. |
| `src/components/ui/label.tsx` | shadcn Label. |
| `src/components/ui/sheet.tsx` | shadcn Sheet (slide-over panel). |
| `src/components/ui/toaster.tsx` | Renders toast notifications. |
| `src/components/ui/tooltip.tsx` | shadcn Tooltip. |
| `src/features/builder/index.ts` | Barrel export for the Extension Builder feature. |
| `src/features/builder/builder-canvas.tsx` | Drag-and-connect neuron canvas. |
| `src/features/builder/use-builder.ts` | React hook that runs the real `ExtensionBuilder` engine in the browser. |
| `src/features/mesh/index.ts` | Barrel export for the mesh feature. |
| `src/features/mesh/mesh-engine.ts` | In-browser elastic all-to-all mesh engine. |
| `src/features/mesh/mesh-visualization.tsx` | 3D mesh visualization (neurons colored by vale and activation). |
| `src/features/mesh/control-panel.tsx` | Mesh controls, input injection, neuron inspector, and stats. |
| `src/features/mesh/types.ts` | Mesh type definitions. |
| `src/features/mesh/use-elastic-mesh.ts` | Hook that runs the mesh loop and polls stats. |
| `src/hooks/useAgentRunning.ts` | Whether the backend agent is currently working. |
| `src/hooks/usePageVisible.ts` | Pauses background polling when the page is hidden. |
| `src/layouts/shared-app-layout.tsx` | Optional sidebar + main app layout. |
| `src/lib/chat-pins.ts` | Pin/unpin helper for chat threads. |
| `src/lib/chat-send.ts` | Chat send-gating and archive-outcome formatting. |
| `src/lib/conversation-learning-trigger.ts` | Starts a training cycle immediately after each real exchange. |
| `src/lib/conversation-log.ts` | Local log of real conversation turns, kept for training. |
| `src/lib/error-log.ts` | App-wide caught-error log. |
| `src/lib/poll.ts` | Polling with timeouts and no overlapping requests. |
| `src/lib/self-improvement-charts.ts` | Data transforms for the Self-Improvement dashboard charts. |
| `src/lib/skill-mesh-metrics.ts` | Measures how often trained skills answer chat directly. |
| `src/lib/stage-file.ts` | Single upload path for staging files into the archive. |
| `src/lib/toast.ts` | Small toast store used instead of sonner. |
| `src/lib/tour-seen.ts` | Remembers whether the tour has been shown. |
| `src/lib/utils.ts` | Hand-written `cn()` and `cva()` class helpers. |
| `src/lib/wiki-markdown.tsx` | Dependency-free markdown renderer for wiki pages. |
| `src/routes/__root.tsx` | Root route: HTML document shell, head tags, and global CSS import. |
| `src/routes/index.tsx` | `/` route, which redirects to `/app/chat`. |
| `src/routes/app.tsx` | `/app` layout with sidebar navigation. |
| `src/routes/app/index.tsx` | `/app` route, which redirects to `/app/chat`. The old dashboard page was removed. |
| `src/routes/app/chat.tsx` | AI Chat page with suggested follow-up prompts. |
| `src/routes/app/chat-groups.tsx` | Chat History and Memory tabs. |
| `src/routes/app/pinned-chats.tsx` | Pinned chat threads. |
| `src/routes/app/self-improvement.tsx` | Self-Improvement dashboard (Overview, Evaluation, and Experiments tabs). |
| `src/routes/app/settings.tsx` | Settings page, including computer access. |
| `src/routes/app/access.tsx` | Computer-access switches and grants. |
| `src/routes/app/store.tsx` | The Store: browse, download, install, and publish (including the wiki). |
| `src/routes/builder.tsx` | `/builder`: the visual Extension Builder. |
| `src/routes/desktop.tsx` | `/desktop`: the app-launcher desktop. |
| `src/server/bot-service.ts` | `ChatBot`: chat message processing, response generation, and follow-up suggestions. |

#### `test/` — TypeScript test suites

Run with `npm test` (smoke + Vitest + install test). Everything in `test/core/` is a Vitest suite.

| File | What it does |
|---|---|
| `test/smoke.mjs` | Dependency-free smoke test of the built NeuroLang/NeuroClaw stack. |
| `test/integration.test.ts` | End-to-end integration test of the core components. |
| `test/install-sh.test.sh` | Regression test for `scripts/install.sh`. |
| `test/core/access-switches.test.ts` | Turning an access switch off actually blocks the capability. |
| `test/core/account-info-security.test.ts` | Account-info plugin doesn't leak sensitive environment data. |
| `test/core/agent-pulse-speed.test.ts` | Pins the breathing rate of the agent-pulse indicator. |
| `test/core/agent-skill.test.ts` | `SKILL.md`-format agent skills load correctly. |
| `test/core/agent-tool-discovery.test.ts` | The agent picks its own tool without being given a plugin id. |
| `test/core/agent-workspace.test.ts` | Agent workspace coordination and the permission layer around it. |
| `test/core/app-diagnostics-security.test.ts` | App-diagnostics plugin runs commands safely. |
| `test/core/architecture-end-to-end.test.ts` | Walks the whole architecture end to end and measures it. |
| `test/core/atomic-write.test.ts` | State writes survive interruption. |
| `test/core/bot-service.test.ts` | `ChatBot` singleton and system-upgrade path. |
| `test/core/browser-ssrf-security.test.ts` | Browser plugin blocks SSRF targets. |
| `test/core/calendar-interop.test.ts` | TS and Python calendar plugins share one storage file correctly. |
| `test/core/calendar-security.test.ts` | Calendar input validation. |
| `test/core/camera-security.test.ts` | Camera plugin executes safely. |
| `test/core/camera-stream-cleanup.test.ts` | Camera stream temp directory is cleaned up. |
| `test/core/capabilities-registry.test.ts` | Host capability detection. |
| `test/core/capability-exam.test.ts` | Capability exam and its generators produce correct answers. |
| `test/core/capability-router.test.ts` | Message → plugin routing without running plugins. |
| `test/core/chat-attachments-marker.test.ts` | `[[ATTACH:id]]` markers are removed from plugin replies. |
| `test/core/chat-attachments.test.ts` | Chat file-attachment registry. |
| `test/core/chat-history-pin.test.ts` | Pinning chat threads. |
| `test/core/chat-history-ux.test.ts` | Chat History UI details. |
| `test/core/chat-new-session-ux.test.ts` | New-chat-session UI details. |
| `test/core/chat-queue.test.ts` | Typing and queuing messages while the agent is replying. |
| `test/core/chat-send-gate.test.ts` | A staged file with no text can be sent. |
| `test/core/code-iteration.test.ts` | Code write/run/fix loop reports failures precisely. |
| `test/core/code-sandbox-escape.test.ts` | Code candidates can't escape the sandbox. |
| `test/core/computer-access-plugin.test.ts` | Computer-access plugin surface. |
| `test/core/contacts-permissions.test.ts` | Contacts file permissions. |
| `test/core/contacts-security.test.ts` | Contacts input validation. |
| `test/core/continuous-learning.test.ts` | Next-message prediction and surprise reporting. |
| `test/core/conversation-learning-trigger.test.ts` | Training starts after each exchange. |
| `test/core/conversation-learning.test.ts` | Conversation logging and the training pipeline. |
| `test/core/critic.test.ts` | Critic verifies claims independently. |
| `test/core/delete-everything.test.ts` | "Delete all memory and chats" really deletes everything. |
| `test/core/desktop-control.test.ts` | Graphical access layer gating (without a real display). |
| `test/core/domain-skills.test.ts` | The eight domain neuron regions. |
| `test/core/doorway-lock.test.ts` | Only one caller drives `settle()` at a time. |
| `test/core/drill-generators.test.ts` | Every drill generator's answers are correct. |
| `test/core/email-header-injection.test.ts` | Email plugin blocks MIME header injection. |
| `test/core/email-permissions.test.ts` | Email file permissions. |
| `test/core/equation.test.ts` | The fast path computes exactly the equation. |
| `test/core/evaluation-ux.test.ts` | Evaluation tab UI details. |
| `test/core/experiments-ux.test.ts` | Experiments tab UI details. |
| `test/core/expert-lazy-weights.test.ts` | Expert weights are allocated only when first used. |
| `test/core/extension-system.test.ts` | `extension_system/`: lifecycle, dependencies, versioning, permissions, and storage. |
| `test/core/extensions-security.test.ts` | Image and Video extensions execute commands safely. |
| `test/core/filesystem-security.test.ts` | File-system plugin opens files safely. |
| `test/core/github-link.test.ts` | Clickable GitHub URL built from a real remote. |
| `test/core/github-publish.test.ts` | GitHub publish plugin works end to end. |
| `test/core/goal-structure.test.ts` | Goal and constraint system on top of `PlanTracker`. |
| `test/core/hive-plugin.test.ts` | Hive chat commands. |
| `test/core/hyperdimensional.test.ts` | Per-tick behavior of the hyperdimensional engine. |
| `test/core/knowledge-ux.test.ts` | Knowledge tab UI and accessibility. |
| `test/core/live-equation.test.ts` | The running agent actually computes the full equation. |
| `test/core/location-security.test.ts` | Location plugin validation. |
| `test/core/long-term-memory.test.ts` | Long-term memory payload storage. |
| `test/core/math-engine.test.ts` | Math toolkit correctness. |
| `test/core/mesh-parallel.test.ts` | Parallel mesh output equals serial output. |
| `test/core/mesh-visualization.test.ts` | Fibonacci-sphere layout edge case. |
| `test/core/messaging-security.test.ts` | Messaging plugin validation. |
| `test/core/microphone-recording-cleanup.test.ts` | Microphone temp directory is cleaned up. |
| `test/core/mod-apply.test.ts` | Applying mods onto the working copy. |
| `test/core/multi-desktop.test.ts` | `launchOnDesktop()` shell handling. |
| `test/core/multi-input-security.test.ts` | Multi-input plugin validation. |
| `test/core/net-skill-graft.test.ts` | Net skills graft into the mesh. |
| `test/core/net-skill-store.test.ts` | Net skills appear in the store catalog. |
| `test/core/notifications-permissions.test.ts` | Notification file permissions. |
| `test/core/notifications-security.test.ts` | Notifications validation. |
| `test/core/optimize-agent.test.ts` | Optimization agent actually fires on regressions. |
| `test/core/other-devices-security.test.ts` | Other-devices plugin validation. |
| `test/core/passkeys-security.test.ts` | Passkeys validation. |
| `test/core/phone-calls-security.test.ts` | Phone-calls validation. |
| `test/core/poll.test.ts` | Polls don't pile up. |
| `test/core/prompt-mesh-feed.test.ts` | Everything said goes through the Zip Loop as a file. |
| `test/core/prompting-skill-edit-ux.test.ts` | Editing a prompting skill in the UI. |
| `test/core/prompting-skills-zip-loop.test.ts` | Prompting-skill prompts reach the Zip Loop. |
| `test/core/prompting-skills.test.ts` | The agent loop really calls prompting skills. |
| `test/core/quantization.test.ts` | Quantization primitives, hardware estimates, and scheduler. |
| `test/core/radios-security.test.ts` | Radios plugin validation. |
| `test/core/remote-access.test.ts` | Remote login and sessions. |
| `test/core/repo-integrity.test.ts` | Guards against repo-level accidents, such as a nested copy of the repo being committed as a broken gitlink. |
| `test/core/requirement-planner.test.ts` | Requirement planner and main-model freezing. |
| `test/core/requirements.test.ts` | The mesh really needs no Python packages. |
| `test/core/research-corroboration.test.ts` | Research corroboration logic. |
| `test/core/research-security.test.ts` | Research plugin validation. |
| `test/core/response-correction.test.ts` | Editing AI replies and the correction signal. |
| `test/core/robotics-security.test.ts` | Robotics plugin restrictions. |
| `test/core/screenshots-security.test.ts` | Screenshots plugin restrictions. |
| `test/core/self-improve.test.ts` | Self-improvement loop and peer sync. |
| `test/core/self-improvement-charts.test.ts` | Dashboard chart data transforms. |
| `test/core/self-improvement-server.test.ts` | Start/stop control of the self-improvement server. |
| `test/core/self-replicate.test.ts` | Self-replicate `tools` export. |
| `test/core/skill-agent.test.ts` | Skill agent helpers. |
| `test/core/skill-drill-agent.test.ts` | Drill agent and arithmetic generator. |
| `test/core/skill-library.test.ts` | Skill library search and load. |
| `test/core/skill-maker-wiki.test.ts` | Skill Maker's wiki-page generation. |
| `test/core/skill-mesh-metrics.test.ts` | Skill-mesh direct-answer metric. |
| `test/core/spawn-utils.test.ts` | `spawnAwait()`. |
| `test/core/stage-file.test.ts` | Single upload path for staging files. |
| `test/core/store-autonomy.test.ts` | Agent publishing its own work. |
| `test/core/store-catalog-pull.test.ts` | Pulling the store catalog from the `store` branch. |
| `test/core/store-fetch.test.ts` | On-demand download of store payloads. |
| `test/core/store-install.test.ts` | Installing store items. |
| `test/core/store-nested-files.test.ts` | Store items that are nested folders. |
| `test/core/store-plugin-manage.test.ts` | Managing the store through the plugin. |
| `test/core/store-sync.test.ts` | Publishes reach the `store` branch. |
| `test/core/system-tests.test.ts` | `ArchitectureMapper` and `PerformanceMonitor`. |
| `test/core/tasks-permissions.test.ts` | Tasks file permissions. |
| `test/core/tasks-security.test.ts` | Tasks validation. |
| `test/core/update-check.test.ts` | Update-check divergence logic. |
| `test/core/voice-activation-security.test.ts` | Wake-word security. |
| `test/core/wiki-remote.test.ts` | Remote wiki pages. |
| `test/core/wiki-security.test.ts` | Wiki plugin validation. |
| `test/core/wiki-ux.test.ts` | Wiki UI and accessibility. |
| `test/core/working-memory.test.ts` | Working memory. |
| `test/core/world-model.test.ts` | World model. |
| `test/core/zip-halt.test.ts` | Mesh halting rule. |

#### `tests/security/` — Python plugin security tests

Run with `python3 -m unittest discover -s tests/security -v` from the repo root.

| File | What it does |
|---|---|
| `tests/security/test_browser_security.py` | Security tests for `plugin_browser.py`. |
| `tests/security/test_calendar_security.py` | Security tests for `plugin_calendar.py`. |
| `tests/security/test_camera_security.py` | Security tests for `plugin_camera.py`. |
| `tests/security/test_contacts_security.py` | Security tests for `plugin_contacts.py`. |
| `tests/security/test_email_security.py` | Security tests for `plugin_email.py`. |
| `tests/security/test_gnome_security.py` | Security tests for `plugin_gnome.py`. |
| `tests/security/test_microphone_security.py` | Security tests for `plugin_microphone.py`. |
| `tests/security/test_notifications_security.py` | Security tests for `plugin_notifications.py`. |
| `tests/security/test_robotics_security.py` | Security tests for `plugin_robotics.py`. |
| `tests/security/test_screenshot_security.py` | Security tests for `plugin_screenshot.py`. |
| `tests/security/test_self_replicate_security.py` | Security tests for `plugin_self_replicate.py`. |
| `tests/security/test_selfheal_security.py` | Security tests for `plugin_selfheal.py`. |
| `tests/security/test_server_security.py` | Security tests for `interface/server.py`. |
| `tests/security/test_terminal_security.py` | Security tests for `plugin_terminal.py`. |
| `tests/security/test_voice_security.py` | Security tests for `plugin_voice.py`. |

#### `training_data/`

| File | What it does |
|---|---|
| `training_data/database_loader.py` | `ScientificDatabaseLoader`: loads the catalog below into the agent's knowledge base. |
| `training_data/scientific_databases.json` | Catalog of scientific databases and repositories (Protocols.io and others) with descriptions and categories. |

#### `wiki/` — architecture wiki

| File | What it does |
|---|---|
| `wiki/Home.md` | Wiki home page and entry point. |
| `wiki/_Sidebar.md` | Wiki navigation sidebar. |
| `wiki/Architecture.md` | System architecture overview. |
| `wiki/Bots.md` | The automated PR bots that work on this repo and their branch prefixes. |
| `wiki/Builder.md` | Extension Builder guide. |
| `wiki/Chrome-Apps.md` | Chrome apps as local data-source plugins. |
| `wiki/Code-to-Net.md` | Code-to-Net overview. |
| `wiki/Elastic-Value-Budget.md` | Zero-sum value budget (learning without forgetting). |
| `wiki/Empathy-Engine.md` | Empathy engine. |
| `wiki/Extensions.md` | Extensions the AI builds for itself. |
| `wiki/Hyperdimensional.md` | Hyperdimensional thinking. |
| `wiki/Languages.md` | The 500+ programming-language catalog. |
| `wiki/MoE.md` | Mixture of Experts. |
| `wiki/Multi-Input.md` | Multiple desktops, keyboards, and mice. |
| `wiki/Net-Search.md` | Net Search. |
| `wiki/NeuroLang.md` | NeuroLang language reference. |
| `wiki/Neuron-Mesh.md` | All-to-all neuron mesh. |
| `wiki/Pipeline.md` | How input flows through `NeuroPipeline.run()`. |
| `wiki/Platforms.md` | macOS, Windows, and Linux support. |
| `wiki/Plugins.md` | Plugins overview. |
| `wiki/Privacy-Policy.md` | Plain-language privacy policy. |
| `wiki/Privacy.md` | Technical privacy and encryption details. |
| `wiki/Quantization.md` | Quantization overview. |
| `wiki/Quantum-Net.md` | Wave-signature "quantum" neural net. |
| `wiki/Quick-Start.md` | Quick-start guide. |
| `wiki/RLM.md` | Reinforcement learning module. |
| `wiki/Self-Improvement.md` | Autonomous self-improvement and peer sync from `npm run server`. |
| `wiki/Skills.md` | Skills as MoE experts. |
| `wiki/Syntax.md` | NeuroLang syntax cheat sheet. |
| `wiki/System-Access.md` | Terminal, file, and desktop access. |
| `wiki/Terms.md` | Terms of use. |
| `wiki/Zip-IO.md` | Zip I/O loop. |
| `wiki/bot/.gitkeep` | Keeps `wiki/bot/`, where pages published through `POST /api/wiki` are stored. |

## Key Features

### Neural Architecture
- **Neural Mesh**: Fully connected neurons with non-linear communication
- **Mixture of Experts (MoE)**: Efficient routing to specialized neuron groups
- **Hyperdimensional Thinking**: Multi-dimensional memory states and analogy reasoning
- **Elastic Value System**: Zero-sum plasticity budget where high-value neurons change less
- **Parallel Settle**: Both meshes can spread a settle tick's O(n²) weighted-sum work across
  multiple cores — `MeshWorkerPool` (Node `worker_threads` + `SharedArrayBuffer`/`Atomics`) for
  the TypeScript engine, `parallel_workers` (a `ProcessPoolExecutor`) for the Python reference —
  see [Parallel Computing](#parallel-computing) below

### Learning & Memory
- **Multi-Rule Plasticity**: Hebbian, Oja's rule, BCM theory, homeostatic learning
- **Circular Context**: Infinite context window via compression to long-term memory
- **Self-Improvement**: Patterns automatically promoted to permanent skills
- **Mistake Tracking**: Detects and penalizes repeated mistakes
- **Conversation Training**: OneBrain trains continuously on real conversations, automatically,
  with zero extra setup — see [Conversation Training](#conversation-training) below

### Extensions & Skills
- **Extension Builder**: Drag-and-drop neuron connection editor
- **Skill System**: Pluggable expert transforms (coding, language, reasoning)
- **Plugin Architecture**: API connections to external services
- **Quantization**: Background model quantization for faster inference

### System Access
- **Full System Access**: Terminal, file system, multi-desktop support
- **Multi-Input**: Separate mouse/keyboard streams to avoid user conflict
- **Chrome Apps**: Service integration for extended capabilities
- **Encrypted by Default**: End-to-end encryption for all data

## Core API Example

```python
from asi_core import UnifiedBrain

# Create brain with named expert groups
brain = UnifiedBrain(
    n_neurons=64,
    n_groups=8,
    expert_names=['coding', 'language', 'reasoning', 'research', 
                  'math', 'vision', 'audio', 'control']
)

# Run perception cycles
result = brain.perceive([0.5, 0.3, 0.2, 0.8], reward=0.8)
print(f"Output: {result.output}")
print(f"Active experts: {result.active_experts}")

# Self-improvement: patterns become skills
for _ in range(50):
    brain.perceive([0.9, 0.9, 0.9, 0.9], reward=0.95)
created = brain.self_improve(min_strength=1.2)

# Create extension from learned skills
ext = brain.create_extension('pattern_recognition', purpose='Recognize patterns')

# Introspection
info = brain.introspect()
print(f"Stable neurons: {info.most_stable_neurons}")
print(f"Flexible neurons: {info.most_flexible_neurons}")
```

## Endurance Training

`asi_core/endurance_training.py` drives one `UnifiedBrain` through a
long-running session: a curriculum of synthetic tasks across every expert
domain, interleaved with `self_improve()`, memory-bounding `maintain()`
calls, and periodic checkpoints (`backup()`/`restore()`) so a session can
be paused and resumed instead of starting over.

```bash
python3 -m asi_core.endurance_training --cycles 20000 \
    --checkpoint /tmp/onebrain.checkpoint.json \
    --report /tmp/onebrain.report.json

# Resume a previous run and keep going:
python3 -m asi_core.endurance_training --cycles 20000 \
    --resume-from /tmp/onebrain.checkpoint.json \
    --checkpoint /tmp/onebrain.checkpoint.json
```

See [docs/ENDURANCE_TRAINING.md](docs/ENDURANCE_TRAINING.md) for the full
option reference.

## Parallel Computing

Settling a mesh tick is dense: every neuron reads every other neuron's
state through a full weight matrix, an O(n²) (times dimensions²) cost per
tick. Both engines can spread that work across CPU cores instead of
running it on one thread — opt-in, off by default, and bit-for-bit
identical to the single-threaded path when it's used (verified by tests
comparing serial vs. parallel output directly, not just checked for
"close enough").

**TypeScript (OneBrain)** — `MeshWorkerPool` (`models && skills/core/mesh-worker-pool.ts`)
shards `NeuronMesh.propagate()`'s dense settle loop across
`node:worker_threads`, with `SharedArrayBuffer` + `Atomics` so a call
blocks only until every worker finishes its row range, not through
`postMessage` round trips:

```ts
import { NeuronMesh } from './models && skills/core/onebrain.js';
import { MeshWorkerPool } from './models && skills/core/mesh-worker-pool.js';

const mesh = new NeuronMesh({ nodeCount: 2000, connectionDensity: 1.0 });
mesh.setParallelBackend(new MeshWorkerPool()); // defaults to os.cpus().length - 1
await mesh.prepareParallel();                  // attaches the shared buffers once
mesh.propagate(inputs);                        // now runs across multiple cores
```

Node-only (Bun works too): `mesh-worker-pool.ts` is never imported by
`onebrain.ts` itself, which stays free of Node built-ins so it can still
be bundled for the browser — see that file's own header comment. Below
`parallelMinNodes` (default 256; `MeshConfig.parallelMinNodes`) it falls
back to the serial loop even with a backend attached, since worker
coordination overhead outweighs the savings on a small mesh — see
`bun run bench:mesh-parallel` (`benchmarks/mesh_parallel_benchmark.ts`)
for real numbers at a size where it wins.

**Python (asi_core reference mesh)** — `NeuralMesh(parallel_workers=N)`
distributes each settle tick's per-neuron update across `N`
`ProcessPoolExecutor` subprocesses, with topology/weights sent to each
worker once (not re-pickled every tick) and torn down automatically
whenever they'd go stale (learning, a new expert group, an explicit
weight/DSL override, or a state load):

```python
from asi_core import create_brain

brain = create_brain("massive", parallel_workers=4)  # 256 neurons
try:
    brain.perceive([0.1, 0.2, 0.3, 0.4])
finally:
    brain.close()  # shuts down the worker pool
```

Also below `parallel_min_neurons` (default 32) it stays on the serial
path. Both are opt-in specifically because coordination overhead can
outweigh the savings below that threshold — see each implementation's own
doc comments (`NeuronMesh`'s `ParallelMeshBackend` in `onebrain.ts`;
`NeuralMesh`'s class docstring and `_settle_shard` in
`asi_core/neural_mesh.py`) for the full design and the constraints that
shaped it.

## Conversation Training

Chat replies only ever improve one way: `scripts/conversation-learning-agent.mjs`
logs every real turn locally and trains OneBrain's actual output neurons on
it via `ExtensionBuilder.train()`'s JS delta rule — no PyTorch, no Python
process, nothing to install. Nothing else you type, including the
`train <text>` command or `POST /api/train`, changes chat replies; see
[docs/CONVERSATION_TRAINING_LOG.md](docs/CONVERSATION_TRAINING_LOG.md) for
the full explanation.

This training loop runs automatically the moment the server is up — right
after every real exchange, plus a catch-up pass every ~20 minutes
(`NEUROCLAW_CONVERSATION_LEARNING_INTERVAL_MS`) — with zero setup. Disable
it with `NEUROCLAW_CONVERSATION_LEARNING=0` if you don't want it. Replies
only actually improve once there's enough real conversation history to
train on; this doesn't retroactively rewrite past replies.

## Documentation

See [docs/](docs/) and [wiki/](wiki/) for comprehensive documentation:

- **Architecture**: System design and neural architecture
- **Deployment**: Installation and deployment guides  
- **Skills**: How to create and train skills
- **Extensions**: Building and sharing extensions
- **Plugins**: Available system plugins

## Testing

All core systems are tested with 349+ unit tests:

```bash
# Run all ASI core tests
python3 -m unittest discover -s asi_core -v

# Run specific test module
python3 -m unittest asi_core.test_unified_brain -v
```

## License

See LICENSE file in subdirectories for specific licensing information.
