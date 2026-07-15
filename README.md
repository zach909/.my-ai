# Prometheus Elastic Core

A locally-run AI built on an **all-to-all neuron mesh** instead of a transformer,
trained by an ordinary PyTorch loop. Every neuron connects to every other neuron
with multi-dimensional state; a reasoning step is many settle ticks of
propagation until the mesh's state stabilises. The mesh is an *experimental,
unproven* alternative to attention — not assumed superior — but it is a real,
trainable substrate that learns via the standard weight-update rule.

The code lives in **`model && skills manager/`** (Python + PyTorch). Run scripts
from that directory.

## The nine mechanisms (all wired into the mesh, all trained by the same loop)

1. **Substrate (§1)** — all-to-all mesh; each connection is a D×D weight block
   (any source dimension can influence any target dimension); bias once per
   neuron; settle-to-convergence. `tinygpt/mesh.py`.
2. **Vale / value budget (§2)** — per-neuron plasticity gates how much each
   neuron's weights move (learn without forgetting); zero-sum; rises when a
   neuron's meaning is verified.
3. **Skills as neuron-groups (§3)** — a router activates top-k groups per input;
   the rest stay wired but dormant. Full density, sparse per-tick compute.
4. **Extension builder / NeuroLang (§4)** — teach declarative *definishon*
   contracts (`when X then reply Y`); contradictions are detected, not looped on.
   `tinygpt/extension_builder.py`, `neurolang.py`.
5. **Answer selection by interference (§5)** — complex-number phase-consensus
   cancels contradictory candidates, Grover amplification boosts a rare-correct
   one, collapse samples ∝ amplitude². `tinygpt/interference.py`.
6. **Self-awareness (§6)** — a reserved input-source flag dimension per neuron,
   and a cheap self-model whose prediction error is the surprise signal.
7. **Live correction (§7)** — re-route on *sustained* tick-to-tick divergence
   during settling (steer, don't halt).
8. **Quantization as internal language (§8)** — quantization-aware training with
   a straight-through estimator, inside the forward pass.
9. **Never idle (§9)** — continuous operation: the neuron state carries across
   calls; memory is the saved neuron state; a bounded output ring buffer.

Around the mesh: an **alignment veto** (blocks objectionable / drifting actions,
fails safe; irreversible actions route to the human), **live guidance**, a
**human-in-the-loop action layer** (read-only by default; a `terminal` action is
opt-in and always confirms), an **empathy engine** (reads the user's mood and
remembered preferences and adapts sampling to stay aligned without repeated
instructions — `tinygpt/empathy.py`), and a **reinforcement-learning layer**
(`tinygpt/rl.py`): candidate replies are evaluated before committing, completed
reasoning steps are recorded in a persistent ledger so they are not repeated
unnecessarily, and a REINFORCE step can train the mesh from its own
candidate-selection signal. §5 is live in the reply path too: every neuron has
a unique **wave signature**, and `--select interference` commits the reply by
phase consensus over the mesh's settled states plus Born-rule collapse.

## Quickstart

```bash
cd "model && skills manager"
pip install -r requirements.txt
python train_tokenizer.py --vocab-size 8000
python pretrain.py --device cuda        # trains the mesh (arch defaults to "mesh")
python core.py --ckpt checkpoints/gpt.pt --candidates 5   # talk to it
python test_core.py                     # 94 checks, no checkpoint needed
```

Or use the unified entry point:

```bash
python main.py build example_experts.nl   # build + train a mesh from NeuroLang
python main.py chat --ckpt checkpoints/gpt.pt
python main.py test
```

## Web dashboard (Vite + React)

The repository root is also a TypeScript web app (TanStack Start + Tailwind +
shadcn/ui) with an interactive **elastic-mesh visualization**
(`src/features/mesh/`): a live in-browser mesh engine with a control panel for
neuron count, settle ticks, and vale budgets.

```bash
npm install
npm run dev      # local dev server
npm run lint     # typecheck + eslint + stylelint + CSS-variable checks
npm run build    # static production build
```

The lint step includes a CSS-variable check that cross-references
`tailwind.config.cjs` against `src/index.css` and fails on undefined variables.

## Honest limitations

This is a correct, trainable implementation of all nine mechanisms, unit-verified
at tiny scale. It is **not** proven to produce a capable model — that needs real
training at scale. It is **not** a path to superintelligence, and it has **no
autonomous goal-generation**: it reasons about and responds to input, it does not
invent its own objectives. The mesh is an unproven alternative to the
transformer, offered to be tested, not assumed better.
