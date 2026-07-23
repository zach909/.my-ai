# Neuroclaw — Prometheus Elastic Core

> ⚠️ **WARNING**: This project is in BETA. Use at your own risk.

## 🚀 Quick Start

**New to Neuroclaw?** Follow our [Easy Installation Guide](INSTALL.md) for a one-click setup!

```bash
# One-click install (creates desktop app)
./install.sh

# Or use npm
npm run install:app
```

This will:
- ✅ Install all dependencies automatically
- ✅ Build the application  
- ✅ Create a desktop shortcut
- ✅ Open the app in your browser

---

A locally-run AI built on an **all-to-all neuron mesh** instead of a transformer.
Every neuron connects to every other neuron with multi-dimensional state; a
reasoning step is many settle ticks of propagation until the mesh's state
stabilises. The mesh is an *experimental, unproven* alternative to attention —
not assumed superior — but it is a real, trainable substrate that learns via the
standard weight-update rule.

The project is one system in three connected layers:

| Layer | Where | What it does |
|---|---|---|
| **Model & training** | `model && skills manager/` (Python + PyTorch) | The trainable mesh, tokenizer, pretrain/finetune loops, unified core with veto + actions |
| **Runtime backend** | `models && skills/`, `plugins/`, `plugin_manager/`, `extension-builder/`, `interface/` (TypeScript/Node) | The live pipeline: MoE routing, empathy, alignment veto, ZIP-IO context, 28 plugins & skills, Extension Builder, web/CLI interfaces |
| **Web UI** | `src/` (React + Vite) | The Prometheus Elastic Core dashboard at `/` — the real mesh engine running in-browser with 3D visualization and controls |

## The nine mechanisms (all wired into the mesh, all trained by the same loop)

1. **Substrate (§1)** — all-to-all mesh; each connection is a D×D weight block
   (any source dimension can influence any target dimension); bias once per
   neuron; settle-to-convergence. `model && skills manager/tinygpt/mesh.py`.
2. **Vale / value budget (§2)** — per-neuron plasticity gates how much each
   neuron's weights move (learn without forgetting); zero-sum; rises when a
   neuron's meaning is verified.
3. **Skills as neuron-groups (§3)** — a router activates top-k groups per input;
   the rest stay wired but dormant. Full density, sparse per-tick compute.
4. **Extension builder / NeuroLang (§4)** — teach declarative *definishon*
   contracts (`when X then reply Y`); contradictions are detected, not looped on.
   `tinygpt/extension_builder.py` (training) and `extension-builder/` (runtime).
5. **Answer selection by interference (§5)** — complex-number phase-consensus
   cancels contradictory candidates, Grover amplification boosts a rare-correct
   one, collapse samples ∝ amplitude². `tinygpt/interference.py`.
6. **Self-awareness (§6)** — a reserved input-source flag dimension per neuron,
   and a cheap self-model whose prediction error is the surprise signal.
