<<<<<<< HEAD
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
   `tinygpt/extension_builder.py`.
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
fails safe; irreversible actions route to the human), **live guidance**, and a
**human-in-the-loop action layer** (read-only by default; a `terminal` action is
opt-in and always confirms).

## Quickstart

```bash
cd "model && skills manager"
pip install -r requirements.txt
python train_tokenizer.py --vocab-size 8000
python pretrain.py --device cuda        # trains the mesh (arch defaults to "mesh")
python core.py --ckpt checkpoints/gpt.pt --candidates 5   # talk to it
python test_core.py                     # 48 checks, no checkpoint needed
```

## Honest limitations

This is a correct, trainable implementation of all nine mechanisms, unit-verified
at tiny scale. It is **not** proven to produce a capable model — that needs real
training at scale. It is **not** a path to superintelligence, and it has **no
autonomous goal-generation**: it reasons about and responds to input, it does not
invent its own objectives. The mesh is an unproven alternative to the
transformer, offered to be tested, not assumed better.
=======
# Enhanced Vite React TypeScript Template

This template includes built-in detection for missing CSS variables between your Tailwind config and CSS files.

## Features

- **CSS Variable Detection**: Automatically detects if CSS variables referenced in `tailwind.config.cjs` are defined in `src/index.css`
- **Enhanced Linting**: Includes ESLint, Stylelint, and custom CSS variable validation
- **Shadcn/ui**: Pre-configured with all Shadcn components
- **Modern Stack**: Vite + React + TypeScript + Tailwind CSS

## Available Scripts

```bash
# Run all linting (includes CSS variable check)
npm run lint

# Check only CSS variables
npm run check:css-vars

# Individual linting
npm run lint:js    # ESLint
npm run lint:css   # Stylelint
```

## CSS Variable Detection

The template includes a custom script that:

1. **Parses `tailwind.config.cjs`** to find all `var(--variable)` references
2. **Parses `src/index.css`** to find all defined CSS variables (`--variable:`)
3. **Cross-references** them to find missing definitions
4. **Reports undefined variables** with clear error messages

### Example Output

When CSS variables are missing:
```
❌ Undefined CSS variables found in tailwind.config.cjs:
   --sidebar-background
   --sidebar-foreground
   --sidebar-primary

Add these variables to src/index.css
```

When all variables are defined:
```
✅ All CSS variables in tailwind.config.cjs are defined
```

## How It Works

The detection happens during the `npm run lint` command, which will:
- Exit with error code 1 if undefined variables are found
- Show exactly which variables need to be added to your CSS file
- Integrate seamlessly with your development workflow

This prevents runtime CSS issues where Tailwind classes reference undefined CSS variables.
>>>>>>> origin/main
