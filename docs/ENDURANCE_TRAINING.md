# Endurance Training

`asi_core/endurance_training.py` is a harness for running one `OneBrain`
(`asi_core.UnifiedBrain`) through a long training session: a curriculum of
synthetic tasks, repeated `perceive()` cycles, periodic `self_improve()`
promotion, memory-bounding `maintain()` calls, and checkpointing so a
session can be paused and resumed.

## What it does

A session picks a task at random from a curriculum (`build_task_library()`,
two tasks — `<domain>.core` and `<domain>.novel` — per expert domain: coding,
language, reasoning, research, math, vision, audio, control), feeds its
input vector into `brain.perceive()` with the task's reward, and repeats.
Every `core` task uses a consistent, high-reward pattern so repeated
exposure strengthens its hyperdimensional memory trace past
`self_improve()`'s `min_strength` and gets promoted into a permanent skill
— the same mechanism the README's own Core API Example demonstrates by
hand. Every `novel` task is noisier and sometimes low-reward, so the
session also has genuinely new material and the occasional logged mistake.

On a fixed cadence (configurable), the trainer also:

- calls `brain.self_improve()` to promote strong memory traces into skills,
- calls `brain.maintain()` to consolidate/prune HD memory and correct
  vale-ledger float drift, keeping the brain's state bounded no matter how
  long the session runs,
- records an `introspect()` snapshot (trimmed to a bounded history length),
- writes a `brain.backup()` checkpoint to disk.

A session stops on cycle count, wall-clock duration, or Ctrl-C
(`KeyboardInterrupt`), whichever comes first — and either way, it still
writes a final checkpoint and returns a full `EnduranceReport`.

## CLI usage

```bash
python3 -m asi_core.endurance_training --cycles 20000 \
    --checkpoint /tmp/onebrain.checkpoint.json \
    --report /tmp/onebrain.report.json
```

Resume a previous run instead of starting from scratch:

```bash
python3 -m asi_core.endurance_training --cycles 20000 \
    --resume-from /tmp/onebrain.checkpoint.json \
    --checkpoint /tmp/onebrain.checkpoint.json
```

### Options

| Flag | Default | Meaning |
|---|---|---|
| `--config` | `default` | `create_brain()` preset: `tiny`, `small`, `default`, `large`, `massive` |
| `--cycles` | `5000` (if neither `--cycles` nor `--seconds` given) | Stop after this many `perceive()` cycles |
| `--seconds` | none | Stop after this many wall-clock seconds |
| `--seed` | `7` | Seed for the task-selection RNG |
| `--checkpoint` | none | Path to periodically write `brain.backup()` to |
| `--checkpoint-every` | `500` | Cycles between checkpoints |
| `--resume-from` | none | Path to a previous `--checkpoint` file to `restore()` from |
| `--report` | none | Path to write the final `EnduranceReport` as JSON |
| `--self-improve-every` | `25` | Cycles between `self_improve()` calls |
| `--maintain-every` | `50` | Cycles between `maintain()` calls |
| `--introspect-every` | `200` | Cycles between `introspect()` snapshots and progress lines |
| `--min-strength` | `1.5` | `self_improve()`'s memory-trace strength threshold for promotion |
| `--bundle-extension NAME` | none | Package everything learned so far into a named `Extension` at the end of the run |
| `--quiet` | off | Suppress progress/summary printing |

## Programmatic usage

```python
from asi_core.endurance_training import EnduranceTrainer, build_task_library
from asi_core.unified_brain import create_brain

brain = create_brain("small", expert_names=["coding", "language", "reasoning", "math"])
trainer = EnduranceTrainer(brain, tasks=build_task_library(["coding", "language", "reasoning", "math"]))

report = trainer.run(max_cycles=10_000, checkpoint_path="onebrain.json")
print(report.skills_created, report.vale_invariant_ok)
```

`EnduranceReport.to_dict()` includes per-task reward statistics
(`task_stats`), skills and extensions created, mistake-tracker counts, a
bounded introspection history, and the final `introspect()` snapshot.