7. **Live correction (§7)** — re-route on *sustained* tick-to-tick divergence
   during settling (steer, don't halt).
8. **Quantization as internal language (§8)** — quantization-aware training with
   a straight-through estimator, inside the forward pass. Extensions are saved
   un-quantized (editable) and quantized on install.
9. **Never idle (§9)** — continuous operation: the neuron state carries across
   calls; memory is the saved neuron state; bounded input **and** output ring
   buffers.

Every neuron also carries a unique **wave signature** and amplitude: with
`--select interference` (answer selection) or `--quant-interference` (a
differentiable interference gate *inside* the mesh forward), phase-aligned
neurons reinforce and discordant ones cancel — the quantum layer runs in the
canonical mesh, no external deps. Persisted data (conversation memory) can be
**encrypted at rest** with a local stdlib cipher (`--encrypt` / `MYAI_PASSPHRASE`;
no external APIs). The Extension Builder can **simulate** a single neuron,
**search** neurons, and expose **API-capable output layers** that turn neuron
activations into veto-gated calls to local endpoints.

**Plugins and skills** are distinguished in one place (`tinygpt/plugins.py`): a
**plugin** connects to a *local* service (file system, diagnostics, screenshot
tool, …) with no external APIs — the ones with a real local implementation run
for real, the rest fail cleanly instead of phoning out — and a **skill** is a
Mixture-of-Experts expert that attaches straight into the mesh's settle loop
(`--skill-experts` at train time; `plugins` / `skills` / `plugin:` commands in
the core). The full extension list from the design notes lives there.

Around the mesh: an **alignment veto** (blocks objectionable / drifting actions,
fails safe; irreversible actions route to the human), an **empathy engine**
(valence/arousal/dominance tracking that keeps decisions user-aligned), **live
guidance**, and a **human-in-the-loop action layer** (read-only by default; a
`terminal` action is opt-in and always confirms). Everything runs locally — no
external APIs.

## Quickstart

### Train & chat with the mesh (Python)

```bash
cd "model && skills manager"
pip install -r requirements.txt
python build_corpus.py                  # build a local corpus (no downloads)
python train_tokenizer.py --vocab-size 8000
python pretrain.py --device cuda        # trains the mesh (arch defaults to "mesh")
python core.py --ckpt checkpoints/gpt.pt --candidates 5   # talk to it
python test_core.py                     # full check suite (221 checks), no checkpoint needed
python test_elastic_mesh.py             # mesh + expert-core smoke checks
python main.py demo                     # end-to-end integration demo (see below)

# local browser chat backend (same Generator core.py/chat.py use)
python interface/server.py --ckpt checkpoints/gpt_sft.pt --port 8000
```

`python main.py demo` (`test_integration.py`) is the proof that the pieces above are
one system, not a pile of separately-tested parts: it carries a *single* trained
mesh through NeuroLang (dictionary-linked concepts, spec-literal directives),
elastic-value self-healing, extension save/install (quantized), live Plugin
Builder and Skill Builder calls against that same mesh, a real `core.py` chat
session (empathy + the RL ledger + §5 quantum-interference selection, all
active together, driven as a subprocess through a scripted conversation), and
a real HTTP round-trip through the browser backend — 32 checks (28 without
the TS backend built; the last 4 exercise the repo-root `interface/server.py`
proxying to it), no mocks.

### Run the TypeScript backend (pipeline, plugins, Extension Builder)

```bash
npm install --legacy-peer-deps
npm test              # builds the backend into dist/ and runs 649 smoke checks
node dist/index.js web 3000   # Neuroclaw dashboard + /api/* at http://localhost:3000
node dist/index.js cli        # interactive shell
```

`node dist/index.js web` serves an embedded terminal-style dashboard
(`HTML_TEMPLATE` in `interface/web-server.ts`) — chat, live subsystem stats,
the plugin/skill catalog, and the NeuroLang Extension Builder (build → save
un-quantized → install quantized), backed by `/api/chat`, `/api/status`,
`/api/neuri`, `/api/plugins`, `/api/extension/*`.

There are actually three different `server.py`-style backends in this repo,
easy to conflate since two share the same relative filename:

- `model && skills manager/interface/server.py` — the one shown above
  (`python interface/server.py --ckpt checkpoints/gpt_sft.pt --port 8000`,
  run from inside `model && skills manager/`): a minimal browser chat UI for
  a trained TinyGPT checkpoint, no TS backend involved at all.
- `interface/server.py` (repo root — run `python interface/server.py
  [--ckpt PATH] [--port 7860]` from the repo *root*, not from `model &&
  skills manager/`): serves `interface/index.html`, a third dashboard
  distinct from both of the above, handles `/api/chat`/`/api/model` itself,
  and proxies `/api/systems` (→ this TS backend's own `/api/status`),
  `/api/plugins`, `/api/extension/*`, etc. to the same TS pipeline `node
  dist/index.js web` runs.
- `node dist/index.js web`'s own embedded dashboard, described just above.

All three are real and independently runnable; pick whichever matches how
you started the model and which dashboard you want.

`NeuroclawSystem` (`index.ts`) ties the TypeScript subsystems into one platform.
Beyond the neural pipeline it provides: a **Hive Mind** of specialized agents
(`collaborate()`) with a zero-sum trust budget and a permissioned shared
blackboard; **Chat Groups** with trust-weighted decisions; **long-term memory**
built from the conversation (`recall()`, `recallHistory()`, `chatHistory()`),
which grounds generation and answers recall questions directly; **semantic
context compression** (`compressContext()`); a **capability router** that sends
each query to recall / summarize / self-heal or generation; **RLM planning**
(`executePlan()`, no-repeat) and **self-healing** (`selfHeal()`,
detect→repair→revert-known-good→report); **behavioral Code-to-Net** and a
four-mode **Net Search** on the NeuroLang side; and `autonomousTask()`, which
runs an objective as a plan delegated across the hive, recorded to memory, with
self-heal on failure. Every one is covered by the smoke suite.

### Run the web UI (in-browser mesh dashboard)

```bash
npm run dev      # dev server
npm run build    # static build into dist/
```

The home page runs the real elastic mesh in the browser: 64 neurons × 4D state,
zero-sum vale, input injection, Hebbian learning, and a 3D all-to-all
visualization.

## Development scripts

```bash
npm run lint:types    # typecheck everything (frontend + backend)
npm run build:backend # compile the Node backend into dist/
npm test              # backend build + smoke suite
npm run lint          # ESLint + Stylelint + CSS variable/class checks
```

The CSS variable check cross-references `var(--…)` usages against definitions in
`src/index.css` and fails the lint when one is missing.

## Honest limitations

This is a correct, trainable implementation of all nine mechanisms, unit-verified
at tiny scale. It is **not** proven to produce a capable model — that needs real
training at scale (`train_at_scale.py` is the on-ramp). It is trying to be a path to
superintelligence,but it has **no autonomous goal-generation**: it reasons about
and responds to input, it does not invent its own objectives. The mesh is an
unproven alternative to the transformer, offered to be tested, not assumed better.
